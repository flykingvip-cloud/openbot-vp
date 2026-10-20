/**
 * P4-c platform key-service. Issues platform_tenant wrap refs bound to auth.tenantId.
 * Envelope/client/projection MUST NOT supply a trusted encryptionKeyRef.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  isGovernanceAuthenticatedCall,
  type GovernanceAuthenticatedCall,
} from "./cognitive-recommendation-auth.js";

export const PROMOTION_KEY_HMAC_KEY_ENV = "OPENBOT_PROMOTION_KEY_HMAC_KEY";

export type PlatformTenantKeyRef = {
  kind: "platform_tenant";
  keyRefId: string;
  tenantId: string;
};

export type DedicatedTenantKeyRef = {
  kind: "dedicated_tenant";
  keyRefId: string;
  tenantId: string;
};

export type ByosCustomerKeyRef = {
  kind: "byos_customer";
  keyRefId: string;
  tenantId: string;
};

export type ArchiveTenantKeyRef = {
  kind: "archive_tenant";
  keyRefId: string;
  tenantId: string;
};

export type PromotionKeyRef =
  | PlatformTenantKeyRef
  | DedicatedTenantKeyRef
  | ByosCustomerKeyRef
  | ArchiveTenantKeyRef;

export type SignedPlatformTenantKeyReceipt = {
  payload: {
    kind: "platform_tenant_key_receipt";
    keyRefId: string;
    tenantId: string;
    wrapKeyId: string;
    issuer: "platform";
    issuedAt: string;
  };
  signature: string;
};

const verifiedKeyRefs = new WeakSet<object>();

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function hmacKey(): Buffer | null {
  const raw = process.env[PROMOTION_KEY_HMAC_KEY_ENV];
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  return Buffer.from(raw, "utf8");
}

function signPayload(payload: SignedPlatformTenantKeyReceipt["payload"], secret: Buffer): string {
  return createHmac("sha256", secret).update(canonicalJson(payload)).digest("base64url");
}

export function isPlatformTenantKeyRef(value: unknown): value is PlatformTenantKeyRef {
  return Boolean(value && typeof value === "object" && verifiedKeyRefs.has(value));
}

export function wrapKeyIdForTenant(tenantId: string): string {
  return `wrap:platform_tenant:${tenantId}`;
}

export function wrapKeyIdForDedicatedTenant(tenantId: string): string {
  return `wrap:dedicated_tenant:${tenantId}`;
}

export function wrapKeyIdForByosCustomer(tenantId: string): string {
  return `wrap:byos_customer:${tenantId}`;
}

export function wrapKeyIdForArchiveTenant(tenantId: string): string {
  return `wrap:archive_tenant:${tenantId}`;
}

/**
 * Verify a platform-signed tenant key receipt and bind an opaque keyRef.
 * Missing key, bad signature, tenant mismatch, or unauthenticated call fail closed.
 */
export function verifyPlatformTenantKeyReceipt(params: {
  signedReceipt: SignedPlatformTenantKeyReceipt;
  call: GovernanceAuthenticatedCall;
}): { ok: true; keyRef: PlatformTenantKeyRef } | { ok: false; reasonCode: "key_ref_required" } {
  if (!isGovernanceAuthenticatedCall(params.call)) {
    return { ok: false, reasonCode: "key_ref_required" };
  }
  const secret = hmacKey();
  if (!secret) {
    return { ok: false, reasonCode: "key_ref_required" };
  }
  const payload = params.signedReceipt.payload;
  if (
    !payload ||
    payload.kind !== "platform_tenant_key_receipt" ||
    payload.issuer !== "platform" ||
    typeof payload.keyRefId !== "string" ||
    payload.keyRefId.trim() === "" ||
    typeof payload.tenantId !== "string" ||
    payload.tenantId.trim() === "" ||
    typeof payload.wrapKeyId !== "string" ||
    payload.wrapKeyId !== wrapKeyIdForTenant(payload.tenantId)
  ) {
    return { ok: false, reasonCode: "key_ref_required" };
  }
  if (payload.tenantId !== params.call.callerTenantId) {
    return { ok: false, reasonCode: "key_ref_required" };
  }
  const expected = Buffer.from(signPayload(payload, secret), "utf8");
  const actual = Buffer.from(params.signedReceipt.signature ?? "", "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reasonCode: "key_ref_required" };
  }
  const keyRef: PlatformTenantKeyRef = Object.freeze({
    kind: "platform_tenant",
    keyRefId: payload.keyRefId,
    tenantId: payload.tenantId,
  });
  verifiedKeyRefs.add(keyRef);
  return { ok: true, keyRef };
}

/**
 * Resolve the platform_tenant keyRef for this authenticated tenant.
 * First wave only; dedicated / customer / BYOS keys stay fail closed elsewhere.
 */
export function resolvePlatformTenantKeyRef(params: {
  call: GovernanceAuthenticatedCall;
  tenantId: string;
}): { ok: true; keyRef: PlatformTenantKeyRef } | { ok: false; reasonCode: "key_ref_required" } {
  if (
    !isGovernanceAuthenticatedCall(params.call) ||
    params.call.callerTenantId !== params.tenantId
  ) {
    return { ok: false, reasonCode: "key_ref_required" };
  }
  const secret = hmacKey();
  if (!secret) {
    return { ok: false, reasonCode: "key_ref_required" };
  }
  const payload: SignedPlatformTenantKeyReceipt["payload"] = {
    kind: "platform_tenant_key_receipt",
    keyRefId: `keyref:${params.tenantId}`,
    tenantId: params.tenantId,
    wrapKeyId: wrapKeyIdForTenant(params.tenantId),
    issuer: "platform",
    issuedAt: "2026-08-16T00:00:00.000Z",
  };
  return verifyPlatformTenantKeyReceipt({
    signedReceipt: { payload, signature: signPayload(payload, secret) },
    call: params.call,
  });
}

export function resolveDedicatedTenantKeyRef(params: {
  call: GovernanceAuthenticatedCall;
  tenantId: string;
}): { ok: true; keyRef: DedicatedTenantKeyRef } | { ok: false; reasonCode: "key_ref_required" } {
  if (
    !isGovernanceAuthenticatedCall(params.call) ||
    params.call.callerTenantId !== params.tenantId
  ) {
    return { ok: false, reasonCode: "key_ref_required" };
  }
  const secret = hmacKey();
  if (!secret) {
    return { ok: false, reasonCode: "key_ref_required" };
  }
  const keyRef: DedicatedTenantKeyRef = Object.freeze({
    kind: "dedicated_tenant",
    keyRefId: `dedicated-keyref:${params.tenantId}`,
    tenantId: params.tenantId,
  });
  verifiedKeyRefs.add(keyRef);
  return { ok: true, keyRef };
}

export function resolveByosCustomerKeyRef(params: {
  call: GovernanceAuthenticatedCall;
  tenantId: string;
}): { ok: true; keyRef: ByosCustomerKeyRef } | { ok: false; reasonCode: "key_ref_required" } {
  if (
    !isGovernanceAuthenticatedCall(params.call) ||
    params.call.callerTenantId !== params.tenantId
  ) {
    return { ok: false, reasonCode: "key_ref_required" };
  }
  const secret = hmacKey();
  if (!secret) {
    return { ok: false, reasonCode: "key_ref_required" };
  }
  const keyRef: ByosCustomerKeyRef = Object.freeze({
    kind: "byos_customer",
    keyRefId: `byos-keyref:${params.tenantId}`,
    tenantId: params.tenantId,
  });
  verifiedKeyRefs.add(keyRef);
  return { ok: true, keyRef };
}

export function resolveArchiveTenantKeyRef(params: {
  call: GovernanceAuthenticatedCall;
  tenantId: string;
}): { ok: true; keyRef: ArchiveTenantKeyRef } | { ok: false; reasonCode: "key_ref_required" } {
  if (
    !isGovernanceAuthenticatedCall(params.call) ||
    params.call.callerTenantId !== params.tenantId
  ) {
    return { ok: false, reasonCode: "key_ref_required" };
  }
  const secret = hmacKey();
  if (!secret) {
    return { ok: false, reasonCode: "key_ref_required" };
  }
  const keyRef: ArchiveTenantKeyRef = Object.freeze({
    kind: "archive_tenant",
    keyRefId: `archive-keyref:${params.tenantId}`,
    tenantId: params.tenantId,
  });
  verifiedKeyRefs.add(keyRef);
  return { ok: true, keyRef };
}

export function assertKeyRefTenant(params: {
  keyRef: { kind: string; keyRefId: string; tenantId: string };
  tenantId: string;
}): { ok: true } | { ok: false; reasonCode: "key_tenant_mismatch" | "dedicated_key_unsupported" } {
  if (
    params.keyRef.kind !== "platform_tenant" &&
    params.keyRef.kind !== "dedicated_tenant" &&
    params.keyRef.kind !== "byos_customer" &&
    params.keyRef.kind !== "archive_tenant"
  ) {
    return { ok: false, reasonCode: "dedicated_key_unsupported" };
  }
  if (params.keyRef.tenantId !== params.tenantId) {
    return { ok: false, reasonCode: "key_tenant_mismatch" };
  }
  return { ok: true };
}
