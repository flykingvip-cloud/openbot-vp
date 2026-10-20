/**
 * P4-b signed tenant-bound promotion protocol.
 * Calls decideShadowPromotion, then P4-a resolvePlacement, then unique-creates
 * a prepared receipt while consuming the grant. Does not write storage adapters
 * or Catalog bindings (P4-c apply lives in cognitive-promotion-apply.ts).
 */
import { createHash } from "node:crypto";
import { resolveStateDir } from "../../config/paths.js";
import { loadValidatedCatalogRecordSync } from "./catalog-store.js";
import {
  isGovernanceApprovalAuth,
  type GovernanceApprovalAuth,
} from "./cognitive-approval-auth.js";
import { readGovernanceApprovalGrant } from "./cognitive-approval-grant-store.js";
import { canonicalizeCognitiveJsonValue } from "./cognitive-mutation-store.js";
import {
  resolveArchiveTenantKeyRef,
  resolveByosCustomerKeyRef,
  resolveDedicatedTenantKeyRef,
  resolvePlatformTenantKeyRef,
} from "./cognitive-promotion-key.js";
import {
  getCognitivePromotionReceiptByReplayId,
  getConsumedGrantReplayId,
  uniqueCreatePreparedPromotionReceipt,
} from "./cognitive-promotion-store.js";
import {
  isGovernanceAuthenticatedCall,
  type GovernanceAuthenticatedCall,
} from "./cognitive-recommendation-auth.js";
import { getCognitiveRecommendationReceipt } from "./cognitive-recommendation-store.js";
import { hexToFloat64 } from "./cognitive-score.js";
import {
  decideShadowPromotion,
  type ShadowPromotionCandidate,
  type ShadowPromotionDecision,
} from "./cognitive-shadow-promotion.js";
import { isLegalHoldActive } from "./envelope.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import type {
  ResourceConsentScope as VerifiedResourceConsentScope,
  SubjectConsentProof as VerifiedSubjectConsentProof,
} from "./placement-platform-verify.js";
import { reverifySubjectConsent } from "./placement-platform-verify.js";
import {
  resolvePlacement,
  type PlacementPolicy,
  type PlacementResolverInput,
  type SyncClassification,
  type TrustedRegionDefault,
} from "./placement-resolve.js";
import type { CognitivePromotionReceipt, OwnershipPrincipal, ActorRef } from "./types.js";

export type PromotionPrepareDenyCode =
  | "governance_approval_auth_required"
  | "wire_authority_rejected"
  | "recommendation_not_found"
  | "catalog_not_found"
  | "envelope_tenant_mismatch"
  | "invalid_score"
  | "decision_denied"
  | "grant_kind_mismatch"
  | "grant_scope_mismatch"
  | "grant_tenant_mismatch"
  | "grant_issuer_invalid"
  | "grant_expired"
  | "grant_revoked"
  | "grant_consumed"
  | "grant_consumed_without_receipt"
  | "placement_denied"
  | "consent_required"
  | "actor_mismatch"
  | "key_ref_required"
  | "recovery_required";

export type PrepareCognitivePromotionParams = {
  call: GovernanceAuthenticatedCall;
  auth: GovernanceApprovalAuth;
  recommendationId: string;
  resourceId: string;
  placement: {
    controllerId: string;
    retentionClass: string | null;
    residencyRequiredRegions: readonly string[] | null;
    deploymentProfile: PlacementResolverInput["deploymentProfile"];
    trustedRegionDefault: TrustedRegionDefault | null;
    tenantContract: PlacementPolicy | null;
    requestedOfflineRequired: boolean | null;
    costObjective: PlacementResolverInput["costObjective"];
    recoveryObjective: PlacementResolverInput["recoveryObjective"];
    syncClassification: SyncClassification | null;
    resourceConsentScope: VerifiedResourceConsentScope | null;
    subjectConsent: VerifiedSubjectConsentProof | null;
  };
  privacyLevel?: ShadowPromotionCandidate["privacyLevel"];
  syncEligibility?: ShadowPromotionCandidate["syncEligibility"];
};

export type PrepareCognitivePromotionResult =
  | { ok: true; receipt: CognitivePromotionReceipt; replay: boolean }
  | { ok: false; error: PromotionPrepareDenyCode; reasonCode?: string };

const ALLOWED_KEYS = new Set([
  "call",
  "auth",
  "recommendationId",
  "resourceId",
  "placement",
  "privacyLevel",
  "syncEligibility",
]);

const FORBIDDEN_WIRE_KEYS = new Set([
  "executedBy",
  "requestedBy",
  "tenantId",
  "tenant",
  "authTenantId",
  "envelopeTenantId",
  "stateDir",
  "catalog",
  "grant",
  "candidate",
]);

const PLACEMENT_ALLOWED_KEYS = new Set([
  "controllerId",
  "retentionClass",
  "residencyRequiredRegions",
  "deploymentProfile",
  "trustedRegionDefault",
  "tenantContract",
  "requestedOfflineRequired",
  "costObjective",
  "recoveryObjective",
  "syncClassification",
  "resourceConsentScope",
  "subjectConsent",
]);

function deny(
  error: PromotionPrepareDenyCode,
  reasonCode?: string,
): PrepareCognitivePromotionResult {
  return reasonCode ? { ok: false, error, reasonCode } : { ok: false, error };
}

export function computeShadowPromotionDecisionFingerprint(params: {
  input: ShadowPromotionCandidate;
  output: ShadowPromotionDecision;
}): string {
  const canonical = canonicalizeCognitiveJsonValue({
    input: {
      admissionScore: params.input.admissionScore,
      retrievalScore: params.input.retrievalScore,
      promotionScore: params.input.promotionScore,
      classification: params.input.classification,
      lifecycleState: params.input.lifecycleState,
      privacyLevel: params.input.privacyLevel ?? null,
      syncEligibility: params.input.syncEligibility ?? null,
    },
    output: params.output,
  });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function computePromotionReplayId(params: {
  grantId: string;
  recommendationId: string;
  resourceId: string;
  decisionFingerprint: string;
}): string {
  return createHash("sha256")
    .update(
      `${params.grantId}\0${params.recommendationId}\0${params.resourceId}\0${params.decisionFingerprint}`,
      "utf8",
    )
    .digest("hex");
}

function ownerScopeOf(owner: OwnershipPrincipal): PlacementResolverInput["ownerScope"] | null {
  if (owner.kind === "user") {
    return "user_owned";
  }
  if (owner.kind === "position") {
    return "position_owned";
  }
  if (owner.kind === "group") {
    return "group_owned";
  }
  return null;
}

function sameActorRef(left: ActorRef, right: ActorRef): boolean {
  return (
    JSON.stringify(canonicalizeCognitiveJsonValue(left)) ===
    JSON.stringify(canonicalizeCognitiveJsonValue(right))
  );
}

/**
 * P4-b prepare. Order is frozen: branded auth → load → decideShadowPromotion →
 * resolvePlacement → replay lookup → grant unused check → unique-create prepared
 * + consume grant. Does not write storage adapters or Catalog bindings.
 */
export async function prepareCognitivePromotionApply(
  params: PrepareCognitivePromotionParams,
): Promise<PrepareCognitivePromotionResult> {
  if (Object.keys(params).some((key) => FORBIDDEN_WIRE_KEYS.has(key) || !ALLOWED_KEYS.has(key))) {
    return deny("wire_authority_rejected");
  }
  if (!isGovernanceAuthenticatedCall(params.call) || !isGovernanceApprovalAuth(params.auth)) {
    return deny("governance_approval_auth_required");
  }
  if (
    !params.placement ||
    typeof params.placement !== "object" ||
    Object.keys(params.placement).some((key) => !PLACEMENT_ALLOWED_KEYS.has(key))
  ) {
    return deny("wire_authority_rejected");
  }
  const tenantId = params.auth.callerTenantId;
  if (
    !tenantId ||
    tenantId !== params.call.callerTenantId ||
    params.auth.approvalGrant.tenantId !== tenantId
  ) {
    return deny("grant_tenant_mismatch");
  }
  if (!sameActorRef(params.auth.actor, params.call.actor)) {
    return deny("actor_mismatch");
  }
  const resourceId = params.resourceId.trim();
  const recommendationId = params.recommendationId.trim();
  const grant = params.auth.approvalGrant;
  if (!resourceId || !recommendationId) {
    return deny("wire_authority_rejected");
  }
  if (grant.grantKind !== "cognitive_promotion_apply") {
    return deny("grant_kind_mismatch");
  }
  if (grant.scope.kind !== "resource" || grant.scope.resourceId !== resourceId) {
    return deny("grant_scope_mismatch");
  }

  const stateDir = resolveStateDir();
  const catalogLoaded = loadValidatedCatalogRecordSync({
    storePath: resolveDataGovernanceCatalogPath(stateDir),
    resourceId,
  });
  if (!catalogLoaded) {
    return deny("catalog_not_found");
  }
  const envelope = catalogLoaded.record.envelope;
  if (envelope.tenantId !== tenantId) {
    return deny("envelope_tenant_mismatch");
  }
  const ownerScope = ownerScopeOf(envelope.owner);
  if (!ownerScope) {
    return deny("catalog_not_found");
  }
  const recommendation = getCognitiveRecommendationReceipt({
    recommendationId,
    tenantId,
    owner: envelope.owner,
    stateDir,
  });
  if (!recommendation || recommendation.status !== "open") {
    return deny("recommendation_not_found");
  }
  if (recommendation.tenantId !== tenantId) {
    return deny("envelope_tenant_mismatch");
  }
  if (
    recommendation.candidateId !== resourceId &&
    !recommendation.sourceResourceIds.includes(resourceId)
  ) {
    return deny("recommendation_not_found");
  }

  let admissionScore: number;
  let retrievalScore: number;
  let promotionScore: number;
  try {
    admissionScore = hexToFloat64(recommendation.scoreInputs.admissionScore.ieee754Hex);
    retrievalScore = hexToFloat64(recommendation.scoreInputs.retrievalScore.ieee754Hex);
    promotionScore = hexToFloat64(recommendation.scoreInputs.promotionScore.ieee754Hex);
  } catch {
    return deny("invalid_score");
  }
  const candidate: ShadowPromotionCandidate = {
    admissionScore,
    retrievalScore,
    promotionScore,
    classification: envelope.classification,
    lifecycleState: envelope.lifecycleState,
    ...(params.privacyLevel ? { privacyLevel: params.privacyLevel } : {}),
    ...(params.syncEligibility ? { syncEligibility: params.syncEligibility } : {}),
  };
  const decision = decideShadowPromotion(candidate);
  if (!decision.ok) {
    return deny("invalid_score");
  }
  if (decision.decision !== "recommend_admit") {
    return deny("decision_denied", decision.reasonCode);
  }

  const placement = resolvePlacement({
    tenantId,
    ownerScope,
    controllerId: params.placement.controllerId,
    classification: envelope.classification,
    retentionClass: params.placement.retentionClass,
    legalHoldActive: isLegalHoldActive(envelope),
    residencyRequiredRegions: params.placement.residencyRequiredRegions,
    deploymentProfile: params.placement.deploymentProfile,
    trustedRegionDefault: params.placement.trustedRegionDefault,
    tenantContract: params.placement.tenantContract,
    requestedOfflineRequired: params.placement.requestedOfflineRequired,
    costObjective: params.placement.costObjective,
    recoveryObjective: params.placement.recoveryObjective,
    syncClassification: params.placement.syncClassification,
    resourceConsentScope: params.placement.resourceConsentScope,
    subjectConsent: params.placement.subjectConsent,
  });
  if (!placement.ok) {
    return deny("placement_denied", placement.reasonCode);
  }
  const cloudWrite =
    placement.mode === "encrypted-cloud" ||
    placement.mode === "tenant-cloud" ||
    placement.mode === "dedicated" ||
    placement.mode === "byos" ||
    placement.mode === "cold-archive" ||
    placement.canonicalHome === "managed_encrypted_cloud" ||
    placement.canonicalHome === "tenant_managed_cloud" ||
    placement.canonicalHome === "dedicated_regional" ||
    placement.canonicalHome === "byos" ||
    placement.canonicalHome === "cold_archive" ||
    placement.projection === "managed_encrypted_cloud";

  let consentVersion: string | undefined;
  if (
    params.placement.syncClassification === "eligible-with-consent" &&
    placement.projection === "managed_encrypted_cloud" &&
    params.placement.subjectConsent &&
    params.placement.resourceConsentScope
  ) {
    const reverified = reverifySubjectConsent({
      call: params.call,
      resourceId,
      consentVersion: params.placement.subjectConsent.consentVersion,
      scope: params.placement.resourceConsentScope,
    });
    if (!reverified.ok) {
      return deny("consent_required");
    }
    consentVersion = reverified.proof.consentVersion;
  }

  // Cloud prepare requires a tenant-bound keyRef + region.
  let keyRef = placement.keyRef;
  if (cloudWrite) {
    if (!placement.region) {
      return deny("key_ref_required");
    }
    const issued =
      placement.canonicalHome === "dedicated_regional"
        ? resolveDedicatedTenantKeyRef({ call: params.call, tenantId })
        : placement.canonicalHome === "byos"
          ? resolveByosCustomerKeyRef({ call: params.call, tenantId })
          : placement.canonicalHome === "cold_archive"
            ? resolveArchiveTenantKeyRef({ call: params.call, tenantId })
            : resolvePlatformTenantKeyRef({ call: params.call, tenantId });
    if (!issued.ok) {
      return deny("key_ref_required");
    }
    keyRef = issued.keyRef;
  }

  const decisionFingerprint = computeShadowPromotionDecisionFingerprint({
    input: candidate,
    output: decision,
  });
  const replayId = computePromotionReplayId({
    grantId: grant.grantId,
    recommendationId,
    resourceId,
    decisionFingerprint,
  });

  const existing = getCognitivePromotionReceiptByReplayId({ replayId, stateDir });
  if (existing) {
    if (existing.state === "prepared" || existing.state === "applied") {
      return { ok: true, receipt: existing, replay: true };
    }
    return deny("recovery_required", existing.decisionReasonCode);
  }

  const storedGrant = readGovernanceApprovalGrant({
    grantId: grant.grantId,
    tenantId,
    stateDir,
  });
  if (!storedGrant) {
    return deny("governance_approval_auth_required");
  }
  if (storedGrant.issuedBy !== "enterprise_ops" && storedGrant.issuedBy !== "tenant_admin") {
    return deny("grant_issuer_invalid");
  }
  if (storedGrant.grantKind !== "cognitive_promotion_apply") {
    return deny("grant_kind_mismatch");
  }
  if (storedGrant.scope.kind !== "resource" || storedGrant.scope.resourceId !== resourceId) {
    return deny("grant_scope_mismatch");
  }
  if ((storedGrant.tenantId ?? null) !== tenantId) {
    return deny("grant_tenant_mismatch");
  }
  if (storedGrant.revokedAt) {
    return deny("grant_revoked");
  }
  if (Date.parse(storedGrant.expiresAt) <= Date.now()) {
    return deny("grant_expired");
  }
  const consumedBy = getConsumedGrantReplayId({ grantId: grant.grantId, stateDir });
  if (consumedBy && consumedBy !== replayId) {
    return deny("grant_consumed");
  }
  if (storedGrant.state === "consumed" && consumedBy !== replayId) {
    return deny("grant_consumed");
  }

  const canonical = catalogLoaded.record.bindings.find(
    (binding) => binding.bindingId === envelope.canonicalBindingId && binding.role === "canonical",
  );
  if (!canonical) {
    return deny("catalog_not_found");
  }
  const now = new Date().toISOString();
  const toCanonicalBindingId =
    placement.canonicalHome === "local"
      ? canonical.bindingId
      : placement.canonicalHome === "tenant_managed_cloud"
        ? `planned-tenant-managed-${resourceId}`
        : placement.canonicalHome === "dedicated_regional"
          ? `planned-dedicated-${resourceId}`
          : placement.canonicalHome === "byos"
            ? `planned-byos-${resourceId}`
            : placement.canonicalHome === "cold_archive"
              ? `planned-cold-archive-${resourceId}`
              : `planned-managed-${resourceId}`;
  const prepared: CognitivePromotionReceipt = {
    kind: "cognitive_promotion_receipt",
    receiptId: `cpr_${replayId}`,
    replayId,
    grantId: grant.grantId,
    recommendationId,
    resourceId,
    tenantId,
    decision: "recommend_admit",
    decisionReasonCode: decision.reasonCode,
    placementMode: placement.mode,
    canonicalHome: placement.canonicalHome,
    fromBindingId: canonical.bindingId,
    toCanonicalBindingId,
    ...(placement.projection === "managed_encrypted_cloud"
      ? { projectionBindingId: `planned-projection-${resourceId}` }
      : {}),
    ...(keyRef ? { keyRefId: keyRef.keyRefId } : {}),
    ...(placement.region ? { region: placement.region } : {}),
    ...(consentVersion ? { consentVersion } : {}),
    policyVersion: recommendation.policyVersion,
    contentVersion: canonical.contentVersion,
    state: "prepared",
    createdAt: now,
    updatedAt: now,
  };

  const created = await uniqueCreatePreparedPromotionReceipt({
    receipt: prepared,
    grantTenantId: tenantId,
    stateDir,
  });
  if (!created.ok) {
    if (created.conflict === "grant_consumed") {
      return deny("grant_consumed");
    }
    if (created.conflict === "grant_revoked") {
      return deny("grant_revoked");
    }
    if (created.conflict === "grant_expired") {
      return deny("grant_expired");
    }
    if (created.conflict === "recovery_required") {
      return deny("recovery_required");
    }
    if (created.conflict === "grant_not_found" || created.conflict === "grant_not_unused") {
      return deny("governance_approval_auth_required");
    }
    return deny("grant_consumed_without_receipt");
  }
  if (!created.created) {
    if (created.receipt.state === "prepared" || created.receipt.state === "applied") {
      return { ok: true, receipt: created.receipt, replay: true };
    }
    return deny("recovery_required", created.receipt.decisionReasonCode);
  }
  return { ok: true, receipt: created.receipt, replay: false };
}

export function getCognitivePromotionReceipt(params: {
  replayId: string;
}): CognitivePromotionReceipt | null {
  return getCognitivePromotionReceiptByReplayId({ replayId: params.replayId });
}
