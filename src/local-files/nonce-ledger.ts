/**
 * Consumed-nonce ledger, held by the gateway.
 *
 * The node must not keep this: an in-memory nonce set on the node is lost on
 * process restart, so a restarted node would accept a replayed capability. The
 * consumption record therefore lives gateway-side and survives node reconnects
 * and restarts (design 9.3).
 *
 * The redemption key includes the capability kind, which is what keeps the three
 * nonce spaces separate — a resolve ticket's nonce cannot be redeemed for a read.
 */

import crypto from "node:crypto";
import { CAPABILITY_CLOCK_SKEW_MS, type CapabilityKind } from "./types.js";

export type RedemptionKeyParts = {
  kind: CapabilityKind;
  capabilityDigest: string;
  nonce: string;
  nodeId: string;
};

/**
 * Build the redemption key.
 *
 * Keyed on `capabilityDigest + nonce + nodeId` (design 9.3) so that submitting a
 * bare nonce, or a nonce lifted onto a modified capability, cannot match — and
 * cannot pre-poison the consumption record for the legitimate capability.
 */
export function buildRedemptionKey(parts: RedemptionKeyParts): string {
  const material = [parts.kind, parts.capabilityDigest, parts.nonce, parts.nodeId].join("\u0000");
  return crypto.createHash("sha256").update(material, "utf8").digest("hex");
}

type LedgerEntry = {
  /** Retain until this instant, then the record may be dropped. */
  retainUntilMs: number;
  consumedAtMs: number;
};

export class NonceLedger {
  private readonly consumed = new Map<string, LedgerEntry>();
  private readonly clockSkewMs: number;

  constructor(opts?: { clockSkewMs?: number }) {
    this.clockSkewMs = opts?.clockSkewMs ?? CAPABILITY_CLOCK_SKEW_MS;
  }

  isConsumed(key: string, nowMs: number): boolean {
    const entry = this.consumed.get(key);
    if (!entry) {
      return false;
    }
    if (nowMs > entry.retainUntilMs) {
      // Past retention the token itself is long expired, so verification already
      // rejects it; dropping the record here just bounds memory.
      this.consumed.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Mark a nonce consumed. Returns false when it was already consumed, which is
   * how concurrent double-redemption resolves to exactly one winner.
   *
   * Synchronous by contract: callers rely on there being no suspension point
   * between the `isConsumed` check and this write.
   */
  consume(key: string, expiresAtMs: number, nowMs: number): boolean {
    if (this.isConsumed(key, nowMs)) {
      return false;
    }
    this.consumed.set(key, {
      retainUntilMs: expiresAtMs + this.clockSkewMs,
      consumedAtMs: nowMs,
    });
    return true;
  }

  /** Drop records past retention. */
  purgeExpired(nowMs: number): number {
    let removed = 0;
    for (const [key, entry] of this.consumed.entries()) {
      if (nowMs > entry.retainUntilMs) {
        this.consumed.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  size(): number {
    return this.consumed.size;
  }
}
