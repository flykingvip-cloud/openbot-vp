import type { CandidateVsInvoked } from "./types.js";

function intersectionCount(left: readonly string[], right: readonly string[]): number {
  const wanted = new Set(right);
  return left.filter((item) => wanted.has(item)).length;
}

export function compareCandidateVsInvoked(params: {
  skillCandidates: readonly string[];
  skillInvoked: readonly string[];
  toolCandidates: readonly string[];
  toolInvoked: readonly string[];
}): CandidateVsInvoked {
  return {
    skillCandidateCount: params.skillCandidates.length,
    skillInvokedCount: params.skillInvoked.length,
    skillIntersectionCount: intersectionCount(params.skillCandidates, params.skillInvoked),
    toolCandidateCount: params.toolCandidates.length,
    toolInvokedCount: params.toolInvoked.length,
    toolIntersectionCount: intersectionCount(params.toolCandidates, params.toolInvoked),
  };
}
