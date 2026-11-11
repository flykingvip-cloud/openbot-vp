import type { ExecReconcileSyncRecord } from "./types.js";

/**
 * Isolation-profile recovery scheduler contract. These numbers are not part
 * of the signed bind/port/timeout/lease/transport-burst freeze and are not
 * production mTLS or ops values.
 *
 * After each exhausted transport burst (max 3 attempts, waits 200ms then
 * 400ms), a still-pending record waits for the next inter-burst delay in
 * this sequence, then caps at the last entry.
 */
export const RECONCILE_SYNC_RECOVERY_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000] as const;
export const RECONCILE_SYNC_RECOVERY_BACKOFF_CAP_MS =
  RECONCILE_SYNC_RECOVERY_BACKOFF_MS[RECONCILE_SYNC_RECOVERY_BACKOFF_MS.length - 1];

/** SLO / alert bound, measured from committedAtMs. Auto-retries continue after this. */
export const RECONCILE_SYNC_MAX_RECOVERY_MS = 300_000;

/** Alert when a pending_sync record is at least this old. */
export const RECONCILE_SYNC_ALERT_PENDING_AGE_MS = 60_000;

/** Alert when the remaining recovery window is at or below this and still positive. */
export const RECONCILE_SYNC_ALERT_WINDOW_REMAINING_MS = 30_000;

/** Maximum concurrent background reconcile-apply transport bursts. */
export const RECONCILE_SYNC_MAX_IN_FLIGHT = 2;

/** Poll / wake bound while waiting for due work. */
export const RECONCILE_SYNC_SCHEDULER_TICK_MS = 250;

export type ReconcileSyncAlertKind =
  | "pending_sync_stale"
  | "recovery_window_nearly_exhausted"
  | "recovery_window_exceeded";

export type ReconcileSyncAlert = {
  kind: ReconcileSyncAlertKind;
  tenantId: string;
  taskId: string;
  reconcileRequestId: string;
  pendingAgeMs: number;
  remainingWindowMs: number;
  atMs: number;
};

export type ReconcileSyncRecoveryBounds = {
  backoffMs: readonly number[];
  maxRecoveryMs: number;
  alertPendingAgeMs: number;
  alertWindowRemainingMs: number;
  maxInFlight: number;
  tickMs: number;
};

export const ISOLATION_RECONCILE_SYNC_RECOVERY: ReconcileSyncRecoveryBounds = {
  backoffMs: RECONCILE_SYNC_RECOVERY_BACKOFF_MS,
  maxRecoveryMs: RECONCILE_SYNC_MAX_RECOVERY_MS,
  alertPendingAgeMs: RECONCILE_SYNC_ALERT_PENDING_AGE_MS,
  alertWindowRemainingMs: RECONCILE_SYNC_ALERT_WINDOW_REMAINING_MS,
  maxInFlight: RECONCILE_SYNC_MAX_IN_FLIGHT,
  tickMs: RECONCILE_SYNC_SCHEDULER_TICK_MS,
};

export type ReconcileSyncRecoveryOptions = Partial<ReconcileSyncRecoveryBounds> & {
  onAlert?: (alert: ReconcileSyncAlert) => void;
  sleep?: (ms: number) => Promise<void>;
};

export type ReconcileSyncSchedulerDeps = ReconcileSyncRecoveryBounds & {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  listPending: () => ExecReconcileSyncRecord[];
  attemptSync: (record: ExecReconcileSyncRecord) => Promise<ExecReconcileSyncRecord>;
  isSyncInFlight?: (record: ExecReconcileSyncRecord) => boolean;
  onAlert?: (alert: ReconcileSyncAlert) => void;
};

export function reconcileSyncRecordKey(record: {
  tenantId: string;
  reconcileRequestId: string;
}): string {
  return `${record.tenantId}\0${record.reconcileRequestId}`;
}

export function nextReconcileSyncDueAtMs(
  record: ExecReconcileSyncRecord,
  backoffMs: readonly number[],
): number {
  if (record.syncState !== "pending_sync" || record.needsHuman) {
    return Number.POSITIVE_INFINITY;
  }
  if (record.lastAttemptAtMs === undefined || record.attemptCount <= 0) {
    return 0;
  }
  const lastIndex = backoffMs.length - 1;
  const step = Math.min(Math.max(record.attemptCount - 1, 0), lastIndex);
  const delay = backoffMs[step];
  return record.lastAttemptAtMs + (delay ?? 0);
}

export function evaluateReconcileSyncAlerts(
  records: readonly ExecReconcileSyncRecord[],
  nowMs: number,
  bounds: Pick<
    ReconcileSyncRecoveryBounds,
    "maxRecoveryMs" | "alertPendingAgeMs" | "alertWindowRemainingMs"
  >,
): ReconcileSyncAlert[] {
  const alerts: ReconcileSyncAlert[] = [];
  for (const record of records) {
    if (record.syncState !== "pending_sync" || record.needsHuman) {
      continue;
    }
    const pendingAgeMs = Math.max(0, nowMs - record.committedAtMs);
    const remainingWindowMs = bounds.maxRecoveryMs - pendingAgeMs;
    const base = {
      tenantId: record.tenantId,
      taskId: record.taskId,
      reconcileRequestId: record.reconcileRequestId,
      pendingAgeMs,
      remainingWindowMs,
      atMs: nowMs,
    };
    if (pendingAgeMs >= bounds.alertPendingAgeMs) {
      alerts.push({ ...base, kind: "pending_sync_stale" });
    }
    if (remainingWindowMs <= 0) {
      alerts.push({ ...base, kind: "recovery_window_exceeded" });
    } else if (remainingWindowMs <= bounds.alertWindowRemainingMs) {
      alerts.push({ ...base, kind: "recovery_window_nearly_exhausted" });
    }
  }
  return alerts;
}

export class ReconcileSyncScheduler {
  private running = false;
  private stopping = false;
  private loopPromise: Promise<void> | undefined;
  private wakeResolver: (() => void) | undefined;
  private readonly inFlight = new Set<string>();
  private readonly inFlightPromises = new Map<string, Promise<void>>();
  private readonly emittedAlertKeys = new Set<string>();
  private readonly bounds: ReconcileSyncRecoveryBounds;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly listPending: () => ExecReconcileSyncRecord[];
  private readonly attemptSync: (
    record: ExecReconcileSyncRecord,
  ) => Promise<ExecReconcileSyncRecord>;
  private readonly isExternalInFlight?: (record: ExecReconcileSyncRecord) => boolean;
  private readonly onAlert?: (alert: ReconcileSyncAlert) => void;

  constructor(deps: ReconcileSyncSchedulerDeps) {
    this.bounds = {
      backoffMs: deps.backoffMs,
      maxRecoveryMs: deps.maxRecoveryMs,
      alertPendingAgeMs: deps.alertPendingAgeMs,
      alertWindowRemainingMs: deps.alertWindowRemainingMs,
      maxInFlight: deps.maxInFlight,
      tickMs: deps.tickMs,
    };
    this.now = deps.now;
    this.sleep = deps.sleep;
    this.listPending = deps.listPending;
    this.attemptSync = deps.attemptSync;
    this.isExternalInFlight = deps.isSyncInFlight;
    this.onAlert = deps.onAlert;
  }

  get isRunning(): boolean {
    return this.running && !this.stopping;
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  isInFlight(record: { tenantId: string; reconcileRequestId: string }): boolean {
    return this.inFlight.has(reconcileSyncRecordKey(record));
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.stopping = false;
    this.running = true;
    this.loopPromise = this.loop().finally(() => {
      this.running = false;
      this.loopPromise = undefined;
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.wake();
    if (this.loopPromise) {
      await this.loopPromise;
    }
    const outstanding = [...this.inFlightPromises.values()];
    if (outstanding.length > 0) {
      await Promise.allSettled(outstanding);
    }
  }

  wake(): void {
    const resolve = this.wakeResolver;
    this.wakeResolver = undefined;
    resolve?.();
  }

  /** Record the outcome of a burst started outside the scheduler (start hook or operator resume). */
  noteBurstResult(result: ExecReconcileSyncRecord): void {
    if (result.syncState === "synced") {
      this.clearAlertKeys(result);
      this.wake();
      return;
    }
    if (result.syncState === "sync_conflict" || result.needsHuman) {
      this.clearAlertKeys(result);
    }
  }

  currentAlerts(nowMs = this.now()): ReconcileSyncAlert[] {
    return evaluateReconcileSyncAlerts(this.listPending(), nowMs, this.bounds);
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      this.tick();
      if (this.stopping) {
        break;
      }
      await this.waitForWakeOrTick();
    }
  }

  private tick(): void {
    const nowMs = this.now();
    const pending = this.listPending().filter(
      (record) => record.syncState === "pending_sync" && !record.needsHuman,
    );
    this.emitAlerts(pending, nowMs);
    if (this.stopping) {
      return;
    }
    const due = pending
      .filter((record) => this.isDue(record, nowMs))
      .toSorted((left, right) => left.committedAtMs - right.committedAtMs);
    const slots = this.bounds.maxInFlight - this.inFlight.size;
    if (slots <= 0) {
      return;
    }
    for (const record of due.slice(0, slots)) {
      this.runBurst(record);
    }
  }

  private isDue(record: ExecReconcileSyncRecord, nowMs: number): boolean {
    if (this.inFlight.has(reconcileSyncRecordKey(record))) {
      return false;
    }
    if (this.isExternalInFlight?.(record)) {
      return false;
    }
    return nowMs >= nextReconcileSyncDueAtMs(record, this.bounds.backoffMs);
  }

  private runBurst(record: ExecReconcileSyncRecord): void {
    const id = reconcileSyncRecordKey(record);
    if (this.stopping || this.inFlight.has(id)) {
      return;
    }
    this.inFlight.add(id);
    const work = this.runBurstBody(record).finally(() => {
      this.inFlight.delete(id);
      this.inFlightPromises.delete(id);
      // A slot just freed; wake so queued due records can start without
      // waiting for the next tick, and so stop() can finish promptly.
      this.wake();
    });
    this.inFlightPromises.set(id, work);
  }

  private async runBurstBody(record: ExecReconcileSyncRecord): Promise<void> {
    try {
      const result = await this.attemptSync(record);
      this.noteBurstResult(result);
    } catch {
      // The control plane persists lastAttemptAtMs; the next due time is
      // derived from that durable field. A throw still must not crash the loop.
    }
  }

  private emitAlerts(pending: readonly ExecReconcileSyncRecord[], nowMs: number): void {
    const alerts = evaluateReconcileSyncAlerts(pending, nowMs, this.bounds);
    const seen = new Set<string>();
    for (const alert of alerts) {
      const key = `${alert.kind}\0${alert.tenantId}\0${alert.reconcileRequestId}`;
      seen.add(key);
      if (this.emittedAlertKeys.has(key)) {
        continue;
      }
      this.emittedAlertKeys.add(key);
      this.onAlert?.(alert);
    }
    for (const key of this.emittedAlertKeys) {
      if (!seen.has(key)) {
        this.emittedAlertKeys.delete(key);
      }
    }
  }

  private clearAlertKeys(record: { tenantId: string; reconcileRequestId: string }): void {
    const suffix = `\0${record.tenantId}\0${record.reconcileRequestId}`;
    for (const key of this.emittedAlertKeys) {
      if (key.endsWith(suffix)) {
        this.emittedAlertKeys.delete(key);
      }
    }
  }

  private async waitForWakeOrTick(): Promise<void> {
    let settled = false;
    await new Promise<void>((resolve) => {
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        if (this.wakeResolver === finish) {
          this.wakeResolver = undefined;
        }
        resolve();
      };
      this.wakeResolver = finish;
      void this.sleep(this.bounds.tickMs).then(finish, finish);
    });
  }
}
