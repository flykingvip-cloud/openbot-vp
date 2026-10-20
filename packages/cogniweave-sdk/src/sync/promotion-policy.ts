/**
 * CW2-P5-01 PromotionPolicy — fail-closed cloud promotion defaults (plan §10.4).
 */

export type PromotionDecisionKind = "blocked" | "needs_consent" | "ready" | "revoked";

export type PromotionPolicy = {
  policyVersion: 1;
  defaultPrivacyLevel: "private";
  defaultSyncEligibility: "blocked";
  /** Low-sensitivity types that may auto-promote after shared + score threshold. */
  autoPromoteAtomTypes: readonly string[];
  autoPromoteMinScore: number;
  requireExplicitConsent: true;
  /**
   * Enterprise overlay — may only tighten (never expand allowlist / lower score).
   * Applied by `resolvePromotionPolicy`.
   */
  tighten?: (base: PromotionPolicy) => PromotionPolicy;
};

export const DEFAULT_PROMOTION_POLICY: PromotionPolicy = {
  policyVersion: 1,
  defaultPrivacyLevel: "private",
  defaultSyncEligibility: "blocked",
  autoPromoteAtomTypes: ["strategy", "failure_pattern"],
  autoPromoteMinScore: 0.55,
  requireExplicitConsent: true,
};

export function resolvePromotionPolicy(policy?: PromotionPolicy): PromotionPolicy {
  const base = policy ?? DEFAULT_PROMOTION_POLICY;
  if (!base.tighten) {
    return base;
  }
  const tightened = base.tighten(base);
  // Enforce tighten-only: allowlist can only shrink; score floor can only rise.
  const allowlist = tightened.autoPromoteAtomTypes.filter((type) =>
    base.autoPromoteAtomTypes.includes(type),
  );
  return {
    ...tightened,
    policyVersion: 1,
    defaultPrivacyLevel: "private",
    defaultSyncEligibility: "blocked",
    requireExplicitConsent: true,
    autoPromoteAtomTypes: allowlist,
    autoPromoteMinScore: Math.max(base.autoPromoteMinScore, tightened.autoPromoteMinScore),
    tighten: undefined,
  };
}
