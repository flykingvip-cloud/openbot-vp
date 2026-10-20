/**
 * Node-side enforcement for the `local-files-readonly` profile.
 *
 * This is the part that must hold even when the gateway is wrong. Declaring
 * fewer commands in the handshake is advisory; hiding `system.run` from the
 * model's tool list is advisory. This guard is the enforcement point: a command
 * outside the profile is refused on arrival, and a read is refused unless it
 * carries a capability that verifies against the pinned keyset AND was
 * successfully redeemed online (design 4.2, 9.3, 9.5).
 *
 * Order matters. Signature verification happens first, and a capability that
 * fails it never reaches the redemption endpoint (design 9.3 step 1).
 */

import {
  gateProfileCommand,
  type CommandGateResult,
} from "../../local-files/capability-profile.js";
import { verifyCapability, type CapabilityVerifyFailure } from "../../local-files/capability.js";
import type { NodeCapabilityKeyset } from "../../local-files/keyset.js";
import {
  LOCAL_FILES_OPAQUE_DENIAL,
  type InvocationCapabilityClaims,
  type LocalFilesOperation,
  type ResolveTicketClaims,
  type SignedCapability,
} from "../../local-files/types.js";

/** Result of the gateway's online redemption of one capability. */
export type RedemptionOutcome = { ok: true } | { ok: false; reason: string };

/** Injected so the node's dependency on the gateway is explicit and testable. */
export type RedemptionClient = {
  /**
   * Submit the complete capability for atomic redemption. Never a bare nonce:
   * a nonce alone carries nothing to verify or bind (design 9.3).
   */
  redeem(params: {
    capability: SignedCapability;
    operation: LocalFilesOperation;
  }): Promise<RedemptionOutcome>;
};

export type LocalFilesGuardDeps = {
  keyset: Pick<NodeCapabilityKeyset, "resolveVerificationKey">;
  redemption: RedemptionClient;
  /** Profile the node host was launched with. */
  configuredProfile: string;
  now?: () => number;
};

export type GuardFailure =
  | { kind: "command-denied"; gate: Extract<CommandGateResult, { ok: false }> }
  | { kind: "capability-missing" }
  | { kind: "capability-invalid"; reason: CapabilityVerifyFailure }
  | { kind: "operation-mismatch" }
  | { kind: "redemption-refused"; reason: string };

/**
 * Map any guard failure to what the model is allowed to see.
 *
 * Deliberately uniform: the model must not learn whether a path exists, what
 * type it is, or which rule fired (design 9.1, 9.7).
 */
export function guardFailureToModelMessage(_failure: GuardFailure): string {
  return LOCAL_FILES_OPAQUE_DENIAL;
}

/** Detail string for the audit log only. Never returned to the model. */
export function guardFailureDetail(failure: GuardFailure): string {
  switch (failure.kind) {
    case "command-denied":
      return `${failure.kind}:${failure.gate.reason}:${failure.gate.command}`;
    case "capability-invalid":
      return `${failure.kind}:${failure.reason}`;
    case "redemption-refused":
      return `${failure.kind}:${failure.reason}`;
    default:
      return failure.kind;
  }
}

/**
 * Refuse any command outside the profile.
 *
 * Call this before dispatch, so it also covers commands that a handler chain
 * would otherwise reach by fallthrough.
 */
export function guardCommand(
  command: string,
): { ok: true; operation: LocalFilesOperation } | { ok: false; failure: GuardFailure } {
  const gate = gateProfileCommand(command);
  if (!gate.ok) {
    return { ok: false, failure: { kind: "command-denied", gate } };
  }
  return { ok: true, operation: gate.operation };
}

/**
 * Verify a resolve ticket.
 *
 * A resolve ticket authorizes exactly one thing: expanding and canonicalizing one
 * path and applying the hard denials. It cannot be turned into a read, so it is
 * checked against `expectedKind: "resolve-ticket"` and its intended operation is
 * informational only (design 9.1).
 */
export async function authorizeResolve(params: {
  ticket: SignedCapability;
  deps: LocalFilesGuardDeps;
}): Promise<{ ok: true; claims: ResolveTicketClaims } | { ok: false; failure: GuardFailure }> {
  const nowMs = params.deps.now?.() ?? Date.now();
  const verified = verifyCapability<ResolveTicketClaims>(params.ticket, {
    keyset: params.deps.keyset,
    nowMs,
    expectedKind: "resolve-ticket",
  });
  if (!verified.ok) {
    // Verification failed, so we never contact the redemption endpoint.
    return { ok: false, failure: { kind: "capability-invalid", reason: verified.reason } };
  }

  // Resolve tickets are single use too, and are redeemed through the same
  // online ledger so a restarted node cannot replay one.
  const redeemed = await params.deps.redemption.redeem({
    capability: params.ticket,
    operation: verified.claims.intendedOperation,
  });
  if (!redeemed.ok) {
    return { ok: false, failure: { kind: "redemption-refused", reason: redeemed.reason } };
  }
  return { ok: true, claims: verified.claims };
}

/**
 * Verify then redeem an Invocation capability.
 *
 * Steps, in this order (design 9.3):
 *   1. verify the signature, keyId, validity window and canonical form locally
 *   2. confirm the capability's operation is the command actually invoked
 *   3. submit the whole capability for atomic online redemption
 * Only after all three may the caller open anything.
 */
export async function authorizeInvocation(params: {
  capability: SignedCapability | null | undefined;
  command: LocalFilesOperation;
  deps: LocalFilesGuardDeps;
}): Promise<
  { ok: true; claims: InvocationCapabilityClaims } | { ok: false; failure: GuardFailure }
> {
  if (!params.capability) {
    return { ok: false, failure: { kind: "capability-missing" } };
  }
  const nowMs = params.deps.now?.() ?? Date.now();

  const verified = verifyCapability<InvocationCapabilityClaims>(params.capability, {
    keyset: params.deps.keyset,
    nowMs,
    expectedKind: "invocation",
  });
  if (!verified.ok) {
    return { ok: false, failure: { kind: "capability-invalid", reason: verified.reason } };
  }
  if (verified.claims.operation !== params.command) {
    return { ok: false, failure: { kind: "operation-mismatch" } };
  }

  const redeemed = await params.deps.redemption.redeem({
    capability: params.capability,
    operation: params.command,
  });
  if (!redeemed.ok) {
    return { ok: false, failure: { kind: "redemption-refused", reason: redeemed.reason } };
  }
  return { ok: true, claims: verified.claims };
}
