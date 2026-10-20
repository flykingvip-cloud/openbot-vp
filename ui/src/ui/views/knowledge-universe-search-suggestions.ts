import type {
  KnowledgeObject,
  KnowledgeRecommendationItem,
  KnowledgeRecentVisit,
} from "../capability/knowledge-universe/types.ts";
import type {
  KnowledgeEvidenceDto,
  WorkspaceSearchGroup,
} from "../capability/knowledge-universe/workspace-endpoints.ts";
import type { KnowledgeUniverseSearchScope } from "../ports/employee/views/home-page-contracts.ts";

function dedupeSuggestions(items: string[], limit: number): string[] {
  return items
    .map((item) => item.trim())
    .filter((item, index, list) => item && list.indexOf(item) === index)
    .slice(0, limit);
}

function buildWorkspaceSearchSuggestions(input: {
  recentVisits: KnowledgeRecentVisit[];
  recommendations: KnowledgeRecommendationItem[];
}): string[] {
  return dedupeSuggestions(
    [
      ...input.recentVisits.slice(0, 2).map((item) => item.title),
      ...input.recommendations.slice(0, 2).map((item) => item.object.title),
    ],
    4,
  );
}

function buildLibrarySearchSuggestions(input: {
  selectedKnowledgeBaseId: string | null;
  recentVisits: KnowledgeRecentVisit[];
  kbSearchEvidence: KnowledgeEvidenceDto[];
  kbSearchSubstringResults: KnowledgeObject[];
  workspaceSearchGroups: WorkspaceSearchGroup[];
}): string[] {
  const kbId = input.selectedKnowledgeBaseId;
  if (!kbId) {
    return buildWorkspaceSearchSuggestions({
      recentVisits: input.recentVisits,
      recommendations: [],
    });
  }

  const suggestions: string[] = [];

  for (const item of input.kbSearchEvidence) {
    if (item.kbId === kbId) {
      suggestions.push(item.docTitle);
    }
  }
  for (const item of input.kbSearchSubstringResults) {
    suggestions.push(item.title);
  }
  for (const group of input.workspaceSearchGroups) {
    if (group.group !== "knowledge") {
      continue;
    }
    for (const hit of group.hits) {
      if (hit.kbId !== kbId) {
        continue;
      }
      suggestions.push(hit.title);
      if (hit.subtitle) {
        suggestions.push(hit.subtitle);
      }
    }
  }
  for (const visit of input.recentVisits.slice(0, 3)) {
    suggestions.push(visit.title);
  }

  return dedupeSuggestions(suggestions, 4);
}

export function buildKnowledgeUniverseSearchSuggestions(input: {
  scope: KnowledgeUniverseSearchScope;
  selectedKnowledgeBaseId: string | null;
  recentVisits: KnowledgeRecentVisit[];
  recommendations: KnowledgeRecommendationItem[];
  kbSearchEvidence: KnowledgeEvidenceDto[];
  kbSearchSubstringResults: KnowledgeObject[];
  workspaceSearchGroups: WorkspaceSearchGroup[];
}): string[] {
  if (input.scope === "library" && input.selectedKnowledgeBaseId) {
    return buildLibrarySearchSuggestions(input);
  }
  return buildWorkspaceSearchSuggestions(input);
}
