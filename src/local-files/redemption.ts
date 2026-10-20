/**
 * Gateway-side capability redemption (design 9.3, P0 in 9.7).
 *
 * The node verifying a signature is not sufficient. The redeeming end must
 * re-verify the whole capability, because only the gateway knows whether the
 * capability was really derived from a still-valid Turn authorization, whether
 * budget remains, and whether the nonce is unused.
 *
 * Transaction order is fixed and must not be rearranged:
 *   1. verify the capability (every item in `verifyRedemption`)
 *   2. check and decrement the Turn authorization budget
 *   3. mark the nonce consumed
 *   4. return a one-shot success result
 *
 * Verification happens strictly before any write. If any step fails the whole
 * thing rolls back: budget is not decremented, the nonce is NOT recorded as
 * consumed, and no success is returned. That last point matters — a malicious or
 * faulty node must not be able to pre-poison the consumption record for a
 * capability it cannot legitimately redeem.
 *
 * Every function here is synchronous. That is the atomicity mechanism: with no
 * suspension point between check and write, two concurrent redemptions of the
 * same capability cannot interleave, so exactly one wins.
 */

import { verifyConnectionIdentity } from "./capability-profile.js";
import {
  bindingsEqual,
  capabilityDigest,
  verifyCapability,
  type CapabilityKeyLookup,
  type CapabilityKeyLookupFailure,
} from "./capability.js";
import type { LocalDeviceBindingStore } from "./device-binding.js";
import type { CapabilityVerificationKey } from "./keyset.js";
import { buildRedemptionKey, NonceLedger } from "./nonce-ledger.js";
import type { TurnAuthorizationStore } from "./turn-authorization.js";
import {
  CAPABILITY_CLOCK_SKEW_MS,
  type InvocationCapabilityClaims,
  type LocalFilesOperation,
  type ResolveTicketClaims,
  type SignedCapability,
} from "./types.js";

/** Minimal keyset view both sides use to resolve a `keyId`. */
export type CapabilityKeyResolver = CapabilityKeyLookup;

/** A gateway-side resolver over a fixed set of published verification keys. */
export class StaticCapabilityKeyResolver implements CapabilityKeyLookup {
  private keys: CapabilityVerificationKey[];

  constructor(keys: CapabilityVerificationKey[]) {
    this.keys = [...keys];
  }

  /** Publish a new verification set. Removing a `keyId` revokes it immediately. */
  publish(keys: CapabilityVerificationKey[]): void {
    this.keys = [...keys];
  }

  resolveVerificationKey(
    keyId: string,
    _nowMs: number,
  ): { ok: true; publicKey: string } | { ok: false; reason: CapabilityKeyLookupFailure } {
    const found = this.keys.find((key) => key.keyId === keyId);
    if (!found) {
      return { ok: false, reason: "unknown-key-id" };
    }
    return { ok: true, publicKey: found.publicKey };
  }
}

/**
 * The connection the redemption arrived on. `devicePublicKey` is the key the
 * gateway authenticated for this live connection, not a value the caller may
 * assert about itself.
 */
export type RedeemingConnection = {
  nodeId: string;
  devicePublicKey: string;
  authenticated: boolean;
  /**
   * Capability profile this live connection is running, derived from what it
   * advertised at handshake. `undefined` is a refusal, not a pass: a connection
   * that does not present the profile cannot redeem a capability for it.
   */
  capabilityProfile: string | undefined;
  /**
   * Commands the node declared at handshake. Required rather than optional so a
   * caller cannot omit it and quietly skip the check; an empty list fails.
   */
  declaredCommands: readonly string[];
};

export type RedemptionRequest = {
  /**
   * The complete Invocation capability. Submitting only a nonce is invalid by
   * construction: there is nothing to verify and nothing to bind (design 9.3).
   */
  capability: SignedCapability;
  connection: RedeemingConnection;
  /** Declared operation, cross-checked against the capability's own claim. */
  operation: LocalFilesOperation;
};

export type RedemptionFailureReason =
  | "connection-not-authenticated"
  | "capability-invalid"
  | "node-mismatch"
  | "device-key-mismatch"
  | "connection-identity-mismatch"
  | "binding-rejected"
  | "operation-mismatch"
  | "authorization-unknown"
  | "authorization-revoked"
  | "authorization-expired"
  | "authorization-binding-mismatch"
  | "authorization-target-mismatch"
  | "operation-not-authorized"
  | "budget-exhausted"
  | "nonce-already-consumed";

export type RedemptionResult =
  | {
      ok: true;
      claims: InvocationCapabilityClaims;
      digest: string;
      redemptionKey: string;
      /** Spend after this reservation, for audit. */
      spend: { calls: number; entriesRead: number; totalExpandedBytes: number };
    }
  | {
      ok: false;
      reason: RedemptionFailureReason;
      /** Verification detail, for audit only. Never surfaced to the model. */
      detail?: string;
    };

export type RedemptionDeps = {
  keyResolver: CapabilityKeyResolver;
  turnAuthorizations: TurnAuthorizationStore;
  bindings: LocalDeviceBindingStore;
  nonces: NonceLedger;
  clockSkewMs?: number;
};

/**
 * Step 1 only: verify the capability and everything it must agree with, without
 * touching any mutable state. Split out so the ordering guarantee is testable.
 */
export function verifyRedemption(
  request: RedemptionRequest,
  deps: RedemptionDeps,
  nowMs: number,
):
  | { ok: true; claims: InvocationCapabilityClaims; digest: string }
  | { ok: false; reason: RedemptionFailureReason; detail?: string } {
  const skew = deps.clockSkewMs ?? CAPABILITY_CLOCK_SKEW_MS;

  // A redemption can only arrive on an authenticated node connection.
  if (!request.connection.authenticated) {
    return { ok: false, reason: "connection-not-authenticated" };
  }

  // Full signature + keyId, canonical form, kind and validity window.
  const verified = verifyCapability<InvocationCapabilityClaims>(request.capability, {
    keyset: deps.keyResolver,
    nowMs,
    expectedKind: "invocation",
    clockSkewMs: skew,
  });
  if (!verified.ok) {
    return { ok: false, reason: "capability-invalid", detail: verified.reason };
  }
  const claims = verified.claims;

  // nodeId, and the device public key of the currently authenticated connection.
  if (claims.binding.nodeId !== request.connection.nodeId) {
    return { ok: false, reason: "node-mismatch" };
  }
  if (claims.binding.devicePublicKey !== request.connection.devicePublicKey) {
    return { ok: false, reason: "device-key-mismatch" };
  }

  // Tenant, user, agent, and the device binding itself.
  const bindingCheck = deps.bindings.authorizeBinding(claims.binding);
  if (!bindingCheck.ok) {
    return { ok: false, reason: "binding-rejected", detail: bindingCheck.reason };
  }

  // Connection identity, re-checked on every invocation redemption.
  //
  // Resolve tickets stop after the binding check above. An invocation is the
  // call that actually lists or reads, so it also checks the live session:
  // an exclusive read-only node must still match the five commands exactly,
  // and a paired computer (empty session profile, file commands plus
  // `system.run`) must still declare every file command. A drifted exclusive
  // node, or a computer missing a file command, is refused here rather than
  // trusted until restart.
  const identity = verifyConnectionIdentity({
    bindingProfile: bindingCheck.binding.capabilityProfile,
    bindingDevicePublicKey: bindingCheck.binding.devicePublicKey,
    nodeConfiguredProfile: request.connection.capabilityProfile ?? "",
    connectionDevicePublicKey: request.connection.devicePublicKey,
    declaredCommands: request.connection.declaredCommands,
  });
  if (!identity.ok) {
    return {
      ok: false,
      reason: "connection-identity-mismatch",
      detail: identity.detail ? `${identity.reason}:${identity.detail}` : identity.reason,
    };
  }

  // Declared operation must match the capability's own single operation.
  if (claims.operation !== request.operation) {
    return { ok: false, reason: "operation-mismatch" };
  }

  // The capability must really derive from a still-valid Turn authorization.
  const authorization = deps.turnAuthorizations.get(claims.authorizationId);
  if (!authorization) {
    return { ok: false, reason: "authorization-unknown" };
  }
  if (authorization.status === "revoked") {
    return { ok: false, reason: "authorization-revoked" };
  }
  if (nowMs > authorization.claims.expiresAtMs + skew) {
    return { ok: false, reason: "authorization-expired" };
  }
  // Session, turn and the rest of the binding must match the parent, not just
  // be internally consistent within the derived capability.
  if (!bindingsEqual(authorization.claims.binding, claims.binding)) {
    return { ok: false, reason: "authorization-binding-mismatch" };
  }
  if (
    authorization.claims.canonicalPath !== claims.canonicalPath ||
    authorization.claims.fileId.dev !== claims.fileId.dev ||
    authorization.claims.fileId.ino !== claims.fileId.ino ||
    authorization.claims.targetKind !== claims.targetKind ||
    authorization.claims.scope !== claims.scope
  ) {
    return { ok: false, reason: "authorization-target-mismatch" };
  }
  if (!authorization.claims.operations.includes(claims.operation)) {
    return { ok: false, reason: "operation-not-authorized" };
  }

  // Nonce must be unused. Checked here as part of verification; the write
  // happens in step 3 so that a later verification failure cannot consume it.
  const redemptionKey = buildRedemptionKey({
    kind: "invocation",
    capabilityDigest: verified.digest,
    nonce: claims.nonce,
    nodeId: claims.binding.nodeId,
  });
  if (deps.nonces.isConsumed(redemptionKey, nowMs)) {
    return { ok: false, reason: "nonce-already-consumed" };
  }

  return { ok: true, claims, digest: verified.digest };
}

/**
 * The full four-step redemption transaction.
 *
 * Synchronous on purpose. Do not introduce an `await` between verification and
 * the two writes, or concurrent redemptions of the same capability could both
 * succeed.
 */
export function redeemInvocationCapability(
  request: RedemptionRequest,
  deps: RedemptionDeps,
  nowMs: number = Date.now(),
): RedemptionResult {
  const skew = deps.clockSkewMs ?? CAPABILITY_CLOCK_SKEW_MS;

  // ---- Step 1: verify. No writes may happen before this returns ok. ----
  const verified = verifyRedemption(request, deps, nowMs);
  if (!verified.ok) {
    return verified;
  }
  const { claims, digest } = verified;

  // ---- Step 2: check and decrement the Turn authorization budget. ----
  const reservation = deps.turnAuthorizations.reserve({
    authorizationId: claims.authorizationId,
    operation: claims.operation,
    nowMs,
    clockSkewMs: skew,
  });
  if (!reservation.ok) {
    // Roll back by doing nothing: no budget was taken, and the nonce is
    // deliberately still unconsumed.
    const reason: RedemptionFailureReason =
      reservation.reason === "authorization-unknown" ||
      reservation.reason === "authorization-revoked" ||
      reservation.reason === "authorization-expired" ||
      reservation.reason === "operation-not-authorized"
        ? reservation.reason
        : "budget-exhausted";
    return { ok: false, reason, detail: reservation.reason };
  }

  // ---- Step 3: mark the nonce consumed. ----
  const redemptionKey = buildRedemptionKey({
    kind: "invocation",
    capabilityDigest: digest,
    nonce: claims.nonce,
    nodeId: claims.binding.nodeId,
  });
  const consumed = deps.nonces.consume(redemptionKey, claims.expiresAtMs, nowMs);
  if (!consumed) {
    // Only reachable if something outside this synchronous path consumed it.
    // Treat as a lost race and refuse rather than serve a second read.
    return { ok: false, reason: "nonce-already-consumed" };
  }

  // ---- Step 4: one-shot success. ----
  return {
    ok: true,
    claims,
    digest,
    redemptionKey,
    spend: reservation.spend,
  };
}

export type ResolveTicketRedemptionResult =
  | { ok: true; claims: ResolveTicketClaims; digest: string; redemptionKey: string }
  | { ok: false; reason: RedemptionFailureReason; detail?: string };

/**
 * Redeem a resolve ticket.
 *
 * A resolve ticket goes through the same online redemption as an Invocation
 * capability, and for the same reason: node-local nonce state is lost on restart, so
 * a restarted node could otherwise replay a ticket and re-probe a path
 * (design 9.1, 9.3).
 *
 * Two deliberate differences from an invocation redemption: there is no parent Turn
 * authorization to check (a ticket precedes authorization), and there is no budget
 * to decrement (a ticket grants no read). The nonce space is separate because the
 * redemption key includes the capability kind, so burning a ticket's nonce can
 * never satisfy a read.
 *
 * Synchronous, like its sibling, so the check and the write cannot interleave.
 */
export function redeemResolveTicket(
  request: { capability: SignedCapability; connection: RedeemingConnection },
  deps: RedemptionDeps,
  nowMs: number = Date.now(),
): ResolveTicketRedemptionResult {
  const skew = deps.clockSkewMs ?? CAPABILITY_CLOCK_SKEW_MS;

  if (!request.connection.authenticated) {
    return { ok: false, reason: "connection-not-authenticated" };
  }

  const verified = verifyCapability<ResolveTicketClaims>(request.capability, {
    keyset: deps.keyResolver,
    nowMs,
    expectedKind: "resolve-ticket",
    clockSkewMs: skew,
  });
  if (!verified.ok) {
    return { ok: false, reason: "capability-invalid", detail: verified.reason };
  }
  const claims = verified.claims;

  if (claims.binding.nodeId !== request.connection.nodeId) {
    return { ok: false, reason: "node-mismatch" };
  }
  if (claims.binding.devicePublicKey !== request.connection.devicePublicKey) {
    return { ok: false, reason: "device-key-mismatch" };
  }
  const bindingCheck = deps.bindings.authorizeBinding(claims.binding);
  if (!bindingCheck.ok) {
    return { ok: false, reason: "binding-rejected", detail: bindingCheck.reason };
  }

  const redemptionKey = buildRedemptionKey({
    kind: "resolve-ticket",
    capabilityDigest: verified.digest,
    nonce: claims.nonce,
    nodeId: claims.binding.nodeId,
  });
  if (!deps.nonces.consume(redemptionKey, claims.expiresAtMs, nowMs)) {
    return { ok: false, reason: "nonce-already-consumed" };
  }

  return { ok: true, claims, digest: verified.digest, redemptionKey };
}

/** Peek at the capability kind without trusting it; verification still enforces it. */
function peekCapabilityKind(claimsJSON: string): string | null {
  try {
    const parsed = JSON.parse(claimsJSON) as { kind?: unknown };
    return typeof parsed?.kind === "string" ? parsed.kind : null;
  } catch {
    return null;
  }
}

/**
 * Redeem whichever capability kind was submitted.
 *
 * The kind is read from the unverified claims only to pick a branch; the branch then
 * verifies with an explicit `expectedKind`, so a mislabelled capability fails rather
 * than taking the wrong path.
 */
export function redeemCapability(
  request: RedemptionRequest,
  deps: RedemptionDeps,
  nowMs: number = Date.now(),
): RedemptionResult | ResolveTicketRedemptionResult {
  const kind = peekCapabilityKind(request.capability.claimsJSON);
  if (kind === "resolve-ticket") {
    return redeemResolveTicket(
      { capability: request.capability, connection: request.connection },
      deps,
      nowMs,
    );
  }
  return redeemInvocationCapability(request, deps, nowMs);
}

/** Digest helper re-exported so callers do not need to reach into capability.ts. */
export { capabilityDigest };
