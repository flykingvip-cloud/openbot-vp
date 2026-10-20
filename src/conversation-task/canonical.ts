/**
 * ConversationTask Runtime — canonical serialization, hashing and goal
 * normalization (P2, per `.kiro/specs/conversation-task-runtime/p2-design-freeze.md`
 * A1.2 / A4 / normalizedGoal).
 *
 * Frozen contract (Scheme A):
 *  - Uniqueness truth lives in composite UNIQUE columns; hashes here derive only
 *    the plain, non-unique `candidate_id` / `task_key` index values.
 *  - Hash input is a length-prefixed, injective canonical serialization so two
 *    different tuples can never serialize to the same byte string.
 *  - The tenant file key is the FULL SHA-256 of the canonical tenant bytes (never
 *    truncated, never a sanitized readable prefix). Injectivity is not claimed
 *    from truncation; the store additionally verifies `meta.tenant_id` on open.
 *  - `normalizeGoal` performs only meaning-preserving normalization (Unicode NFC +
 *    whitespace folding). It must not drop digits, negation, entities or
 *    significant punctuation, so distinct goals map to distinct keys.
 *
 * Pure and deterministic: no clock, locale, or ambient state.
 */

import { createHash } from "node:crypto";

/** NFC-normalize a key field. Idempotent. */
function nfc(value: string): string {
  return value.normalize("NFC");
}

/**
 * Meaning-preserving goal normalization (frozen):
 *  - Unicode NFC.
 *  - Fold every run of Unicode whitespace to a single ASCII space.
 *  - Trim leading/trailing whitespace.
 * No case folding, no full/half-width conversion, no stemming, no punctuation
 * removal. Digits, negation words, entities and punctuation are preserved.
 */
export function normalizeGoal(goal: string): string {
  return nfc(goal).replace(/\s+/gu, " ").trim();
}

/** SHA-256 hex digest of a buffer or utf-8 string. */
export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Length-prefixed injective frame for one field:
 *   frame(f) = uint32BE(utf8ByteLength(f)) || utf8Bytes(f)
 * Concatenating frames is injective over the field vector, so no delimiter can
 * be forged by field content.
 */
function frame(field: string): Buffer {
  const bytes = Buffer.from(field, "utf8");
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(bytes.length, 0);
  return Buffer.concat([prefix, bytes]);
}

/** Canonical serialization of an ordered field vector (length-prefixed frames). */
export function canonicalSerialize(fields: readonly string[]): Buffer {
  return Buffer.concat(fields.map(frame));
}

/**
 * Canonical decimal string for an activation epoch: a non-negative integer with
 * no leading zeros, so `1` and `01` can never collide.
 */
export function canonicalizeActivationEpoch(epoch: number): string {
  if (!Number.isInteger(epoch) || epoch < 0) {
    throw new RangeError(`activationEpoch must be a non-negative integer, got ${epoch}`);
  }
  return epoch.toString(10);
}

/**
 * Full SHA-256 (64 hex chars) of the canonical tenant bytes. This is the DB file
 * key. It is NOT claimed to be collision-free by truncation (it is not
 * truncated); the store still verifies `meta.tenant_id` on every open.
 */
export function fileKeyForTenant(tenantId: string): string {
  return sha256Hex(Buffer.from(nfc(tenantId), "utf8"));
}

/** Canonical tenant identity string stored in `meta.tenant_id` and compared on open. */
export function canonicalTenantId(tenantId: string): string {
  return nfc(tenantId);
}

/** Candidate composite tuple (the business uniqueness truth). */
export type CandidateKeyTuple = {
  tenantId: string;
  conversationId: string;
  sourceMessageId: string;
  decisionVersion: string;
};

/**
 * Derive the plain (non-unique) `candidate_id` index value from the composite
 * tuple. A hash collision here never merges rows — the store compares the full
 * tuple after any hash hit.
 */
export function deriveCandidateId(tuple: CandidateKeyTuple): string {
  const ser = canonicalSerialize([
    nfc(tuple.tenantId),
    nfc(tuple.conversationId),
    nfc(tuple.sourceMessageId),
    nfc(tuple.decisionVersion),
  ]);
  return `cand_${sha256Hex(ser)}`;
}

/** ConversationTask composite tuple (the business uniqueness truth). */
export type TaskKeyTuple = {
  tenantId: string;
  conversationId: string;
  /** Already normalized via `normalizeGoal`. */
  normalizedGoal: string;
  activationEpoch: number;
};

/**
 * Derive the plain (non-unique) `task_key` index value from the composite tuple.
 * As with candidates, uniqueness is enforced by the composite UNIQUE column, not
 * by this hash.
 */
export function deriveTaskKey(tuple: TaskKeyTuple): string {
  const ser = canonicalSerialize([
    nfc(tuple.tenantId),
    nfc(tuple.conversationId),
    nfc(tuple.normalizedGoal),
    canonicalizeActivationEpoch(tuple.activationEpoch),
  ]);
  return `ctask_${sha256Hex(ser)}`;
}
