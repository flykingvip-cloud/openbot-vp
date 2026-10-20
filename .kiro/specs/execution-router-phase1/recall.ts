import type { RecallResult } from "./types.ts";

export function recallAgainst(gold: string[] | undefined, predicted: string[]): number | null {
  if (!gold || gold.length === 0) {
    return null;
  }
  const predictedSet = new Set(predicted);
  const hits = gold.filter((item) => predictedSet.has(item)).length;
  return hits / gold.length;
}

export function computeRequiredRecall(params: {
  requiredSkillDigests?: string[];
  requiredToolDigests?: string[];
  skillCandidates: string[];
  toolCandidates: string[];
}): RecallResult {
  return {
    skillRecall: recallAgainst(params.requiredSkillDigests, params.skillCandidates),
    toolRecall: recallAgainst(params.requiredToolDigests, params.toolCandidates),
  };
}
