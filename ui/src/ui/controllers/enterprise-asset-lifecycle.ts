import type { MATURITY_LABEL_MAP } from "../capability/employee-capability/projection.ts";

export type CapabilityMaturityKey = keyof typeof MATURITY_LABEL_MAP;

export type CapabilityMaturityInput = {
  depositedDays: number;
  usageCount: number;
  robotCount: number;
  employeeCount: number;
  averageSuccessRate: number;
  approvedReviewCount: number;
};

export type CapabilityReuseValueScore = {
  usageScore: number;
  reuseScore: number;
  successScore: number;
  adoptionScore: number;
  totalScore: number;
};

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Maps enterprise usage metrics to internal maturity keys (employee projection strips these). */
export function computeCapabilityMaturity(input: CapabilityMaturityInput): CapabilityMaturityKey {
  if (
    input.approvedReviewCount >= 3 &&
    input.robotCount >= 10 &&
    input.usageCount >= 100 &&
    input.averageSuccessRate >= 0.9
  ) {
    return "core-asset";
  }
  if (input.approvedReviewCount >= 2 && input.robotCount >= 5 && input.employeeCount >= 5) {
    return "standard";
  }
  if (input.approvedReviewCount >= 1 && input.averageSuccessRate >= 0.85) {
    return "enterprise-certified";
  }
  if (input.robotCount >= 2 && input.employeeCount >= 2) {
    return "multi-reuse";
  }
  if (input.usageCount >= 10 && input.averageSuccessRate >= 0.7) {
    return "stable";
  }
  return "forming";
}

export function computeCapabilityReuseValueScore(
  input: CapabilityMaturityInput,
): CapabilityReuseValueScore {
  const usageScore = clampScore((input.usageCount / 500) * 100);
  const reuseScore = clampScore(((input.robotCount + input.employeeCount) / 50) * 100);
  const successScore = clampScore(input.averageSuccessRate * 100);
  const adoptionScore = clampScore((input.approvedReviewCount / 5) * 100);
  const totalScore = clampScore((usageScore + reuseScore + successScore + adoptionScore) / 4);
  return { usageScore, reuseScore, successScore, adoptionScore, totalScore };
}
