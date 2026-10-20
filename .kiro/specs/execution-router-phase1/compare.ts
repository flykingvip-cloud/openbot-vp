import type { CandidateVsInvoked } from "./types.ts";

function intersectionCount(left: string[], right: string[]): number {
  const wanted = new Set(right);
  return left.filter((item) => wanted.has(item)).length;
}

export function compareCandidateVsInvoked(params: {
  skillCandidates: string[];
  skillInvoked: string[];
  toolCandidates: string[];
  toolInvoked: string[];
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
