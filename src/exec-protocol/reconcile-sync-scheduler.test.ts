import { describe, expect, it } from "vitest";
import { AControlPlane } from "./a-control-plane.js";
import { AControlServer } from "./a-server.js";
import { BExecutionServer } from "./b-server.js";
import { sha256Of } from "./checksum.js";
import { ExecHttpClient } from "./client.js";
import {
  evaluateReconcileSyncAlerts,
  nextReconcileSyncDueAtMs,
  ReconcileSyncScheduler,
  type ReconcileSyncAlert,
  type ReconcileSyncRecoveryOptions,
} from "./reconcile-sync-scheduler.js";
import { FileExecStore } from "./store.js";
import {
  MAX_REQUEST_BODY_BYTES,
  TEST_SUBJECT,
  TEST_TENANT,
  baseSubmitBody,
  createReconcileClient,
  inlineJsonInput,
  startIsolatedPair,
  uniqueReconcileRequestId,
  waitFor,
} from "./test-helpers.js";
import type { ExecReconcileRequest, ExecReconcileSyncRecord } from "./types.js";

function pendingRecord(overrides: Partial<ExecReconcileSyncRecord> = {}): ExecReconcileSyncRecord {
  const reconcileRequestId = overrides.reconcileRequestId ?? "recon-1";
  const taskId = overrides.taskId ?? "task-1";
  return {
    tenantId: TEST_TENANT,
    taskId,
    reconcileRequestId,
    conclusion: "succeeded",
    conclusionDigest: "digest-1",
    syncState: "pending_sync",
    aStateVersionAtCommit: 1,
    requestExpectedStateVersion: 0,
    previousAState: "result_unconfirmed",
    newAState: "succeeded",
    applyPayload: {
      "exec-api-version": 1,
      tenantId: TEST_TENANT,
      taskId,
      expectedStateVersion: 0,
      reconcileRequestId,
      conclusion: "succeeded",
      reason: "test",
      evidenceRef: { kind: "operator-note", note: "test" },
    },
    attemptCount: 1,
    committedAt: "2026-11-11T00:00:00.000Z",
    committedAtMs: 1_000_000,
    lastAttemptAtMs: 1_000_000,
    needsHuman: false,
    ...overrides,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

function createSchedulerHarness(
  options: {
    backoffMs?: readonly number[];
    maxRecoveryMs?: number;
    alertPendingAgeMs?: number;
    alertWindowRemainingMs?: number;
    maxInFlight?: number;
    tickMs?: number;
    nowMs?: number;
  } = {},
) {
  let nowMs = options.nowMs ?? 1_000_000;
  const sleeps: Array<{ due: number; resolve: () => void }> = [];
  const attempts: string[] = [];
  const inFlight = new Map<string, (result: ExecReconcileSyncRecord) => void>();
  const records = new Map<string, ExecReconcileSyncRecord>();
  const alerts: ReconcileSyncAlert[] = [];

  const scheduler = new ReconcileSyncScheduler({
    now: () => nowMs,
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        sleeps.push({ due: nowMs + ms, resolve });
      }),
    listPending: () =>
      [...records.values()].filter((record) => record.syncState === "pending_sync"),
    attemptSync: (record) =>
      new Promise<ExecReconcileSyncRecord>((resolve) => {
        attempts.push(record.reconcileRequestId);
        inFlight.set(record.reconcileRequestId, resolve);
      }),
    onAlert: (alert) => {
      alerts.push(alert);
    },
    backoffMs: options.backoffMs ?? [1000, 2000, 4000],
    maxRecoveryMs: options.maxRecoveryMs ?? 10_000,
    alertPendingAgeMs: options.alertPendingAgeMs ?? 4000,
    alertWindowRemainingMs: options.alertWindowRemainingMs ?? 2000,
    maxInFlight: options.maxInFlight ?? 2,
    tickMs: options.tickMs ?? 100,
  });

  function add(record: ExecReconcileSyncRecord): void {
    records.set(record.reconcileRequestId, record);
  }

  function resolveAttempt(
    reconcileRequestId: string,
    patch: Partial<ExecReconcileSyncRecord>,
  ): ExecReconcileSyncRecord {
    const current = records.get(reconcileRequestId);
    if (!current) {
      throw new Error(`missing record ${reconcileRequestId}`);
    }
    const next = { ...current, ...patch, lastAttemptAtMs: nowMs };
    records.set(reconcileRequestId, next);
    const resolve = inFlight.get(reconcileRequestId);
    inFlight.delete(reconcileRequestId);
    if (!resolve) {
      throw new Error(`no in-flight apply for ${reconcileRequestId}`);
    }
    resolve(next);
    return next;
  }

  async function drain(): Promise<void> {
    for (let i = 0; i < 20; i += 1) {
      const due = sleeps.filter((entry) => entry.due <= nowMs);
      if (due.length === 0) {
        await flush();
        if (sleeps.every((entry) => entry.due > nowMs)) {
          return;
        }
        continue;
      }
      const rest = sleeps.filter((entry) => entry.due > nowMs);
      sleeps.length = 0;
      sleeps.push(...rest);
      for (const entry of due) {
        entry.resolve();
      }
      await flush();
    }
  }

  async function advance(ms: number): Promise<void> {
    nowMs += ms;
    await drain();
  }

  async function stop(): Promise<void> {
    const stopPromise = scheduler.stop();
    await flush();
    for (const id of Array.from(inFlight.keys())) {
      const current = records.get(id);
      if (!current) {
        continue;
      }
      resolveAttempt(id, { attemptCount: current.attemptCount, syncState: current.syncState });
    }
    await flush();
    await stopPromise;
  }

  return {
    scheduler,
    attempts,
    alerts,
    add,
    resolveAttempt,
    advance,
    flush,
    stop,
    now: () => nowMs,
    inFlightCount: () => inFlight.size,
  };
}

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

async function submitIgnoreCancelUnconfirmed(syncRecovery?: ReconcileSyncRecoveryOptions) {
  const pair = await startIsolatedPair(
    { cancelDeadlineMs: 80, connectTimeoutMs: 200 },
    { syncRecovery },
  );
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
  await waitFor(
    () => pair.bStore.getTask(submitted.payload.taskId)?.state,
    (state) => state === "result_unconfirmed",
    4000,
  );
  return { pair, submitted, unconfirmed };
}

async function attachVerifiedArtifact(
  pair: Awaited<ReturnType<typeof startIsolatedPair>>,
  unconfirmed: { payload: { taskId: string; toolCallId: string } },
  body = "scheduler-sync-artifact",
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
  };
}

describe("reconcile sync recovery contract helpers", () => {
  it("derives the next due time from the inter-burst backoff sequence", () => {
    const backoff = [1000, 2000, 4000];
    expect(
      nextReconcileSyncDueAtMs(
        pendingRecord({ attemptCount: 0, lastAttemptAtMs: undefined }),
        backoff,
      ),
    ).toBe(0);
    expect(
      nextReconcileSyncDueAtMs(pendingRecord({ attemptCount: 1, lastAttemptAtMs: 5_000 }), backoff),
    ).toBe(6_000);
    expect(
      nextReconcileSyncDueAtMs(pendingRecord({ attemptCount: 2, lastAttemptAtMs: 5_000 }), backoff),
    ).toBe(7_000);
    expect(
      nextReconcileSyncDueAtMs(pendingRecord({ attemptCount: 9, lastAttemptAtMs: 5_000 }), backoff),
    ).toBe(9_000);
    expect(
      nextReconcileSyncDueAtMs(
        pendingRecord({ syncState: "sync_conflict", needsHuman: true, lastAttemptAtMs: 5_000 }),
        backoff,
      ),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it("raises stale, nearly-exhausted, and exceeded alerts only for pending_sync", () => {
    const pending = pendingRecord({ committedAtMs: 0 });
    const conflict = pendingRecord({
      reconcileRequestId: "recon-conflict",
      syncState: "sync_conflict",
      needsHuman: true,
      committedAtMs: 0,
    });
    const bounds = {
      maxRecoveryMs: 10_000,
      alertPendingAgeMs: 4_000,
      alertWindowRemainingMs: 2_000,
    };
    expect(evaluateReconcileSyncAlerts([pending, conflict], 3_999, bounds)).toEqual([]);
    expect(
      evaluateReconcileSyncAlerts([pending, conflict], 4_000, bounds).map((alert) => alert.kind),
    ).toEqual(["pending_sync_stale"]);
    expect(
      evaluateReconcileSyncAlerts([pending, conflict], 8_000, bounds).map((alert) => alert.kind),
    ).toEqual(["pending_sync_stale", "recovery_window_nearly_exhausted"]);
    expect(
      evaluateReconcileSyncAlerts([pending, conflict], 10_000, bounds).map((alert) => alert.kind),
    ).toEqual(["pending_sync_stale", "recovery_window_exceeded"]);
  });
});

describe("ReconcileSyncScheduler", () => {
  it("retries a pending record after backoff and does not overlap bursts for the same record", async () => {
    const harness = createSchedulerHarness();
    harness.add(pendingRecord());
    harness.scheduler.start();
    await harness.flush();
    expect(harness.attempts).toEqual([]);

    await harness.advance(999);
    expect(harness.attempts).toEqual([]);
    await harness.advance(200);
    expect(harness.attempts).toEqual(["recon-1"]);
    expect(harness.scheduler.inFlightCount).toBe(1);

    await harness.advance(5_000);
    expect(harness.attempts).toEqual(["recon-1"]);

    harness.resolveAttempt("recon-1", { attemptCount: 2 });
    await harness.flush();
    expect(harness.scheduler.inFlightCount).toBe(0);
    await harness.advance(1_999);
    expect(harness.attempts).toEqual(["recon-1"]);
    await harness.advance(200);
    expect(harness.attempts).toEqual(["recon-1", "recon-1"]);
    await harness.stop();
  });

  it("rate-limits concurrent background bursts and leaves extra records queued", async () => {
    const harness = createSchedulerHarness({ maxInFlight: 1, backoffMs: [1] });
    harness.add(
      pendingRecord({ reconcileRequestId: "recon-a", lastAttemptAtMs: 0, attemptCount: 0 }),
    );
    harness.add(
      pendingRecord({
        reconcileRequestId: "recon-b",
        taskId: "task-2",
        lastAttemptAtMs: 0,
        attemptCount: 0,
      }),
    );
    harness.scheduler.start();
    await harness.flush();
    expect(harness.attempts).toEqual(["recon-a"]);
    expect(harness.scheduler.inFlightCount).toBe(1);
    await harness.advance(500);
    expect(harness.attempts).toEqual(["recon-a"]);
    harness.resolveAttempt("recon-a", { attemptCount: 1, lastAttemptAtMs: harness.now() });
    await harness.flush();
    if (harness.attempts.length < 2) {
      await harness.advance(100);
    }
    expect(harness.attempts).toEqual(["recon-a", "recon-b"]);
    await harness.stop();
  });

  it("does not auto-retry a permanent conflict and does not raise recovery alerts for it", async () => {
    const harness = createSchedulerHarness({ backoffMs: [1] });
    harness.add(pendingRecord({ lastAttemptAtMs: 0, attemptCount: 0, committedAtMs: 1_000_000 }));
    harness.scheduler.start();
    await harness.flush();
    expect(harness.attempts).toEqual(["recon-1"]);
    harness.resolveAttempt("recon-1", {
      attemptCount: 1,
      syncState: "sync_conflict",
      needsHuman: true,
    });
    await harness.flush();
    await harness.advance(20_000);
    expect(harness.attempts).toEqual(["recon-1"]);
    expect(harness.alerts).toEqual([]);
    expect(harness.scheduler.currentAlerts(harness.now())).toEqual([]);
    await harness.stop();
  });

  it("emits stale and exhausted alerts without converting pending_sync into a conflict", async () => {
    const harness = createSchedulerHarness({
      backoffMs: [50_000],
      maxRecoveryMs: 10_000,
      alertPendingAgeMs: 4_000,
      alertWindowRemainingMs: 2_000,
    });
    harness.add(
      pendingRecord({ committedAtMs: 1_000_000, lastAttemptAtMs: 1_000_000, attemptCount: 1 }),
    );
    harness.scheduler.start();
    await harness.flush();
    await harness.advance(4_000);
    expect(harness.alerts.map((alert) => alert.kind)).toEqual(["pending_sync_stale"]);
    await harness.advance(4_000);
    expect(harness.alerts.map((alert) => alert.kind)).toEqual([
      "pending_sync_stale",
      "recovery_window_nearly_exhausted",
    ]);
    await harness.advance(2_000);
    expect(harness.alerts.map((alert) => alert.kind)).toEqual([
      "pending_sync_stale",
      "recovery_window_nearly_exhausted",
      "recovery_window_exceeded",
    ]);
    expect(harness.attempts).toEqual([]);
    const stillPending = pendingRecord({
      committedAtMs: 1_000_000,
      lastAttemptAtMs: 1_000_000,
      attemptCount: 1,
    });
    expect(stillPending.syncState).toBe("pending_sync");
    expect(stillPending.needsHuman).toBe(false);
    await harness.stop();
  });

  it("stop() ends the loop and prevents further bursts", async () => {
    const harness = createSchedulerHarness({ backoffMs: [1], tickMs: 10 });
    harness.add(pendingRecord({ lastAttemptAtMs: 0, attemptCount: 0 }));
    harness.scheduler.start();
    await harness.flush();
    expect(harness.attempts).toHaveLength(1);
    expect(harness.scheduler.isRunning).toBe(true);
    const first = harness.resolveAttempt("recon-1", { attemptCount: 1 });
    expect(first.syncState).toBe("pending_sync");
    await harness.flush();
    await harness.scheduler.stop();
    expect(harness.scheduler.isRunning).toBe(false);
    const attemptsAtStop = harness.attempts.length;
    await harness.advance(5_000);
    expect(harness.attempts).toHaveLength(attemptsAtStop);
  });

  it("wakes other due records after a successful burst without overlapping the same id", async () => {
    const harness = createSchedulerHarness({ maxInFlight: 1, backoffMs: [10_000], tickMs: 5_000 });
    harness.add(
      pendingRecord({
        reconcileRequestId: "recon-a",
        lastAttemptAtMs: 0,
        attemptCount: 0,
      }),
    );
    harness.add(
      pendingRecord({
        reconcileRequestId: "recon-b",
        taskId: "task-2",
        lastAttemptAtMs: 0,
        attemptCount: 0,
      }),
    );
    harness.scheduler.start();
    await harness.flush();
    expect(harness.attempts).toEqual(["recon-a"]);
    harness.resolveAttempt("recon-a", { syncState: "synced", attemptCount: 1 });
    await harness.flush();
    expect(harness.attempts).toEqual(["recon-a", "recon-b"]);
    await harness.stop();
  });
});

describe("A' background reconcile-sync recovery", () => {
  const fastRecovery = {
    backoffMs: [40, 80],
    tickMs: 15,
    maxRecoveryMs: 30_000,
    alertPendingAgeMs: 10_000,
    alertWindowRemainingMs: 2_000,
  };

  it("auto-syncs pending_sync after connectivity returns without a restart or resume hook", async () => {
    const { pair, unconfirmed } = await submitIgnoreCancelUnconfirmed(fastRecovery);
    const evidence = await attachVerifiedArtifact(pair, unconfirmed);
    const bDir = pair.bDir;
    const configB = pair.configB;
    const leaseRecord = pair.leaseRecord;
    try {
      await pair.b.stop();
      const reconciler = await createReconcileClient(pair);
      const result = await reconciler.client.reconcile(
        successRequest(unconfirmed.payload.taskId, unconfirmed.payload.stateVersion, evidence),
      );
      expect(result.payload.conclusionCommitted).toBe(true);
      expect(result.payload.bSyncConfirmed).toBe(false);
      expect(result.payload.reconcileSyncState).toBe("pending_sync");

      const bStore = new FileExecStore(bDir);
      const b = new BExecutionServer({
        config: configB,
        store: bStore,
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
        autoStartExecution: false,
      });
      await b.start();
      await b.registerLease(leaseRecord);

      await waitFor(
        () => pair.aStore.latestReconcileSync(unconfirmed.payload.taskId),
        (sync) => sync?.syncState === "synced",
        4000,
      );
      expect(pair.aStore.getTask(unconfirmed.payload.taskId)?.state).toBe("succeeded");
      expect(bStore.getTask(unconfirmed.payload.taskId)?.state).toBe("succeeded");
      expect(pair.plane.syncScheduler.isRunning).toBe(true);
      await b.stop();
    } finally {
      await pair.stop();
    }
  });

  it("still auto-recovers after A restarts with the scheduler, once B is reachable again", async () => {
    const { pair, unconfirmed } = await submitIgnoreCancelUnconfirmed(fastRecovery);
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
      await pair.a.stop();

      const aStore = new FileExecStore(aDir);
      const bClient = new ExecHttpClient({
        baseUrl: `http://127.0.0.1:${configB.port}`,
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
        syncRecovery: fastRecovery,
      });
      const a = new AControlServer({
        config: configA,
        store: aStore,
        plane,
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
      });
      await a.start();
      await a.registerLease(leaseRecord);
      expect(aStore.latestReconcileSync(unconfirmed.payload.taskId)?.syncState).toBe(
        "pending_sync",
      );
      expect(plane.syncScheduler.isRunning).toBe(true);

      const bStore = new FileExecStore(bDir);
      const b = new BExecutionServer({
        config: configB,
        store: bStore,
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
        autoStartExecution: false,
      });
      await b.start();
      await b.registerLease(leaseRecord);

      await waitFor(
        () => aStore.latestReconcileSync(unconfirmed.payload.taskId),
        (sync) => sync?.syncState === "synced",
        4000,
      );
      expect(bStore.getTask(unconfirmed.payload.taskId)?.state).toBe("succeeded");
      await a.stop();
      await b.stop();
    } finally {
      await pair.stop();
    }
  });

  it("does not auto-retry sync_conflict while the scheduler is running", async () => {
    const { pair, unconfirmed } = await submitIgnoreCancelUnconfirmed(fastRecovery);
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
      const reconciler = await createReconcileClient(pair);
      const result = await reconciler.client.reconcile(
        successRequest(unconfirmed.payload.taskId, unconfirmed.payload.stateVersion, evidence),
      );
      expect(result.payload.reconcileSyncState).toBe("sync_conflict");
      const attempts =
        pair.aStore.latestReconcileSync(unconfirmed.payload.taskId)?.attemptCount ?? 0;
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(pair.aStore.latestReconcileSync(unconfirmed.payload.taskId)?.attemptCount).toBe(
        attempts,
      );
      expect(pair.plane.listHumanReconcileConflicts()).toHaveLength(1);
      expect(pair.plane.listReconcileSyncAlerts()).toEqual([]);
    } finally {
      await pair.stop();
    }
  });
});
