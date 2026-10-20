import {
  resolveAtomTypePolicy,
  scorePromotion,
  withAtomV2Defaults,
  type AtomTypePolicy,
} from "../domain/atom-v2.js";
import type { MemoryAtom } from "../models.js";
import { buildPromotionEnvelope, type CloudPromotionEnvelope } from "./promotion-envelope.js";
import {
  resolvePromotionPolicy,
  type PromotionDecisionKind,
  type PromotionPolicy,
} from "./promotion-policy.js";

/**
 * CW2-P5-01 decidePromotion — fail-closed authorization for cloud sync.
 */

export type PromotionConsentContext = {
  consentGranted?: boolean;
  consentRevoked?: boolean;
};

export type PromotionDecision = {
  decision: PromotionDecisionKind;
  reason: string;
  promotionScore: number;
  atomTypePolicy: AtomTypePolicy;
  envelope?: CloudPromotionEnvelope;
};

function decide(
  atom: MemoryAtom,
  ctx: PromotionConsentContext | undefined,
  policy: PromotionPolicy,
): PromotionDecision {
  const normalized = withAtomV2Defaults(atom);
  const atomTypePolicy = resolveAtomTypePolicy(normalized.atomType);
  const promotionScore = scorePromotion(normalized);
  const privacy = normalized.privacy!;

  if (ctx?.consentRevoked || privacy.syncEligibility === "blocked") {
    if (ctx?.consentRevoked) {
      return {
        decision: "revoked",
        reason: "consent_revoked",
        promotionScore,
        atomTypePolicy,
      };
    }
    if (privacy.syncEligibility === "blocked" && !ctx?.consentGranted) {
      return {
        decision: "blocked",
        reason: "sync_eligibility_blocked",
        promotionScore,
        atomTypePolicy,
      };
    }
  }

  if (promotionScore <= 0) {
    return {
      decision: "blocked",
      reason: "promotion_score_zero",
      promotionScore,
      atomTypePolicy,
    };
  }

  if (privacy.privacyLevel === "private" && !ctx?.consentGranted) {
    return {
      decision: "blocked",
      reason: "private_without_consent",
      promotionScore,
      atomTypePolicy,
    };
  }

  const onAllowlist = policy.autoPromoteAtomTypes.includes(normalized.atomType);
  const alreadyPromoted = privacy.syncEligibility === "promoted";
  const hasConsent = Boolean(ctx?.consentGranted) || alreadyPromoted;

  if (atomTypePolicy.confirmationRequired && !hasConsent) {
    return {
      decision: "needs_consent",
      reason: "type_requires_confirmation",
      promotionScore,
      atomTypePolicy,
    };
  }

  if (!onAllowlist && !hasConsent) {
    return {
      decision: "needs_consent",
      reason: "not_on_auto_promote_allowlist",
      promotionScore,
      atomTypePolicy,
    };
  }

  if (!hasConsent && onAllowlist && promotionScore < policy.autoPromoteMinScore) {
    return {
      decision: "needs_consent",
      reason: "below_auto_promote_score",
      promotionScore,
      atomTypePolicy,
    };
  }

  if (!hasConsent) {
    // Allowlist + score OK but still require explicit consent by default policy.
    return {
      decision: "needs_consent",
      reason: "explicit_consent_required",
      promotionScore,
      atomTypePolicy,
    };
  }

  // Ready: consent granted or already promoted, and not private without upgrade.
  if (privacy.privacyLevel === "private") {
    return {
      decision: "needs_consent",
      reason: "private_must_upgrade_privacy_level",
      promotionScore,
      atomTypePolicy,
    };
  }

  return {
    decision: "ready",
    reason: "eligible_with_consent",
    promotionScore,
    atomTypePolicy,
    envelope: buildPromotionEnvelope(normalized),
  };
}

export function decidePromotion(
  atom: MemoryAtom,
  ctx?: PromotionConsentContext,
  policy?: PromotionPolicy,
): PromotionDecision {
  return decide(atom, ctx, resolvePromotionPolicy(policy));
}
