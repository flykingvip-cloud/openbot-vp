import type { KnowledgeObject } from "../types.js";
import type { CandidateRelationship } from "./types.js";

function recencyBoost(updatedAt: number, now = Date.now()): number {
  const ageDays = Math.max(0, (now - updatedAt) / 86_400_000);
  if (ageDays <= 7) {
    return 12;
  }
  if (ageDays <= 30) {
    return 6;
  }
  return 0;
}

export function scoreRelationshipCandidate(params: {
  candidate: CandidateRelationship;
  objectsById: Map<string, KnowledgeObject>;
}): number {
  const left = params.objectsById.get(params.candidate.sourceObjectId);
  const right = params.objectsById.get(params.candidate.targetObjectId);
  let score = params.candidate.baseScore;
  if (left && right) {
    score += recencyBoost(left.updatedAt) / 2;
    score += recencyBoost(right.updatedAt) / 2;
    if (left.source === right.source) {
      score += 4;
    }
    if (params.candidate.reasons.includes("explicit-reference")) {
      score += 8;
    }
  }
  return Math.min(100, Math.max(1, Math.round(score)));
}

export function scoreRelationshipCandidates(params: {
  candidates: CandidateRelationship[];
  objects: KnowledgeObject[];
}): Array<CandidateRelationship & { score: number }> {
  const objectsById = new Map(params.objects.map((item) => [item.id, item]));
  return params.candidates.map((candidate) => ({
    ...candidate,
    score: scoreRelationshipCandidate({ candidate, objectsById }),
  }));
}
