import type {
  KnowledgeBaseDocumentSummaryDto,
  KnowledgeBaseSourceListItemDto,
  KnowledgeBaseSummary,
} from "../capability/knowledge-universe/workspace-endpoints.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { withReservedDeliverableFoldersFirst } from "./knowledge-universe-reserved-folders.ts";

export type KnowledgeBaseVisibilityGroup = "private" | "team" | "enterprise";

export function filterKnowledgeBasesByVisibility(
  knowledgeBases: KnowledgeBaseSummary[],
  visibility: KnowledgeBaseVisibilityGroup,
): KnowledgeBaseSummary[] {
  return knowledgeBases.filter((kb) => kb.visibility === visibility);
}

export function partitionKnowledgeBasesForSidebar(surface: WorkbenchKnowledgeSurface): {
  pinned: KnowledgeBaseSummary[];
  favorites: KnowledgeBaseSummary[];
  privateSpaces: KnowledgeBaseSummary[];
  teamSpaces: KnowledgeBaseSummary[];
  enterpriseSpaces: KnowledgeBaseSummary[];
} {
  const query = surface.kbSearchQuery.trim().toLowerCase();
  const libraries = surface.knowledgeBases.filter((kb) => {
    if (!query) {
      return true;
    }
    return `${kb.title} ${kb.description}`.toLowerCase().includes(query);
  });
  const pinnedSet = new Set(surface.pinnedKnowledgeBaseIds ?? []);
  const favoriteSet = new Set(surface.favoriteKnowledgeBaseIds ?? []);
  const pinned = libraries.filter((kb) => pinnedSet.has(kb.id));
  // Favorites stay in their visibility groups; 收藏 is a parallel file funnel.
  const favorites = libraries.filter((kb) => favoriteSet.has(kb.id));
  const rest = libraries.filter((kb) => !pinnedSet.has(kb.id));
  return {
    pinned,
    favorites,
    privateSpaces: withReservedDeliverableFoldersFirst(
      rest.filter((kb) => kb.visibility === "private"),
    ),
    teamSpaces: withReservedDeliverableFoldersFirst(rest.filter((kb) => kb.visibility === "team")),
    enterpriseSpaces: rest.filter((kb) => kb.visibility === "enterprise"),
  };
}

export type FavoriteFunnelEntry = {
  kb: KnowledgeBaseSummary;
  doc: KnowledgeBaseDocumentSummaryDto;
};

export function resolveTreeDocumentsForKnowledgeBase(
  surface: WorkbenchKnowledgeSurface,
  kbId: string,
): KnowledgeBaseDocumentSummaryDto[] {
  const cached = surface.treeDocumentsByKbId?.[kbId];
  if (cached) {
    return cached;
  }
  if (surface.selectedKnowledgeBaseId === kbId) {
    return surface.libraryWorkspaceDocuments ?? [];
  }
  return [];
}

export function resolveTreeSourcesForKnowledgeBase(
  surface: WorkbenchKnowledgeSurface,
  kbId: string,
): KnowledgeBaseSourceListItemDto[] {
  const cached = surface.treeSourcesByKbId?.[kbId];
  if (cached) {
    return cached;
  }
  if (surface.selectedKnowledgeBaseId === kbId) {
    return surface.libraryWorkspaceSources ?? [];
  }
  return [];
}

export function listFavoriteFunnelEntries(
  surface: WorkbenchKnowledgeSurface,
): FavoriteFunnelEntry[] {
  const favoriteIds = surface.favoriteKnowledgeBaseIds ?? [];
  if (favoriteIds.length === 0) {
    return [];
  }
  const byId = new Map(surface.knowledgeBases.map((kb) => [kb.id, kb]));
  const entries: FavoriteFunnelEntry[] = [];
  for (const kbId of favoriteIds) {
    const kb = byId.get(kbId);
    if (!kb) {
      continue;
    }
    for (const doc of resolveTreeDocumentsForKnowledgeBase(surface, kbId)) {
      entries.push({ kb, doc });
    }
  }
  return entries;
}

export function supplyMetricForVisibility(
  knowledgeBases: KnowledgeBaseSummary[],
  visibility: KnowledgeBaseVisibilityGroup,
): { count: number; documentCount: number } {
  const spaces = filterKnowledgeBasesByVisibility(knowledgeBases, visibility);
  return {
    count: spaces.length,
    documentCount: spaces.reduce((sum, kb) => sum + (kb.documentCount ?? 0), 0),
  };
}
