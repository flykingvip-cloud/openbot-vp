import type { ScoredCandidate } from "./types.js";

/**
 * Policy remains the final authority. Shadow scores never grant a tool
 * that is not already in the authorized digest set.
 */
export function constrainShadowToolsToPolicy(
  candidates: readonly ScoredCandidate[],
  policyAuthorizedDigests: readonly string[],
): ScoredCandidate[] {
  const allowed = new Set(policyAuthorizedDigests);
  return candidates
    .filter((row) => allowed.has(row.nameDigest))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function shadowCannotExpandPolicy(params: {
  policyAuthorizedDigests: readonly string[];
  shadowToolCandidates: readonly ScoredCandidate[];
}): boolean {
  const allowed = new Set(params.policyAuthorizedDigests);
  return params.shadowToolCandidates.every((row) => allowed.has(row.nameDigest));
}
