/**
 * ConversationTask Runtime — error types.
 */

import type { ConversationTaskInvariantId } from "./invariants.js";

export class ConversationTaskInvariantError extends Error {
  readonly invariantId: ConversationTaskInvariantId;

  constructor(id: ConversationTaskInvariantId, message: string) {
    super(`${id}: ${message}`);
    this.name = "ConversationTaskInvariantError";
    this.invariantId = id;
  }
}

/**
 * Fail-closed store error (P2). Raised when the store cannot proceed safely —
 * e.g. a missing/untrusted tenantId, or a PRAGMA self-check failure. Messages
 * must never contain the raw tenant value (privacy); use the hashed file key.
 */
export class ConversationTaskStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "ConversationTaskStoreError";
    this.code = code;
  }
}

/**
 * Fail-closed access-control error (P2). Raised when a tenant / conversation /
 * employee scope check does not pass. Carries only a stable `code`, never raw
 * identifiers.
 */
export class ConversationTaskAccessError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "ConversationTaskAccessError";
    this.code = code;
  }
}

/** Reasons a tenant DB open is rejected as an isolation violation. */
export type TenantIsolationViolationReason =
  | "meta_mismatch"
  | "meta_missing_with_data"
  | "pragma_failed";

/**
 * Tenant isolation violation (P2, fail-closed). Raised when a tenant DB's
 * `meta.tenant_id` does not match the requested tenant, or `meta` is missing yet
 * business tables already hold rows (file mismatch / replacement / tamper). The
 * error carries only the hashed `fileKey` and a reason — never the raw tenant
 * value — so logs stay free of sensitive identifiers.
 */
export class TenantIsolationViolationError extends Error {
  readonly reason: TenantIsolationViolationReason;
  readonly fileKey: string;

  constructor(reason: TenantIsolationViolationReason, fileKey: string) {
    super(`TenantIsolationViolation(${reason}) for fileKey=${fileKey}`);
    this.name = "TenantIsolationViolationError";
    this.reason = reason;
    this.fileKey = fileKey;
  }
}
