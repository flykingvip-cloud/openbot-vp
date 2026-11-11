import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BExecutionServer } from "./b-server.js";
import { sha256Of } from "./checksum.js";
import { ExecHttpClient } from "./client.js";
import { isolationProfile } from "./config.js";
import { ExecConfigError, ExecProtocolError } from "./errors.js";
import { mintLease } from "./lease.js";
import { FileExecStore } from "./store.js";
import {
  MAX_REQUEST_BODY_BYTES,
  TEST_SUBJECT,
  TEST_TENANT,
  baseSubmitBody,
  createReconcileClient,
  getFreePort,
  inlineJsonInput,
  startIsolatedPair,
  uniqueIdempotencyKey,
  uniqueReconcileRequestId,
  waitFor,
} from "./test-helpers.js";
import type { ExecReconcileRequest, ExecTaskRecord } from "./types.js";

async function waitUntilUnconfirmed(
  pair: Awaited<ReturnType<typeof startIsolatedPair>>,
  taskId: string,
) {
  return waitFor(
    () =>
      pair.aClient.status({
        "exec-api-version": 1,
        tenantId: TEST_TENANT,
        taskId,
      }),
    (result) => result.payload.state === "result_unconfirmed",
    4000,
  );
}

async function submitIgnoreCancelUnconfirmed() {
  const pair = await startIsolatedPair({ cancelDeadlineMs: 80 });
  const submitted = await pair.aClient.submit(
    baseSubmitBody({
      kind: "ignore-cancel",
      sleepMs: 2000,
      input: inlineJsonInput({ hold: true }),
    }) as never,
  );
  await waitFor(
    () =>
      pair.aClient.status({
        "exec-api-version": 1,
        tenantId: TEST_TENANT,
        taskId: submitted.payload.taskId,
      }),
    (result) => result.payload.state === "running",
  );
  await pair.aClient.cancel({
    "exec-api-version": 1,
    tenantId: TEST_TENANT,
    taskId: submitted.payload.taskId,
  });
  const unconfirmed = await waitUntilUnconfirmed(pair, submitted.payload.taskId);
  return { pair, submitted, unconfirmed };
}

function remainRequest(
  taskId: string,
  expectedStateVersion: number,
  extras: Partial<ExecReconcileRequest> = {},
): ExecReconcileRequest {
  return {
    "exec-api-version": 1,
    tenantId: TEST_TENANT,
    taskId,
    expectedStateVersion,
    reconcileRequestId: uniqueReconcileRequestId(),
    conclusion: "remain_unconfirmed",
    reason: "operator cannot confirm the result yet",
    evidenceRef: { kind: "operator-note", note: "still unconfirmed" },
    ...extras,
  };
}

describe("single-writer store fence and persist rollback", () => {
  it("refuses a second FileExecStore on the same directory while the first is open, then allows open after close", async () => {
    const dir = await mkdtemp(join(tmpdir(), "exec-protocol-lock-"));
    const first = new FileExecStore(dir);
    const second = new FileExecStore(dir);
    const third = new FileExecStore(dir);
    try {
      await first.load();
      await expect(second.load()).rejects.toThrow(ExecConfigError);
      await expect(second.load()).rejects.toThrow(/another process already holds this store/);
      await first.close();
      await third.load();
      expect(third.data().tasks).toEqual({});
    } finally {
      await first.close();
      await second.close();
      await third.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rolls back in-memory state when persist fails and does not report success", async () => {
    const dir = await mkdtemp(join(tmpdir(), "exec-protocol-persist-"));
    const store = new FileExecStore(dir);
    try {
      await store.load();
      const now = new Date(1_700_000_000_000).toISOString();
      const task: ExecTaskRecord = {
        taskId: "task-persist-1",
        toolCallId: "tool-persist-1",
        tenantId: TEST_TENANT,
        subject: TEST_SUBJECT,
        kind: "echo",
        idempotencyKey: uniqueIdempotencyKey(),
        intentCanonical: "{}",
        state: "accepted",
        input: inlineJsonInput({ persist: true }),
        createdAt: now,
        updatedAt: now,
        createdAtMs: 1_700_000_000_000,
        updatedAtMs: 1_700_000_000_000,
        idempotencyExpiresAtMs: 1_700_086_400_000,
        artifacts: [],
        stateVersion: 1,
      };
      await store.upsertTask(task);
      expect(store.getTask(task.taskId)?.stateVersion).toBe(1);
      store.failNextPersist(1);
      const mutated = store.getTask(task.taskId);
      if (!mutated) {
        throw new Error("expected stored task");
      }
      mutated.state = "succeeded";
      await expect(store.upsertTask(mutated)).rejects.toThrow(/injected persist failure/);
      const rolledBack = store.getTask(task.taskId);
      expect(rolledBack?.state).toBe("accepted");
      expect(rolledBack?.stateVersion).toBe(1);
    } finally {
      await store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not return HTTP success after a persist failure", async () => {
    const pair = await startIsolatedPair({}, { autoStartExecution: false });
    try {
      const submitted = await pair.aClient.submit(baseSubmitBody({}) as never);
      const beforeState = pair.aStore.getTask(submitted.payload.taskId)?.state;
      expect(beforeState).not.toBe("cancel_requested");
      pair.aStore.failNextPersist(1);
      await expect(
        pair.aClient.cancel({
          "exec-api-version": 1,
          tenantId: TEST_TENANT,
          taskId: submitted.payload.taskId,
        }),
      ).rejects.toBeInstanceOf(ExecProtocolError);
      const after = pair.aStore.getTask(submitted.payload.taskId);
      expect(after?.state).toBe(beforeState);
      expect(after?.state).not.toBe("cancel_requested");
      expect(after?.state).not.toBe("cancelled");
    } finally {
      await pair.stop();
    }
  });
});

describe("transport retry sequence", () => {
  it("attempts status three times, sleeps 200 then 400, and never retries submit", async () => {
    const port = await getFreePort();
    const sleeps: number[] = [];
    const config = isolationProfile({
      port,
      connectTimeoutMs: 50,
      requestTimeoutMs: 100,
    });
    expect(config.transportBackoffMs).toEqual([200, 400]);
    const client = new ExecHttpClient({
      baseUrl: `http://127.0.0.1:${port}`,
      config,
      leaseToken: `exec1_${"ab".repeat(32)}`,
      maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
      runtime: {
        now: () => Date.now(),
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    });
    await expect(
      client.status({
        "exec-api-version": 1,
        tenantId: TEST_TENANT,
        taskId: "task-missing",
      }),
    ).rejects.toMatchObject({ code: "EXEC_UNREACHABLE" });
    expect(sleeps).toEqual([200, 400]);
    expect(sleeps).not.toContain(800);

    const submitSleeps: number[] = [];
    const submitClient = new ExecHttpClient({
      baseUrl: `http://127.0.0.1:${port}`,
      config,
      leaseToken: `exec1_${"cd".repeat(32)}`,
      maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
      runtime: {
        now: () => Date.now(),
        sleep: async (ms) => {
          submitSleeps.push(ms);
        },
      },
    });
    await expect(submitClient.submit(baseSubmitBody({}) as never)).rejects.toMatchObject({
      code: "EXEC_UNREACHABLE",
    });
    expect(submitSleeps).toEqual([]);
  });
});

describe("tenant-bounded idempotency", () => {
  it("lets two tenants share an idempotency key while the same tenant still deduplicates concurrent submits", async () => {
    const pair = await startIsolatedPair({}, { leaseTenantId: null });
    try {
      const sharedKey = uniqueIdempotencyKey("shared");
      const otherTenant = "tenant-isolation-2";
      const otherLease = mintLease({
        subject: TEST_SUBJECT,
        nowMs: Date.now(),
        ttlMs: pair.configA.leaseTtlMs,
        tenantId: otherTenant,
      });
      await pair.a.registerLease(otherLease.record);
      await pair.b.registerLease(otherLease.record);
      const otherClient = new ExecHttpClient({
        baseUrl: pair.a.baseUrl,
        config: pair.configA,
        leaseToken: otherLease.token,
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
      });
      const first = await pair.aClient.submit(
        baseSubmitBody({
          idempotencyKey: sharedKey,
          toolCallId: uniqueIdempotencyKey("tool-a"),
          input: inlineJsonInput({ tenant: "one" }),
        }) as never,
      );
      const second = await otherClient.submit(
        baseSubmitBody({
          tenantId: otherTenant,
          idempotencyKey: sharedKey,
          toolCallId: uniqueIdempotencyKey("tool-b"),
          input: inlineJsonInput({ tenant: "two" }),
        }) as never,
      );
      expect(second.payload.taskId).not.toBe(first.payload.taskId);
      expect(second.payload.tenantId).toBe(otherTenant);

      const sameTenantKey = uniqueIdempotencyKey("same-tenant");
      const body = baseSubmitBody({
        idempotencyKey: sameTenantKey,
        toolCallId: uniqueIdempotencyKey("tool-same"),
        input: inlineJsonInput({ tenant: "same" }),
      });
      const started = pair.b.debug().executionsStarted;
      const [one, two] = await Promise.all([
        pair.aClient.submit(body as never),
        pair.aClient.submit(body as never),
      ]);
      expect(one.payload.taskId).toBe(two.payload.taskId);
      await waitFor(
        () =>
          pair.aClient.status({
            "exec-api-version": 1,
            tenantId: TEST_TENANT,
            taskId: one.payload.taskId,
          }),
        (result) => result.payload.state === "succeeded",
      );
      expect(pair.b.debug().executionsStarted).toBe(started + 1);
    } finally {
      await pair.stop();
    }
  });
});

describe("result_unconfirmed reconcile entry", () => {
  it("rejects reconcile from an ordinary execution lease", async () => {
    const { pair, unconfirmed } = await submitIgnoreCancelUnconfirmed();
    try {
      await expect(
        pair.aClient.reconcile(
          remainRequest(unconfirmed.payload.taskId, unconfirmed.payload.stateVersion),
        ),
      ).rejects.toMatchObject({ code: "EXEC_UNAUTHORIZED", httpStatus: 401 });
      expect(pair.aStore.getTask(unconfirmed.payload.taskId)?.state).toBe("result_unconfirmed");
    } finally {
      await pair.stop();
    }
  });

  it("rejects confirming success without a verified artifact and stays result_unconfirmed", async () => {
    const { pair, unconfirmed } = await submitIgnoreCancelUnconfirmed();
    try {
      const reconciler = await createReconcileClient(pair);
      await expect(
        reconciler.client.reconcile({
          "exec-api-version": 1,
          tenantId: TEST_TENANT,
          taskId: unconfirmed.payload.taskId,
          expectedStateVersion: unconfirmed.payload.stateVersion,
          reconcileRequestId: uniqueReconcileRequestId(),
          conclusion: "succeeded",
          reason: "attempt to confirm success without bytes",
          evidenceRef: {
            kind: "artifact-verified",
            artifactId: "artifact-does-not-exist",
            sha256: "0".repeat(64),
            byteCount: 4,
          },
        }),
      ).rejects.toBeInstanceOf(ExecProtocolError);
      expect(pair.aStore.getTask(unconfirmed.payload.taskId)?.state).toBe("result_unconfirmed");
    } finally {
      await pair.stop();
    }
  });

  it("rejects confirming cancel when only a cancel request was sent", async () => {
    const { pair, unconfirmed } = await submitIgnoreCancelUnconfirmed();
    try {
      const local = pair.aStore.getTask(unconfirmed.payload.taskId);
      expect(local?.cancelRequestedAtMs).toBeTypeOf("number");
      expect(local?.state).toBe("result_unconfirmed");
      const reconciler = await createReconcileClient(pair);
      await expect(
        reconciler.client.reconcile({
          "exec-api-version": 1,
          tenantId: TEST_TENANT,
          taskId: unconfirmed.payload.taskId,
          expectedStateVersion: unconfirmed.payload.stateVersion,
          reconcileRequestId: uniqueReconcileRequestId(),
          conclusion: "cancelled",
          reason: "cancel was sent so this must be cancelled",
          evidenceRef: { kind: "b-cancelled-confirmed" },
        }),
      ).rejects.toMatchObject({ code: "EXEC_CONFLICT" });
      expect(pair.aStore.getTask(unconfirmed.payload.taskId)?.state).toBe("result_unconfirmed");
    } finally {
      await pair.stop();
    }
  });

  it("records remain_unconfirmed without closing the task", async () => {
    const { pair, unconfirmed } = await submitIgnoreCancelUnconfirmed();
    try {
      const reconciler = await createReconcileClient(pair);
      const requestId = uniqueReconcileRequestId();
      const result = await reconciler.client.reconcile(
        remainRequest(unconfirmed.payload.taskId, unconfirmed.payload.stateVersion, {
          reconcileRequestId: requestId,
        }),
      );
      expect(result.httpStatus).toBe(200);
      expect(result.payload.state).toBe("result_unconfirmed");
      expect(result.payload.conclusion).toBe("remain_unconfirmed");
      expect(result.payload.previousState).toBe("result_unconfirmed");
      expect(result.payload.newState).toBe("result_unconfirmed");
      expect(result.payload.operator).toBe("reconcile-operator");
      expect(result.payload.reconcileRequestId).toBe(requestId);
      expect(result.payload.stateVersion).toBeGreaterThan(unconfirmed.payload.stateVersion);
      const audits = pair.aStore.listReconcileAudits(unconfirmed.payload.taskId);
      expect(audits).toHaveLength(1);
      expect(audits[0]?.reason).toContain("cannot confirm");
      expect(pair.aStore.getTask(unconfirmed.payload.taskId)?.state).toBe("result_unconfirmed");
    } finally {
      await pair.stop();
    }
  });

  it("rejects a stale expectedStateVersion", async () => {
    const { pair, unconfirmed } = await submitIgnoreCancelUnconfirmed();
    try {
      const reconciler = await createReconcileClient(pair);
      await expect(
        reconciler.client.reconcile(
          remainRequest(unconfirmed.payload.taskId, unconfirmed.payload.stateVersion - 1),
        ),
      ).rejects.toMatchObject({ code: "EXEC_CONFLICT" });
      expect(pair.aStore.getTask(unconfirmed.payload.taskId)?.state).toBe("result_unconfirmed");
    } finally {
      await pair.stop();
    }
  });

  it("replays an identical reconcileRequestId and conflicts when the same id is reused with different fields", async () => {
    const { pair, unconfirmed } = await submitIgnoreCancelUnconfirmed();
    try {
      const reconciler = await createReconcileClient(pair);
      const request = remainRequest(unconfirmed.payload.taskId, unconfirmed.payload.stateVersion);
      const first = await reconciler.client.reconcile(request);
      const second = await reconciler.client.reconcile(request);
      expect(second.payload.conclusion).toBe(first.payload.conclusion);
      expect(second.payload.newState).toBe("result_unconfirmed");
      expect(pair.aStore.listReconcileAudits(unconfirmed.payload.taskId)).toHaveLength(1);
      await expect(
        reconciler.client.reconcile({
          ...request,
          conclusion: "failed",
          evidenceRef: { kind: "b-failed-confirmed" },
          reason: "conflicting conclusion for the same request id",
        }),
      ).rejects.toMatchObject({ code: "EXEC_CONFLICT" });
    } finally {
      await pair.stop();
    }
  });

  it("does not re-run the executor or increment B' executionsStarted", async () => {
    const { pair, unconfirmed } = await submitIgnoreCancelUnconfirmed();
    try {
      const started = pair.b.debug().executionsStarted;
      const reconciler = await createReconcileClient(pair);
      await reconciler.client.reconcile(
        remainRequest(unconfirmed.payload.taskId, unconfirmed.payload.stateVersion),
      );
      expect(pair.b.debug().executionsStarted).toBe(started);
      expect(pair.plane.debug().executionsStarted).toBe(0);
    } finally {
      await pair.stop();
    }
  });

  it("confirms success only with verified task artifact bytes and does not re-execute", async () => {
    const { pair, unconfirmed } = await submitIgnoreCancelUnconfirmed();
    try {
      const task = pair.aStore.getTask(unconfirmed.payload.taskId);
      expect(task).toBeDefined();
      const bytes = Buffer.from("reconcile-verified-artifact");
      const sha256 = sha256Of(bytes);
      const artifactId = `artifact-${unconfirmed.payload.taskId.slice(0, 12)}`;
      const meta = {
        artifactId,
        taskId: unconfirmed.payload.taskId,
        toolCallId: unconfirmed.payload.toolCallId,
        tenantId: TEST_TENANT,
        sha256,
        byteCount: bytes.byteLength,
        fileName: `${artifactId}.bin`,
      };
      await pair.aStore.putArtifactBytes(meta, bytes);
      await pair.bStore.putArtifactBytes(meta, bytes);
      const started = pair.b.debug().executionsStarted;
      const reconciler = await createReconcileClient(pair);
      const result = await reconciler.client.reconcile({
        "exec-api-version": 1,
        tenantId: TEST_TENANT,
        taskId: unconfirmed.payload.taskId,
        expectedStateVersion: unconfirmed.payload.stateVersion,
        reconcileRequestId: uniqueReconcileRequestId(),
        conclusion: "succeeded",
        reason: "artifact bytes were verified on both sides",
        evidenceRef: { kind: "artifact-verified", artifactId, sha256, byteCount: bytes.byteLength },
      });
      expect(result.httpStatus).toBe(200);
      expect(result.payload.state).toBe("succeeded");
      expect(result.payload.conclusion).toBe("succeeded");
      expect(pair.aStore.getTask(unconfirmed.payload.taskId)?.state).toBe("succeeded");
      expect(pair.bStore.getTask(unconfirmed.payload.taskId)?.state).toBe("succeeded");
      expect(pair.b.debug().executionsStarted).toBe(started);
    } finally {
      await pair.stop();
    }
  });

  it("refuses failed when a side effect was applied and B' has not confirmed failure", async () => {
    const pair = await startIsolatedPair();
    const probeId = uniqueIdempotencyKey("probe");
    try {
      const submitted = await pair.aClient.submit(
        baseSubmitBody({
          kind: "side-effect-probe",
          probeId,
          sleepMs: 3000,
          input: inlineJsonInput({ probe: true }),
        }) as never,
      );
      await waitFor(
        () => pair.bStore.getProbe(probeId),
        (count) => count === 1,
        4000,
      );
      const bDir = pair.bDir;
      const leaseRecord = pair.leaseRecord;
      const configB = pair.configB;
      await pair.b.stop();
      const restartedStore = new FileExecStore(bDir);
      const restarted = new BExecutionServer({
        config: configB,
        store: restartedStore,
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
      });
      await restarted.start();
      await restarted.registerLease(leaseRecord);
      try {
        const unconfirmed = await waitUntilUnconfirmed(pair, submitted.payload.taskId);
        expect(pair.aStore.getTask(submitted.payload.taskId)?.sideEffectApplied).toBe(true);
        const started = restarted.debug().executionsStarted;
        const reconciler = await createReconcileClient(pair);
        await expect(
          reconciler.client.reconcile({
            "exec-api-version": 1,
            tenantId: TEST_TENANT,
            taskId: submitted.payload.taskId,
            expectedStateVersion: unconfirmed.payload.stateVersion,
            reconcileRequestId: uniqueReconcileRequestId(),
            conclusion: "failed",
            reason: "force fail after a side effect",
            evidenceRef: { kind: "b-failed-confirmed" },
          }),
        ).rejects.toMatchObject({ code: "EXEC_CONFLICT" });
        expect(pair.aStore.getTask(submitted.payload.taskId)?.state).toBe("result_unconfirmed");
        expect(restarted.debug().executionsStarted).toBe(started);
      } finally {
        await restarted.stop();
      }
    } finally {
      await pair.stop();
    }
  });
});
