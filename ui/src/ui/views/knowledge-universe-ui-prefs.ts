import type {
  KnowledgeUniverseBrowseSubTab,
  KnowledgeUniversePageTab,
  LibraryWorkspaceContentTab,
  LibraryWorkspaceMaterialsKindFilter,
} from "../ports/employee/views/home-page-contracts.ts";

const STORAGE_KEY = "openbot.knowledge-universe.ui.v1";

const LIBRARY_CONTENT_TABS = new Set<LibraryWorkspaceContentTab>([
  "documents",
  "snippets",
  "datasets",
  "web",
  "agent",
  "recycle",
]);

const MATERIALS_KIND_FILTERS = new Set<LibraryWorkspaceMaterialsKindFilter>([
  "all",
  "document",
  "web",
  "dataset",
  "agent",
  "active",
]);

type KnowledgeUniverseUiPrefs = {
  pageTab?: KnowledgeUniversePageTab | "browse" | "more" | "libraryWorkspace";
  browseSubTab?: KnowledgeUniverseBrowseSubTab;
  selectedKnowledgeBaseId?: string;
  pinnedKnowledgeBaseIds?: string[];
  favoriteKnowledgeBaseIds?: string[];
  libraryWorkspaceContentTab?: LibraryWorkspaceContentTab;
  libraryWorkspaceMaterialsKindFilter?: LibraryWorkspaceMaterialsKindFilter;
  dismissedHomeInsightsNotice?: boolean;
};

const PAGE_TABS = new Set<KnowledgeUniversePageTab>([
  "workbench",
  "relations",
  "supply",
  "personal",
  "deliverables",
  "deliverableDetail",
  "libraryCreate",
  "spaceImport",
  "assets",
  "governance",
]);

const BROWSE_SUB_TABS = new Set<KnowledgeUniverseBrowseSubTab>([
  "private",
  "team",
  "enterprise",
  "capabilities",
  "personal",
]);

/** Map legacy supply facets onto visibility-aligned tabs. */
export function normalizeKnowledgeUniverseBrowseSubTab(
  tab: KnowledgeUniverseBrowseSubTab | undefined,
): KnowledgeUniverseBrowseSubTab | undefined {
  if (!tab) {
    return undefined;
  }
  if (tab === "personal") {
    return "private";
  }
  return tab;
}

export function normalizeKnowledgeUniversePageTab(
  tab: KnowledgeUniverseUiPrefs["pageTab"],
): KnowledgeUniversePageTab | undefined {
  if (!tab) {
    return undefined;
  }
  if (tab === "browse") {
    return "supply";
  }
  if (tab === "more") {
    return "governance";
  }
  // The deliverable detail view depends on a transient in-memory selection that does not
  // survive a reload. Never restore it directly (that lands on an empty "not found" page);
  // fall back to the deliverables list (成果中心) so the user can pick a deliverable.
  if (tab === "deliverableDetail") {
    return "workbench";
  }
  // Retired 成果中心 page — outputs now live in 个人成果 / 团队成果 folders.
  if (tab === "deliverables") {
    return "workbench";
  }
  // Retired space catalog page — always reopen on the home cockpit.
  if (tab === "libraryWorkspace") {
    return "workbench";
  }
  // Import is a transient flow; reopening cold should land on home.
  if (tab === "spaceImport") {
    return "workbench";
  }
  return PAGE_TABS.has(tab) ? tab : undefined;
}

function readRaw(): KnowledgeUniverseUiPrefs {
  if (typeof localStorage === "undefined") {
    return {};
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as KnowledgeUniverseUiPrefs;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function readKnowledgeUniverseUiPrefs(): {
  pageTab?: KnowledgeUniversePageTab;
  browseSubTab?: KnowledgeUniverseBrowseSubTab;
  selectedKnowledgeBaseId?: string;
  pinnedKnowledgeBaseIds: string[];
  favoriteKnowledgeBaseIds: string[];
  libraryWorkspaceContentTab: LibraryWorkspaceContentTab;
  libraryWorkspaceMaterialsKindFilter: LibraryWorkspaceMaterialsKindFilter;
  dismissedHomeInsightsNotice: boolean;
} {
  const parsed = readRaw();
  const pageTab = normalizeKnowledgeUniversePageTab(parsed.pageTab);
  const browseSubTab = normalizeKnowledgeUniverseBrowseSubTab(
    parsed.browseSubTab && BROWSE_SUB_TABS.has(parsed.browseSubTab)
      ? parsed.browseSubTab
      : undefined,
  );
  const selectedKnowledgeBaseId =
    typeof parsed.selectedKnowledgeBaseId === "string" &&
    parsed.selectedKnowledgeBaseId.trim().length > 0
      ? parsed.selectedKnowledgeBaseId.trim()
      : undefined;
  const pinnedKnowledgeBaseIds = normalizeIdList(parsed.pinnedKnowledgeBaseIds);
  const favoriteKnowledgeBaseIds = normalizeIdList(parsed.favoriteKnowledgeBaseIds);
  const libraryWorkspaceContentTab =
    parsed.libraryWorkspaceContentTab && LIBRARY_CONTENT_TABS.has(parsed.libraryWorkspaceContentTab)
      ? parsed.libraryWorkspaceContentTab
      : "documents";
  const libraryWorkspaceMaterialsKindFilter =
    parsed.libraryWorkspaceMaterialsKindFilter &&
    MATERIALS_KIND_FILTERS.has(parsed.libraryWorkspaceMaterialsKindFilter)
      ? parsed.libraryWorkspaceMaterialsKindFilter
      : "all";
  const dismissedHomeInsightsNotice = parsed.dismissedHomeInsightsNotice === true;
  return {
    pageTab,
    browseSubTab,
    selectedKnowledgeBaseId,
    pinnedKnowledgeBaseIds,
    favoriteKnowledgeBaseIds,
    libraryWorkspaceContentTab,
    libraryWorkspaceMaterialsKindFilter,
    dismissedHomeInsightsNotice,
  };
}

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value.filter((item): item is string => typeof item === "string" && item.trim().length > 0),
    ),
  ];
}

export function writeKnowledgeUniverseUiPrefs(partial: Partial<KnowledgeUniverseUiPrefs>): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  const next = { ...readRaw(), ...partial };
  const normalizedPageTab = normalizeKnowledgeUniversePageTab(next.pageTab);
  if (next.pageTab && !normalizedPageTab) {
    delete next.pageTab;
  } else if (normalizedPageTab) {
    next.pageTab = normalizedPageTab;
  }
  if (next.browseSubTab && !BROWSE_SUB_TABS.has(next.browseSubTab)) {
    delete next.browseSubTab;
  } else if (next.browseSubTab) {
    next.browseSubTab =
      normalizeKnowledgeUniverseBrowseSubTab(next.browseSubTab) ?? next.browseSubTab;
  }
  if (next.selectedKnowledgeBaseId !== undefined && !next.selectedKnowledgeBaseId.trim()) {
    delete next.selectedKnowledgeBaseId;
  }
  if (
    next.libraryWorkspaceContentTab &&
    !LIBRARY_CONTENT_TABS.has(next.libraryWorkspaceContentTab)
  ) {
    delete next.libraryWorkspaceContentTab;
  }
  if (
    next.libraryWorkspaceMaterialsKindFilter &&
    !MATERIALS_KIND_FILTERS.has(next.libraryWorkspaceMaterialsKindFilter)
  ) {
    delete next.libraryWorkspaceMaterialsKindFilter;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function applyKnowledgeUniverseUiPrefs(state: {
  knowledgeUniversePageTab?: KnowledgeUniversePageTab;
  knowledgeUniverseBrowseSubTab?: KnowledgeUniverseBrowseSubTab;
}): void {
  const prefs = readKnowledgeUniverseUiPrefs();
  if (prefs.pageTab) {
    state.knowledgeUniversePageTab = prefs.pageTab;
  }
  if (prefs.browseSubTab) {
    state.knowledgeUniverseBrowseSubTab = prefs.browseSubTab;
  }
}

export function readPreferredKnowledgeBaseId(): string | undefined {
  return readKnowledgeUniverseUiPrefs().selectedKnowledgeBaseId;
}

export function readLibraryWorkspaceContentTab(): LibraryWorkspaceContentTab {
  return readKnowledgeUniverseUiPrefs().libraryWorkspaceContentTab;
}

export function readLibraryWorkspaceMaterialsKindFilter(): LibraryWorkspaceMaterialsKindFilter {
  return readKnowledgeUniverseUiPrefs().libraryWorkspaceMaterialsKindFilter;
}

export function readPinnedKnowledgeBaseIds(): string[] {
  return readKnowledgeUniverseUiPrefs().pinnedKnowledgeBaseIds;
}

export function readFavoriteKnowledgeBaseIds(): string[] {
  return readKnowledgeUniverseUiPrefs().favoriteKnowledgeBaseIds;
}

export function readHomeInsightsNoticeDismissed(): boolean {
  return readKnowledgeUniverseUiPrefs().dismissedHomeInsightsNotice;
}

export function dismissHomeInsightsNotice(): void {
  writeKnowledgeUniverseUiPrefs({ dismissedHomeInsightsNotice: true });
}

export function removeKnowledgeBaseFromUiPrefs(kbId: string): void {
  const prefs = readKnowledgeUniverseUiPrefs();
  writeKnowledgeUniverseUiPrefs({
    pinnedKnowledgeBaseIds: prefs.pinnedKnowledgeBaseIds.filter((id) => id !== kbId),
    favoriteKnowledgeBaseIds: prefs.favoriteKnowledgeBaseIds.filter((id) => id !== kbId),
    selectedKnowledgeBaseId:
      prefs.selectedKnowledgeBaseId === kbId ? undefined : prefs.selectedKnowledgeBaseId,
  });
}

export function togglePinnedKnowledgeBaseId(kbId: string): string[] {
  const prefs = readKnowledgeUniverseUiPrefs();
  const next = prefs.pinnedKnowledgeBaseIds.includes(kbId)
    ? prefs.pinnedKnowledgeBaseIds.filter((id) => id !== kbId)
    : [...prefs.pinnedKnowledgeBaseIds, kbId];
  writeKnowledgeUniverseUiPrefs({ pinnedKnowledgeBaseIds: next });
  return next;
}

export function toggleFavoriteKnowledgeBaseId(kbId: string): string[] {
  const prefs = readKnowledgeUniverseUiPrefs();
  const next = prefs.favoriteKnowledgeBaseIds.includes(kbId)
    ? prefs.favoriteKnowledgeBaseIds.filter((id) => id !== kbId)
    : [...prefs.favoriteKnowledgeBaseIds, kbId];
  writeKnowledgeUniverseUiPrefs({ favoriteKnowledgeBaseIds: next });
  return next;
}
