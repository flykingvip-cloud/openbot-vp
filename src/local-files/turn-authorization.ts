/**
 * Turn authorization store and budget accounting (design 9.2).
 *
 * Two layers of authorization: the user's single intent for this turn is a Turn
 * authorization, and every individual node call is a separate single-use
 * Invocation capability derived from it. This store owns the first layer and the
 * budget that bounds the second.
 *
 * Byte accounting is deliberately split from call accounting. The expanded byte
 * count is only known after a read returns, so `maxTotalExpandedBytes` gates
 * *derivation* of the next Invocation capability rather than redemption of the
 * current one; `maxCalls` and `maxEntriesRead` are reserved up front at
 * redemption.
 *
 * Bytes are capped twice. Per authorization by `budget.maxTotalExpandedBytes`,
 * and per *turn* by `LOCAL_FILES_LIMITS.maxTurnTotalBytes` (design 4.10). The
 * second cap is not redundant: one turn can hold several authorizations, one per
 * resolved target, so without it a user naming several files in a single message
 * would face no cumulative ceiling at all.
 */

import {
  type CapabilityBinding,
  LOCAL_FILES_LIMITS,
  type LocalFilesOperation,
  type TurnAuthorizationClaims,
} from "./types.js";

/**
 * Identity of one turn for cumulative accounting.
 *
 * Node and device are deliberately absent: the cap bounds how much disk content
 * reaches one turn's context, regardless of how many devices served it.
 */
export function turnLedgerKey(binding: CapabilityBinding): string {
  return [
    binding.tenantId,
    binding.userId,
    binding.agentId,
    binding.sessionKey,
    binding.turnId,
  ].join("\u0000");
}

/** Operations that return content, and therefore consume an entry from the budget. */
const CONTENT_OPERATIONS: ReadonlySet<LocalFilesOperation> = new Set<LocalFilesOperation>([
  "fs.read",
  "archive.readEntry",
]);

export function consumesEntryBudget(operation: LocalFilesOperation): boolean {
  return CONTENT_OPERATIONS.has(operation);
}

export type TurnAuthorizationSpend = {
  /**
   * Capabilities minted. Counted separately from `calls` because redemption is
   * the authoritative decrement (design 9.3 step 2), but issuing has to be bounded
   * too — otherwise the gateway would happily mint ten capabilities against a
   * one-call budget and let nine fail at redemption.
   */
  issued: number;
  /** Capabilities successfully redeemed. The authoritative spend. */
  calls: number;
  entriesRead: number;
  totalExpandedBytes: number;
};

export type TurnAuthorizationRecord = {
  claims: TurnAuthorizationClaims;
  spend: TurnAuthorizationSpend;
  status: "active" | "revoked";
  revokedAtMs?: number;
};

export type BudgetReservation =
  | { ok: true; spend: TurnAuthorizationSpend }
  | {
      ok: false;
      reason:
        | "authorization-unknown"
        | "authorization-revoked"
        | "authorization-expired"
        | "operation-not-authorized"
        | "budget-calls-exhausted"
        | "budget-entries-exhausted"
        | "budget-bytes-exhausted"
        | "budget-turn-bytes-exhausted";
    };

export class TurnAuthorizationStore {
  private readonly records = new Map<string, TurnAuthorizationRecord>();
  /** Bytes returned so far per turn, across every authorization in that turn. */
  private readonly turnBytes = new Map<string, number>();
  private readonly turnTotalByteCap: number;

  constructor(options?: { turnTotalByteCap?: number }) {
    this.turnTotalByteCap = options?.turnTotalByteCap ?? LOCAL_FILES_LIMITS.maxTurnTotalBytes;
  }

  put(claims: TurnAuthorizationClaims): TurnAuthorizationRecord {
    const record: TurnAuthorizationRecord = {
      claims,
      spend: { issued: 0, calls: 0, entriesRead: 0, totalExpandedBytes: 0 },
      status: "active",
    };
    this.records.set(claims.authorizationId, record);
    return record;
  }

  get(authorizationId: string): TurnAuthorizationRecord | undefined {
    return this.records.get(authorizationId);
  }

  revoke(authorizationId: string, nowMs: number): boolean {
    const record = this.records.get(authorizationId);
    if (!record || record.status === "revoked") {
      return false;
    }
    record.status = "revoked";
    record.revokedAtMs = nowMs;
    return true;
  }

  /**
   * Reserve budget for one invocation. Synchronous: the caller depends on there
   * being no suspension point between the check and the decrement.
   *
   * Returns a failure without mutating anything when the reservation does not fit.
   */
  reserve(params: {
    authorizationId: string;
    operation: LocalFilesOperation;
    nowMs: number;
    clockSkewMs: number;
  }): BudgetReservation {
    const record = this.records.get(params.authorizationId);
    if (!record) {
      return { ok: false, reason: "authorization-unknown" };
    }
    if (record.status === "revoked") {
      return { ok: false, reason: "authorization-revoked" };
    }
    if (params.nowMs > record.claims.expiresAtMs + params.clockSkewMs) {
      return { ok: false, reason: "authorization-expired" };
    }
    if (!record.claims.operations.includes(params.operation)) {
      return { ok: false, reason: "operation-not-authorized" };
    }

    const budget = record.claims.budget;
    if (record.spend.calls + 1 > budget.maxCalls) {
      return { ok: false, reason: "budget-calls-exhausted" };
    }
    const entryCost = consumesEntryBudget(params.operation) ? 1 : 0;
    if (record.spend.entriesRead + entryCost > budget.maxEntriesRead) {
      return { ok: false, reason: "budget-entries-exhausted" };
    }
    // Bytes already returned in this turn are a hard ceiling; a fresh call is
    // refused once the cumulative cap is reached, so chunking cannot exceed it.
    if (record.spend.totalExpandedBytes >= budget.maxTotalExpandedBytes) {
      return { ok: false, reason: "budget-bytes-exhausted" };
    }
    if (this.turnBytesExhausted(record)) {
      return { ok: false, reason: "budget-turn-bytes-exhausted" };
    }

    record.spend.calls += 1;
    record.spend.entriesRead += entryCost;
    return { ok: true, spend: { ...record.spend } };
  }

  /**
   * Reserve the right to mint one Invocation capability.
   *
   * Synchronous, and bounded by the same `maxCalls` as redemption, so the number
   * of capabilities in flight can never exceed the turn's budget.
   */
  reserveIssuance(params: {
    authorizationId: string;
    operation: LocalFilesOperation;
    nowMs: number;
    clockSkewMs: number;
  }): BudgetReservation {
    const record = this.records.get(params.authorizationId);
    if (!record) {
      return { ok: false, reason: "authorization-unknown" };
    }
    if (record.status === "revoked") {
      return { ok: false, reason: "authorization-revoked" };
    }
    if (params.nowMs > record.claims.expiresAtMs + params.clockSkewMs) {
      return { ok: false, reason: "authorization-expired" };
    }
    if (!record.claims.operations.includes(params.operation)) {
      return { ok: false, reason: "operation-not-authorized" };
    }
    const budget = record.claims.budget;
    if (record.spend.issued + 1 > budget.maxCalls) {
      return { ok: false, reason: "budget-calls-exhausted" };
    }
    if (record.spend.totalExpandedBytes >= budget.maxTotalExpandedBytes) {
      return { ok: false, reason: "budget-bytes-exhausted" };
    }
    if (this.turnBytesExhausted(record)) {
      return { ok: false, reason: "budget-turn-bytes-exhausted" };
    }
    record.spend.issued += 1;
    return { ok: true, spend: { ...record.spend } };
  }

  /**
   * Whether this authorization's turn has already returned its cumulative cap.
   *
   * Checked against bytes *already returned*, matching the per-authorization rule
   * above: a fresh call is refused once the ceiling is reached, so splitting a
   * large read into chunks cannot walk past it.
   */
  private turnBytesExhausted(record: TurnAuthorizationRecord): boolean {
    const spent = this.turnBytes.get(turnLedgerKey(record.claims.binding)) ?? 0;
    return spent >= this.turnTotalByteCap;
  }

  /** Record bytes actually returned, after a read completes. */
  recordBytes(authorizationId: string, bytes: number): TurnAuthorizationSpend | undefined {
    const record = this.records.get(authorizationId);
    if (!record) {
      return undefined;
    }
    const delta = Math.max(0, Math.trunc(bytes));
    record.spend.totalExpandedBytes += delta;
    // The same bytes count against the turn as a whole, so a second
    // authorization in this turn inherits what the first already spent.
    const key = turnLedgerKey(record.claims.binding);
    this.turnBytes.set(key, (this.turnBytes.get(key) ?? 0) + delta);
    return { ...record.spend };
  }

  /** Bytes returned so far across every authorization in this turn (design 4.10). */
  turnBytesSpent(binding: CapabilityBinding): number {
    return this.turnBytes.get(turnLedgerKey(binding)) ?? 0;
  }

  /** Remaining headroom, for diagnostics. */
  remaining(authorizationId: string):
    | {
        issuable: number;
        calls: number;
        entriesRead: number;
        totalExpandedBytes: number;
      }
    | undefined {
    const record = this.records.get(authorizationId);
    if (!record) {
      return undefined;
    }
    const budget = record.claims.budget;
    const turnSpent = this.turnBytes.get(turnLedgerKey(record.claims.binding)) ?? 0;
    return {
      issuable: Math.max(0, budget.maxCalls - record.spend.issued),
      calls: Math.max(0, budget.maxCalls - record.spend.calls),
      entriesRead: Math.max(0, budget.maxEntriesRead - record.spend.entriesRead),
      // Whichever ceiling binds first. Reporting only the authorization's own
      // headroom would overstate what the next call can actually return.
      totalExpandedBytes: Math.min(
        Math.max(0, budget.maxTotalExpandedBytes - record.spend.totalExpandedBytes),
        Math.max(0, this.turnTotalByteCap - turnSpent),
      ),
    };
  }

  /**
   * Active, unexpired authorizations. Lets the gateway reuse an open grant for the
   * same target inside a turn instead of asking the user again for each call of a
   * bounded task.
   */
  allActive(nowMs: number, clockSkewMs = 0): TurnAuthorizationRecord[] {
    return [...this.records.values()].filter(
      (record) => record.status === "active" && nowMs <= record.claims.expiresAtMs + clockSkewMs,
    );
  }

  purgeExpired(nowMs: number, clockSkewMs: number): number {
    let removed = 0;
    for (const [id, record] of this.records.entries()) {
      if (nowMs > record.claims.expiresAtMs + clockSkewMs) {
        this.records.delete(id);
        removed += 1;
      }
    }
    // Drop ledger rows for turns with no authorization left. Authorizations
    // expire with their turn, so an empty turn is a finished turn; keeping its
    // total would charge the cap to a later turn.
    if (removed > 0) {
      const live = new Set(
        [...this.records.values()].map((record) => turnLedgerKey(record.claims.binding)),
      );
      for (const key of this.turnBytes.keys()) {
        if (!live.has(key)) {
          this.turnBytes.delete(key);
        }
      }
    }
    return removed;
  }

  size(): number {
    return this.records.size;
  }
}
