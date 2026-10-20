/**
 * Production placement authority. Verifies signed receipts, Catalog scopes,
 * and consent-store records, then binds opaque proofs. Does not accept raw mint.
 * Catalog and consent store come from the composition root, not the caller.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  isGovernanceAuthenticatedCall,
  type GovernanceAuthenticatedCall,
} from "./cognitive-recommendation-auth.js";
import { getPlacementAuthorityBindings } from "./placement-platform-root.js";

export const PLACEMENT_REGION_HMAC_KEY_ENV = "OPENBOT_PLACEMENT_REGION_HMAC_KEY";

export type PlatformDeploymentRegionReceipt = {
  readonly kind: "platform_deployment_region_receipt";
  readonly receiptId: string;
  readonly tenantId: string;
  readonly region: string;
  readonly issuer: "platform";
  readonly verifiedAt: string;
};

export type ResourceConsentScope = {
  readonly tenantId: string;
  readonly resourceId: string;
  readonly dataSubjectIds: readonly string[];
  readonly catalogEpoch: string;
  readonly verifiedAt: string;
};

export type SubjectConsentProof = {
  readonly tenantId: string;
  readonly resourceId: string;
  readonly purpose: "eligible_cloud_projection";
  readonly consentVersion: string;
  readonly subjectIds: readonly string[];
  readonly expiresAt: string;
  readonly revoked: boolean;
  readonly consentEpoch: string;
  readonly verifiedAt: string;
};

export type SignedPlatformDeploymentRegionReceipt = {
  payload: {
    kind: "platform_deployment_region_receipt";
    receiptId: string;
    tenantId: string;
    region: string;
    issuer: "platform";
    issuedAt: string;
  };
  signature: string;
};

export type PlacementCatalogScopeLoader = {
  loadResourceConsentScope(query: { tenantId: string; resourceId: string }): {
    tenantId: string;
    resourceId: string;
    dataSubjectIds: readonly string[];
    catalogEpoch: string;
  } | null;
};

export type PlacementConsentStore = {
  loadConsent(query: { tenantId: string; resourceId: string; consentVersion: string }): {
    tenantId: string;
    resourceId: string;
    consentVersion: string;
    subjectIds: readonly string[];
    purpose: "eligible_cloud_projection";
    expiresAt: string;
    revoked: boolean;
    consentEpoch: string;
  } | null;
};

const verifiedReceipts = new WeakSet<object>();
const verifiedScopes = new WeakSet<object>();
const verifiedProofs = new WeakSet<object>();

export function placementTrustedNowMs(): number {
  return Date.now();
}

function trustedNowIso(): string {
  return new Date(placementTrustedNowMs()).toISOString();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function placementAuthTenantId(call: unknown): string | null {
  if (!isGovernanceAuthenticatedCall(call)) {
    return null;
  }
  const tenantId = call.callerTenantId?.trim() ?? "";
  return tenantId === "" ? null : tenantId;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function platformRegionTrustSecret(): string | null {
  const secret = process.env[PLACEMENT_REGION_HMAC_KEY_ENV];
  return isNonEmptyString(secret) ? secret : null;
}

function hmacDigest(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function signaturesMatch(expected: string, actual: unknown): boolean {
  if (typeof actual !== "string" || actual === "") {
    return false;
  }
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isPlatformDeploymentRegionReceipt(
  value: unknown,
): value is PlatformDeploymentRegionReceipt {
  if (typeof value !== "object" || value === null || !verifiedReceipts.has(value)) {
    return false;
  }
  const receipt = value as PlatformDeploymentRegionReceipt;
  return (
    receipt.kind === "platform_deployment_region_receipt" &&
    receipt.issuer === "platform" &&
    isNonEmptyString(receipt.receiptId) &&
    isNonEmptyString(receipt.tenantId) &&
    isNonEmptyString(receipt.region) &&
    isNonEmptyString(receipt.verifiedAt)
  );
}

export function isResourceConsentScope(value: unknown): value is ResourceConsentScope {
  if (typeof value !== "object" || value === null || !verifiedScopes.has(value)) {
    return false;
  }
  const scope = value as ResourceConsentScope;
  return (
    isNonEmptyString(scope.tenantId) &&
    isNonEmptyString(scope.resourceId) &&
    isNonEmptyString(scope.catalogEpoch) &&
    isNonEmptyString(scope.verifiedAt) &&
    Array.isArray(scope.dataSubjectIds) &&
    scope.dataSubjectIds.every((id) => isNonEmptyString(id))
  );
}

export function isSubjectConsentProof(value: unknown): value is SubjectConsentProof {
  if (typeof value !== "object" || value === null || !verifiedProofs.has(value)) {
    return false;
  }
  const proof = value as SubjectConsentProof;
  const expiresAt = Date.parse(proof.expiresAt);
  return (
    isNonEmptyString(proof.tenantId) &&
    isNonEmptyString(proof.resourceId) &&
    proof.purpose === "eligible_cloud_projection" &&
    isNonEmptyString(proof.consentVersion) &&
    isNonEmptyString(proof.consentEpoch) &&
    isNonEmptyString(proof.verifiedAt) &&
    Array.isArray(proof.subjectIds) &&
    proof.subjectIds.every((id) => isNonEmptyString(id)) &&
    Number.isFinite(expiresAt) &&
    expiresAt > placementTrustedNowMs() &&
    !proof.revoked
  );
}

export function verifyPlatformDeploymentRegionReceipt(params: {
  signedReceipt: unknown;
  call: GovernanceAuthenticatedCall;
}):
  | { ok: true; receipt: PlatformDeploymentRegionReceipt }
  | { ok: false; reasonCode: "missing_trusted_region" } {
  const secret = platformRegionTrustSecret();
  const signed = params.signedReceipt as SignedPlatformDeploymentRegionReceipt;
  const authTenantId = placementAuthTenantId(params.call);
  const payload = signed?.payload;
  if (
    !secret ||
    !hasOnlyKeys(params, ["signedReceipt", "call"]) ||
    !authTenantId ||
    !payload ||
    payload.kind !== "platform_deployment_region_receipt" ||
    payload.issuer !== "platform" ||
    !isNonEmptyString(payload.receiptId) ||
    !isNonEmptyString(payload.tenantId) ||
    !isNonEmptyString(payload.region) ||
    !isNonEmptyString(payload.issuedAt) ||
    payload.tenantId !== authTenantId
  ) {
    return { ok: false, reasonCode: "missing_trusted_region" };
  }
  const expected = hmacDigest(secret, canonicalJson(payload));
  if (!signaturesMatch(expected, signed.signature)) {
    return { ok: false, reasonCode: "missing_trusted_region" };
  }
  const receipt = Object.freeze({
    kind: "platform_deployment_region_receipt" as const,
    receiptId: payload.receiptId.trim(),
    tenantId: payload.tenantId.trim(),
    region: payload.region.trim(),
    issuer: "platform" as const,
    verifiedAt: trustedNowIso(),
  });
  verifiedReceipts.add(receipt);
  return { ok: true, receipt };
}

export function verifyResourceConsentScope(params: {
  call: GovernanceAuthenticatedCall;
  resourceId: string;
}): { ok: true; scope: ResourceConsentScope } | { ok: false; reasonCode: "consent_required" } {
  const tenantId = placementAuthTenantId(params.call);
  const resourceId = params.resourceId.trim();
  const catalog = getPlacementAuthorityBindings()?.catalog ?? null;
  if (
    !tenantId ||
    !catalog ||
    !hasOnlyKeys(params, ["call", "resourceId"]) ||
    !isNonEmptyString(resourceId)
  ) {
    return { ok: false, reasonCode: "consent_required" };
  }
  const record = catalog.loadResourceConsentScope({ tenantId, resourceId });
  if (
    !record ||
    record.tenantId !== tenantId ||
    record.resourceId !== resourceId ||
    !isNonEmptyString(record.catalogEpoch) ||
    !Array.isArray(record.dataSubjectIds) ||
    record.dataSubjectIds.length === 0 ||
    record.dataSubjectIds.some((id) => !isNonEmptyString(id))
  ) {
    return { ok: false, reasonCode: "consent_required" };
  }
  const scope = Object.freeze({
    tenantId,
    resourceId,
    dataSubjectIds: Object.freeze([...record.dataSubjectIds]),
    catalogEpoch: record.catalogEpoch.trim(),
    verifiedAt: trustedNowIso(),
  });
  verifiedScopes.add(scope);
  return { ok: true, scope };
}

export function verifySubjectConsent(params: {
  call: GovernanceAuthenticatedCall;
  resourceId: string;
  consentVersion: string;
  scope: ResourceConsentScope;
}): { ok: true; proof: SubjectConsentProof } | { ok: false; reasonCode: "consent_required" } {
  const tenantId = placementAuthTenantId(params.call);
  const resourceId = params.resourceId.trim();
  const consentVersion = params.consentVersion.trim();
  const store = getPlacementAuthorityBindings()?.store ?? null;
  if (
    !tenantId ||
    !store ||
    !hasOnlyKeys(params, ["call", "resourceId", "consentVersion", "scope"]) ||
    !isResourceConsentScope(params.scope) ||
    params.scope.tenantId !== tenantId ||
    params.scope.resourceId !== resourceId ||
    params.scope.dataSubjectIds.length === 0
  ) {
    return { ok: false, reasonCode: "consent_required" };
  }
  const record = store.loadConsent({ tenantId, resourceId, consentVersion });
  const expiresAt = Date.parse(record?.expiresAt ?? "");
  if (
    !record ||
    record.tenantId !== tenantId ||
    record.resourceId !== resourceId ||
    record.consentVersion !== consentVersion ||
    record.purpose !== "eligible_cloud_projection" ||
    record.revoked ||
    !isNonEmptyString(record.consentEpoch) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= placementTrustedNowMs() ||
    !Array.isArray(record.subjectIds) ||
    params.scope.dataSubjectIds.some((subjectId) => !record.subjectIds.includes(subjectId))
  ) {
    return { ok: false, reasonCode: "consent_required" };
  }
  const proof = Object.freeze({
    tenantId,
    resourceId,
    purpose: "eligible_cloud_projection" as const,
    consentVersion,
    subjectIds: Object.freeze([...record.subjectIds]),
    expiresAt: record.expiresAt,
    revoked: false,
    consentEpoch: record.consentEpoch.trim(),
    verifiedAt: trustedNowIso(),
  });
  verifiedProofs.add(proof);
  return { ok: true, proof };
}

/** P4-b must call this again before execution; do not reuse a stale proof object. */
export function reverifySubjectConsent(
  params: Parameters<typeof verifySubjectConsent>[0],
): ReturnType<typeof verifySubjectConsent> {
  return verifySubjectConsent(params);
}
