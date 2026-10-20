import type { KnowledgeBaseVisibility } from "../knowledge/knowledge-base-store.js";
import type { ContextConfidentialityLevel } from "./types.js";

export function confidentialityRank(level: ContextConfidentialityLevel): number {
  switch (level) {
    case "public":
      return 0;
    case "internal":
      return 1;
    case "restricted":
      return 2;
  }
}

/** Map group participation tier onto the CSC plan ceiling. Secret collapses to restricted. */
export function maxLevelFromGroupConfidentiality(
  tier: string | null | undefined,
): ContextConfidentialityLevel {
  switch (tier?.trim()) {
    case "public":
      return "public";
    case "restricted":
    case "secret":
      return "restricted";
    default:
      return "internal";
  }
}

export function visibilityToConfidentiality(
  visibility: KnowledgeBaseVisibility | undefined,
): ContextConfidentialityLevel {
  return visibility === "private" ? "restricted" : "internal";
}

export function exceedsConfidentialityCeiling(params: {
  sourceLevel: ContextConfidentialityLevel;
  maxLevel: ContextConfidentialityLevel;
}): boolean {
  return confidentialityRank(params.sourceLevel) > confidentialityRank(params.maxLevel);
}
