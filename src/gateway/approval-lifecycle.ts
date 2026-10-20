/**
 * Generic human-approval lifecycle: pending registration, decision, timeout,
 * double-resolve prevention and atomic one-shot consumption.
 *
 * Extracted from `ExecApprovalManager` so a second approval type can reuse the
 * mechanism without inheriting the shell-exec policy. The subtle parts worth
 * reusing rather than reimplementing are the resolved-entry grace window (so a
 * late `awaitDecision` still sees a decision), the double-resolve guard, and
 * `consumeAllowOnce` being atomic (so one approval cannot be spent twice inside
 * the grace window).
 *
 * `ExecApprovalManager` is now a thin subclass; behaviour for exec approvals is
 * unchanged. An optional journal persists that one domain. Other approval
 * domains pass their own file or none; this class is not an approval center.
 */

import { randomUUID } from "node:crypto";
import {
  approvalGrantFromJournal,
  readExecApprovalJournal,
  recoverExecApprovalJournal,
  upsertExecApprovalJournal,
  type ExecApprovalJournalDecision,
  type ExecApprovalJournalRecord,
  type ExecApprovalJournalState,
} from "./exec-approval-journal.js";

/** Grace period keeping resolved entries visible to late `awaitDecision` calls. */
const RESOLVED_ENTRY_GRACE_MS = 15_000;

export type ApprovalLifecycleDecision = "allow-once" | "allow-always" | "deny";

export type ApprovalLifecycleOptions = {
  /** Durable file for this domain only. Omit to keep the historical in-memory map. */
  journalPath?: string;
};

export type ApprovalRecord<TRequest> = {
  id: string;
  request: TRequest;
  createdAtMs: number;
  expiresAtMs: number;
  /** Caller metadata (best effort). Prevents other clients replaying an approval id. */
  requestedByConnId?: string | null;
  requestedByDeviceId?: string | null;
  requestedByClientId?: string | null;
  resolvedAtMs?: number;
  decision?: ApprovalLifecycleDecision;
  resolvedBy?: string | null;
};

type PendingEntry<TRequest> = {
  record: ApprovalRecord<TRequest>;
  resolve: (decision: ApprovalLifecycleDecision | null) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  promise: Promise<ApprovalLifecycleDecision | null>;
};

export type ApprovalIdLookupResult =
  | { kind: "exact" | "prefix"; id: string }
  | { kind: "ambiguous"; ids: string[] }
  | { kind: "none" };

export class ApprovalLifecycle<TRequest> {
  private pending = new Map<string, PendingEntry<TRequest>>();
  private readonly graceTimers: Array<ReturnType<typeof setTimeout>> = [];
  private readonly journalPath?: string;

  constructor(options?: ApprovalLifecycleOptions) {
    this.journalPath = options?.journalPath;
    if (this.journalPath) {
      this.recoverJournaled(Date.now());
    }
  }

  create(request: TRequest, timeoutMs: number, id?: string | null): ApprovalRecord<TRequest> {
    const now = Date.now();
    const resolvedId = id && id.trim().length > 0 ? id.trim() : randomUUID();
    return {
      id: resolvedId,
      request,
      createdAtMs: now,
      expiresAtMs: now + timeoutMs,
    };
  }

  /**
   * Register an approval and return a promise that settles on decision or timeout.
   *
   * Registration is synchronous and separate from waiting, so a caller can confirm
   * the id is live before anything can resolve it.
   */
  register(
    record: ApprovalRecord<TRequest>,
    timeoutMs: number,
  ): Promise<ApprovalLifecycleDecision | null> {
    this.assertJournalCanOpen(record.id);
    const existing = this.pending.get(record.id);
    if (existing) {
      // Idempotent while still pending; a resolved id may not be re-registered.
      if (existing.record.resolvedAtMs === undefined) {
        return existing.promise;
      }
      throw new Error(`approval id '${record.id}' already resolved`);
    }
    let resolvePromise: (decision: ApprovalLifecycleDecision | null) => void;
    let rejectPromise: (err: Error) => void;
    const promise = new Promise<ApprovalLifecycleDecision | null>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const entry: PendingEntry<TRequest> = {
      record,
      resolve: resolvePromise!,
      reject: rejectPromise!,
      timer: null as unknown as ReturnType<typeof setTimeout>,
      promise,
    };
    entry.timer = setTimeout(() => {
      this.expire(record.id);
    }, timeoutMs);
    entry.timer.unref?.();
    this.pending.set(record.id, entry);
    try {
      this.persist(record, "PENDING");
    } catch (error) {
      clearTimeout(entry.timer);
      this.pending.delete(record.id);
      throw error;
    }
    return promise;
  }

  /** @deprecated Use `register()`; kept for existing callers. */
  async waitForDecision(
    record: ApprovalRecord<TRequest>,
    timeoutMs: number,
  ): Promise<ApprovalLifecycleDecision | null> {
    return this.register(record, timeoutMs);
  }

  resolve(
    recordId: string,
    decision: ApprovalLifecycleDecision,
    resolvedBy?: string | null,
  ): boolean {
    const pending = this.pending.get(recordId);
    if (!pending) {
      return false;
    }
    // Guard against resolving after a timeout already settled the promise.
    if (pending.record.resolvedAtMs !== undefined) {
      return false;
    }
    clearTimeout(pending.timer);
    pending.record.resolvedAtMs = Date.now();
    pending.record.decision = decision;
    pending.record.resolvedBy = resolvedBy ?? null;
    this.persist(pending.record, decision === "deny" ? "FAILED" : "COMPLETED", decision);
    pending.resolve(decision);
    this.scheduleGraceDelete(recordId, pending);
    return true;
  }

  /** Explicit cancel. Settles as null, which is not an allow. */
  cancel(recordId: string, resolvedBy?: string | null): boolean {
    const pending = this.pending.get(recordId);
    if (!pending || pending.record.resolvedAtMs !== undefined) {
      return false;
    }
    clearTimeout(pending.timer);
    pending.record.resolvedAtMs = Date.now();
    pending.record.decision = undefined;
    pending.record.resolvedBy = resolvedBy ?? null;
    this.persist(pending.record, "CANCELLED");
    pending.resolve(null);
    this.scheduleGraceDelete(recordId, pending);
    return true;
  }

  expire(recordId: string, resolvedBy?: string | null): boolean {
    const pending = this.pending.get(recordId);
    if (!pending) {
      return false;
    }
    if (pending.record.resolvedAtMs !== undefined) {
      return false;
    }
    clearTimeout(pending.timer);
    pending.record.resolvedAtMs = Date.now();
    pending.record.decision = undefined;
    pending.record.resolvedBy = resolvedBy ?? null;
    this.persist(pending.record, "EXPIRED");
    // Timeout settles as `null`, never as an allow.
    pending.resolve(null);
    this.scheduleGraceDelete(recordId, pending);
    return true;
  }

  getSnapshot(recordId: string): ApprovalRecord<TRequest> | null {
    const entry = this.pending.get(recordId);
    return entry?.record ?? null;
  }

  /**
   * Spend a one-time approval. Atomic: clears the decision so the same id cannot
   * be replayed during the resolved-entry grace window.
   */
  consumeAllowOnce(recordId: string): boolean {
    return this.consumeSettledGrant(recordId, "allow-once");
  }

  /**
   * Spend a settled allow so the same id cannot be replayed during the grace
   * window. `allow-always` is a remembered exact-path grant, still single-use
   * as an approval id.
   */
  consumeSettledGrant(recordId: string, decision: "allow-once" | "allow-always"): boolean {
    const entry = this.pending.get(recordId);
    if (!entry) {
      return false;
    }
    const record = entry.record;
    if (record.decision !== decision) {
      return false;
    }
    record.decision = undefined;
    this.persist(record, "COMPLETED", decision, true);
    return true;
  }

  /** Wait on an already-registered approval. Null when the id is not pending. */
  awaitDecision(recordId: string): Promise<ApprovalLifecycleDecision | null> | null {
    const entry = this.pending.get(recordId);
    return entry?.promise ?? null;
  }

  /**
   * Approvals still awaiting an answer, oldest first.
   *
   * Excludes resolved entries lingering in the grace window: they are no longer
   * answerable, and listing them would invite an operator to try.
   */
  listPending(): ApprovalRecord<TRequest>[] {
    return [...this.pending.values()]
      .filter((entry) => entry.record.resolvedAtMs === undefined)
      .map((entry) => entry.record)
      .toSorted((left, right) => left.createdAtMs - right.createdAtMs);
  }

  /**
   * Reload this domain's journal. Pending work is resumed. Expired work is
   * marked EXPIRED and is not treated as allow. Explicit unconsumed allows
   * are restored once.
   */
  recoverJournaled(nowMs: number = Date.now()): {
    resumed: ExecApprovalJournalRecord[];
    grantable: ExecApprovalJournalRecord[];
    closed: ExecApprovalJournalRecord[];
  } {
    if (!this.journalPath) {
      return { resumed: [], grantable: [], closed: [] };
    }
    const recovered = recoverExecApprovalJournal(this.journalPath, nowMs);
    for (const record of recovered.resumed) {
      this.rehydratePending(record);
    }
    for (const record of recovered.grantable) {
      this.rehydrateGrant(record);
    }
    return recovered;
  }

  /** Drop timers created by this lifecycle. Does not convert pending rows into allows. */
  close(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
    }
    for (const timer of this.graceTimers) {
      clearTimeout(timer);
    }
    this.graceTimers.length = 0;
  }

  lookupPendingId(input: string): ApprovalIdLookupResult {
    const normalized = input.trim();
    if (!normalized) {
      return { kind: "none" };
    }

    const exact = this.pending.get(normalized);
    if (exact) {
      return exact.record.resolvedAtMs === undefined
        ? { kind: "exact", id: normalized }
        : { kind: "none" };
    }

    const lowerPrefix = normalized.toLowerCase();
    const matches: string[] = [];
    for (const [id, entry] of this.pending.entries()) {
      if (entry.record.resolvedAtMs !== undefined) {
        continue;
      }
      if (id.toLowerCase().startsWith(lowerPrefix)) {
        matches.push(id);
      }
    }

    if (matches.length === 1) {
      return { kind: "prefix", id: matches[0] };
    }
    if (matches.length > 1) {
      return { kind: "ambiguous", ids: matches };
    }
    return { kind: "none" };
  }

  private assertJournalCanOpen(id: string): void {
    if (!this.journalPath) {
      return;
    }
    const existing = readExecApprovalJournal(this.journalPath)[id];
    if (!existing) {
      return;
    }
    const grant = approvalGrantFromJournal(existing);
    if (grant.state === "PENDING" || grant.state === "RUNNING") {
      return;
    }
    if (grant.grant === "allow-once" || grant.grant === "allow-always") {
      return;
    }
    throw new Error(`approval id '${id}' already ${grant.state}`);
  }

  private rehydratePending(stored: ExecApprovalJournalRecord): void {
    if (this.pending.has(stored.id)) {
      return;
    }
    const timeoutMs = Math.max(0, Date.parse(stored.expiresAt) - Date.now());
    void this.register(this.recordFromJournal(stored), timeoutMs);
  }

  private rehydrateGrant(stored: ExecApprovalJournalRecord): void {
    if (!stored.decision || this.pending.has(stored.id)) {
      return;
    }
    const record = this.recordFromJournal(stored);
    record.decision = stored.decision;
    record.resolvedAtMs = stored.resolvedAtMs ?? Date.now();
    let resolvePromise: (decision: ApprovalLifecycleDecision | null) => void;
    const promise = new Promise<ApprovalLifecycleDecision | null>((resolve) => {
      resolvePromise = resolve;
    });
    const decision = stored.decision;
    const remaining = Math.max(0, record.expiresAtMs - Date.now());
    const entry: PendingEntry<TRequest> = {
      record,
      resolve: resolvePromise!,
      reject: () => undefined,
      timer: setTimeout(() => {
        if (this.pending.get(record.id) !== entry || entry.record.decision === undefined) {
          return;
        }
        entry.record.decision = undefined;
        this.persist(entry.record, "EXPIRED");
        this.pending.delete(record.id);
      }, remaining),
      promise,
    };
    entry.timer.unref?.();
    this.pending.set(record.id, entry);
    resolvePromise!(decision);
  }

  private recordFromJournal(stored: ExecApprovalJournalRecord): ApprovalRecord<TRequest> {
    return {
      id: stored.id,
      request: stored.request as TRequest,
      createdAtMs: stored.createdAtMs,
      expiresAtMs: Date.parse(stored.expiresAt),
    };
  }

  private persist(
    record: ApprovalRecord<TRequest>,
    state: ExecApprovalJournalState,
    decision?: ExecApprovalJournalDecision,
    consumed?: boolean,
  ): void {
    if (!this.journalPath) {
      return;
    }
    upsertExecApprovalJournal(this.journalPath, {
      id: record.id,
      state,
      expiresAt: new Date(record.expiresAtMs).toISOString(),
      createdAtMs: record.createdAtMs,
      request: record.request,
      ...(decision ? { decision } : {}),
      ...(record.resolvedAtMs !== undefined ? { resolvedAtMs: record.resolvedAtMs } : {}),
      ...(consumed ? { consumed: true } : {}),
    });
  }

  private scheduleGraceDelete(recordId: string, pending: PendingEntry<TRequest>): void {
    const timer = setTimeout(() => {
      if (this.pending.get(recordId) === pending) {
        this.pending.delete(recordId);
      }
    }, RESOLVED_ENTRY_GRACE_MS);
    timer.unref?.();
    this.graceTimers.push(timer);
  }
}
