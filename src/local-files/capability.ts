/**
 * Capability token signing, digesting and verification.
 *
 * All three token kinds (resolve ticket, Turn authorization, Invocation
 * capability) share this one scheme (design 9.3). Their nonce spaces are kept
 * separate by including the kind in the redemption key, so a resolve ticket's
 * nonce can never be redeemed for a read.
 */

import crypto from "node:crypto";
import { signDevicePayload, verifyDeviceSignature } from "../infra/device-identity.js";
import { canonicalJsonStringify } from "./canonical-json.js";
import type { CapabilitySigningKey } from "./keyset.js";
import {
  CAPABILITY_CLOCK_SKEW_MS,
  type CapabilityBinding,
  type CapabilityClaims,
  type CapabilityKind,
  type FileIdentity,
  type InvocationCapabilityClaims,
  isLocalFilesOperation,
  type ResolveTicketClaims,
  type SignedCapability,
  type TurnAuthorizationClaims,
  type TurnBudget,
} from "./types.js";

export function newNonce(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString("base64url")}`;
}

/**
 * Digest over the exact signed claim bytes.
 *
 * This is one component of the redemption key, which is why the gateway can
 * detect a tampered capability even when the nonce is replayed verbatim
 * (design 9.3).
 */
export function capabilityDigest(claimsJSON: string): string {
  return crypto.createHash("sha256").update(claimsJSON, "utf8").digest("hex");
}

export function signCapability(
  claims: CapabilityClaims,
  key: CapabilitySigningKey,
): SignedCapability {
  const claimsJSON = canonicalJsonStringify(claims);
  return {
    alg: "Ed25519",
    keyId: key.keyId,
    claimsJSON,
    signature: signDevicePayload(key.privateKeyPem, claimsJSON),
  };
}

/** Why a `keyId` could not be resolved. All three are fail-closed outcomes. */
export type CapabilityKeyLookupFailure = "no-keyset" | "keyset-expired" | "unknown-key-id";

/**
 * Minimal structural view of a keyset, used by both the node and the gateway.
 *
 * Takes only a `keyId`: there is no parameter through which a caller could supply
 * a public key, which is what makes "never resolve an unknown keyId from call
 * parameters" a property of the type rather than a convention (design 9.3).
 */
export type CapabilityKeyLookup = {
  resolveVerificationKey(
    keyId: string,
    nowMs: number,
  ): { ok: true; publicKey: string } | { ok: false; reason: CapabilityKeyLookupFailure };
};

export type CapabilityVerifyFailure =
  | CapabilityKeyLookupFailure
  | "bad-alg"
  | "bad-signature"
  | "malformed-claims"
  | "not-canonical"
  | "kind-mismatch"
  | "expired"
  | "not-yet-valid";

export type CapabilityVerifyResult<C extends CapabilityClaims> =
  | { ok: true; claims: C; digest: string }
  | { ok: false; reason: CapabilityVerifyFailure };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseBinding(value: unknown): CapabilityBinding | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const r = value as Record<string, unknown>;
  const fields = [
    "tenantId",
    "userId",
    "agentId",
    "sessionKey",
    "turnId",
    "nodeId",
    "devicePublicKey",
  ] as const;
  for (const field of fields) {
    if (!isNonEmptyString(r[field])) {
      return null;
    }
  }
  return {
    tenantId: r.tenantId as string,
    userId: r.userId as string,
    agentId: r.agentId as string,
    sessionKey: r.sessionKey as string,
    turnId: r.turnId as string,
    nodeId: r.nodeId as string,
    devicePublicKey: r.devicePublicKey as string,
  };
}

function parseFileIdentity(value: unknown): FileIdentity | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const r = value as Record<string, unknown>;
  if (!isNonEmptyString(r.dev) || !isNonEmptyString(r.ino)) {
    return null;
  }
  return { dev: r.dev, ino: r.ino };
}

function parseBudget(value: unknown): TurnBudget | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const r = value as Record<string, unknown>;
  const fields = ["maxEntriesRead", "maxTotalExpandedBytes", "maxCalls"] as const;
  for (const field of fields) {
    const raw = r[field];
    if (!isFiniteNumber(raw) || raw < 0 || !Number.isInteger(raw)) {
      return null;
    }
  }
  return {
    maxEntriesRead: r.maxEntriesRead as number,
    maxTotalExpandedBytes: r.maxTotalExpandedBytes as number,
    maxCalls: r.maxCalls as number,
  };
}

function parseClaims(raw: unknown): CapabilityClaims | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (!isFiniteNumber(r.issuedAtMs) || !isFiniteNumber(r.expiresAtMs)) {
    return null;
  }
  const binding = parseBinding(r.binding);
  if (!binding) {
    return null;
  }

  if (r.kind === "resolve-ticket") {
    if (
      !isNonEmptyString(r.ticketId) ||
      !isNonEmptyString(r.rawPath) ||
      !isNonEmptyString(r.nonce) ||
      !isLocalFilesOperation(r.intendedOperation)
    ) {
      return null;
    }
    const claims: ResolveTicketClaims = {
      kind: "resolve-ticket",
      ticketId: r.ticketId,
      binding,
      rawPath: r.rawPath,
      intendedOperation: r.intendedOperation,
      nonce: r.nonce,
      issuedAtMs: r.issuedAtMs,
      expiresAtMs: r.expiresAtMs,
    };
    return claims;
  }

  if (r.kind === "turn-authorization") {
    const fileId = parseFileIdentity(r.fileId);
    const budget = parseBudget(r.budget);
    if (
      !isNonEmptyString(r.authorizationId) ||
      !isNonEmptyString(r.canonicalPath) ||
      !fileId ||
      !budget ||
      (r.targetKind !== "file" && r.targetKind !== "directory") ||
      r.scope !== "exact" ||
      !Array.isArray(r.operations) ||
      r.operations.length === 0 ||
      !r.operations.every(isLocalFilesOperation) ||
      (r.grantSource !== "user-directed" && r.grantSource !== "user-approved-once")
    ) {
      return null;
    }
    const claims: TurnAuthorizationClaims = {
      kind: "turn-authorization",
      authorizationId: r.authorizationId,
      binding,
      canonicalPath: r.canonicalPath,
      fileId,
      targetKind: r.targetKind,
      scope: "exact",
      operations: [...r.operations],
      budget,
      grantSource: r.grantSource,
      issuedAtMs: r.issuedAtMs,
      expiresAtMs: r.expiresAtMs,
    };
    return claims;
  }

  if (r.kind === "invocation") {
    const fileId = parseFileIdentity(r.fileId);
    if (
      !isNonEmptyString(r.capabilityId) ||
      !isNonEmptyString(r.authorizationId) ||
      !isNonEmptyString(r.canonicalPath) ||
      !isNonEmptyString(r.nonce) ||
      !fileId ||
      (r.targetKind !== "file" && r.targetKind !== "directory") ||
      r.scope !== "exact" ||
      !isLocalFilesOperation(r.operation) ||
      r.useCount !== 1
    ) {
      return null;
    }
    if (r.archiveEntryPath !== undefined && !isNonEmptyString(r.archiveEntryPath)) {
      return null;
    }
    const claims: InvocationCapabilityClaims = {
      kind: "invocation",
      capabilityId: r.capabilityId,
      authorizationId: r.authorizationId,
      binding,
      canonicalPath: r.canonicalPath,
      fileId,
      targetKind: r.targetKind,
      scope: "exact",
      operation: r.operation,
      useCount: 1,
      nonce: r.nonce,
      issuedAtMs: r.issuedAtMs,
      expiresAtMs: r.expiresAtMs,
    };
    if (r.archiveEntryPath !== undefined) {
      claims.archiveEntryPath = r.archiveEntryPath;
    }
    return claims;
  }

  return null;
}

/**
 * Verify a signed capability.
 *
 * Order matters: the key must resolve from the pinned keyset before the
 * signature is checked, and the signature must check out before any claim is
 * trusted. A caller-supplied public key is never consulted.
 */
export function verifyCapability<C extends CapabilityClaims>(
  signed: SignedCapability,
  params: {
    keyset: CapabilityKeyLookup;
    nowMs: number;
    expectedKind: CapabilityKind;
    clockSkewMs?: number;
  },
): CapabilityVerifyResult<C> {
  if (signed.alg !== "Ed25519") {
    return { ok: false, reason: "bad-alg" };
  }
  const resolved = params.keyset.resolveVerificationKey(signed.keyId, params.nowMs);
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }
  if (!verifyDeviceSignature(resolved.publicKey, signed.claimsJSON, signed.signature)) {
    return { ok: false, reason: "bad-signature" };
  }

  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(signed.claimsJSON);
  } catch {
    return { ok: false, reason: "malformed-claims" };
  }
  const claims = parseClaims(parsedRaw);
  if (!claims) {
    return { ok: false, reason: "malformed-claims" };
  }
  // Signed bytes must already be canonical, so the digest used as a redemption
  // key component cannot be made ambiguous by reordering or padding.
  if (canonicalJsonStringify(claims) !== signed.claimsJSON) {
    return { ok: false, reason: "not-canonical" };
  }
  if (claims.kind !== params.expectedKind) {
    return { ok: false, reason: "kind-mismatch" };
  }

  const skew = params.clockSkewMs ?? CAPABILITY_CLOCK_SKEW_MS;
  if (params.nowMs > claims.expiresAtMs + skew) {
    return { ok: false, reason: "expired" };
  }
  if (params.nowMs + skew < claims.issuedAtMs) {
    return { ok: false, reason: "not-yet-valid" };
  }

  return { ok: true, claims: claims as C, digest: capabilityDigest(signed.claimsJSON) };
}

/** Compare two bindings for exact equality across every bound field. */
export function bindingsEqual(left: CapabilityBinding, right: CapabilityBinding): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.userId === right.userId &&
    left.agentId === right.agentId &&
    left.sessionKey === right.sessionKey &&
    left.turnId === right.turnId &&
    left.nodeId === right.nodeId &&
    left.devicePublicKey === right.devicePublicKey
  );
}

export function fileIdentitiesEqual(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}
