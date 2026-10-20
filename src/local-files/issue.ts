/**
 * Gateway-side issuing of the three token kinds (design 9.1, 9.2).
 *
 * Issuing rules enforced here:
 * - a resolve ticket carries the raw user path and cannot be turned into a read
 * - a Turn authorization only ever uses `scope: "exact"`; there is no directory
 *   tree grant, so listing a directory never implies reading its children
 * - an Invocation capability may not exceed its parent's operation set or its
 *   remaining budget
 */

import { newId, newNonce, signCapability } from "./capability.js";
import type { CapabilitySigningKey } from "./keyset.js";
import type { TurnAuthorizationStore } from "./turn-authorization.js";
import {
  ARCHIVE_TASK_BUDGET,
  type CapabilityBinding,
  type CapabilityTargetKind,
  type FileIdentity,
  type GrantSource,
  type InvocationCapabilityClaims,
  type LocalFilesOperation,
  type ResolveTicketClaims,
  SINGLE_CALL_BUDGET,
  type SignedCapability,
  type TurnAuthorizationClaims,
  type TurnBudget,
} from "./types.js";

/** Resolve tickets are short-lived: they exist only to bridge one round trip. */
export const RESOLVE_TICKET_TTL_MS = 15_000;
/** Invocation capabilities live just long enough for one call. */
export const INVOCATION_TTL_MS = 30_000;

export function issueResolveTicket(params: {
  binding: CapabilityBinding;
  rawPath: string;
  intendedOperation: LocalFilesOperation;
  signingKey: CapabilitySigningKey;
  nowMs: number;
  ttlMs?: number;
}): { signed: SignedCapability; claims: ResolveTicketClaims } {
  const claims: ResolveTicketClaims = {
    kind: "resolve-ticket",
    ticketId: newId("rt"),
    binding: params.binding,
    rawPath: params.rawPath,
    intendedOperation: params.intendedOperation,
    nonce: newNonce(),
    issuedAtMs: params.nowMs,
    expiresAtMs: params.nowMs + (params.ttlMs ?? RESOLVE_TICKET_TTL_MS),
  };
  return { signed: signCapability(claims, params.signingKey), claims };
}

/**
 * Default budget for a bounded task.
 *
 * "Inspect this ZIP" is one bounded task, not a token that only covers the first
 * `archive.list` — the approval card says inspect, so the grant must actually
 * cover the entry reads that follow (design 9.2).
 */
export function defaultBudgetForOperations(operations: LocalFilesOperation[]): TurnBudget {
  const isArchiveTask =
    operations.includes("archive.list") || operations.includes("archive.readEntry");
  return isArchiveTask ? { ...ARCHIVE_TASK_BUDGET } : { ...SINGLE_CALL_BUDGET };
}

export type IssueTurnAuthorizationResult =
  | { ok: true; signed: SignedCapability; claims: TurnAuthorizationClaims }
  | { ok: false; reason: "directory-scope-requires-list-only" | "empty-operations" };

export function issueTurnAuthorization(params: {
  binding: CapabilityBinding;
  canonicalPath: string;
  fileId: FileIdentity;
  targetKind: CapabilityTargetKind;
  operations: LocalFilesOperation[];
  grantSource: GrantSource;
  budget?: TurnBudget;
  signingKey: CapabilitySigningKey;
  store: TurnAuthorizationStore;
  nowMs: number;
  expiresAtMs: number;
}): IssueTurnAuthorizationResult {
  const operations = [...new Set(params.operations)];
  if (operations.length === 0) {
    return { ok: false, reason: "empty-operations" };
  }
  // A directory target may only be listed. Granting a read against a directory
  // target would be the directory-tree grant the design forbids.
  if (params.targetKind === "directory") {
    const allowed = new Set<LocalFilesOperation>(["fs.list", "fs.stat"]);
    if (!operations.every((op) => allowed.has(op))) {
      return { ok: false, reason: "directory-scope-requires-list-only" };
    }
  }

  const claims: TurnAuthorizationClaims = {
    kind: "turn-authorization",
    authorizationId: newId("ta"),
    binding: params.binding,
    canonicalPath: params.canonicalPath,
    fileId: params.fileId,
    targetKind: params.targetKind,
    scope: "exact",
    operations,
    budget: params.budget ?? defaultBudgetForOperations(operations),
    grantSource: params.grantSource,
    issuedAtMs: params.nowMs,
    expiresAtMs: params.expiresAtMs,
  };
  params.store.put(claims);
  return { ok: true, signed: signCapability(claims, params.signingKey), claims };
}

export type DeriveInvocationResult =
  | { ok: true; signed: SignedCapability; claims: InvocationCapabilityClaims }
  | {
      ok: false;
      reason:
        | "authorization-unknown"
        | "authorization-revoked"
        | "authorization-expired"
        | "operation-not-authorized"
        | "budget-exhausted"
        | "entry-path-requires-archive-read";
    };

/** Map a budget reservation failure onto a derivation failure reason. */
function derivationFailureFor(
  reason: Exclude<ReturnType<TurnAuthorizationStore["reserveIssuance"]>, { ok: true }>["reason"],
): Exclude<DeriveInvocationResult, { ok: true }>["reason"] {
  switch (reason) {
    case "authorization-unknown":
    case "authorization-revoked":
    case "authorization-expired":
    case "operation-not-authorized":
      return reason;
    default:
      return "budget-exhausted";
  }
}

/**
 * Derive a single-use Invocation capability from a Turn authorization.
 *
 * This is the derivation gate: once the turn's budget is spent, no further
 * capability is minted, so an exhausted budget stops work at issuing time rather
 * than only at redemption.
 */
export function deriveInvocationCapability(params: {
  authorizationId: string;
  operation: LocalFilesOperation;
  archiveEntryPath?: string;
  signingKey: CapabilitySigningKey;
  store: TurnAuthorizationStore;
  nowMs: number;
  ttlMs?: number;
  clockSkewMs: number;
}): DeriveInvocationResult {
  const record = params.store.get(params.authorizationId);
  if (!record) {
    return { ok: false, reason: "authorization-unknown" };
  }
  if (params.archiveEntryPath !== undefined && params.operation !== "archive.readEntry") {
    return { ok: false, reason: "entry-path-requires-archive-read" };
  }

  // Reserve the issuance slot before signing anything. Validity, revocation,
  // operation membership and budget are all checked inside the reservation.
  const reserved = params.store.reserveIssuance({
    authorizationId: params.authorizationId,
    operation: params.operation,
    nowMs: params.nowMs,
    clockSkewMs: params.clockSkewMs,
  });
  if (!reserved.ok) {
    return { ok: false, reason: derivationFailureFor(reserved.reason) };
  }

  const claims: InvocationCapabilityClaims = {
    kind: "invocation",
    capabilityId: newId("ic"),
    authorizationId: record.claims.authorizationId,
    binding: record.claims.binding,
    canonicalPath: record.claims.canonicalPath,
    fileId: record.claims.fileId,
    targetKind: record.claims.targetKind,
    scope: "exact",
    operation: params.operation,
    useCount: 1,
    nonce: newNonce(),
    issuedAtMs: params.nowMs,
    expiresAtMs: params.nowMs + (params.ttlMs ?? INVOCATION_TTL_MS),
  };
  if (params.archiveEntryPath !== undefined) {
    claims.archiveEntryPath = params.archiveEntryPath;
  }
  return { ok: true, signed: signCapability(claims, params.signingKey), claims };
}
