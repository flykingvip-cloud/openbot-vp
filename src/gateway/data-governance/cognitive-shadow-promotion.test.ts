import { describe, expect, it } from "vitest";
import {
  SHADOW_ADMISSION_MIN,
  SHADOW_PROMOTION_MIN,
  decideShadowPromotion,
  type ShadowPromotionCandidate,
} from "./cognitive-shadow-promotion.js";

function eligible(patch: Partial<ShadowPromotionCandidate> = {}): ShadowPromotionCandidate {
  return {
    admissionScore: 0.9,
    retrievalScore: 0.7,
    promotionScore: 0.85,
    classification: "confidential",
    lifecycleState: "active",
    privacyLevel: "internal",
    syncEligibility: "allowed",
    ...patch,
  };
}

describe("decideShadowPromotion", () => {
  it("admits an eligible shadow candidate and does not execute P4", () => {
    expect(decideShadowPromotion(eligible())).toEqual({
      ok: true,
      decision: "recommend_admit",
      reasonCode: "shadow_allow",
    });
  });

  it("denies on lifecycle, classification, privacy, and sync gates even with high scores", () => {
    expect(decideShadowPromotion(eligible({ lifecycleState: "quarantined" }))).toMatchObject({
      decision: "recommend_deny",
      reasonCode: "lifecycle_denied",
    });
    expect(decideShadowPromotion(eligible({ classification: "restricted" }))).toMatchObject({
      decision: "recommend_deny",
      reasonCode: "classification_denied",
    });
    expect(decideShadowPromotion(eligible({ privacyLevel: "private" }))).toMatchObject({
      decision: "recommend_deny",
      reasonCode: "privacy_blocked",
    });
    expect(decideShadowPromotion(eligible({ syncEligibility: "blocked" }))).toMatchObject({
      decision: "recommend_deny",
      reasonCode: "sync_blocked",
    });
  });

  it("denies below the frozen score floors and fail-closes invalid scores", () => {
    expect(
      decideShadowPromotion(eligible({ promotionScore: SHADOW_PROMOTION_MIN - 0.01 })),
    ).toMatchObject({
      decision: "recommend_deny",
      reasonCode: "promotion_below_threshold",
    });
    expect(
      decideShadowPromotion(eligible({ admissionScore: SHADOW_ADMISSION_MIN - 0.01 })),
    ).toMatchObject({
      decision: "recommend_deny",
      reasonCode: "admission_below_threshold",
    });
    expect(decideShadowPromotion(eligible({ promotionScore: Number.NaN }))).toEqual({
      ok: false,
      error: "invalid_score",
    });
  });
});
