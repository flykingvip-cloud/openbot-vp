/**
 * P3 shadow-promotion decision (no P4 execution).
 * Scores are inputs; lifecycle / classification / privacy / sync gates decide.
 */
import { encodeUnitIntervalScore } from "./cognitive-score.js";
import type {
  CognitiveRecommendationDecision,
  DataClassification,
  LifecycleState,
} from "./types.js";

const ADMIT_BLOCKED_LIFECYCLES = new Set<LifecycleState>([
  "purged",
  "deletion_pending",
  "recovery_required",
  "quarantined",
]);

/** Frozen P3 shadow floors. Changing them is a policy change, not an evaluator cheat. */
export const SHADOW_PROMOTION_MIN = 0.8;
export const SHADOW_ADMISSION_MIN = 0.5;

export type ShadowPromotionCandidate = {
  admissionScore: number;
  retrievalScore: number;
  promotionScore: number;
  classification: DataClassification;
  lifecycleState: LifecycleState;
  privacyLevel?: "public" | "internal" | "private";
  syncEligibility?: "promoted" | "allowed" | "blocked";
};

export type ShadowPromotionDecision =
  | { ok: true; decision: CognitiveRecommendationDecision; reasonCode: string }
  | { ok: false; error: "invalid_score" };

export function decideShadowPromotion(
  candidate: ShadowPromotionCandidate,
): ShadowPromotionDecision {
  const admission = encodeUnitIntervalScore(candidate.admissionScore);
  const retrieval = encodeUnitIntervalScore(candidate.retrievalScore);
  const promotion = encodeUnitIntervalScore(candidate.promotionScore);
  if (!admission.ok || !retrieval.ok || !promotion.ok) {
    return { ok: false, error: "invalid_score" };
  }
  if (ADMIT_BLOCKED_LIFECYCLES.has(candidate.lifecycleState)) {
    return { ok: true, decision: "recommend_deny", reasonCode: "lifecycle_denied" };
  }
  if (candidate.classification === "restricted") {
    return { ok: true, decision: "recommend_deny", reasonCode: "classification_denied" };
  }
  if (candidate.privacyLevel === "private") {
    return { ok: true, decision: "recommend_deny", reasonCode: "privacy_blocked" };
  }
  if (candidate.syncEligibility === "blocked") {
    return { ok: true, decision: "recommend_deny", reasonCode: "sync_blocked" };
  }
  if (candidate.promotionScore < SHADOW_PROMOTION_MIN) {
    return { ok: true, decision: "recommend_deny", reasonCode: "promotion_below_threshold" };
  }
  if (candidate.admissionScore < SHADOW_ADMISSION_MIN) {
    return { ok: true, decision: "recommend_deny", reasonCode: "admission_below_threshold" };
  }
  return { ok: true, decision: "recommend_admit", reasonCode: "shadow_allow" };
}
