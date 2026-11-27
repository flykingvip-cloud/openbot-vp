/**
 * Production stored-result read ACL. Distinct from write/membership/send authority.
 *
 * Allow only when the current trusted host binding exactly matches the binding
 * stamped on the stored receipt. Missing current identity, missing stamp, or
 * mismatch fails closed. Cross-session, cross-run, tenant-wide, and admin-wide
 * reads are not granted here.
 */
import {
  computeStoredResultHostReadBinding,
  peekCurrentStoredResultReadBinding,
  peekExposedStoredResultReadBinding,
  type StoredResultHostReadBindingInput,
} from "../../state/stored-result-read-binding.js";

export type StoredResultReadDecision = "allowed" | "denied" | "unverifiable";

export function resolveStoredResultReadHook(input: StoredResultHostReadBindingInput): {
  hostReadBinding?: string;
  authorizeStoredResultRead: (params: unknown) => StoredResultReadDecision;
} {
  const hostReadBinding = computeStoredResultHostReadBinding(input);
  return {
    ...(hostReadBinding ? { hostReadBinding } : {}),
    authorizeStoredResultRead: createAuthorizeStoredResultRead(hostReadBinding),
  };
}

export function createAuthorizeStoredResultRead(
  currentBinding: string | undefined,
): (params: unknown) => StoredResultReadDecision {
  const expected = currentBinding?.trim() || undefined;
  return (_params: unknown): StoredResultReadDecision => {
    // Tool parameters are untrusted and must not grant receipt access.
    if (!expected) {
      return "unverifiable";
    }
    const scoped = peekCurrentStoredResultReadBinding();
    if (scoped && scoped !== expected) {
      return "unverifiable";
    }
    const stored = peekExposedStoredResultReadBinding();
    if (!stored) {
      return "unverifiable";
    }
    if (stored !== expected) {
      return "denied";
    }
    return "allowed";
  };
}
