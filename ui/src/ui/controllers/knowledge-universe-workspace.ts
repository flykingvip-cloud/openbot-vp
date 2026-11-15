import { t } from "../../i18n/index.ts";
import type { AppPortState } from "../app-port-state.ts";
import { createKnowledgeUniverseGateway } from "../capability/knowledge-universe/gateway-client.ts";
import {
  syncKnowledgeUniverseSelectionToChatHost,
  type KnowledgeUniverseChatScopeHost,
} from "../chat/knowledge-universe-chat-scope.ts";
import { GatewayRequestError } from "../gateway.ts";
import type { LibraryWorkspaceContentTab } from "../ports/employee/views/home-page-contracts.ts";
import type { SpaceImportKind } from "../ports/employee/views/home-page-contracts.ts";
import type { WorkspaceDeliverableStatusFilter } from "../ports/employee/views/home-page-contracts.ts";
import { resolveKnowledgeBaseDisplayTitle } from "../views/knowledge-universe-deliverable-display.ts";
import {
  createEmptyNoteImportState,
  readNoteTagHistory,
} from "../views/knowledge-universe-note-import.ts";
import {
  canCreateKnowledgeFolderInSection,
  isReservedDeliverableKnowledgeBase,
} from "../views/knowledge-universe-reserved-folders.ts";
import { createEmptySpaceConnectorBindDraft } from "../views/knowledge-universe-space-connector-bind.ts";
import {
  readPreferredKnowledgeBaseId,
  removeKnowledgeBaseFromUiPrefs,
  toggleFavoriteKnowledgeBaseId,
  togglePinnedKnowledgeBaseId,
  writeKnowledgeUniverseUiPrefs,
} from "../views/knowledge-universe-ui-prefs.ts";
import { createEmptyWebUrlImportState } from "../views/knowledge-universe-url-import.ts";
import {
  isDeliverablesUserContextError,
  resolveWorkspaceLoadError,
  workspaceMessageArchiveFailed,
  workspaceMessageArchiveSelectLibrary,
  workspaceMessageCreateEmptyTitle,
  workspaceMessageCreateFailed,
  workspaceMessageDeleteConfirmRequired,
  workspaceMessageDeleteFailed,
  workspaceMessageDeleteSelectLibrary,
  workspaceMessageKbSearchEmpty,
  workspaceMessageKbSearchFailed,
  workspaceMessageRenameEmptyTitle,
  workspaceMessageRenameFailed,
  workspaceMessageSelectLibraryFirst,
  workspaceNoticeArchived,
  workspaceNoticeArchivedWithRag,
  workspaceNoticeCreated,
  workspaceNoticeDeleted,
  workspaceNoticeKbSearchIndexed,
  workspaceNoticeKbSearchSubstring,
  workspaceNoticeRenamed,
  workspaceNoticeTabActionComingSoon,
  workspaceNoticeImportReadOnly,
  workspaceNoticeDocumentDetached,
  workspaceNoticeDocumentRestored,
  workspaceNoticeDocumentDeleted,
  workspaceNoticeSourceIngested,
  workspaceNoticeDeliverableDeleted,
  workspaceNoticeInviteSent,
  workspaceMessageDetachSelectLibrary,
  workspaceMessageDetachFailed,
  workspaceMessageIngestFailed,
  workspaceMessageRestoreFailed,
  workspaceMessageInviteEmailRequired,
  workspaceMessageInviteFailed,
} from "./knowledge-universe-workspace-messages.ts";
import {
  getKnowledgeUniverseRuntime,
  type KnowledgeUniverseSession,
} from "./knowledge-universe.ts";

function requestUpdate(state: KnowledgeUniverseSession) {
  if (typeof state.requestUpdate === "function") {
    state.requestUpdate();
  }
}

function expandKnowledgeBaseInTree(runtime: { expandedKnowledgeBaseIds: string[] }, kbId: string) {
  if (!runtime.expandedKnowledgeBaseIds.includes(kbId)) {
    runtime.expandedKnowledgeBaseIds = [...runtime.expandedKnowledgeBaseIds, kbId];
  }
}

const SKILL_CATALOG_REF = /(?:^|[:/])skill_[a-z0-9]+/i;
const INTERNAL_SOURCE_TITLE =
  /^(Ifdoc[:_]?|lfdoc[-:]|kbdoc[-:]|obj:|doc[-:]|dataset[-:]|skill[:_]|lin:)|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^[0-9a-f]{16,}$/i;

function isCabinTreeLeakSource(item: {
  id?: string;
  title?: string;
  documentId?: string;
  kind?: string;
}): boolean {
  const refs = [item.id, item.title, item.documentId].filter((value): value is string =>
    Boolean(value?.trim()),
  );
  if (refs.some((value) => SKILL_CATALOG_REF.test(value.trim()))) {
    return true;
  }
  if (INTERNAL_SOURCE_TITLE.test(item.title?.trim() ?? "")) {
    return true;
  }
  return false;
}

function cabinTreeSources<
  T extends { id?: string; title?: string; documentId?: string; kind?: string },
>(sources: readonly T[]): T[] {
  return sources.filter((item) => !isCabinTreeLeakSource(item));
}

function cacheTreeDocuments(
  runtime: ReturnType<typeof getKnowledgeUniverseRuntime>,
  kbId: string,
  documents: (typeof runtime.libraryWorkspaceDocuments)[number][],
  sources: (typeof runtime.libraryWorkspaceSources)[number][],
) {
  runtime.treeDocumentsByKbId = { ...runtime.treeDocumentsByKbId, [kbId]: documents };
  runtime.treeSourcesByKbId = { ...runtime.treeSourcesByKbId, [kbId]: sources };
}

export async function ensureKnowledgeUniverseTreeDocuments(state: AppPortState, kbId: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const trimmed = kbId.trim();
  if (!trimmed || !state.client) {
    return;
  }
  if (runtime.treeDocumentsByKbId[trimmed] && !runtime.treeDocumentsLoadingByKbId[trimmed]) {
    return;
  }
  runtime.treeDocumentsLoadingByKbId = {
    ...runtime.treeDocumentsLoadingByKbId,
    [trimmed]: true,
  };
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const plane =
      runtime.libraryWorkspaceSourcesPlaneFilter === "all"
        ? undefined
        : runtime.libraryWorkspaceSourcesPlaneFilter;
    const response = await gateway.listKnowledgeBaseSources({
      knowledgeBaseId: trimmed,
      ...(plane ? { plane } : {}),
    });
    const sources = cabinTreeSources(response.sources);
    const documents = sources
      .filter((item) => item.documentId)
      .map((item) => ({
        docId: item.documentId!,
        title: item.title,
        contentType: null,
        updatedAtMs: item.updatedAtMs,
        indexed: item.status === "indexed",
      }));
    cacheTreeDocuments(runtime, trimmed, documents, sources);
    if (runtime.selectedKnowledgeBaseId === trimmed) {
      runtime.libraryWorkspaceSources = sources;
      runtime.libraryWorkspaceDocuments = documents;
    }
  } catch {
    cacheTreeDocuments(runtime, trimmed, [], []);
  } finally {
    runtime.treeDocumentsLoadingByKbId = {
      ...runtime.treeDocumentsLoadingByKbId,
      [trimmed]: false,
    };
    syncWorkspaceToAppState(state);
    requestUpdate(state);
  }
}

export function toggleKnowledgeUniverseTreeExpanded(state: AppPortState, kbId: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const trimmed = kbId.trim();
  if (!trimmed) {
    return;
  }
  const open = runtime.expandedKnowledgeBaseIds.includes(trimmed);
  runtime.expandedKnowledgeBaseIds = open
    ? runtime.expandedKnowledgeBaseIds.filter((id) => id !== trimmed)
    : [...runtime.expandedKnowledgeBaseIds, trimmed];
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  if (!open) {
    void ensureKnowledgeUniverseTreeDocuments(state, trimmed);
  }
}

function preloadFavoriteFunnelDocuments(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  for (const kbId of runtime.favoriteKnowledgeBaseIds) {
    void ensureKnowledgeUniverseTreeDocuments(state, kbId);
  }
}

export function syncWorkspaceToAppState(state: KnowledgeUniverseSession) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const surface = state as Record<string, unknown>;
  surface.knowledgeUniverseKnowledgeBases = runtime.knowledgeBases;
  surface.knowledgeUniverseSelectedKnowledgeBaseId = runtime.selectedKnowledgeBaseId;
  surface.knowledgeUniverseSearchScope = runtime.searchScope;
  surface.knowledgeUniverseKbSearchQuery = runtime.kbSearchQuery;
  surface.knowledgeUniverseKbSearchEvidence = runtime.kbSearchEvidence;
  surface.knowledgeUniverseKbSearchMode = runtime.kbSearchMode;
  surface.knowledgeUniverseKbSearchSubstringResults = runtime.kbSearchSubstringResults;
  surface.knowledgeUniverseWorkspaceDeliverables = runtime.workspaceDeliverables;
  surface.knowledgeUniverseWorkspaceDeliverableStatusFilter =
    runtime.workspaceDeliverableStatusFilter;
  surface.knowledgeUniverseWorkspaceBusy = runtime.workspaceBusy;
  surface.knowledgeUniverseWorkspaceNotice = runtime.workspaceNotice;
  surface.knowledgeUniverseWorkspaceError = runtime.workspaceError;
  surface.knowledgeUniverseWorkspaceHint = runtime.workspaceHint;
  surface.knowledgeUniverseWorkspaceDeliverablesUnavailable =
    runtime.workspaceDeliverablesUnavailable;
  surface.knowledgeUniverseNewKnowledgeBaseTitle = runtime.newKnowledgeBaseTitle;
  surface.knowledgeUniverseNewKnowledgeBaseDescription = runtime.newKnowledgeBaseDescription;
  surface.knowledgeUniverseNewKnowledgeBaseVisibility = runtime.newKnowledgeBaseVisibility;
  surface.knowledgeUniverseWorkspaceDeliverablesExpanded = runtime.workspaceDeliverablesExpanded;
  surface.knowledgeUniverseSelectedKbSearchHighlightKey = runtime.selectedKbSearchHighlightKey;
  surface.knowledgeUniverseSearchPanelOpen = runtime.searchPanelOpen;
  surface.knowledgeUniverseWorkspaceDeliverableTrace = runtime.workspaceDeliverableTrace;
  surface.knowledgeUniverseWorkspaceDeliverableTraceLoading =
    runtime.workspaceDeliverableTraceLoading;
  surface.knowledgeUniverseDeliverableDetailFocus = runtime.deliverableDetailFocus;
  surface.knowledgeUniverseOpenDeliverableMoreMenuId = runtime.openDeliverableMoreMenuId;
  surface.knowledgeUniversePinnedKnowledgeBaseIds = runtime.pinnedKnowledgeBaseIds;
  surface.knowledgeUniverseFavoriteKnowledgeBaseIds = runtime.favoriteKnowledgeBaseIds;
  surface.knowledgeUniverseLibraryWorkspaceContentTab = runtime.libraryWorkspaceContentTab;
  surface.knowledgeUniverseLibraryWorkspaceMaterialsKindFilter =
    runtime.libraryWorkspaceMaterialsKindFilter;
  surface.knowledgeUniverseLibraryWorkspaceDocuments = runtime.libraryWorkspaceDocuments;
  surface.knowledgeUniverseLibraryWorkspaceDocumentsLoading =
    runtime.libraryWorkspaceDocumentsLoading;
  surface.knowledgeUniverseLibraryWorkspaceSources = runtime.libraryWorkspaceSources;
  surface.knowledgeUniverseLibraryWorkspaceSourcesLoading = runtime.libraryWorkspaceSourcesLoading;
  surface.knowledgeUniverseLibraryWorkspaceSourcesPlaneFilter =
    runtime.libraryWorkspaceSourcesPlaneFilter;
  surface.knowledgeUniverseLibraryWorkspaceSelectedDocumentIds =
    runtime.libraryWorkspaceSelectedDocumentIds;
  surface.knowledgeUniverseLibraryWorkspaceSnippets = runtime.libraryWorkspaceSnippets;
  surface.knowledgeUniverseLibraryWorkspaceSnippetsLoading =
    runtime.libraryWorkspaceSnippetsLoading;
  surface.knowledgeUniverseLibraryWorkspaceRecycleDocuments =
    runtime.libraryWorkspaceRecycleDocuments;
  surface.knowledgeUniverseLibraryWorkspaceRecycleLoading = runtime.libraryWorkspaceRecycleLoading;
  surface.knowledgeUniverseLibraryWorkspaceEvictedChunks = runtime.libraryWorkspaceEvictedChunks;
  surface.knowledgeUniverseLibraryWorkspaceWebPages = runtime.libraryWorkspaceWebPages;
  surface.knowledgeUniverseLibraryWorkspaceWebPagesLoading =
    runtime.libraryWorkspaceWebPagesLoading;
  surface.knowledgeUniverseLibraryWorkspaceDatasets = runtime.libraryWorkspaceDatasets;
  surface.knowledgeUniverseLibraryWorkspaceDatasetsLoading =
    runtime.libraryWorkspaceDatasetsLoading;
  surface.knowledgeUniverseLibraryWorkspaceAgentKnowledge = runtime.libraryWorkspaceAgentKnowledge;
  surface.knowledgeUniverseLibraryWorkspaceAgentKnowledgeLoading =
    runtime.libraryWorkspaceAgentKnowledgeLoading;
  surface.knowledgeUniverseLibraryWorkspaceMembers = runtime.libraryWorkspaceMembers;
  surface.knowledgeUniverseLibraryWorkspaceMembersLoading = runtime.libraryWorkspaceMembersLoading;
  surface.knowledgeUniverseLibraryWorkspaceInviteRole = runtime.libraryWorkspaceInviteRole;
  surface.knowledgeUniverseLibraryWorkspaceInviteDrawerOpen =
    runtime.libraryWorkspaceInviteDrawerOpen;
  surface.knowledgeUniverseLibraryWorkspaceInviteEmail = runtime.libraryWorkspaceInviteEmail;
  surface.knowledgeUniverseLibraryWorkspaceInlineRenameKbId =
    runtime.libraryWorkspaceInlineRenameKbId;
  surface.knowledgeUniverseLibraryWorkspaceSettingsKbId = runtime.libraryWorkspaceSettingsKbId;
  surface.knowledgeUniverseLibraryWorkspaceSettingsTitle = runtime.libraryWorkspaceSettingsTitle;
  surface.knowledgeUniverseLibraryWorkspaceImportOpen = runtime.libraryWorkspaceImportOpen;
  surface.knowledgeUniverseLibraryWorkspaceImportLockSpace =
    runtime.libraryWorkspaceImportLockSpace;
  surface.knowledgeUniverseLibraryWorkspaceImportKind = runtime.libraryWorkspaceImportKind;
  surface.knowledgeUniverseLibraryWorkspaceBindSourceKind = runtime.libraryWorkspaceBindSourceKind;
  surface.knowledgeUniverseLibraryWorkspaceBindSourceTitle =
    runtime.libraryWorkspaceBindSourceTitle;
  surface.knowledgeUniverseLibraryWorkspaceBindSourceEndpoint =
    runtime.libraryWorkspaceBindSourceEndpoint;
  surface.knowledgeUniverseLibraryWorkspaceConnectorBindDraft =
    runtime.libraryWorkspaceConnectorBindDraft;
  surface.knowledgeUniverseLibraryWorkspaceConnectorCatalog =
    runtime.libraryWorkspaceConnectorCatalog;
  surface.knowledgeUniverseLibraryWorkspaceConnectorCatalogLoading =
    runtime.libraryWorkspaceConnectorCatalogLoading;
  surface.knowledgeUniverseLibraryWorkspaceConnectorCatalogError =
    runtime.libraryWorkspaceConnectorCatalogError;
  surface.knowledgeUniverseLibraryWorkspaceConnectorCredentials =
    runtime.libraryWorkspaceConnectorCredentials;
  surface.knowledgeUniverseLibraryWorkspaceConnectorCredentialsLoading =
    runtime.libraryWorkspaceConnectorCredentialsLoading;
  surface.knowledgeUniverseLibraryWorkspaceConnectorProbeOk =
    runtime.libraryWorkspaceConnectorProbeOk;
  surface.knowledgeUniverseLibraryWorkspaceConnectorProbeMessage =
    runtime.libraryWorkspaceConnectorProbeMessage;
  surface.knowledgeUniverseLibraryWorkspaceConnectorProbeBusy =
    runtime.libraryWorkspaceConnectorProbeBusy;
  surface.knowledgeUniverseLibraryWorkspaceConnectorOAuthBusy =
    runtime.libraryWorkspaceConnectorOAuthBusy;
  surface.knowledgeUniverseLibraryWorkspaceConnectorOAuthNotice =
    runtime.libraryWorkspaceConnectorOAuthNotice;
  surface.knowledgeUniverseLibraryWorkspaceConnectorOAuthError =
    runtime.libraryWorkspaceConnectorOAuthError;
  surface.knowledgeUniverseLibraryWorkspaceConnectorOAuthSessionId =
    runtime.libraryWorkspaceConnectorOAuthSessionId;
  surface.knowledgeUniverseLibraryWorkspaceConnectorOAuthSimulateAllowed =
    runtime.libraryWorkspaceConnectorOAuthSimulateAllowed;
  surface.knowledgeUniverseLibraryWorkspaceHttpRestExpanded =
    runtime.libraryWorkspaceHttpRestExpanded;
  surface.knowledgeUniverseLibraryWorkspaceDatasetImportTab =
    runtime.libraryWorkspaceDatasetImportTab;
  surface.knowledgeUniverseLibraryWorkspaceDatasetFileAttachment =
    runtime.libraryWorkspaceDatasetFileAttachment;
  surface.knowledgeUniverseLibraryWorkspaceDatasetPreview = runtime.libraryWorkspaceDatasetPreview;
  surface.knowledgeUniverseLibraryWorkspaceDatasetPreviewError =
    runtime.libraryWorkspaceDatasetPreviewError;
  surface.knowledgeUniverseLibraryWorkspaceUrlImportMode = runtime.libraryWorkspaceUrlImportMode;
  surface.knowledgeUniverseLibraryWorkspaceUrlImportText = runtime.libraryWorkspaceUrlImportText;
  surface.knowledgeUniverseLibraryWorkspaceUrlImportAdvancedOpen =
    runtime.libraryWorkspaceUrlImportAdvancedOpen;
  surface.knowledgeUniverseLibraryWorkspaceUrlSyncSchedule =
    runtime.libraryWorkspaceUrlSyncSchedule;
  surface.knowledgeUniverseLibraryWorkspaceUrlStripNavAds = runtime.libraryWorkspaceUrlStripNavAds;
  surface.knowledgeUniverseLibraryWorkspaceUrlMainContentOnly =
    runtime.libraryWorkspaceUrlMainContentOnly;
  surface.knowledgeUniverseLibraryWorkspaceNoteTags = runtime.libraryWorkspaceNoteTags;
  surface.knowledgeUniverseLibraryWorkspaceNoteTagDraft = runtime.libraryWorkspaceNoteTagDraft;
  surface.knowledgeUniverseLibraryWorkspaceNoteTagSuggestionsOpen =
    runtime.libraryWorkspaceNoteTagSuggestionsOpen;
  surface.knowledgeUniverseLibraryWorkspaceNoteTagHistory = runtime.libraryWorkspaceNoteTagHistory;
  surface.knowledgeUniverseLibraryWorkspaceNoteAiBusy = runtime.libraryWorkspaceNoteAiBusy;
  surface.knowledgeUniverseLibraryWorkspaceFileImportItems =
    runtime.libraryWorkspaceFileImportItems;
  surface.knowledgeUniverseLibraryWorkspaceFileImportAdvancedOpen =
    runtime.libraryWorkspaceFileImportAdvancedOpen;
  surface.knowledgeUniverseLibraryWorkspaceFileChunkingStrategy =
    runtime.libraryWorkspaceFileChunkingStrategy;
  surface.knowledgeUniverseLibraryWorkspaceFileOcrEnabled = runtime.libraryWorkspaceFileOcrEnabled;
  runtime.chatScopeSyncKey = syncKnowledgeUniverseSelectionToChatHost(
    state as KnowledgeUniverseChatScopeHost,
    runtime,
  );
}

function ensureSelectedKnowledgeBase(state: KnowledgeUniverseSession) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const preferredId = readPreferredKnowledgeBaseId();
  if (
    preferredId &&
    runtime.knowledgeBases.some((item) => item.id === preferredId) &&
    runtime.selectedKnowledgeBaseId !== preferredId
  ) {
    runtime.selectedKnowledgeBaseId = preferredId;
    return;
  }
  if (
    runtime.selectedKnowledgeBaseId &&
    !runtime.knowledgeBases.some((item) => item.id === runtime.selectedKnowledgeBaseId)
  ) {
    runtime.selectedKnowledgeBaseId = runtime.knowledgeBases[0]?.id ?? null;
  } else if (!runtime.selectedKnowledgeBaseId && runtime.knowledgeBases[0]) {
    runtime.selectedKnowledgeBaseId = runtime.knowledgeBases[0].id;
  }
  if (runtime.selectedKnowledgeBaseId) {
    writeKnowledgeUniverseUiPrefs({ selectedKnowledgeBaseId: runtime.selectedKnowledgeBaseId });
    expandKnowledgeBaseInTree(runtime, runtime.selectedKnowledgeBaseId);
  }
}

export function setKnowledgeUniverseSelectedKnowledgeBase(
  state: AppPortState,
  kbId: string | null,
  options?: { preserveHomeFocus?: boolean },
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.selectedKnowledgeBaseId = kbId;
  const preserveHomeFocus = options?.preserveHomeFocus === true;
  if (!preserveHomeFocus) {
    // Folder/space select clears document ego so relationships reload as library panorama.
    runtime.homeFocus = kbId ? { kind: "knowledge-base", id: kbId, kbId } : null;
    runtime.selectedNodeId = null;
    runtime.selectedObject = null;
    runtime.relatedGroups = null;
  }
  if (!kbId) {
    runtime.searchScope = "workspace";
    runtime.libraryWorkspaceDocuments = [];
    runtime.libraryWorkspaceSources = [];
    runtime.libraryWorkspaceSnippets = [];
    runtime.libraryWorkspaceRecycleDocuments = [];
    runtime.libraryWorkspaceEvictedChunks = [];
    runtime.libraryWorkspaceWebPages = [];
    runtime.libraryWorkspaceDatasets = [];
    runtime.libraryWorkspaceAgentKnowledge = [];
    runtime.libraryWorkspaceMembers = [];
  }
  if (kbId) {
    writeKnowledgeUniverseUiPrefs({ selectedKnowledgeBaseId: kbId });
    expandKnowledgeBaseInTree(runtime, kbId);
  }
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  void import("./knowledge-universe.ts").then((module) => {
    void module.loadKnowledgeUniverseGovernance(state);
    if (!preserveHomeFocus) {
      void module.refreshKnowledgeUniverseHome(state);
    }
  });
  if (kbId) {
    void refreshLibraryWorkspaceAfterKbMutation(state);
  }
}

export function setKnowledgeUniverseLibraryWorkspaceContentTab(
  state: AppPortState,
  tab: LibraryWorkspaceContentTab,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceContentTab = tab;
  writeKnowledgeUniverseUiPrefs({ libraryWorkspaceContentTab: tab });
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  if (tab === "snippets" && runtime.selectedKnowledgeBaseId) {
    void loadLibraryWorkspaceSnippets(state);
  }
  if (tab === "recycle" && runtime.selectedKnowledgeBaseId) {
    void loadLibraryWorkspaceRecycle(state);
  }
  if (tab === "web" && runtime.selectedKnowledgeBaseId) {
    void loadLibraryWorkspaceWebPages(state);
  }
  if (tab === "datasets" && runtime.selectedKnowledgeBaseId) {
    void loadLibraryWorkspaceDatasets(state);
  }
  if (tab === "agent" && runtime.selectedKnowledgeBaseId) {
    void loadLibraryWorkspaceAgentKnowledge(state);
  }
}

export function setKnowledgeUniverseLibraryWorkspaceMaterialsKindFilter(
  state: AppPortState,
  filter: import("../ports/employee/views/home-page-contracts.ts").LibraryWorkspaceMaterialsKindFilter,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceMaterialsKindFilter = filter;
  writeKnowledgeUniverseUiPrefs({ libraryWorkspaceMaterialsKindFilter: filter });
  syncWorkspaceToAppState(state);
  requestUpdate(state);
}

export function setKnowledgeUniverseLibraryWorkspaceInviteDrawerOpen(
  state: AppPortState,
  open: boolean,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceInviteDrawerOpen = open;
  if (!open) {
    runtime.libraryWorkspaceInviteEmail = "";
    runtime.libraryWorkspaceInviteRole = "viewer";
  }
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  if (open && runtime.selectedKnowledgeBaseId) {
    void loadLibraryWorkspaceMembers(state);
  }
}

export function setKnowledgeUniverseLibraryWorkspaceInviteEmail(
  state: AppPortState,
  email: string,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceInviteEmail = email;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
}

export function setKnowledgeUniverseLibraryWorkspaceInviteRole(
  state: AppPortState,
  role: import("../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseMemberRoleDto,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceInviteRole = role;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
}

export function notifyLibraryWorkspaceInvite(state: AppPortState) {
  setKnowledgeUniverseLibraryWorkspaceInviteDrawerOpen(state, true);
}

export async function submitLibraryWorkspaceInvite(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = runtime.selectedKnowledgeBaseId;
  const email = runtime.libraryWorkspaceInviteEmail.trim();
  if (!kbId) {
    runtime.workspaceHint = workspaceMessageDetachSelectLibrary();
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  if (!email) {
    runtime.workspaceHint = workspaceMessageInviteEmailRequired();
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  runtime.workspaceBusy = true;
  runtime.workspaceError = null;
  runtime.workspaceHint = null;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    await gateway.inviteKnowledgeBaseMember({
      knowledgeBaseId: kbId,
      email,
      role: runtime.libraryWorkspaceInviteRole,
    });
    runtime.workspaceNotice = workspaceNoticeInviteSent(email);
    runtime.libraryWorkspaceInviteEmail = "";
    await loadLibraryWorkspaceMembers(state);
  } catch {
    runtime.workspaceError = workspaceMessageInviteFailed();
  } finally {
    runtime.workspaceBusy = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
  }
}

export function startLibraryWorkspaceInlineRename(state: AppPortState, kbId: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kb = runtime.knowledgeBases.find((item) => item.id === kbId);
  if (!kb || isReservedDeliverableKnowledgeBase(kb)) {
    return;
  }
  if (runtime.selectedKnowledgeBaseId !== kbId) {
    setKnowledgeUniverseSelectedKnowledgeBase(state, kbId);
  }
  runtime.libraryWorkspaceInlineRenameKbId = kbId;
  runtime.libraryWorkspaceSettingsKbId = kbId;
  runtime.libraryWorkspaceSettingsTitle = kb.title;
  runtime.workspaceHint = null;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
}

export function cancelLibraryWorkspaceInlineRename(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceInlineRenameKbId = null;
  runtime.libraryWorkspaceSettingsKbId = null;
  runtime.libraryWorkspaceSettingsTitle = "";
  syncWorkspaceToAppState(state);
  requestUpdate(state);
}

export function setKnowledgeUniverseLibraryWorkspaceSettingsTitle(
  state: AppPortState,
  title: string,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceSettingsTitle = title;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
}

export async function submitLibraryWorkspaceRename(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = runtime.libraryWorkspaceSettingsKbId ?? runtime.selectedKnowledgeBaseId;
  const title = runtime.libraryWorkspaceSettingsTitle.trim();
  if (!kbId) {
    runtime.workspaceHint = workspaceMessageDeleteSelectLibrary();
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  if (!title) {
    runtime.workspaceHint = workspaceMessageRenameEmptyTitle();
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  runtime.workspaceBusy = true;
  runtime.workspaceError = null;
  runtime.workspaceHint = null;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    await gateway.updateKnowledgeBase({ knowledgeBaseId: kbId, title });
    runtime.workspaceNotice = workspaceNoticeRenamed(title);
    cancelLibraryWorkspaceInlineRename(state);
    await loadKnowledgeUniverseWorkspace(state);
    const { refreshKnowledgeUniverseHome } = await import("./knowledge-universe.ts");
    await refreshKnowledgeUniverseHome(state);
  } catch {
    runtime.workspaceError = workspaceMessageRenameFailed();
  } finally {
    runtime.workspaceBusy = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
  }
}

export async function deleteLibraryWorkspace(state: AppPortState, kbId: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kb = runtime.knowledgeBases.find((item) => item.id === kbId);
  if (kb && isReservedDeliverableKnowledgeBase(kb)) {
    return;
  }
  runtime.libraryWorkspaceSettingsKbId = kbId;
  runtime.libraryWorkspaceSettingsDeleteConfirm = true;
  await submitLibraryWorkspaceDelete(state);
}

export async function submitLibraryWorkspaceDelete(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = runtime.libraryWorkspaceSettingsKbId ?? runtime.selectedKnowledgeBaseId;
  if (!kbId) {
    runtime.workspaceHint = workspaceMessageDeleteSelectLibrary();
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  if (!runtime.libraryWorkspaceSettingsDeleteConfirm) {
    runtime.workspaceHint = workspaceMessageDeleteConfirmRequired();
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  const deletedTitle = runtime.knowledgeBases.find((item) => item.id === kbId)?.title ?? kbId;
  runtime.workspaceBusy = true;
  runtime.workspaceError = null;
  runtime.workspaceHint = null;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    await gateway.deleteKnowledgeBase({ knowledgeBaseId: kbId });
    removeKnowledgeBaseFromUiPrefs(kbId);
    cancelLibraryWorkspaceInlineRename(state);
    runtime.libraryWorkspaceSettingsKbId = null;
    runtime.libraryWorkspaceSettingsDeleteConfirm = false;
    runtime.workspaceNotice = workspaceNoticeDeleted(deletedTitle);
    await loadKnowledgeUniverseWorkspace(state);
    const { refreshKnowledgeUniverseHome } = await import("./knowledge-universe.ts");
    await refreshKnowledgeUniverseHome(state);
  } catch {
    runtime.workspaceError = workspaceMessageDeleteFailed();
  } finally {
    runtime.workspaceBusy = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
  }
}

export function notifyLibraryWorkspaceTabActionUnavailable(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.workspaceNotice = workspaceNoticeTabActionComingSoon();
  runtime.workspaceHint = null;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
}

export async function loadLibraryWorkspaceDocuments(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = runtime.selectedKnowledgeBaseId;
  if (!kbId) {
    runtime.libraryWorkspaceDocuments = [];
    runtime.libraryWorkspaceSources = [];
    runtime.libraryWorkspaceDocumentsLoading = false;
    runtime.libraryWorkspaceSourcesLoading = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  runtime.libraryWorkspaceDocumentsLoading = true;
  runtime.libraryWorkspaceSourcesLoading = true;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const plane =
      runtime.libraryWorkspaceSourcesPlaneFilter === "all"
        ? undefined
        : runtime.libraryWorkspaceSourcesPlaneFilter;
    const response = await gateway.listKnowledgeBaseSources({
      knowledgeBaseId: kbId,
      ...(plane ? { plane } : {}),
    });
    runtime.libraryWorkspaceSources = cabinTreeSources(response.sources);
    runtime.libraryWorkspaceDocuments = runtime.libraryWorkspaceSources
      .filter((item) => item.documentId)
      .map((item) => ({
        docId: item.documentId!,
        title: item.title,
        contentType: null,
        updatedAtMs: item.updatedAtMs,
        indexed: item.status === "indexed",
      }));
    cacheTreeDocuments(
      runtime,
      kbId,
      runtime.libraryWorkspaceDocuments,
      runtime.libraryWorkspaceSources,
    );
    const visibleDocIds = new Set(
      runtime.libraryWorkspaceSources
        .map((item) => item.documentId?.trim())
        .filter((id): id is string => Boolean(id)),
    );
    runtime.libraryWorkspaceSelectedDocumentIds =
      runtime.libraryWorkspaceSelectedDocumentIds.filter((id) => visibleDocIds.has(id));
  } catch {
    runtime.libraryWorkspaceSources = [];
    runtime.libraryWorkspaceDocuments = [];
    runtime.libraryWorkspaceSelectedDocumentIds = [];
    runtime.workspaceHint = resolveWorkspaceLoadError(new Error("sources failed"));
  } finally {
    runtime.libraryWorkspaceDocumentsLoading = false;
    runtime.libraryWorkspaceSourcesLoading = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
  }
}

export function setKnowledgeUniverseLibraryWorkspaceSourcesPlaneFilter(
  state: AppPortState,
  filter: import("../ports/employee/views/home-page-contracts.ts").LibraryWorkspaceSourcesPlaneFilter,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceSourcesPlaneFilter = filter;
  runtime.libraryWorkspaceSelectedDocumentIds = [];
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  if (runtime.selectedKnowledgeBaseId) {
    void loadLibraryWorkspaceDocuments(state);
  }
}

function listDeletableLibraryDocumentIds(state: AppPortState): string[] {
  const runtime = getKnowledgeUniverseRuntime(state);
  const ids: string[] = [];
  for (const item of runtime.libraryWorkspaceSources) {
    const documentId = item.documentId?.trim();
    if (!documentId || item.plane === "active") {
      continue;
    }
    ids.push(documentId);
  }
  return ids;
}

export function toggleLibraryWorkspaceDocumentSelection(state: AppPortState, documentId: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const trimmed = documentId.trim();
  if (!trimmed) {
    return;
  }
  const selected = new Set(runtime.libraryWorkspaceSelectedDocumentIds);
  if (selected.has(trimmed)) {
    selected.delete(trimmed);
  } else {
    selected.add(trimmed);
  }
  runtime.libraryWorkspaceSelectedDocumentIds = [...selected];
  syncWorkspaceToAppState(state);
  requestUpdate(state);
}

export function setLibraryWorkspaceDocumentSelectionAll(state: AppPortState, selected: boolean) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceSelectedDocumentIds = selected
    ? listDeletableLibraryDocumentIds(state)
    : [];
  syncWorkspaceToAppState(state);
  requestUpdate(state);
}

export function clearLibraryWorkspaceDocumentSelection(state: AppPortState) {
  setLibraryWorkspaceDocumentSelectionAll(state, false);
}

function resolveDeleteErrorMessage(error: unknown): string {
  if (error instanceof GatewayRequestError) {
    const message = error.message.trim();
    if (message) {
      return message;
    }
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return workspaceMessageDeleteFailed();
}

export async function loadLibraryWorkspaceSnippets(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = runtime.selectedKnowledgeBaseId;
  if (!kbId) {
    runtime.libraryWorkspaceSnippets = [];
    runtime.libraryWorkspaceSnippetsLoading = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  runtime.libraryWorkspaceSnippetsLoading = true;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const response = await gateway.listKnowledgeBaseSnippets({
      knowledgeBaseId: kbId,
      limit: 24,
    });
    runtime.libraryWorkspaceSnippets = response.snippets;
  } catch {
    runtime.libraryWorkspaceSnippets = [];
    runtime.workspaceHint = resolveWorkspaceLoadError(new Error("snippets failed"));
  } finally {
    runtime.libraryWorkspaceSnippetsLoading = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
  }
}

export async function refreshLibraryWorkspaceAfterKbMutation(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!runtime.selectedKnowledgeBaseId) {
    return;
  }
  await Promise.all([
    loadLibraryWorkspaceDocuments(state),
    loadLibraryWorkspaceSnippets(state),
    loadLibraryWorkspaceMembers(state),
    runtime.libraryWorkspaceContentTab === "recycle"
      ? loadLibraryWorkspaceRecycle(state)
      : Promise.resolve(),
    runtime.libraryWorkspaceContentTab === "web"
      ? loadLibraryWorkspaceWebPages(state)
      : Promise.resolve(),
    runtime.libraryWorkspaceContentTab === "datasets"
      ? loadLibraryWorkspaceDatasets(state)
      : Promise.resolve(),
    runtime.libraryWorkspaceContentTab === "agent"
      ? loadLibraryWorkspaceAgentKnowledge(state)
      : Promise.resolve(),
  ]);
}

export async function loadLibraryWorkspaceWebPages(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = runtime.selectedKnowledgeBaseId;
  if (!kbId) {
    runtime.libraryWorkspaceWebPages = [];
    runtime.libraryWorkspaceWebPagesLoading = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  runtime.libraryWorkspaceWebPagesLoading = true;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const response = await gateway.listKnowledgeBaseWebPages({ knowledgeBaseId: kbId });
    runtime.libraryWorkspaceWebPages = response.webPages;
  } catch {
    runtime.libraryWorkspaceWebPages = [];
    runtime.workspaceHint = resolveWorkspaceLoadError(new Error("web pages failed"));
  } finally {
    runtime.libraryWorkspaceWebPagesLoading = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
  }
}

export async function loadLibraryWorkspaceDatasets(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = runtime.selectedKnowledgeBaseId;
  if (!kbId) {
    runtime.libraryWorkspaceDatasets = [];
    runtime.libraryWorkspaceDatasetsLoading = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  runtime.libraryWorkspaceDatasetsLoading = true;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const response = await gateway.listKnowledgeBaseDatasets({ knowledgeBaseId: kbId });
    runtime.libraryWorkspaceDatasets = response.datasets;
  } catch {
    runtime.libraryWorkspaceDatasets = [];
    runtime.workspaceHint = resolveWorkspaceLoadError(new Error("datasets failed"));
  } finally {
    runtime.libraryWorkspaceDatasetsLoading = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
  }
}

export async function setLibraryWebRefreshPolicy(
  state: AppPortState,
  params: { url: string; docId?: string | null; enabled: boolean },
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = runtime.selectedKnowledgeBaseId;
  if (!kbId || !params.url) {
    return;
  }
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    await gateway.setWebRefreshPolicy({
      knowledgeBaseId: kbId,
      url: params.url,
      docId: params.docId ?? null,
      enabled: params.enabled,
    });
  } catch {
    runtime.workspaceHint = resolveWorkspaceLoadError(new Error("web refresh policy failed"));
  } finally {
    await loadLibraryWorkspaceWebPages(state);
  }
}

export async function loadLibraryWorkspaceAgentKnowledge(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = runtime.selectedKnowledgeBaseId;
  if (!kbId) {
    runtime.libraryWorkspaceAgentKnowledge = [];
    runtime.libraryWorkspaceAgentKnowledgeLoading = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  runtime.libraryWorkspaceAgentKnowledgeLoading = true;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const response = await gateway.listKnowledgeBaseAgentKnowledge({ knowledgeBaseId: kbId });
    runtime.libraryWorkspaceAgentKnowledge = response.items;
  } catch {
    runtime.libraryWorkspaceAgentKnowledge = [];
    runtime.workspaceHint = resolveWorkspaceLoadError(new Error("agent knowledge failed"));
  } finally {
    runtime.libraryWorkspaceAgentKnowledgeLoading = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
  }
}

/**
 * One-click LLM generation: summarize the active chat session into the selected knowledge
 * space (conversation_summary + auto_sop), then reload the typed agent-knowledge listing.
 */
export async function generateLibraryAgentKnowledge(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = runtime.selectedKnowledgeBaseId;
  if (!kbId || runtime.libraryWorkspaceAgentKnowledgeLoading) {
    return;
  }
  const sessionKey = (state.sessionKey ?? "").trim();
  if (!sessionKey) {
    runtime.workspaceHint = resolveWorkspaceLoadError(new Error("no active session"));
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  runtime.libraryWorkspaceAgentKnowledgeLoading = true;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    await gateway.generateAgentKnowledge({ knowledgeBaseId: kbId, sessionKey });
  } catch {
    runtime.workspaceHint = resolveWorkspaceLoadError(
      new Error("agent knowledge generation failed"),
    );
  } finally {
    // loadLibraryWorkspaceAgentKnowledge resets the loading flag, syncs, and re-renders.
    await loadLibraryWorkspaceAgentKnowledge(state);
  }
}

export async function loadLibraryWorkspaceMembers(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = runtime.selectedKnowledgeBaseId;
  if (!kbId) {
    runtime.libraryWorkspaceMembers = [];
    runtime.libraryWorkspaceMembersLoading = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  runtime.libraryWorkspaceMembersLoading = true;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const response = await gateway.listKnowledgeBaseMembers({ knowledgeBaseId: kbId });
    runtime.libraryWorkspaceMembers = response.members;
  } catch {
    runtime.libraryWorkspaceMembers = [];
  } finally {
    runtime.libraryWorkspaceMembersLoading = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
  }
}

export async function loadLibraryWorkspaceRecycle(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = runtime.selectedKnowledgeBaseId;
  if (!kbId) {
    runtime.libraryWorkspaceRecycleDocuments = [];
    runtime.libraryWorkspaceEvictedChunks = [];
    runtime.libraryWorkspaceRecycleLoading = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  runtime.libraryWorkspaceRecycleLoading = true;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const response = await gateway.listKnowledgeBaseRecycle({ knowledgeBaseId: kbId });
    runtime.libraryWorkspaceRecycleDocuments = response.documents;
    runtime.libraryWorkspaceEvictedChunks = response.evicted ?? [];
  } catch {
    runtime.libraryWorkspaceRecycleDocuments = [];
    runtime.libraryWorkspaceEvictedChunks = [];
    runtime.workspaceHint = resolveWorkspaceLoadError(new Error("recycle failed"));
  } finally {
    runtime.libraryWorkspaceRecycleLoading = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
  }
}

export async function detachLibraryWorkspaceDocument(state: AppPortState, documentId: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = runtime.selectedKnowledgeBaseId;
  if (!kbId) {
    runtime.workspaceHint = workspaceMessageDetachSelectLibrary();
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  runtime.workspaceBusy = true;
  runtime.workspaceError = null;
  runtime.workspaceHint = null;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    await gateway.detachKnowledgeBaseDocument({ knowledgeBaseId: kbId, documentId });
    runtime.workspaceNotice = workspaceNoticeDocumentDetached();
    await refreshLibraryWorkspaceAfterKbMutation(state);
    const { refreshKnowledgeUniverseHome } = await import("./knowledge-universe.ts");
    await refreshKnowledgeUniverseHome(state);
  } catch {
    runtime.workspaceError = workspaceMessageDetachFailed();
  } finally {
    runtime.workspaceBusy = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
  }
}

export async function restoreLibraryWorkspaceDocument(state: AppPortState, documentId: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = runtime.selectedKnowledgeBaseId;
  if (!kbId) {
    runtime.workspaceHint = workspaceMessageDetachSelectLibrary();
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  runtime.workspaceBusy = true;
  runtime.workspaceError = null;
  runtime.workspaceHint = null;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    await gateway.restoreKnowledgeBaseDocument({ knowledgeBaseId: kbId, documentId });
    runtime.workspaceNotice = workspaceNoticeDocumentRestored();
    await refreshLibraryWorkspaceAfterKbMutation(state);
    const { refreshKnowledgeUniverseHome } = await import("./knowledge-universe.ts");
    await refreshKnowledgeUniverseHome(state);
  } catch {
    runtime.workspaceError = workspaceMessageRestoreFailed();
  } finally {
    runtime.workspaceBusy = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
  }
}

const PASSIVE_CONNECTOR_KINDS = new Set(["gitRepo", "cloudDrive", "mailAttachment"]);

function resolveSourceDescriptorId(item: {
  id: string;
  sourceDescriptorId?: string;
}): string | null {
  const fromField = item.sourceDescriptorId?.trim();
  if (fromField) {
    return fromField;
  }
  if (item.id.startsWith("binding:")) {
    const parsed = item.id.slice("binding:".length).trim();
    return parsed || null;
  }
  return null;
}

/**
 * Remove a bound passive/active source (云盘 / 本地文件夹 / API …) that has no
 * documentId — these rows previously had no delete affordance in the sources table.
 */
export async function ingestLibraryWorkspaceSource(
  state: AppPortState,
  item: {
    id: string;
    kind: string;
    sourceDescriptorId?: string;
  },
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = runtime.selectedKnowledgeBaseId;
  const descriptorId = resolveSourceDescriptorId(item);
  if (!kbId || !descriptorId) {
    runtime.workspaceHint = workspaceMessageDetachSelectLibrary();
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }

  runtime.workspaceBusy = true;
  runtime.workspaceError = null;
  runtime.workspaceHint = null;
  syncWorkspaceToAppState(state);
  requestUpdate(state);

  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const result = await gateway.ingestSource({
      sourceDescriptorId: descriptorId,
      knowledgeBaseId: kbId,
    });
    if (!result?.ok) {
      throw new Error(result?.reason ?? "ingestSource returned ok:false");
    }
    runtime.workspaceNotice = workspaceNoticeSourceIngested();
    await refreshLibraryWorkspaceAfterKbMutation(state);
    const { refreshKnowledgeUniverseHome } = await import("./knowledge-universe.ts");
    await refreshKnowledgeUniverseHome(state);
  } catch {
    runtime.workspaceError = workspaceMessageIngestFailed();
  } finally {
    runtime.workspaceBusy = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
  }
}

export async function unbindLibraryWorkspaceSource(
  state: AppPortState,
  item: {
    id: string;
    kind: string;
    sourceDescriptorId?: string;
  },
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = runtime.selectedKnowledgeBaseId;
  const descriptorId = resolveSourceDescriptorId(item);
  if (!kbId || !descriptorId) {
    runtime.workspaceHint = workspaceMessageDetachSelectLibrary();
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }

  const previousSources = [...runtime.libraryWorkspaceSources];
  runtime.libraryWorkspaceSources = runtime.libraryWorkspaceSources.filter(
    (entry) => entry.id !== item.id && entry.sourceDescriptorId !== descriptorId,
  );
  runtime.workspaceBusy = true;
  runtime.workspaceError = null;
  runtime.workspaceHint = null;
  syncWorkspaceToAppState(state);
  requestUpdate(state);

  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const assertOk = (result: unknown, label: string) => {
      if (
        result &&
        typeof result === "object" &&
        "ok" in result &&
        (result as { ok?: unknown }).ok === false
      ) {
        throw new Error(`${label} returned ok:false`);
      }
    };
    // Always remove the SourceDescriptor row first — that is what the sources table
    // lists. Dedicated connector/local-folder unbind is best-effort purge afterwards.
    // Older gateways may not implement knowledge.connector.* at all.
    const sourceResult = await gateway.unbindSource({ id: descriptorId });
    assertOk(sourceResult, "unbindSource");
    try {
      if (item.kind === "localFolder") {
        await gateway.unbindLocalFolder({
          sourceDescriptorId: descriptorId,
          purgeProjected: true,
        });
      } else if (PASSIVE_CONNECTOR_KINDS.has(item.kind) && gateway.unbindPassiveConnector) {
        await gateway.unbindPassiveConnector({
          sourceDescriptorId: descriptorId,
          purgeProjected: true,
        });
      }
    } catch {
      // Descriptor already removed; purge failure must not resurrect the row.
    }
    runtime.workspaceNotice = workspaceNoticeDocumentDeleted();
    await refreshLibraryWorkspaceAfterKbMutation(state);
    const { refreshKnowledgeUniverseHome } = await import("./knowledge-universe.ts");
    await refreshKnowledgeUniverseHome(state);
  } catch {
    runtime.libraryWorkspaceSources = previousSources;
    runtime.workspaceError = workspaceMessageDeleteFailed();
  } finally {
    runtime.workspaceBusy = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
  }
}

export async function deleteLibraryWorkspaceDocument(state: AppPortState, documentId: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = runtime.selectedKnowledgeBaseId;
  if (!kbId) {
    runtime.workspaceHint = workspaceMessageDetachSelectLibrary();
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  const previous = {
    knowledgeBases: runtime.knowledgeBases.map((item) => ({ ...item })),
    libraryWorkspaceSources: [...runtime.libraryWorkspaceSources],
    libraryWorkspaceDocuments: [...runtime.libraryWorkspaceDocuments],
    libraryWorkspaceSnippets: [...runtime.libraryWorkspaceSnippets],
    libraryWorkspaceRecycleDocuments: [...runtime.libraryWorkspaceRecycleDocuments],
    libraryWorkspaceWebPages: [...runtime.libraryWorkspaceWebPages],
    libraryWorkspaceDatasets: [...runtime.libraryWorkspaceDatasets],
    selectedKbSearchHighlightKey: runtime.selectedKbSearchHighlightKey,
  };

  const existedInSources = runtime.libraryWorkspaceSources.some(
    (item) => item.documentId === documentId,
  );
  runtime.libraryWorkspaceSources = runtime.libraryWorkspaceSources.filter(
    (item) => item.documentId !== documentId,
  );
  runtime.libraryWorkspaceDocuments = runtime.libraryWorkspaceDocuments.filter(
    (item) => item.docId !== documentId,
  );
  runtime.libraryWorkspaceSnippets = runtime.libraryWorkspaceSnippets.filter(
    (item) => item.docId !== documentId,
  );
  runtime.libraryWorkspaceRecycleDocuments = runtime.libraryWorkspaceRecycleDocuments.filter(
    (item) => item.docId !== documentId,
  );
  runtime.libraryWorkspaceWebPages = runtime.libraryWorkspaceWebPages.filter(
    (item) => item.docId !== documentId,
  );
  runtime.libraryWorkspaceDatasets = runtime.libraryWorkspaceDatasets.filter(
    (item) => item.docId !== documentId,
  );
  if (runtime.selectedKbSearchHighlightKey === documentId) {
    runtime.selectedKbSearchHighlightKey = null;
  }
  if (existedInSources) {
    runtime.knowledgeBases = runtime.knowledgeBases.map((item) =>
      item.id === kbId
        ? {
            ...item,
            documentCount: Math.max(0, item.documentCount - 1),
            updatedAtMs: Date.now(),
          }
        : item,
    );
  }
  runtime.workspaceBusy = true;
  runtime.workspaceError = null;
  runtime.workspaceHint = null;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    await gateway.deleteKnowledgeBaseDocument({ knowledgeBaseId: kbId, documentId });
    runtime.libraryWorkspaceSelectedDocumentIds =
      runtime.libraryWorkspaceSelectedDocumentIds.filter((id) => id !== documentId);
    runtime.workspaceNotice = workspaceNoticeDocumentDeleted();
    await refreshLibraryWorkspaceAfterKbMutation(state);
    const { refreshKnowledgeUniverseHome } = await import("./knowledge-universe.ts");
    await refreshKnowledgeUniverseHome(state);
  } catch (error) {
    runtime.knowledgeBases = previous.knowledgeBases;
    runtime.libraryWorkspaceSources = previous.libraryWorkspaceSources;
    runtime.libraryWorkspaceDocuments = previous.libraryWorkspaceDocuments;
    runtime.libraryWorkspaceSnippets = previous.libraryWorkspaceSnippets;
    runtime.libraryWorkspaceRecycleDocuments = previous.libraryWorkspaceRecycleDocuments;
    runtime.libraryWorkspaceWebPages = previous.libraryWorkspaceWebPages;
    runtime.libraryWorkspaceDatasets = previous.libraryWorkspaceDatasets;
    runtime.selectedKbSearchHighlightKey = previous.selectedKbSearchHighlightKey;
    runtime.workspaceError = resolveDeleteErrorMessage(error);
  } finally {
    runtime.workspaceBusy = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
  }
}

export async function deleteSelectedLibraryWorkspaceDocuments(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const documentIds = [
    ...new Set(runtime.libraryWorkspaceSelectedDocumentIds.map((id) => id.trim())),
  ].filter(Boolean);
  if (documentIds.length === 0) {
    runtime.workspaceHint = workspaceMessageDetachSelectLibrary();
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  runtime.workspaceBusy = true;
  runtime.workspaceError = null;
  runtime.workspaceHint = null;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  let deleted = 0;
  let lastError: unknown = null;
  for (const documentId of documentIds) {
    try {
      await deleteLibraryWorkspaceDocument(state, documentId);
      const after = getKnowledgeUniverseRuntime(state);
      if (after.workspaceError) {
        lastError = new Error(after.workspaceError);
        break;
      }
      deleted += 1;
    } catch (error) {
      lastError = error;
      break;
    }
  }
  const after = getKnowledgeUniverseRuntime(state);
  after.libraryWorkspaceSelectedDocumentIds = after.libraryWorkspaceSelectedDocumentIds.filter(
    (id) => !documentIds.slice(0, deleted).includes(id),
  );
  if (lastError) {
    after.workspaceError =
      deleted > 0
        ? t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.deleteSelectedPartialFailed", {
            deleted: String(deleted),
            total: String(documentIds.length),
            error: resolveDeleteErrorMessage(lastError),
          })
        : resolveDeleteErrorMessage(lastError);
  } else {
    after.workspaceNotice =
      documentIds.length > 1
        ? t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.noticeDeletedSelected", {
            count: String(documentIds.length),
          })
        : workspaceNoticeDocumentDeleted();
  }
  after.workspaceBusy = false;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
}

export function setKnowledgeUniverseNewKnowledgeBaseTitle(state: AppPortState, title: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.newKnowledgeBaseTitle = title;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
}

export function setKnowledgeUniverseNewKnowledgeBaseDescription(
  state: AppPortState,
  description: string,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.newKnowledgeBaseDescription = description;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
}

export function setKnowledgeUniverseNewKnowledgeBaseVisibility(
  state: AppPortState,
  visibility: import("../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseSummary["visibility"],
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.newKnowledgeBaseVisibility = visibility;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
}

export async function createKnowledgeUniverseFolderInSection(
  state: AppPortState,
  visibility: import("../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseSummary["visibility"],
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!canCreateKnowledgeFolderInSection(runtime.knowledgeBases, visibility)) {
    runtime.workspaceNotice = workspaceNoticeImportReadOnly();
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  setKnowledgeUniverseNewKnowledgeBaseVisibility(state, visibility);
  runtime.workspaceBusy = true;
  runtime.workspaceError = null;
  runtime.workspaceHint = null;
  runtime.workspaceNotice = null;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  try {
    const { libraryCreateDefaultQuickTitle } =
      await import("./knowledge-universe-personal-messages.ts");
    const gateway = createKnowledgeUniverseGateway(state.client);
    const created = await gateway.createKnowledgeBase({
      title: libraryCreateDefaultQuickTitle(),
      visibility,
    });
    runtime.newKnowledgeBaseTitle = "";
    runtime.newKnowledgeBaseDescription = "";
    runtime.selectedKnowledgeBaseId = created.knowledgeBase.id;
    writeKnowledgeUniverseUiPrefs({ selectedKnowledgeBaseId: created.knowledgeBase.id });
    runtime.knowledgeBases = [
      ...runtime.knowledgeBases.filter((item) => item.id !== created.knowledgeBase.id),
      created.knowledgeBase,
    ];
    await loadKnowledgeUniverseWorkspace(state);
    startLibraryWorkspaceInlineRename(state, created.knowledgeBase.id);
  } catch {
    runtime.workspaceError = workspaceMessageCreateFailed();
  } finally {
    runtime.workspaceBusy = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
  }
}

export function setKnowledgeUniverseKbSearchQuery(state: AppPortState, query: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.kbSearchQuery = query;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
}

export function setKnowledgeUniverseOpenDeliverableMoreMenu(
  state: AppPortState,
  deliverableId: string | null,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.openDeliverableMoreMenuId = deliverableId;
  state.knowledgeUniverseOpenDeliverableMoreMenuId = deliverableId;
  if (typeof state.requestUpdate === "function") {
    state.requestUpdate();
  }
}

export function setKnowledgeUniverseDeliverableStatusFilter(
  state: AppPortState,
  filter: WorkspaceDeliverableStatusFilter,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.workspaceDeliverableStatusFilter = filter;
  runtime.workspaceDeliverablesExpanded = false;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
}

const WORKSPACE_DELIVERABLES_PREVIEW_LIMIT = 12;

export async function loadKnowledgeUniverseWorkspace(
  state: KnowledgeUniverseSession,
  options?: { deliverablesLimit?: number },
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.workspaceBusy = true;
  runtime.workspaceError = null;
  runtime.workspaceHint = null;
  runtime.workspaceDeliverablesUnavailable = false;
  syncWorkspaceToAppState(state);
  requestUpdate(state);

  const gateway = createKnowledgeUniverseGateway(state.client);
  let librariesFailed = false;

  try {
    const bases = await gateway.listKnowledgeBases();
    runtime.knowledgeBases = bases.knowledgeBases;
    ensureSelectedKnowledgeBase(state);
  } catch (error) {
    librariesFailed = true;
    // Keep any previously loaded libraries so a transient RPC/auth race does not
    // blank the knowledge universe tree after a successful earlier load.
    if (runtime.knowledgeBases.length === 0) {
      runtime.selectedKnowledgeBaseId = null;
    }
    runtime.workspaceError = resolveWorkspaceLoadError(error);
  }

  try {
    const deliverables = await gateway.listWorkspaceDeliverables({
      limit: options?.deliverablesLimit ?? WORKSPACE_DELIVERABLES_PREVIEW_LIMIT,
    });
    runtime.workspaceDeliverables = deliverables.deliverables;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runtime.workspaceDeliverables = [];
    if (isDeliverablesUserContextError(message)) {
      runtime.workspaceDeliverablesUnavailable = true;
    } else if (!librariesFailed) {
      runtime.workspaceHint = resolveWorkspaceLoadError(error);
    }
  } finally {
    runtime.workspaceBusy = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    if (runtime.selectedKnowledgeBaseId) {
      void refreshLibraryWorkspaceAfterKbMutation(
        state as import("../app-port-state.ts").AppPortState,
      );
    }
    preloadFavoriteFunnelDocuments(state as import("../app-port-state.ts").AppPortState);
  }
}

export async function createKnowledgeUniverseKnowledgeBase(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const title = runtime.newKnowledgeBaseTitle.trim();
  if (!title) {
    runtime.workspaceHint = workspaceMessageCreateEmptyTitle();
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  runtime.workspaceBusy = true;
  runtime.workspaceError = null;
  runtime.workspaceHint = null;
  runtime.workspaceNotice = null;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const created = await gateway.createKnowledgeBase({
      title,
      description: runtime.newKnowledgeBaseDescription.trim() || undefined,
      visibility: runtime.newKnowledgeBaseVisibility,
    });
    runtime.newKnowledgeBaseTitle = "";
    runtime.newKnowledgeBaseDescription = "";
    runtime.selectedKnowledgeBaseId = created.knowledgeBase.id;
    writeKnowledgeUniverseUiPrefs({ selectedKnowledgeBaseId: created.knowledgeBase.id });
    runtime.workspaceNotice = workspaceNoticeCreated(created.knowledgeBase.title);
    await loadKnowledgeUniverseWorkspace(state);
  } catch {
    runtime.workspaceError = workspaceMessageCreateFailed();
  } finally {
    runtime.workspaceBusy = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
  }
}

export async function searchKnowledgeUniverseKnowledgeBase(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = runtime.selectedKnowledgeBaseId;
  const query = runtime.kbSearchQuery.trim();
  if (!kbId) {
    runtime.workspaceHint = workspaceMessageSelectLibraryFirst();
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  if (!query) {
    runtime.workspaceHint = workspaceMessageKbSearchEmpty();
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  runtime.searchPanelOpen = true;
  runtime.workspaceBusy = true;
  runtime.workspaceError = null;
  runtime.workspaceHint = null;
  runtime.selectedKbSearchHighlightKey = null;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const response = await gateway.searchKnowledgeBase({
      knowledgeBaseId: kbId,
      query,
      limit: 8,
    });
    runtime.kbSearchEvidence = response.evidence;
    runtime.kbSearchMode = response.searchMode;
    runtime.kbSearchSubstringResults = response.substringMatches;
    runtime.workspaceNotice =
      response.searchMode === "indexed"
        ? workspaceNoticeKbSearchIndexed(response.evidence.length)
        : workspaceNoticeKbSearchSubstring(response.substringMatches.length);
  } catch {
    runtime.workspaceError = workspaceMessageKbSearchFailed();
    runtime.kbSearchEvidence = [];
    runtime.kbSearchSubstringResults = [];
    runtime.kbSearchMode = null;
  } finally {
    runtime.workspaceBusy = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
  }
}

export async function archiveKnowledgeUniverseDeliverable(
  state: AppPortState,
  deliverableId: string,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = runtime.selectedKnowledgeBaseId;
  if (!kbId) {
    runtime.workspaceHint = workspaceMessageArchiveSelectLibrary();
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  const deliverableTitle =
    runtime.workspaceDeliverables.find((item) => item.deliverableId === deliverableId)?.title ??
    runtime.workspaceDeliverableTrace?.deliverable.title ??
    "";
  runtime.workspaceBusy = true;
  runtime.workspaceError = null;
  runtime.workspaceHint = null;
  runtime.workspaceNotice = null;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const result = await gateway.attachWorkspaceDeliverable({
      deliverableId,
      knowledgeBaseId: kbId,
    });
    runtime.workspaceDeliverables = runtime.workspaceDeliverables.map((item) =>
      item.deliverableId === deliverableId
        ? { ...item, relatedKnowledgeBaseId: result.relatedKnowledgeBaseId }
        : item,
    );
    if (
      runtime.workspaceDeliverableTrace?.deliverableId === deliverableId &&
      runtime.workspaceDeliverableTrace
    ) {
      runtime.workspaceDeliverableTrace = {
        ...runtime.workspaceDeliverableTrace,
        deliverable: {
          ...runtime.workspaceDeliverableTrace.deliverable,
          relatedKnowledgeBaseId: result.relatedKnowledgeBaseId,
        },
      };
    }
    const kbTitle =
      resolveKnowledgeBaseDisplayTitle(runtime.knowledgeBases, kbId) ??
      runtime.knowledgeBases.find((item) => item.id === kbId)?.title ??
      "";
    await loadKnowledgeUniverseWorkspace(state);
    const { refreshKnowledgeUniverseHome } = await import("./knowledge-universe.ts");
    await refreshKnowledgeUniverseHome(state);
    if (deliverableTitle.trim()) {
      runtime.kbSearchQuery = deliverableTitle.trim();
      syncWorkspaceToAppState(state);
      requestUpdate(state);
      try {
        const search = await gateway.searchKnowledgeBase({
          knowledgeBaseId: kbId,
          query: deliverableTitle.trim(),
          limit: 5,
        });
        runtime.kbSearchEvidence = search.evidence;
        runtime.kbSearchMode = search.searchMode;
        runtime.kbSearchSubstringResults = search.substringMatches;
        const hitCount = search.evidence.length + search.substringMatches.length;
        runtime.workspaceNotice = workspaceNoticeArchivedWithRag(kbTitle, hitCount);
      } catch {
        runtime.workspaceNotice = workspaceNoticeArchived(kbTitle);
      }
    } else {
      runtime.workspaceNotice = workspaceNoticeArchived(kbTitle);
    }
    if (runtime.selectedWorkspaceSearchDeliverableId === deliverableId) {
      await loadKnowledgeUniverseDeliverableTrace(state);
    }
  } catch {
    runtime.workspaceError = workspaceMessageArchiveFailed();
  } finally {
    runtime.workspaceBusy = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
  }
}

/**
 * Permanently delete a deliverable (成果). Routes to the right backing store on the gateway
 * (personal skill asset for `skill:*`, otherwise the owning group's object storage), then
 * optimistically drops it from the list and refreshes the workspace + home surfaces.
 */
export async function deleteKnowledgeUniverseDeliverable(
  state: AppPortState,
  deliverableId: string,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const deliverableTitle =
    runtime.workspaceDeliverables.find((item) => item.deliverableId === deliverableId)?.title ??
    runtime.workspaceDeliverableTrace?.deliverable.title ??
    "";
  runtime.workspaceBusy = true;
  runtime.workspaceError = null;
  runtime.workspaceHint = null;
  runtime.workspaceNotice = null;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    await gateway.deleteWorkspaceDeliverable({ deliverableId });
    runtime.workspaceDeliverables = runtime.workspaceDeliverables.filter(
      (item) => item.deliverableId !== deliverableId,
    );
    if (runtime.selectedWorkspaceSearchDeliverableId === deliverableId) {
      runtime.selectedWorkspaceSearchDeliverableId = null;
      runtime.workspaceDeliverableTrace = null;
    }
    runtime.workspaceNotice = workspaceNoticeDeliverableDeleted(deliverableTitle);
    await loadKnowledgeUniverseWorkspace(state, { deliverablesLimit: 100 });
    const { refreshKnowledgeUniverseHome } = await import("./knowledge-universe.ts");
    await refreshKnowledgeUniverseHome(state);
  } catch (error) {
    runtime.workspaceError = error instanceof Error ? error.message : String(error);
  } finally {
    runtime.workspaceBusy = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
  }
}

export async function loadKnowledgeUniverseDeliverableTrace(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const deliverableId = runtime.selectedWorkspaceSearchDeliverableId;
  if (!deliverableId) {
    runtime.workspaceDeliverableTrace = null;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  runtime.workspaceDeliverableTraceLoading = true;
  runtime.workspaceError = null;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const response = await gateway.getWorkspaceDeliverableTrace({ deliverableId });
    runtime.workspaceDeliverableTrace = response.trace;
    const listed = runtime.workspaceDeliverables.find(
      (item) => item.deliverableId === deliverableId,
    );
    if (listed && response.trace.deliverable.relatedKnowledgeBaseId) {
      runtime.workspaceDeliverables = runtime.workspaceDeliverables.map((item) =>
        item.deliverableId === deliverableId
          ? {
              ...item,
              relatedKnowledgeBaseId:
                response.trace.deliverable.relatedKnowledgeBaseId ?? item.relatedKnowledgeBaseId,
            }
          : item,
      );
    }
  } catch {
    runtime.workspaceDeliverableTrace = null;
    runtime.workspaceHint = resolveWorkspaceLoadError(new Error("trace failed"));
  } finally {
    runtime.workspaceDeliverableTraceLoading = false;
    syncWorkspaceToAppState(state);
    requestUpdate(state);
  }
}

export function toggleKnowledgeUniversePinnedKnowledgeBase(state: AppPortState, kbId: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.pinnedKnowledgeBaseIds = togglePinnedKnowledgeBaseId(kbId);
  syncWorkspaceToAppState(state);
  requestUpdate(state);
}

export function toggleKnowledgeUniverseFavoriteKnowledgeBase(state: AppPortState, kbId: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.favoriteKnowledgeBaseIds = toggleFavoriteKnowledgeBaseId(kbId);
  syncWorkspaceToAppState(state);
  requestUpdate(state);
  if (runtime.favoriteKnowledgeBaseIds.includes(kbId)) {
    void ensureKnowledgeUniverseTreeDocuments(state, kbId);
  }
}

export function setKnowledgeUniverseLibraryWorkspaceImportOpen(
  state: AppPortState,
  open: boolean,
  options?: { lockSpace?: boolean },
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceImportOpen = open;
  if (open) {
    runtime.libraryWorkspaceImportLockSpace = options?.lockSpace ?? true;
  } else {
    runtime.libraryWorkspaceImportKind = null;
    runtime.libraryWorkspaceImportLockSpace = true;
  }
  syncWorkspaceToAppState(state);
  requestUpdate(state);
}

export function setKnowledgeUniverseLibraryWorkspaceImportKind(
  state: AppPortState,
  kind: SpaceImportKind | null,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceImportKind = kind;
  if (kind === "localFolder") {
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    void import("./knowledge-universe-local-folder.ts").then((module) =>
      module.loadKnowledgeUniverseLocalFolderStatus(state).then(() => requestUpdate(state)),
    );
    return;
  }
  // vaultSync kind retained for internal/future entry wiring only — not a product 录入知识 tab.
  if (kind === "vaultSync") {
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    void import("./knowledge-universe-vault-sync.ts").then((module) =>
      module.hydrateKnowledgeUniverseVaultSyncPanel(state).then(() => requestUpdate(state)),
    );
    return;
  }
  if (kind === "active") {
    runtime.libraryWorkspaceConnectorBindDraft = createEmptySpaceConnectorBindDraft();
    runtime.libraryWorkspaceConnectorCatalog = [];
    runtime.libraryWorkspaceConnectorCatalogLoading = false;
    runtime.libraryWorkspaceConnectorCatalogError = null;
    runtime.libraryWorkspaceConnectorCredentials = [];
    runtime.libraryWorkspaceConnectorCredentialsLoading = false;
    runtime.libraryWorkspaceConnectorProbeOk = null;
    runtime.libraryWorkspaceConnectorProbeMessage = null;
    runtime.libraryWorkspaceConnectorProbeBusy = false;
    runtime.libraryWorkspaceConnectorOAuthBusy = false;
    runtime.libraryWorkspaceConnectorOAuthNotice = null;
    runtime.libraryWorkspaceConnectorOAuthError = null;
    runtime.libraryWorkspaceConnectorOAuthSessionId = null;
    runtime.libraryWorkspaceConnectorOAuthSimulateAllowed = false;
    runtime.libraryWorkspaceHttpRestExpanded = false;
    runtime.libraryWorkspaceBindSourceKind = "api";
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    void import("./knowledge-universe-connector-bind.ts").then((module) =>
      module.loadKnowledgeUniverseConnectorCatalog(state),
    );
    return;
  }
  if (kind === "note") {
    Object.assign(runtime, createEmptyNoteImportState());
    runtime.libraryWorkspaceNoteTagHistory = readNoteTagHistory();
    runtime.personalCollectTitle = "";
    runtime.personalCollectSummary = "";
    runtime.personalCollectTags = "";
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  if (kind === "url") {
    Object.assign(runtime, createEmptyWebUrlImportState());
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  syncWorkspaceToAppState(state);
  requestUpdate(state);
}

export function setKnowledgeUniverseLibraryWorkspaceBindSourceDraft(
  state: AppPortState,
  field: "kind" | "title" | "endpoint",
  value: string,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (field === "kind") {
    runtime.libraryWorkspaceBindSourceKind = "api";
    syncWorkspaceToAppState(state);
    requestUpdate(state);
    return;
  }
  if (field === "title") {
    runtime.libraryWorkspaceBindSourceTitle = value;
  } else {
    runtime.libraryWorkspaceBindSourceEndpoint = value;
  }
  syncWorkspaceToAppState(state);
  requestUpdate(state);
}

export function notifyLibraryWorkspaceImportReadOnly(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.workspaceNotice = workspaceNoticeImportReadOnly();
  runtime.workspaceHint = null;
  syncWorkspaceToAppState(state);
  requestUpdate(state);
}
