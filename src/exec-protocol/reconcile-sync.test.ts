import { describe, expect, it } from "vitest";
import { AControlPlane } from "./a-control-plane.js";
import { AControlServer } from "./a-server.js";
import { BExecutionServer } from "./b-server.js";
import { sha256Of } from "./checksum.js";
import { ExecHttpClient } from "./client.js";
import { FileExecStore } from "./store.js";
import {
  MAX_REQUEST_BODY_BYTES,
  TEST_SUBJECT,
  TEST_TENANT,
  baseSubmitBody,
  createReconcileClient,
  inlineJsonInput,
  startIsolatedPair,
  uniqueIdempotencyKey,
  uniqueReconcileRequestId,
  waitFor,
} from "./test-helpers.js";
import type { ExecReconcileRequest } from "./types.js";

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

async function attachVerifiedArtifact(
  pair: Awaited<ReturnType<typeof startIsolatedPair>>,
  unconfirmed: { payload: { taskId: string; toolCallId: string } },
  body = "reconcile-sync-artifact",
) {
  const bytes = Buffer.from(body);
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
  return { artifactId, sha256, byteCount: bytes.byteLength };
}

function successRequest(
  taskId: string,
  expectedStateVersion: number,
  evidence: { artifactId: string; sha256: string; byteCount: number },
  extras: Partial<ExecReconcileRequest> = {},
): ExecReconcileRequest {
  return {
    "exec-api-version": 1,
    tenantId: TEST_TENANT,
    taskId,
    expectedStateVersion,
    reconcileRequestId: uniqueReconcileRequestId(),
    conclusion: "succeeded",
    reason: "artifact bytes were verified on both sides",
    evidenceRef: { kind: "artifact-verified", ...evidence },
    ...extras,
  };
}

describe("durable A→B reconcile sync", () => {
  it("commits the conclusion and pending-sync record atomically; persist failure leaves neither", async () => {
    const { pair, unconfirmed } = await submitIgnoreCancelUnconfirmed();
    try {
      const evidence = await attachVerifiedArtifact(pair, unconfirmed);
      const reconciler = await createReconcileClient(pair);
      pair.aStore.failNextPersist(1);
      await expect(
        reconciler.client.reconcile(
          successRequest(unconfirmed.payload.taskId, unconfirmed.payload.stateVersion, evidence),
        ),
      ).rejects.toThrow();
      const task = pair.aStore.getTask(unconfirmed.payload.taskId);
      expect(task?.state).toBe("result_unconfirmed");
      expect(pair.aStore.listReconcileAudits(unconfirmed.payload.taskId)).toHaveLength(0);
      expect(pair.aStore.listReconcileSyncs(unconfirmed.payload.taskId)).toHaveLength(0);
      expect(pair.bStore.getTask(unconfirmed.payload.taskId)?.state).toBe("result_unconfirmed");
    } finally {
      await pair.stop();
    }
  });

  it("keeps a pending sync when B is unreachable, then resumes after A restart", async () => {
    const { pair, unconfirmed } = await submitIgnoreCancelUnconfirmed();
    const evidence = await attachVerifiedArtifact(pair, unconfirmed);
    const aDir = pair.aDir;
    const bDir = pair.bDir;
    const configA = pair.configA;
    const configB = pair.configB;
    const leaseRecord = pair.leaseRecord;
    const leaseToken = pair.leaseToken;
    try {
      await pair.b.stop();
      const reconciler = await createReconcileClient(pair);
      const result = await reconciler.client.reconcile(
        successRequest(unconfirmed.payload.taskId, unconfirmed.payload.stateVersion, evidence),
      );
      expect(result.payload.state).toBe("succeeded");
      expect(result.payload.conclusionCommitted).toBe(true);
      expect(result.payload.bSyncConfirmed).toBe(false);
      expect(result.payload.reconcileSyncState).toBe("pending_sync");
      expect(result.payload.needsHuman).toBe(false);
      const pending = pair.aStore.latestReconcileSync(unconfirmed.payload.taskId);
      expect(pending?.syncState).toBe("pending_sync");
      await pair.a.stop();

      const bStore = new FileExecStore(bDir);
      const b = new BExecutionServer({
        config: configB,
        store: bStore,
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
        autoStartExecution: false,
      });
      await b.start();
      await b.registerLease(leaseRecord);
      expect(bStore.getTask(unconfirmed.payload.taskId)?.state).toBe("result_unconfirmed");

      const aStore = new FileExecStore(aDir);
      const bClient = new ExecHttpClient({
        baseUrl: b.baseUrl,
        config: configA,
        leaseToken,
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
      });
      const plane = new AControlPlane({
        config: configA,
        store: aStore,
        client: bClient,
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
        subject: TEST_SUBJECT,
      });
      const a = new AControlServer({
        config: configA,
        store: aStore,
        plane,
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
      });
      await a.start();
      await a.registerLease(leaseRecord);
      const sync = aStore.latestReconcileSync(unconfirmed.payload.taskId);
      expect(sync?.syncState).toBe("synced");
      expect(aStore.getTask(unconfirmed.payload.taskId)?.state).toBe("succeeded");
      expect(bStore.getTask(unconfirmed.payload.taskId)?.state).toBe("succeeded");
      const status = await new ExecHttpClient({
        baseUrl: a.baseUrl,
        config: configA,
        leaseToken,
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
      }).status({
        "exec-api-version": 1,
        tenantId: TEST_TENANT,
        taskId: unconfirmed.payload.taskId,
      });
      expect(status.payload.conclusionCommitted).toBe(true);
      expect(status.payload.bSyncConfirmed).toBe(true);
      expect(status.payload.reconcileSyncState).toBe("synced");
      await a.stop();
      await b.stop();
    } finally {
      await pair.stop();
    }
  });

  it("applies the same reconcileRequestId + digest idempotently when B applied but the response was lost", async () => {
    const { pair, unconfirmed } = await submitIgnoreCancelUnconfirmed();
    try {
      const evidence = await attachVerifiedArtifact(pair, unconfirmed);
      const started = pair.b.debug().executionsStarted;
      pair.b.dropNextReconcileApplyResponses(3);
      const reconciler = await createReconcileClient(pair);
      const result = await reconciler.client.reconcile(
        successRequest(unconfirmed.payload.taskId, unconfirmed.payload.stateVersion, evidence),
      );
      expect(result.payload.state).toBe("succeeded");
      expect(result.payload.conclusionCommitted).toBe(true);
      expect(result.payload.bSyncConfirmed).toBe(false);
      expect(result.payload.reconcileSyncState).toBe("pending_sync");
      expect(pair.bStore.getTask(unconfirmed.payload.taskId)?.state).toBe("succeeded");
      await pair.plane.stopReconcileSyncScheduler();
      await pair.plane.resumePendingReconcileSyncs();
      const sync = pair.aStore.latestReconcileSync(unconfirmed.payload.taskId);
      expect(sync?.syncState).toBe("synced");
      expect(pair.bStore.getTask(unconfirmed.payload.taskId)?.state).toBe("succeeded");
      expect(pair.b.debug().executionsStarted).toBe(started);
    } finally {
      await pair.stop();
    }
  });

  it("turns a conflicting B apply into sync_conflict and does not retry it forever", async () => {
    const { pair, unconfirmed } = await submitIgnoreCancelUnconfirmed();
    try {
      const evidence = await attachVerifiedArtifact(pair, unconfirmed);
      await pair.bClient.reconcileApply({
        "exec-api-version": 1,
        tenantId: TEST_TENANT,
        taskId: unconfirmed.payload.taskId,
        expectedStateVersion: pair.bStore.getTask(unconfirmed.payload.taskId)?.stateVersion ?? 1,
        reconcileRequestId: uniqueReconcileRequestId(),
        conclusion: "failed",
        reason: "B already applied a conflicting local conclusion",
        evidenceRef: { kind: "b-failed-confirmed" },
      });
      expect(pair.bStore.getTask(unconfirmed.payload.taskId)?.state).toBe("failed");
      const reconciler = await createReconcileClient(pair);
      const result = await reconciler.client.reconcile(
        successRequest(unconfirmed.payload.taskId, unconfirmed.payload.stateVersion, evidence),
      );
      expect(result.payload.state).toBe("succeeded");
      expect(result.payload.reconcileSyncState).toBe("sync_conflict");
      expect(result.payload.needsHuman).toBe(true);
      expect(result.payload.bSyncConfirmed).toBe(false);
      expect(pair.plane.listHumanReconcileConflicts()).toHaveLength(1);
      const attempts =
        pair.aStore.latestReconcileSync(unconfirmed.payload.taskId)?.attemptCount ?? 0;
      await pair.plane.resumePendingReconcileSyncs();
      const after = pair.aStore.latestReconcileSync(unconfirmed.payload.taskId);
      expect(after?.syncState).toBe("sync_conflict");
      expect(after?.attemptCount).toBe(attempts);
      expect(pair.bStore.getTask(unconfirmed.payload.taskId)?.state).toBe("failed");
      expect(pair.plane.listHumanReconcileConflicts()).toEqual([after]);
    } finally {
      await pair.stop();
    }
  });

  it("rejects the same request id with a different conclusion as a permanent conflict", async () => {
    const { pair, unconfirmed } = await submitIgnoreCancelUnconfirmed();
    try {
      const evidence = await attachVerifiedArtifact(pair, unconfirmed);
      const reconciler = await createReconcileClient(pair);
      const request = successRequest(
        unconfirmed.payload.taskId,
        unconfirmed.payload.stateVersion,
        evidence,
      );
      await reconciler.client.reconcile(request);
      await expect(
        reconciler.client.reconcile({
          ...request,
          conclusion: "failed",
          evidenceRef: { kind: "b-failed-confirmed" },
          reason: "conflicting conclusion for the same request id",
        }),
      ).rejects.toMatchObject({ code: "EXEC_CONFLICT" });
      expect(pair.aStore.listReconcileSyncs(unconfirmed.payload.taskId)).toHaveLength(1);
    } finally {
      await pair.stop();
    }
  });

  it("does not compare A.stateVersion to B.stateVersion and lets B reject stale applies locally", async () => {
    const { pair, unconfirmed } = await submitIgnoreCancelUnconfirmed();
    try {
      const evidence = await attachVerifiedArtifact(pair, unconfirmed);
      const aBefore = pair.aStore.getTask(unconfirmed.payload.taskId)?.stateVersion ?? 0;
      const bBefore = pair.bStore.getTask(unconfirmed.payload.taskId)?.stateVersion ?? 0;
      expect(aBefore).not.toBe(bBefore);
      const reconciler = await createReconcileClient(pair);
      const result = await reconciler.client.reconcile(
        successRequest(unconfirmed.payload.taskId, aBefore, evidence),
      );
      expect(result.payload.state).toBe("succeeded");
      expect(result.payload.reconcileSyncState).toBe("synced");
      const aAfter = pair.aStore.getTask(unconfirmed.payload.taskId)?.stateVersion ?? 0;
      const bAfter = pair.bStore.getTask(unconfirmed.payload.taskId)?.stateVersion ?? 0;
      expect(aAfter).toBe(aBefore + 1);
      expect(bAfter).toBe(bBefore + 1);
      expect(aAfter).not.toBe(bAfter);

      await expect(
        pair.bClient.reconcileApply({
          "exec-api-version": 1,
          tenantId: TEST_TENANT,
          taskId: unconfirmed.payload.taskId,
          expectedStateVersion: 1,
          reconcileRequestId: uniqueReconcileRequestId(),
          conclusion: "failed",
          reason: "out-of-order conflicting apply",
          evidenceRef: { kind: "b-failed-confirmed" },
        }),
      ).rejects.toMatchObject({ code: "EXEC_CONFLICT" });
      expect(pair.bStore.getTask(unconfirmed.payload.taskId)?.state).toBe("succeeded");
    } finally {
      await pair.stop();
    }
  });

  it("refuses re-execution of the original task while sync is still pending", async () => {
    const { pair, unconfirmed, submitted } = await submitIgnoreCancelUnconfirmed();
    const evidence = await attachVerifiedArtifact(pair, unconfirmed);
    const started = pair.b.debug().executionsStarted;
    const bDir = pair.bDir;
    const configB = pair.configB;
    const leaseRecord = pair.leaseRecord;
    try {
      await pair.b.stop();
      const reconciler = await createReconcileClient(pair);
      const result = await reconciler.client.reconcile(
        successRequest(unconfirmed.payload.taskId, unconfirmed.payload.stateVersion, evidence),
      );
      expect(result.payload.reconcileSyncState).toBe("pending_sync");
      await pair.plane.stopReconcileSyncScheduler();
      const replay = await pair.aClient.submit({
        ...baseSubmitBody({
          idempotencyKey: submitted.payload.taskId ? undefined : uniqueIdempotencyKey(),
        }),
        idempotencyKey: pair.aStore.getTask(unconfirmed.payload.taskId)?.idempotencyKey,
        toolCallId: submitted.payload.toolCallId,
        input: inlineJsonInput({ hold: true }),
        kind: "ignore-cancel",
        sleepMs: 2000,
      } as never);
      expect(replay.payload.taskId).toBe(unconfirmed.payload.taskId);
      expect(replay.payload.state).toBe("succeeded");
      expect(replay.payload.conclusionCommitted).toBe(true);
      expect(replay.payload.bSyncConfirmed).toBe(false);

      await expect(
        reconciler.client.reconcile({
          "exec-api-version": 1,
          tenantId: TEST_TENANT,
          taskId: unconfirmed.payload.taskId,
          expectedStateVersion: pair.aStore.getTask(unconfirmed.payload.taskId)?.stateVersion ?? 0,
          reconcileRequestId: uniqueReconcileRequestId(),
          conclusion: "failed",
          reason: "conflicting closing conclusion while pending_sync",
          evidenceRef: { kind: "b-failed-confirmed" },
        }),
      ).rejects.toMatchObject({ code: "EXEC_CONFLICT" });

      const bStore = new FileExecStore(bDir);
      const b = new BExecutionServer({
        config: configB,
        store: bStore,
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
        autoStartExecution: true,
      });
      await b.start();
      await b.registerLease(leaseRecord);
      b.startQueued(unconfirmed.payload.taskId);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(b.debug().executionsStarted).toBe(0);
      expect(bStore.getTask(unconfirmed.payload.taskId)?.state).toBe("result_unconfirmed");
      await pair.plane.resumePendingReconcileSyncs();
      expect(bStore.getTask(unconfirmed.payload.taskId)?.state).toBe("succeeded");
      expect(b.debug().executionsStarted).toBe(0);
      expect(started).toBeGreaterThan(0);
      await b.stop();
    } finally {
      await pair.stop();
    }
  });

  it("continues sync after A and B restart independently", async () => {
    const { pair, unconfirmed } = await submitIgnoreCancelUnconfirmed();
    const evidence = await attachVerifiedArtifact(pair, unconfirmed);
    const aDir = pair.aDir;
    const bDir = pair.bDir;
    const configA = pair.configA;
    const configB = pair.configB;
    const leaseRecord = pair.leaseRecord;
    const leaseToken = pair.leaseToken;
    try {
      await pair.b.stop();
      const reconciler = await createReconcileClient(pair);
      await reconciler.client.reconcile(
        successRequest(unconfirmed.payload.taskId, unconfirmed.payload.stateVersion, evidence),
      );
      expect(pair.aStore.latestReconcileSync(unconfirmed.payload.taskId)?.syncState).toBe(
        "pending_sync",
      );
      await pair.a.stop();

      const bStore = new FileExecStore(bDir);
      const b = new BExecutionServer({
        config: configB,
        store: bStore,
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
        autoStartExecution: false,
      });
      await b.start();
      await b.registerLease(leaseRecord);

      const aStore = new FileExecStore(aDir);
      const plane = new AControlPlane({
        config: configA,
        store: aStore,
        client: new ExecHttpClient({
          baseUrl: b.baseUrl,
          config: configA,
          leaseToken,
          maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
        }),
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
        subject: TEST_SUBJECT,
      });
      await plane.loadAndReconcile();
      expect(aStore.latestReconcileSync(unconfirmed.payload.taskId)?.syncState).toBe("synced");
      expect(bStore.getTask(unconfirmed.payload.taskId)?.state).toBe("succeeded");
      await aStore.close();
      await b.stop();
    } finally {
      await pair.stop();
    }
  });
});
