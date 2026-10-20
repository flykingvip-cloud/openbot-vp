/**
 * Tri-Platform Employee Shell — one-time web bootstrap token store (Phase 1).
 *
 * Backs the `/native/bootstrap` flow (design doc §5.4): a native app that has
 * already established an Employee Identity mints a SHORT-LIVED, SINGLE-USE token,
 * then opens `/native/bootstrap?token=...&target=...` in its WebView; the server
 * consumes the token and establishes an HttpOnly employee session.
 *
 * Security properties (mirrors the `issueActivationCode` precedent in
 * platform-auth/token-operations.ts, plus stricter TTL):
 *   - tokens are high-entropy random and stored ONLY as a sha256 hash (never plaintext);
 *   - single-use: a token is deleted on first successful consume;
 *   - short TTL (default/clamped <= 60s) per the design doc;
 *   - bound to a resolved principal (userId + email + membership + enterprise) + a
 *     pre-validated safe redirect target, all captured at mint time.
 *
 * This module is intentionally a pure in-memory primitive: it neither reads
 * cookies nor issues sessions (that wiring is gated on review). In-memory is
 * appropriate for a <=60s single-use token — a gateway restart simply
 * invalidates outstanding tokens, which is the safe failure mode.
 */

import { createHash, randomBytes } from "node:crypto";

/** Principal + redirect captured when a bootstrap token is minted. */
export type BootstrapTokenPrincipal = {
  /** Platform-auth user id the resulting session belongs to. */
  userId: string;
  /** User email (for audit logging; the session is rebuilt from userId at consume). */
  userEmail: string;
  /** Exact active membership selected by the source session. */
  membershipId: string;
  /** Enterprise paired with `membershipId`; it is revalidated at consume. */
  enterpriseId: string;
  /** Pre-validated, site-internal embed target to redirect to (see embed-target.ts). */
  target: string;
};

/** Default/maximum token lifetime. The design doc caps bootstrap tokens at <= 60s. */
export const BOOTSTRAP_TOKEN_DEFAULT_TTL_MS = 60_000;
export const BOOTSTRAP_TOKEN_MAX_TTL_MS = 60_000;

type StoredRecord = BootstrapTokenPrincipal & { expiresAtMs: number };

export type BootstrapTokenStore = {
  /** Mint a single-use token for a principal; returns the plaintext token (shown once). */
  mint(input: BootstrapTokenPrincipal & { ttlMs?: number; now?: number }): string;
  /** Consume a token (single-use). Returns the bound principal or null when invalid/expired/used. */
  consume(token: string, now?: number): BootstrapTokenPrincipal | null;
  /** Remove expired records (best-effort housekeeping). */
  prune(now?: number): void;
  /** Number of live (unconsumed) records — for tests/observability. */
  size(): number;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function clampTtl(ttlMs: number | undefined): number {
  if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    return BOOTSTRAP_TOKEN_DEFAULT_TTL_MS;
  }
  return Math.min(ttlMs, BOOTSTRAP_TOKEN_MAX_TTL_MS);
}

/** Create an isolated in-memory bootstrap-token store. */
export function createBootstrapTokenStore(): BootstrapTokenStore {
  const byHash = new Map<string, StoredRecord>();

  function prune(now = Date.now()): void {
    for (const [hash, record] of byHash) {
      if (record.expiresAtMs <= now) {
        byHash.delete(hash);
      }
    }
  }

  return {
    mint(input) {
      const now = input.now ?? Date.now();
      // 32 bytes of entropy: this token grants a session, so use more than the
      // 18-byte activation-code precedent.
      const token = randomBytes(32).toString("base64url");
      byHash.set(hashToken(token), {
        userId: input.userId,
        userEmail: input.userEmail,
        membershipId: input.membershipId,
        enterpriseId: input.enterpriseId,
        target: input.target,
        expiresAtMs: now + clampTtl(input.ttlMs),
      });
      return token;
    },

    consume(token, now = Date.now()) {
      if (typeof token !== "string" || token.length === 0) {
        return null;
      }
      const hash = hashToken(token);
      const record = byHash.get(hash);
      if (!record) {
        return null;
      }
      // Single-use: remove regardless of expiry so a token can never be replayed.
      byHash.delete(hash);
      if (record.expiresAtMs <= now) {
        return null;
      }
      return {
        userId: record.userId,
        userEmail: record.userEmail,
        membershipId: record.membershipId,
        enterpriseId: record.enterpriseId,
        target: record.target,
      };
    },

    prune,

    size() {
      return byHash.size;
    },
  };
}
