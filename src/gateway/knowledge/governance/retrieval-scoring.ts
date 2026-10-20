import { applyClaimConflictMultiplier } from "./claims/claim-retrieval.js";
import type { ChunkGovernanceFactors } from "./types.js";

const TRUST_FLOOR = 0.5;
const TRUST_CEIL = 1.2;
const FRESHNESS_FLOOR = 0.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function resolveVerifiedWeight(factors: ChunkGovernanceFactors): number {
  if (factors.governanceStatus === "confirmed") {
    return 1.1;
  }
  if (factors.governanceStatus === "suppressed" || factors.governanceStatus === "archived") {
    return 0;
  }
  if (factors.conflictGroupId) {
    return 0.7;
  }
  return 1;
}

export function applyGovernanceMultiplier(
  hybridScore: number,
  factors: ChunkGovernanceFactors | null | undefined,
  options?: { claimConflict?: boolean },
): number {
  if (!factors) {
    return applyClaimConflictMultiplier(hybridScore, options?.claimConflict ?? false);
  }
  const trust = clamp(factors.trustScore ?? 1, TRUST_FLOOR, TRUST_CEIL);
  const freshness = clamp(factors.freshnessScore ?? 1, FRESHNESS_FLOOR, 1);
  const verified = resolveVerifiedWeight(factors);
  if (verified === 0) {
    return 0;
  }
  const score = hybridScore * trust * freshness * verified;
  return applyClaimConflictMultiplier(score, options?.claimConflict ?? false);
}

export function shouldFilterGovernanceHit(
  factors: ChunkGovernanceFactors | null | undefined,
): boolean {
  return factors?.governanceStatus === "suppressed" || factors?.governanceStatus === "archived";
}
