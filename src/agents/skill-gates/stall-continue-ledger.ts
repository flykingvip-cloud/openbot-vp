/**
 * Durable progress-stall continue ledger (≤ EXECUTION_STALL_CONTINUE_LIMIT).
 *
 * In-memory counters in attempt.ts reset on process restart and race under
 * overlapping continues. This ledger persists one slot file per continue under
 * ledgerDir and claims with O_EXCL (wx) so restart + concurrent continues
 * cannot bypass the limit. After exhaust: stop with reason.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
/** Must match EXECUTION_STALL_CONTINUE_LIMIT in execution-stall-continue.ts. */
export const STALL_CONTINUE_LEDGER_LIMIT = 2;

export const STALL_CONTINUE_EXHAUSTED_REASON = "execution_stall_continue_exhausted";

export type StallContinueClaimResult = {
  allowed: boolean;
  /** Continues already recorded on disk after this call (includes a new claim). */
  continuesUsed: number;
  exhausted: boolean;
  stopReason?: string;
  /** Slot index claimed this call (1-based), when allowed. */
  claimedSlot?: number;
};

function sessionDigest(sessionKey: string): string {
  return createHash("sha256").update(sessionKey.trim()).digest("hex").slice(0, 24);
}

export function stallContinueLedgerSessionDir(ledgerDir: string, sessionKey: string): string {
  return path.join(ledgerDir, "stall-continue", sessionDigest(sessionKey));
}

function slotPath(sessionDir: string, slot: number): string {
  return path.join(sessionDir, `continue-${slot}.json`);
}

/** Count durable continue slots present for a session (restart-safe). */
export function readStallContinueUsed(params: {
  ledgerDir: string;
  sessionKey: string;
  limit?: number;
}): number {
  const limit = params.limit ?? STALL_CONTINUE_LEDGER_LIMIT;
  const sessionDir = stallContinueLedgerSessionDir(params.ledgerDir, params.sessionKey);
  if (!fs.existsSync(sessionDir)) {
    return 0;
  }
  let used = 0;
  for (let slot = 1; slot <= limit + 8; slot += 1) {
    if (fs.existsSync(slotPath(sessionDir, slot))) {
      used = slot;
    }
  }
  return Math.min(used, limit + 8);
}

/**
 * Claim the next progress-stall continue slot. Fail-closed at limit.
 * Concurrent claims for the same next slot: exactly one wins (wx); loser recounts.
 */
export function claimStallContinue(params: {
  ledgerDir: string;
  sessionKey: string;
  limit?: number;
  nowMs?: number;
  kind?: string;
}): StallContinueClaimResult {
  const limit = params.limit ?? STALL_CONTINUE_LEDGER_LIMIT;
  const sessionKey = params.sessionKey.trim();
  const ledgerDir = params.ledgerDir.trim();
  if (!sessionKey || !ledgerDir) {
    return {
      allowed: false,
      continuesUsed: 0,
      exhausted: true,
      stopReason: STALL_CONTINUE_EXHAUSTED_REASON,
    };
  }
  const sessionDir = stallContinueLedgerSessionDir(ledgerDir, sessionKey);
  fs.mkdirSync(sessionDir, { recursive: true });

  for (let attempt = 0; attempt < limit + 4; attempt += 1) {
    const used = readStallContinueUsed({ ledgerDir, sessionKey, limit });
    if (used >= limit) {
      return {
        allowed: false,
        continuesUsed: used,
        exhausted: true,
        stopReason: STALL_CONTINUE_EXHAUSTED_REASON,
      };
    }
    const next = used + 1;
    const file = slotPath(sessionDir, next);
    const body = `${JSON.stringify({
      sessionKey,
      slot: next,
      kind: params.kind ?? "progress-stall",
      claimedAtMs: params.nowMs ?? Date.now(),
      limit,
    })}\n`;
    try {
      fs.writeFileSync(file, body, { flag: "wx", mode: 0o600 });
      return {
        allowed: true,
        continuesUsed: next,
        exhausted: next >= limit,
        ...(next >= limit ? { stopReason: STALL_CONTINUE_EXHAUSTED_REASON } : {}),
        claimedSlot: next,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        // Lost the race for this slot — loop and recount.
        continue;
      }
      throw error;
    }
  }

  const used = readStallContinueUsed({ ledgerDir, sessionKey, limit });
  return {
    allowed: false,
    continuesUsed: used,
    exhausted: true,
    stopReason: STALL_CONTINUE_EXHAUSTED_REASON,
  };
}

/** Whether another progress-stall continue is still allowed without claiming. */
export function canStallContinue(params: {
  ledgerDir: string;
  sessionKey: string;
  limit?: number;
}): boolean {
  const limit = params.limit ?? STALL_CONTINUE_LEDGER_LIMIT;
  return readStallContinueUsed(params) < limit;
}
