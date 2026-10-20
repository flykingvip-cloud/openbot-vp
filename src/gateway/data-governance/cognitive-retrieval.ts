import { resolveStateDir } from "../../config/paths.js";
import { calculateTemporalDecayMultiplier } from "../../memory/temporal-decay.js";
import {
  getOrCreateFileDataGovernanceCatalogStore,
  type DataGovernanceCatalogStore,
} from "./catalog-store.js";
import {
  isCognitiveRecommendationAuth,
  type CognitiveRecommendationAuth,
} from "./cognitive-recommendation-auth.js";
import { getRetrievalPolicyEvaluator } from "./cognitive-retrieval-policy.js";
import { isLegalHoldActive } from "./envelope.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import type { CatalogRecord, ResourceScope } from "./types.js";
import { assertOwnershipProofMatches } from "./write-gate.js";

export type {
  RetrievalPolicyEvaluation,
  RetrievalPolicyEvaluator,
} from "./cognitive-retrieval-policy.js";

export type RetrievalMode = "default_recall" | "explicit_retrieval" | "audit_retrieval";

export type RetrievalDenyCode =
  | "acl_denied"
  | "classification_denied"
  | "lifecycle_denied"
  | "legal_hold"
  | "legal_policy_denied"
  | "eligibility_blocked"
  | "eligibility_retired"
  | "pending_finalization"
  | "retrieval_governance_missing"
  | "policy_evaluator_missing"
  | "unknown_policy_id"
  | "invalid_score";

export type ConstrainedRetrievalDecision =
  | {
      outcome: "allow";
      mode: RetrievalMode;
      resourceId: string;
      rankedScore: number;
      reasons: {
        resourceId: string;
        version: string;
        scope: string;
        sourceSupport: "present" | "missing";
      };
    }
  | {
      outcome: "deny";
      mode: RetrievalMode;
      resourceId?: string;
      code: RetrievalDenyCode;
    };

export type DecideConstrainedRetrievalParams = {
  resourceId: string;
  mode: RetrievalMode;
  retrievalScore: number;
  auth: CognitiveRecommendationAuth;
  decayMultiplier?: number;
  ageInDays?: number;
  halfLifeDays?: number;
  stateDir?: string;
  catalog?: DataGovernanceCatalogStore;
};

const ALLOWED_KEYS = new Set([
  "resourceId",
  "mode",
  "retrievalScore",
  "auth",
  "decayMultiplier",
  "ageInDays",
  "halfLifeDays",
  "stateDir",
  "catalog",
]);

const MODES = new Set<RetrievalMode>(["default_recall", "explicit_retrieval", "audit_retrieval"]);

const HARD_LIFECYCLE_DENY = new Set([
  "purged",
  "deletion_pending",
  "quarantined",
  "recovery_required",
]);

function deny(
  mode: RetrievalMode,
  code: RetrievalDenyCode,
  resourceId?: string,
): ConstrainedRetrievalDecision {
  return resourceId ? { outcome: "deny", mode, resourceId, code } : { outcome: "deny", mode, code };
}

function catalogFor(params: {
  stateDir?: string;
  catalog?: DataGovernanceCatalogStore;
}): DataGovernanceCatalogStore {
  if (params.catalog) {
    return params.catalog;
  }
  return getOrCreateFileDataGovernanceCatalogStore({
    storePath: resolveDataGovernanceCatalogPath(params.stateDir ?? resolveStateDir()),
  });
}

function scopeLabel(scope: ResourceScope): string {
  switch (scope.kind) {
    case "user":
      return `user:${scope.userId}`;
    case "tenant":
      return `tenant:${scope.tenantId}`;
    case "group":
      return `group:${scope.groupId}`;
    case "system":
      return "system";
  }
}

function isUnitInterval(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function isOpenUnitInterval(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= 1;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function resolveDecayMultiplier(
  params: DecideConstrainedRetrievalParams,
): number | "invalid_score" {
  if (params.decayMultiplier !== undefined) {
    return isOpenUnitInterval(params.decayMultiplier) ? params.decayMultiplier : "invalid_score";
  }
  if (params.ageInDays !== undefined || params.halfLifeDays !== undefined) {
    if (
      params.ageInDays === undefined ||
      params.halfLifeDays === undefined ||
      !Number.isFinite(params.ageInDays) ||
      params.ageInDays < 0 ||
      !Number.isFinite(params.halfLifeDays) ||
      params.halfLifeDays <= 0
    ) {
      return "invalid_score";
    }
    const multiplier = calculateTemporalDecayMultiplier({
      ageInDays: params.ageInDays,
      halfLifeDays: params.halfLifeDays,
    });
    return isOpenUnitInterval(multiplier) ? multiplier : "invalid_score";
  }
  return 1;
}

function evaluatePolicyIds(
  freshnessPolicyId: string,
  applicabilityPolicyId: string,
): RetrievalDenyCode | null {
  const evaluator = getRetrievalPolicyEvaluator();
  if (!evaluator) {
    return "policy_evaluator_missing";
  }
  for (const policyId of [freshnessPolicyId, applicabilityPolicyId]) {
    const result = evaluator.evaluate(policyId);
    if (result === "evaluator_missing") {
      return "policy_evaluator_missing";
    }
    if (result === "unknown") {
      return "unknown_policy_id";
    }
    if (result === "deny") {
      return "legal_policy_denied";
    }
    if (result !== "allow") {
      return "policy_evaluator_missing";
    }
  }
  return null;
}

/**
 * P3-c constrained retrieval: returns a decision, never a bare score.
 * User-only. Worker/operator/system and delegation are out of this slice.
 */
export async function decideConstrainedRetrieval(
  params: DecideConstrainedRetrievalParams,
): Promise<ConstrainedRetrievalDecision> {
  const raw = params as unknown as Record<string, unknown>;
  const mode = MODES.has(params.mode) ? params.mode : "default_recall";
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) {
      return deny(
        mode,
        "invalid_score",
        typeof params.resourceId === "string" ? params.resourceId : undefined,
      );
    }
  }
  if (!isCognitiveRecommendationAuth(params.auth) || params.auth.actor.kind !== "user") {
    return deny(
      mode,
      "acl_denied",
      typeof params.resourceId === "string" ? params.resourceId : undefined,
    );
  }
  const resourceId = typeof params.resourceId === "string" ? params.resourceId.trim() : "";
  if (!resourceId) {
    return deny(mode, "acl_denied");
  }

  let record: CatalogRecord | null;
  try {
    record = await catalogFor(params).get(resourceId);
  } catch {
    return deny(mode, "retrieval_governance_missing", resourceId);
  }
  if (!record || record.envelope.resourceType !== "memory") {
    return deny(mode, "retrieval_governance_missing", resourceId);
  }

  if (record.envelope.tenantId !== params.auth.callerTenantId) {
    return deny(mode, "acl_denied", resourceId);
  }
  try {
    assertOwnershipProofMatches(record, params.auth.ownershipProof);
  } catch {
    return deny(mode, "acl_denied", resourceId);
  }

  if (params.auth.actor.kind === "user" && record.envelope.classification === "restricted") {
    return deny(mode, "classification_denied", resourceId);
  }

  if (record.envelope.activeLifecycleOperation) {
    return deny(mode, "lifecycle_denied", resourceId);
  }
  if (HARD_LIFECYCLE_DENY.has(record.envelope.lifecycleState)) {
    return deny(mode, "lifecycle_denied", resourceId);
  }
  if (record.envelope.lifecycleState === "archived" && mode === "default_recall") {
    return deny(mode, "lifecycle_denied", resourceId);
  }

  if (isLegalHoldActive(record.envelope)) {
    return deny(mode, "legal_hold", resourceId);
  }

  // B35: pending_finalization is blocked regardless of lifecycleState / eligibility.
  if (record.envelope.mergeFinalizationState === "pending_finalization") {
    return deny(mode, "pending_finalization", resourceId);
  }

  const governance = record.envelope.retrievalGovernance;
  if (!governance) {
    return deny(mode, "retrieval_governance_missing", resourceId);
  }
  if (governance.eligibility === "blocked") {
    return deny(mode, "eligibility_blocked", resourceId);
  }
  if (governance.eligibility === "retired" && mode === "default_recall") {
    return deny(mode, "eligibility_retired", resourceId);
  }

  const policyDenied = evaluatePolicyIds(
    governance.freshnessPolicyId,
    governance.applicabilityPolicyId,
  );
  if (policyDenied) {
    return deny(mode, policyDenied, resourceId);
  }

  if (!isUnitInterval(params.retrievalScore) || !isUnitInterval(governance.basePriority)) {
    return deny(mode, "invalid_score", resourceId);
  }
  const decayMultiplier = resolveDecayMultiplier(params);
  if (decayMultiplier === "invalid_score") {
    return deny(mode, "invalid_score", resourceId);
  }
  const rankedScore = clamp01(params.retrievalScore * decayMultiplier * governance.basePriority);
  const canonical = record.bindings.find(
    (binding) =>
      binding.bindingId === record.envelope.canonicalBindingId &&
      binding.role === "canonical" &&
      binding.state === "active",
  );
  return {
    outcome: "allow",
    mode,
    resourceId,
    rankedScore,
    reasons: {
      resourceId,
      version: canonical?.contentVersion ?? String(record.envelope.governanceVersion),
      scope: scopeLabel(record.envelope.scope),
      sourceSupport: canonical?.locator ? "present" : "missing",
    },
  };
}
