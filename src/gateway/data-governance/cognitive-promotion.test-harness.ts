import fs from "node:fs";
import path from "node:path";
import { resolveGovernanceApprovalAuth } from "./cognitive-approval-auth.js";
import type { GovernanceApprovalAuth } from "./cognitive-approval-auth.js";
import { writeGovernanceApprovalGrantAtDeployBoundary } from "./cognitive-approval-grant-store.js";
import {
  authenticateGovernanceCall,
  type GovernanceAuthenticatedCall,
} from "./cognitive-recommendation-auth.js";
import { createCognitiveRecommendationReceiptUnique } from "./cognitive-recommendation-store.js";
/**
 * P4-b test-only helpers. Production modules must not import this file.
 */
import { encodeUnitIntervalScore } from "./cognitive-score.js";
import { trustedRegionDefaultFromReceipt } from "./placement-resolve.js";
import type { PlacementPolicy } from "./placement-resolve.js";
import {
  installPlacementRegionTrustSecretForTests,
  mintPlatformDeploymentRegionReceiptForTests,
  mintResourceConsentScopeForTests,
  mintSubjectConsentProofForTests,
  putPlacementCatalogRecordForTests,
  resetPlacementAuthorityForTests,
} from "./placement-resolve.test-harness.js";
import type { OwnershipPrincipal } from "./types.js";

export const P4B_TENANT = "tenant-a";
export const P4B_RESOURCE = "ws-p4b-1";
export const P4B_SUBJECT = "user-p4b";
export const P4B_REGION = "us-west-2";
export const P4B_GRANT = "grant-p4b-1";
export const P4B_RECOMMENDATION = "rec-p4b-1";

export function defaultPlacementPolicy(patch: Partial<PlacementPolicy> = {}): PlacementPolicy {
  return {
    allowedCustodians: ["device", "openbot"],
    allowedRegions: [P4B_REGION, "eu-central-1"],
    requireDedicatedKey: false,
    requireDedicatedDatabase: false,
    offlineRequired: false,
    replicationClass: "none",
    ...patch,
  };
}

export function beginP4bFixture(): string {
  const dir = resetPlacementAuthorityForTests();
  process.env.OPENBOT_STATE_DIR = dir;
  installPlacementRegionTrustSecretForTests();
  return dir;
}

export async function authenticateP4bCall(
  tenantId = P4B_TENANT,
): Promise<GovernanceAuthenticatedCall> {
  const authenticated = await authenticateGovernanceCall({
    connect: {} as never,
    user: `${tenantId}@acme.test`,
    sessionDomain: "enterprise",
  });
  if (!authenticated.ok) {
    throw new Error("expected P4-b GovernanceAuthenticatedCall");
  }
  return authenticated.call;
}

export async function seedP4bCatalog(params?: {
  owner?: OwnershipPrincipal;
  resourceId?: string;
  tenantId?: string;
  classification?: "public" | "internal" | "confidential" | "restricted";
  lifecycleState?: "active" | "archived" | "read_only";
  legalHold?: {
    holdId: string;
    reason: string;
    appliedBy: { kind: "user"; userId: string };
    appliedAt: string;
  };
}): Promise<void> {
  await putPlacementCatalogRecordForTests({
    tenantId: params?.tenantId ?? P4B_TENANT,
    resourceId: params?.resourceId ?? P4B_RESOURCE,
    owner: params?.owner ?? { kind: "user", userId: P4B_SUBJECT },
    ...(params?.classification ? { classification: params.classification } : {}),
    ...(params?.lifecycleState ? { lifecycleState: params.lifecycleState } : {}),
    ...(params?.legalHold ? { legalHold: params.legalHold } : {}),
  });
}

export function writeP4bGrant(params?: {
  grantId?: string;
  resourceId?: string;
  tenantId?: string;
  expiresAt?: string;
  revokedAt?: string;
  grantKind?:
    | "cognitive_promotion_apply"
    | "cognitive_merge_apply"
    | "cognitive_projection_tombstone"
    | "placement_export_restore";
  issuedBy?: "enterprise_ops" | "tenant_admin";
  state?: "unused" | "consumed";
  consumedAt?: string;
  consumedByReplayId?: string;
  scopeKind?: "resource" | "agentAsset";
}): void {
  const grantId = params?.grantId ?? P4B_GRANT;
  const resourceId = params?.resourceId ?? P4B_RESOURCE;
  const tenantId = params?.tenantId ?? P4B_TENANT;
  writeGovernanceApprovalGrantAtDeployBoundary({
    stateDir: process.env.OPENBOT_STATE_DIR!,
    record: {
      grantId,
      kind: "governance_approval_grant",
      grantKind: params?.grantKind ?? "cognitive_promotion_apply",
      tenantId,
      scope:
        params?.scopeKind === "agentAsset"
          ? { kind: "agentAsset", agentAssetId: "asset-1" }
          : { kind: "resource", resourceId },
      approverUserId: P4B_SUBJECT,
      issuedBy: params?.issuedBy ?? "enterprise_ops",
      issuedAt: "2026-08-16T00:00:00.000Z",
      expiresAt: params?.expiresAt ?? "2027-08-16T00:00:00.000Z",
      ...(params?.revokedAt ? { revokedAt: params.revokedAt } : {}),
      ...(params?.state ? { state: params.state } : {}),
      ...(params?.consumedAt ? { consumedAt: params.consumedAt } : {}),
      ...(params?.consumedByReplayId ? { consumedByReplayId: params.consumedByReplayId } : {}),
    },
  });
}

export async function resolveP4bAuth(params?: {
  grantId?: string;
  resourceId?: string;
  call?: GovernanceAuthenticatedCall;
  requiredKind?:
    | "cognitive_promotion_apply"
    | "cognitive_merge_apply"
    | "cognitive_projection_tombstone"
    | "placement_export_restore";
}): Promise<GovernanceApprovalAuth> {
  const call = params?.call ?? (await authenticateP4bCall());
  const requiredKind = params?.requiredKind ?? "cognitive_promotion_apply";
  const resolved = await resolveGovernanceApprovalAuth({
    call,
    owner: { kind: "user", userId: P4B_SUBJECT },
    grantId: params?.grantId ?? P4B_GRANT,
    requiredKind,
    requiredScope: { kind: "resource", resourceId: params?.resourceId ?? P4B_RESOURCE },
    stateDir: process.env.OPENBOT_STATE_DIR,
  });
  if (!resolved.ok) {
    throw new Error(`expected promotion auth: ${resolved.reason}`);
  }
  return resolved.auth;
}

export async function seedP4bRecommendation(params?: {
  recommendationId?: string;
  resourceId?: string;
  owner?: OwnershipPrincipal;
  admissionScore?: number;
  retrievalScore?: number;
  promotionScore?: number;
  decision?: "recommend_admit" | "recommend_deny";
}): Promise<void> {
  const resourceId = params?.resourceId ?? P4B_RESOURCE;
  const owner = params?.owner ?? { kind: "user" as const, userId: P4B_SUBJECT };
  const admission = encodeUnitIntervalScore(params?.admissionScore ?? 0.9);
  const retrieval = encodeUnitIntervalScore(params?.retrievalScore ?? 0.7);
  const promotion = encodeUnitIntervalScore(params?.promotionScore ?? 0.9);
  if (!admission.ok || !retrieval.ok || !promotion.ok) {
    throw new Error("invalid test scores");
  }
  const created = await createCognitiveRecommendationReceiptUnique({
    receipt: {
      recommendationId: params?.recommendationId ?? P4B_RECOMMENDATION,
      candidateId: resourceId,
      tenantId: P4B_TENANT,
      owner,
      sourceResourceIds: [resourceId],
      policyVersion: "pv-1",
      scoreInputs: {
        admissionScore: { ieee754Hex: admission.score.ieee754Hex },
        retrievalScore: { ieee754Hex: retrieval.score.ieee754Hex },
        promotionScore: { ieee754Hex: promotion.score.ieee754Hex },
        scoreAlgorithmVersion: "v1",
        producerModelRef: "model-test",
      },
      decision: params?.decision ?? "recommend_admit",
      reasonCode: "shadow_allow",
      requestedBy: { kind: "user", userId: P4B_SUBJECT },
      executedBy: { kind: "user", userId: P4B_SUBJECT },
      requestFingerprint: "fp-p4b-test",
      createdAt: "2026-08-16T00:00:00.000Z",
      expiresAt: "2027-08-16T00:00:00.000Z",
      status: "open",
    },
    stateDir: process.env.OPENBOT_STATE_DIR,
  });
  if (!created.ok) {
    throw new Error("failed to seed recommendation");
  }
}

export function installPromotionKeySecretForTests(): void {
  process.env.OPENBOT_PROMOTION_KEY_HMAC_KEY = "p4c-test-promotion-key-hmac";
}

export function seedP4cCanonicalBytes(body = "canonical-bytes-p4c"): Buffer {
  const locator = path.join(process.env.OPENBOT_STATE_DIR!, P4B_RESOURCE);
  fs.mkdirSync(path.dirname(locator), { recursive: true });
  fs.writeFileSync(locator, body);
  return Buffer.from(body);
}

export async function p4bTrustedRegion(call: GovernanceAuthenticatedCall) {
  const receipt = mintPlatformDeploymentRegionReceiptForTests({
    receiptId: "drr-p4b",
    tenantId: P4B_TENANT,
    region: P4B_REGION,
    call,
  });
  const built = trustedRegionDefaultFromReceipt({ receipt, call });
  if (!built.ok) {
    throw new Error("expected trusted region");
  }
  return built.value;
}

export async function p4bConsent(call: GovernanceAuthenticatedCall) {
  const scope = await mintResourceConsentScopeForTests({
    tenantId: P4B_TENANT,
    resourceId: P4B_RESOURCE,
    ownerUserId: P4B_SUBJECT,
    call,
  });
  const proof = await mintSubjectConsentProofForTests({
    tenantId: P4B_TENANT,
    resourceId: P4B_RESOURCE,
    consentVersion: "cv-1",
    ownerUserId: P4B_SUBJECT,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    call,
  });
  return { scope, proof };
}
