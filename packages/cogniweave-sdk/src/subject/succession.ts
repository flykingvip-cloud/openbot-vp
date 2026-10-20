import type {
  MemorySubjectBinding,
  MemoryTransferClass,
  SeatMemoryScopeTransfer,
} from "../models.js";
import {
  createMemorySubjectBinding,
  isLiveMemorySubjectBinding,
  markMemorySubjectBindingUnbound,
  normalizeMemorySubject,
} from "./binding.js";

/**
 * CW2-P3-02 seat succession — authorization-plane rebinding only.
 * Never copies canonical atoms / journals; never rewrites op-keys.
 */

export type ApplySeatMemorySuccessionInput = {
  bindings: ReadonlyArray<MemorySubjectBinding>;
  tenantId: string;
  seatId: string;
  outgoingUserId: string;
  incomingUserId: string;
  /** Classified scopes from OpenBot handover snapshot / governance. */
  scopes: ReadonlyArray<SeatMemoryScopeTransfer>;
  /** Admin-confirmed review_required scopeIds. */
  confirmedScopeIds?: ReadonlySet<string> | ReadonlyArray<string>;
  /**
   * Map a binding to an OpenBot memory scopeId (e.g. `seat:{seatId}`).
   * Unknown → treated as review_required without confirmation (fail closed).
   */
  resolveScopeId: (binding: MemorySubjectBinding) => string | undefined;
  now?: string;
};

export type SeatMemorySuccessionResult = {
  /** Full binding set after succession (includes unchanged + unbound + new). */
  bindings: MemorySubjectBinding[];
  unboundBindingIds: string[];
  createdBindingIds: string[];
  skippedPrivateScopeIds: string[];
  skippedReviewScopeIds: string[];
  preservedSeatBindingIds: string[];
};

/** OpenBot seat memory scope id convention (`seat:{seatId}`). */
export function resolveSeatMemoryScopeId(seatId: string): string {
  return `seat:${seatId.trim()}`;
}

function toConfirmedSet(
  value: ApplySeatMemorySuccessionInput["confirmedScopeIds"],
): ReadonlySet<string> {
  if (!value) {
    return new Set();
  }
  return value instanceof Set ? value : new Set(value);
}

function transferClassForScope(
  scopes: ReadonlyArray<SeatMemoryScopeTransfer>,
  scopeId: string | undefined,
): MemoryTransferClass {
  if (!scopeId) {
    return "review_required";
  }
  const hit = scopes.find((scope) => scope.scopeId === scopeId);
  return hit?.transferClass ?? "review_required";
}

/**
 * Apply seat succession to MemorySubjectBindings.
 *
 * Rules:
 * - `ownerType: seat` for this seatId stays (assets follow the seat).
 * - Outgoing user bindings: soft-unbind; successor bind only for inheritable
 *   or confirmed review_required. Private never inherits.
 * - Mutates authorization plane only — callers persist returned bindings.
 */
export function applySeatMemorySuccession(
  input: ApplySeatMemorySuccessionInput,
): SeatMemorySuccessionResult {
  const tenantId = input.tenantId.trim();
  const seatId = input.seatId.trim();
  const outgoingUserId = input.outgoingUserId.trim();
  const incomingUserId = input.incomingUserId.trim();
  if (!tenantId || !seatId || !outgoingUserId || !incomingUserId) {
    throw new Error("applySeatMemorySuccession: tenantId/seatId/user ids are required");
  }
  if (outgoingUserId === incomingUserId) {
    throw new Error("applySeatMemorySuccession: outgoing and incoming user must differ");
  }

  const now = input.now ?? new Date().toISOString();
  const confirmed = toConfirmedSet(input.confirmedScopeIds);
  const byId = new Map<string, MemorySubjectBinding>();
  for (const binding of input.bindings) {
    byId.set(binding.id, binding);
  }

  const unboundBindingIds: string[] = [];
  const createdBindingIds: string[] = [];
  const skippedPrivateScopeIds: string[] = [];
  const skippedReviewScopeIds: string[] = [];
  const preservedSeatBindingIds: string[] = [];
  const seenSkipPrivate = new Set<string>();
  const seenSkipReview = new Set<string>();

  const candidates = [...byId.values()].filter(
    (binding) => isLiveMemorySubjectBinding(binding) && binding.subject.tenantId === tenantId,
  );

  for (const binding of candidates) {
    if (binding.subject.ownerType === "seat" && binding.subject.ownerId === seatId) {
      preservedSeatBindingIds.push(binding.id);
      continue;
    }

    if (binding.subject.ownerType !== "user" || binding.subject.ownerId !== outgoingUserId) {
      continue;
    }

    const scopeId = input.resolveScopeId(binding);
    const transferClass = transferClassForScope(input.scopes, scopeId);
    const unbound = markMemorySubjectBindingUnbound(binding, now);
    byId.set(unbound.id, unbound);
    unboundBindingIds.push(unbound.id);

    if (transferClass === "private") {
      if (scopeId && !seenSkipPrivate.has(scopeId)) {
        skippedPrivateScopeIds.push(scopeId);
        seenSkipPrivate.add(scopeId);
      }
      continue;
    }

    if (transferClass === "review_required") {
      if (!scopeId || !confirmed.has(scopeId)) {
        if (scopeId && !seenSkipReview.has(scopeId)) {
          skippedReviewScopeIds.push(scopeId);
          seenSkipReview.add(scopeId);
        }
        continue;
      }
    }

    // inheritable, or confirmed review_required
    const successor = createMemorySubjectBinding({
      partition: binding.partition,
      scope: binding.scope,
      scopeType: binding.scopeType,
      subject: normalizeMemorySubject({
        tenantId,
        ownerType: "user",
        ownerId: incomingUserId,
      }),
      now,
    });
    byId.set(successor.id, successor);
    createdBindingIds.push(successor.id);
  }

  return {
    bindings: [...byId.values()],
    unboundBindingIds,
    createdBindingIds,
    skippedPrivateScopeIds,
    skippedReviewScopeIds,
    preservedSeatBindingIds,
  };
}

/** Alias matching plan naming. */
export const applySeatSuccession = applySeatMemorySuccession;
