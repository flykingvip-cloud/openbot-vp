import type { RecallResult } from "./types.js";

export function recallAgainst(
  gold: readonly string[] | undefined,
  predicted: readonly string[],
): number | null {
  if (!gold || gold.length === 0) {
    return null;
  }
  const predictedSet = new Set(predicted);
  const hits = gold.filter((item) => predictedSet.has(item)).length;
  return hits / gold.length;
}

export function computeRequiredRecall(params: {
  requiredSkillDigests?: readonly string[];
  requiredToolDigests?: readonly string[];
  skillCandidates: readonly string[];
  toolCandidates: readonly string[];
}): RecallResult {
  return {
    skillRecall: recallAgainst(params.requiredSkillDigests, params.skillCandidates),
    toolRecall: recallAgainst(params.requiredToolDigests, params.toolCandidates),
  };
}
