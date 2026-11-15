import { parseAgentSessionKey } from "../../../../src/sessions/session-key-utils.ts";
import type { AppPortState } from "../app-port-state.ts";
import type {
  KnowledgePersonalCollectResponse,
  KnowledgePersonalDocumentAttachment,
} from "../capability/knowledge-universe/endpoints.ts";
import { loadKnowledgeUniverseHomeSnapshot } from "../capability/knowledge-universe/facade.ts";
import {
  createKnowledgeUniverseGateway,
  type KnowledgeUniverseRpcClient,
} from "../capability/knowledge-universe/gateway-client.ts";
import {
  buildHomeGraphViewModel,
  buildRadialGraphLayout,
} from "../capability/knowledge-universe/graph-layout.ts";
import { relationshipGraphToViewModel } from "../capability/knowledge-universe/graph-view-model.ts";
import {
  buildKnowledgeObjectIdCandidates,
  documentKnowledgeNodeId,
  findRelationshipNodeByObjectIdCandidates,
  nodeIdForKnowledgeObject,
  resolvePreferredKnowledgeObjectId,
} from "../capability/knowledge-universe/object-id.ts";
import {
  isSupportedPersonalDocument,
  readPersonalDocumentUpload,
} from "../capability/knowledge-universe/personal-document-upload.ts";
import type {
  ExternalDataSourceSummary,
  KnowledgeActionSuggestion,
  KnowledgeCapabilityPreviewState,
  KnowledgeCapabilityInvocationState,
  KnowledgeDiscoveryEvent,
  KnowledgeObject,
  KnowledgeRecommendationItem,
  KnowledgeRecentVisit,
  KnowledgeRelatedGroups,
  KnowledgeSourceBrowse,
  PersonalKnowledgeVersionDiff,
  PersonalKnowledgeVersionSummary,
} from "../capability/knowledge-universe/types.ts";
import type {
  KnowledgeBaseSummary,
  KnowledgeEvidenceDto,
  WorkspaceDeliverableDto,
  WorkspaceSearchGroup,
  WorkspaceSearchHit,
  WorkspaceSearchMode,
} from "../capability/knowledge-universe/workspace-endpoints.ts";
import {
  syncKnowledgeUniverseSelectionToChatHost,
  type KnowledgeUniverseChatScopeHost,
} from "../chat/knowledge-universe-chat-scope.ts";
import type {
  KnowledgeHomeFocus,
  KnowledgeUniverseBrowseSubTab,
  KnowledgeUniversePageTab,
  KnowledgeUniverseSearchScope,
  LibraryWorkspaceContentTab,
  WorkspaceDeliverableStatusFilter,
} from "../ports/employee/views/home-page-contracts.ts";
import { navigateKnowledgeUniverseAnchor } from "../views/knowledge-universe-anchor-nav.ts";
import { KNOWLEDGE_UNIVERSE_ANCHORS } from "../views/knowledge-universe-anchors.ts";
import { createEmptyFileImportState } from "../views/knowledge-universe-file-import.ts";
import { resolveAdoptedClaimChoice } from "../views/knowledge-universe-governance-claim-conflict.ts";
import {
  createEmptyNoteImportState,
  readNoteTagHistory,
} from "../views/knowledge-universe-note-import.ts";
import { findReservedDeliverableKnowledgeBase } from "../views/knowledge-universe-reserved-folders.ts";
import { createEmptySpaceConnectorBindDraft } from "../views/knowledge-universe-space-connector-bind.ts";
import {
  applyKnowledgeUniverseUiPrefs,
  readFavoriteKnowledgeBaseIds,
  readLibraryWorkspaceContentTab,
  readLibraryWorkspaceMaterialsKindFilter,
  readPinnedKnowledgeBaseIds,
  dismissHomeInsightsNotice,
  readHomeInsightsNoticeDismissed,
  normalizeKnowledgeUniverseBrowseSubTab,
  writeKnowledgeUniverseUiPrefs,
} from "../views/knowledge-universe-ui-prefs.ts";
import { createEmptyWebUrlImportState } from "../views/knowledge-universe-url-import.ts";
import {
  appendPersonalCompatWarnings,
  libraryCreateDefaultQuickTitle,
  personalDatasetDefaultTitle,
  personalMessageCollectFailed,
  personalMessageDatasetEmpty,
  personalMessageKnowledgeBaseRequired,
  personalMessageReadFileFailed,
  personalMessageSelectFileFirst,
  personalMessageUnsupportedFileType,
  personalMessageUploadFailed,
  personalMessageUrlRequired,
  personalNoticeCollected,
  personalNoticeDatasetImported,
  personalNoticeFileSelected,
  personalNoticeUploaded,
  personalNoticeWebCollected,
} from "./knowledge-universe-personal-messages.ts";
import {
  personalManageMessageLoadVersionsFailed,
  personalManageMessageTagsUpdateFailed,
  personalManageMessageVersionCompareFailed,
  personalManageNoticeTagsUpdated,
  runtimeMessageCapabilityRequestFailed,
  runtimeMessageEnterpriseAccessRequestFailed,
  runtimeMessageGovernanceIndexNotReady,
  runtimeMessageGovernanceTaskUpdateFailed,
  runtimeNoticeGovernanceClaimConflictDismissed,
  runtimeNoticeGovernanceClaimTruthAccepted,
  runtimeNoticeGovernanceTaskDismissed,
  runtimeNoticeGovernanceTaskResolved,
  runtimeMessageLoadGovernanceFailed,
  runtimeMessageLoadIssueGraphFailed,
  runtimeMessageLoadKnowledgeObjectFailed,
  runtimeMessageFromError,
  runtimeMessageLoadNodeDetailFailed,
  runtimeMessageLoadWorkbenchFailed,
  runtimeMessageRefreshWorkbenchFailed,
  runtimeMessageSearchWorkspaceFailed,
  runtimeNoticeCapabilityAccessSubmitted,
  runtimeNoticeEnterpriseAccessSubmitted,
} from "./knowledge-universe-runtime-messages.ts";
import {
  createKnowledgeUniverseKnowledgeBase,
  loadKnowledgeUniverseDeliverableTrace,
  loadKnowledgeUniverseWorkspace,
  searchKnowledgeUniverseKnowledgeBase,
  setKnowledgeUniverseNewKnowledgeBaseTitle,
  setKnowledgeUniverseSelectedKnowledgeBase,
} from "./knowledge-universe-workspace.ts";

export async function syncKnowledgeBaseAfterPersonalMutation(
  state: AppPortState,
  response: Pick<KnowledgePersonalCollectResponse, "knowledgeBaseId">,
) {
  const knowledgeBaseId = response.knowledgeBaseId?.trim();
  if (!knowledgeBaseId) {
    return;
  }
  const runtime = getKnowledgeUniverseRuntime(state);
  if (runtime.libraryWorkspaceImportOpen) {
    runtime.libraryWorkspaceImportOpen = false;
    runtime.libraryWorkspaceImportKind = null;
    runtime.libraryWorkspaceImportLockSpace = true;
  }
  await loadKnowledgeUniverseWorkspace(state);
  setKnowledgeUniverseSelectedKnowledgeBase(state, knowledgeBaseId);
  const { refreshLibraryWorkspaceAfterKbMutation } =
    await import("./knowledge-universe-workspace.ts");
  await refreshLibraryWorkspaceAfterKbMutation(state);
  syncToAppState(state, runtime);
}

export function requireSelectedKnowledgeBaseId(state: AppPortState): string | null {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = runtime.selectedKnowledgeBaseId?.trim() || null;
  if (!kbId) {
    runtime.personalActionError = personalMessageKnowledgeBaseRequired();
    syncToAppState(state, runtime);
    requestUpdate(state);
  }
  return kbId;
}

export type KnowledgeUniverseControllerState = {
  loading: boolean;
  /** True while the relation graph request for the current home load is in flight. */
  graphLoading: boolean;
  /** True while recommendations / actions / discovery for the current home load are in flight. */
  insightsLoading: boolean;
  error: string | null;
  query: string;
  homeFocus: KnowledgeHomeFocus | null;
  homeCockpitTab: import("../ports/employee/views/home-page-contracts.ts").KnowledgeHomeCockpitTab;
  documentReaderLoading: boolean;
  documentReaderSaving: boolean;
  documentReaderEditing: boolean;
  documentReaderDirty: boolean;
  documentReaderError: string | null;
  documentReaderDocKey: string | null;
  documentReaderPreview:
    | import("../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeDocumentPreviewResponse
    | null;
  documentReaderDraft: string;
  selectedNodeId: string | null;
  selectedObject: KnowledgeObject | null;
  sourceSummary: AppPortState["knowledgeUniverseSourceSummary"];
  graph: AppPortState["knowledgeUniverseGraph"];
  graphViewModel: AppPortState["knowledgeUniverseGraphViewModel"];
  searchResults: KnowledgeObject[];
  dataCapabilities: AppPortState["knowledgeUniverseDataCapabilities"];
  sourceBrowse: KnowledgeSourceBrowse;
  externalDataSources: ExternalDataSourceSummary[];
  personalCollectTitle: string;
  personalCollectSummary: string;
  personalCollectTags: string;
  personalCollectUrl: string;
  personalDatasetText: string;
  personalUploadAttachment: KnowledgePersonalDocumentAttachment | null;
  personalActionBusy: boolean;
  personalActionNotice: string | null;
  personalActionError: string | null;
  importProgress: { current: number; total: number; label: string } | null;
  accessRequestBusyCapabilityId: string | null;
  accessRequestBusyProjectionId: string | null;
  accessRequestNotice: string | null;
  capabilityPreview: KnowledgeCapabilityPreviewState | null;
  capabilityInvocation: KnowledgeCapabilityInvocationState | null;
  personalManageObjectId: string | null;
  personalManageObjectTitle: string | null;
  personalManageTags: string;
  personalManageBusy: boolean;
  personalManageNotice: string | null;
  personalVersions: PersonalKnowledgeVersionSummary[];
  personalVersionCompareFrom: string;
  personalVersionCompareTo: string;
  personalVersionDiff: PersonalKnowledgeVersionDiff | null;
  recommendations: KnowledgeRecommendationItem[];
  discoveryEvents: KnowledgeDiscoveryEvent[];
  actionSuggestions: KnowledgeActionSuggestion[];
  recentVisits: KnowledgeRecentVisit[];
  relatedGroups: KnowledgeRelatedGroups | null;
  homeInsightsDegraded: boolean;
  graphZoom: number;
  graphPanX: number;
  graphPanY: number;
  hoveredNodeId: string | null;
  hasLoaded: boolean;
  knowledgeBases: KnowledgeBaseSummary[];
  selectedKnowledgeBaseId: string | null;
  chatScopeSyncKey: string;
  kbSearchQuery: string;
  kbSearchEvidence: KnowledgeEvidenceDto[];
  kbSearchMode: "indexed" | "substring" | null;
  kbSearchSubstringResults: KnowledgeObject[];
  workspaceDeliverables: WorkspaceDeliverableDto[];
  workspaceDeliverableStatusFilter: WorkspaceDeliverableStatusFilter;
  workspaceBusy: boolean;
  workspaceNotice: string | null;
  workspaceError: string | null;
  workspaceHint: string | null;
  workspaceDeliverablesUnavailable: boolean;
  newKnowledgeBaseTitle: string;
  newKnowledgeBaseDescription: string;
  newKnowledgeBaseVisibility: import("../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseSummary["visibility"];
  workspaceDeliverableTrace:
    | import("../capability/knowledge-universe/workspace-endpoints.ts").WorkspaceDeliverableTraceDto
    | null;
  workspaceDeliverableTraceLoading: boolean;
  deliverableDetailFocus:
    | import("../capability/knowledge-universe/workspace-endpoints.ts").DeliverableDetailFocus
    | null;
  pinnedKnowledgeBaseIds: string[];
  favoriteKnowledgeBaseIds: string[];
  expandedKnowledgeBaseIds: string[];
  treeDocumentsByKbId: Record<
    string,
    import("../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseDocumentSummaryDto[]
  >;
  treeSourcesByKbId: Record<
    string,
    import("../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseSourceListItemDto[]
  >;
  treeDocumentsLoadingByKbId: Record<string, boolean>;
  libraryWorkspaceContentTab: LibraryWorkspaceContentTab;
  libraryWorkspaceMaterialsKindFilter: import("../ports/employee/views/home-page-contracts.ts").LibraryWorkspaceMaterialsKindFilter;
  libraryWorkspaceDocuments: import("../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseDocumentSummaryDto[];
  libraryWorkspaceDocumentsLoading: boolean;
  libraryWorkspaceSources: import("../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseSourceListItemDto[];
  libraryWorkspaceSourcesLoading: boolean;
  libraryWorkspaceSourcesPlaneFilter: import("../ports/employee/views/home-page-contracts.ts").LibraryWorkspaceSourcesPlaneFilter;
  /** Selected document ids in the library sources table (multi-select delete). */
  libraryWorkspaceSelectedDocumentIds: string[];
  libraryWorkspaceSnippets: import("../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseSnippetSummaryDto[];
  libraryWorkspaceSnippetsLoading: boolean;
  libraryWorkspaceRecycleDocuments: import("../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseDocumentSummaryDto[];
  libraryWorkspaceRecycleLoading: boolean;
  libraryWorkspaceEvictedChunks: import("../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseEvictedChunkSummaryDto[];
  libraryWorkspaceWebPages: import("../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseWebPageSummaryDto[];
  libraryWorkspaceWebPagesLoading: boolean;
  libraryWorkspaceDatasets: import("../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseDatasetSummaryDto[];
  libraryWorkspaceDatasetsLoading: boolean;
  libraryWorkspaceAgentKnowledge: import("../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseAgentKnowledgeDto[];
  libraryWorkspaceAgentKnowledgeLoading: boolean;
  libraryWorkspaceMembers: import("../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseMemberDto[];
  libraryWorkspaceMembersLoading: boolean;
  libraryWorkspaceInviteDrawerOpen: boolean;
  libraryWorkspaceInviteEmail: string;
  libraryWorkspaceInviteRole: import("../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseMemberRoleDto;
  libraryWorkspaceInlineRenameKbId: string | null;
  libraryWorkspaceSettingsKbId: string | null;
  libraryWorkspaceSettingsTitle: string;
  libraryWorkspaceSettingsDeleteConfirm: boolean;
  libraryWorkspaceImportOpen: boolean;
  libraryWorkspaceImportLockSpace: boolean;
  libraryWorkspaceImportKind:
    | import("../ports/employee/views/home-page-contracts.ts").SpaceImportKind
    | null;
  libraryWorkspaceBindSourceKind: import("../ports/employee/views/home-page-contracts.ts").ActiveSourceBindKind;
  libraryWorkspaceBindSourceTitle: string;
  libraryWorkspaceBindSourceEndpoint: string;
  libraryWorkspaceLocalFolderPath: string;
  libraryWorkspaceLocalFolderLabel: string;
  libraryWorkspaceLocalFolderDeletePolicy: import("../capability/knowledge-universe/endpoints.ts").LocalFolderDeletePolicy;
  libraryWorkspaceLocalFolderWatcherEnabled: boolean;
  libraryWorkspaceLocalFolderMode: import("../capability/knowledge-universe/endpoints.ts").LocalFolderBindingMode;
  libraryWorkspaceLocalFolderStatusItems: import("../capability/knowledge-universe/endpoints.ts").LocalFolderStatusItem[];
  vaultSyncRootPath: string;
  vaultSyncPassword: string;
  vaultSyncStatus: string | null;
  /** Last created/opened vault id (session memory; used to filter WS revision events). */
  vaultSyncVaultId: string | null;
  vaultSyncDeviceId: string | null;
  vaultSyncPendingRevisionNotice: string | null;
  /** Revision id for restore (session memory; never persisted). */
  vaultSyncRevisionId: string;
  vaultSyncIncludeImages: boolean;
  /** One exclude glob per line (session memory). */
  vaultSyncExcludeGlobsText: string;
  vaultSyncDevices: Array<{
    deviceId: string;
    status?: string;
    platform?: string;
    label?: string;
  }>;
  vaultSyncTeamEnabled: boolean;
  vaultSyncMembers: Array<{
    memberAccountId: string;
    role?: string;
    status?: string;
    joinedAt?: string;
  }>;
  vaultSyncInvites: Array<{
    inviteId: string;
    inviteeAccountId?: string | null;
    role?: string;
    status?: string;
    expiresAt?: string;
  }>;
  /** Optional targeted invitee on create (session memory). */
  vaultSyncInviteeAccountId: string;
  vaultSyncAcceptInviteId: string;
  /** Invite secret for accept flow (memory-only). */
  vaultSyncInviteSecret: string;
  /** Shown once after invite create; never persisted. */
  vaultSyncLastCreatedInviteSecret: string | null;
  libraryWorkspaceConnectorBindDraft: import("../views/knowledge-universe-space-connector-bind.ts").SpaceConnectorBindDraft;
  libraryWorkspaceConnectorCatalog: import("../capability/enterprise-data-capability/types.ts").DataConnectorCatalogEntry[];
  libraryWorkspaceConnectorCatalogLoading: boolean;
  libraryWorkspaceConnectorCatalogError: string | null;
  libraryWorkspacePassiveConnectorLocator: string;
  libraryWorkspacePassiveConnectorLabel: string;
  libraryWorkspaceConnectorCredentials: import("../capability/enterprise-data-capability/types.ts").DataConnectorCredentialRecord[];
  libraryWorkspaceConnectorCredentialsLoading: boolean;
  libraryWorkspaceConnectorProbeOk: boolean | null;
  libraryWorkspaceConnectorProbeMessage: string | null;
  libraryWorkspaceConnectorProbeBusy: boolean;
  libraryWorkspaceConnectorOAuthBusy: boolean;
  libraryWorkspaceConnectorOAuthNotice: string | null;
  libraryWorkspaceConnectorOAuthError: string | null;
  libraryWorkspaceConnectorOAuthSessionId: string | null;
  libraryWorkspaceConnectorOAuthSimulateAllowed: boolean;
  libraryWorkspaceHttpRestExpanded: boolean;
  libraryWorkspaceDatasetImportTab: import("../views/knowledge-universe-dataset-import.ts").DatasetImportTab;
  libraryWorkspaceDatasetFileAttachment:
    | import("../capability/knowledge-universe/personal-document-upload.ts").PersonalDocumentUploadAttachment
    | null;
  libraryWorkspaceDatasetPreview:
    | import("../views/knowledge-universe-dataset-import.ts").DatasetImportPreview
    | null;
  libraryWorkspaceDatasetPreviewError: string | null;
  libraryWorkspaceUrlImportMode: import("../views/knowledge-universe-url-import.ts").WebUrlImportMode;
  libraryWorkspaceUrlImportText: string;
  libraryWorkspaceUrlImportAdvancedOpen: boolean;
  libraryWorkspaceUrlSyncSchedule: import("../views/knowledge-universe-url-import.ts").WebUrlSyncSchedule;
  libraryWorkspaceUrlStripNavAds: boolean;
  libraryWorkspaceUrlMainContentOnly: boolean;
  libraryWorkspaceNoteTags: string[];
  libraryWorkspaceNoteTagDraft: string;
  libraryWorkspaceNoteTagSuggestionsOpen: boolean;
  libraryWorkspaceNoteTagHistory: string[];
  libraryWorkspaceNoteAiBusy: boolean;
  libraryWorkspaceFileImportItems: import("../views/knowledge-universe-file-import.ts").FileImportQueueItem[];
  libraryWorkspaceFileImportAdvancedOpen: boolean;
  libraryWorkspaceFileChunkingStrategy: import("../views/knowledge-universe-file-import.ts").FileChunkingStrategy;
  libraryWorkspaceFileOcrEnabled: boolean;
  workspaceSearchGroups: WorkspaceSearchGroup[];
  workspaceSearchTotalCount: number;
  workspaceSearchMode: WorkspaceSearchMode | null;
  selectedWorkspaceSearchHitId: string | null;
  selectedWorkspaceSearchDeliverableId: string | null;
  openDeliverableMoreMenuId: string | null;
  relationsInsightExpanded: boolean;
  supplySectionExpanded: boolean;
  selectedKbSearchHighlightKey: string | null;
  workspaceDeliverablesExpanded: boolean;
  searchScope: KnowledgeUniverseSearchScope;
  searchPanelOpen: boolean;
  governanceSummary:
    | import("../capability/knowledge-universe/endpoints.ts").KnowledgeGovernanceSummary
    | null;
  governanceTasks: import("../capability/knowledge-universe/endpoints.ts").KnowledgeGovernanceTask[];
  governanceLoading: boolean;
  governanceError: string | null;
  governanceNotice: string | null;
  governanceTaskBusyId: string | null;
  governanceSelectedTaskId: string | null;
  governanceTaskGraph: import("../capability/knowledge-universe/types.ts").RelationshipGraph | null;
  governanceTaskGraphViewModel:
    | import("../capability/knowledge-universe/types.ts").GraphViewModel
    | null;
  governanceTaskGraphLoading: boolean;
  governanceTaskGraphZoom: number;
  governanceTaskGraphPanX: number;
  governanceTaskGraphPanY: number;
  governanceTaskGraphSelectedNodeId: string | null;
  governanceTaskGraphHoveredNodeId: string | null;
};

/**
 * Host needed by knowledge-universe home load/refresh and the runtime WeakMap.
 * Production `AppPortState` satisfies this; tests may pass a small session
 * object (identity, `client`, `requestUpdate`) instead of inventing the full
 * shell state.
 */
export type KnowledgeUniverseSession = {
  requestUpdate?: () => void;
  client?: KnowledgeUniverseRpcClient | null;
  knowledgeUniversePageTab?: KnowledgeUniversePageTab;
  knowledgeUniverseBrowseSubTab?: KnowledgeUniverseBrowseSubTab;
};

const runtimes = new WeakMap<object, KnowledgeUniverseControllerState>();

function requestUpdate(state: KnowledgeUniverseSession) {
  if (typeof state.requestUpdate === "function") {
    state.requestUpdate();
  }
}

function syncToAppState(
  state: KnowledgeUniverseSession,
  runtime: KnowledgeUniverseControllerState,
) {
  const surface = state as Record<string, unknown>;
  surface.knowledgeUniverseLoading = runtime.loading;
  surface.knowledgeUniverseError = runtime.error;
  surface.knowledgeUniverseQuery = runtime.query;
  surface.knowledgeUniverseHomeFocus = runtime.homeFocus;
  surface.knowledgeUniverseSearchScope = runtime.searchScope;
  surface.knowledgeUniverseSelectedNodeId = runtime.selectedNodeId;
  surface.knowledgeUniverseSelectedObject = runtime.selectedObject;
  surface.knowledgeUniverseSourceSummary = runtime.sourceSummary;
  surface.knowledgeUniverseGraph = runtime.graph;
  surface.knowledgeUniverseGraphViewModel = runtime.graphViewModel;
  surface.knowledgeUniverseSearchResults = runtime.searchResults;
  surface.knowledgeUniverseDataCapabilities = runtime.dataCapabilities;
  surface.knowledgeUniverseSourceBrowse = runtime.sourceBrowse;
  surface.knowledgeUniverseExternalDataSources = runtime.externalDataSources;
  surface.knowledgeUniversePersonalCollectTitle = runtime.personalCollectTitle;
  surface.knowledgeUniversePersonalCollectSummary = runtime.personalCollectSummary;
  surface.knowledgeUniversePersonalCollectTags = runtime.personalCollectTags;
  surface.knowledgeUniversePersonalCollectUrl = runtime.personalCollectUrl;
  surface.knowledgeUniversePersonalDatasetText = runtime.personalDatasetText;
  surface.knowledgeUniversePersonalUploadAttachment = runtime.personalUploadAttachment;
  surface.knowledgeUniversePersonalActionBusy = runtime.personalActionBusy;
  surface.knowledgeUniversePersonalActionNotice = runtime.personalActionNotice;
  surface.knowledgeUniversePersonalActionError = runtime.personalActionError;
  surface.knowledgeUniverseAccessRequestBusyCapabilityId = runtime.accessRequestBusyCapabilityId;
  surface.knowledgeUniverseAccessRequestBusyProjectionId = runtime.accessRequestBusyProjectionId;
  surface.knowledgeUniverseAccessRequestNotice = runtime.accessRequestNotice;
  surface.knowledgeUniverseCapabilityPreview = runtime.capabilityPreview;
  surface.knowledgeUniverseCapabilityInvocation = runtime.capabilityInvocation;
  surface.knowledgeUniversePersonalManageObjectId = runtime.personalManageObjectId;
  surface.knowledgeUniversePersonalManageObjectTitle = runtime.personalManageObjectTitle;
  surface.knowledgeUniversePersonalManageTags = runtime.personalManageTags;
  surface.knowledgeUniversePersonalManageBusy = runtime.personalManageBusy;
  surface.knowledgeUniversePersonalManageNotice = runtime.personalManageNotice;
  surface.knowledgeUniversePersonalVersions = runtime.personalVersions;
  surface.knowledgeUniversePersonalVersionCompareFrom = runtime.personalVersionCompareFrom;
  surface.knowledgeUniversePersonalVersionCompareTo = runtime.personalVersionCompareTo;
  surface.knowledgeUniversePersonalVersionDiff = runtime.personalVersionDiff;
  surface.knowledgeUniverseRecommendations = runtime.recommendations;
  surface.knowledgeUniverseDiscoveryEvents = runtime.discoveryEvents;
  surface.knowledgeUniverseActionSuggestions = runtime.actionSuggestions;
  surface.knowledgeUniverseHomeInsightsDegraded = runtime.homeInsightsDegraded;
  surface.knowledgeUniverseRecentVisits = runtime.recentVisits;
  surface.knowledgeUniverseRelatedGroups = runtime.relatedGroups;
  surface.knowledgeUniverseGraphZoom = runtime.graphZoom;
  surface.knowledgeUniverseGraphPanX = runtime.graphPanX;
  surface.knowledgeUniverseGraphPanY = runtime.graphPanY;
  surface.knowledgeUniverseHoveredNodeId = runtime.hoveredNodeId;
  surface.knowledgeUniverseKnowledgeBases = runtime.knowledgeBases;
  surface.knowledgeUniverseSelectedKnowledgeBaseId = runtime.selectedKnowledgeBaseId;
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
  surface.knowledgeUniverseWorkspaceSearchGroups = runtime.workspaceSearchGroups;
  surface.knowledgeUniverseWorkspaceSearchTotalCount = runtime.workspaceSearchTotalCount;
  surface.knowledgeUniverseWorkspaceSearchMode = runtime.workspaceSearchMode;
  surface.knowledgeUniverseSelectedWorkspaceSearchHitId = runtime.selectedWorkspaceSearchHitId;
  surface.knowledgeUniverseSelectedWorkspaceSearchDeliverableId =
    runtime.selectedWorkspaceSearchDeliverableId;
  surface.knowledgeUniverseOpenDeliverableMoreMenuId = runtime.openDeliverableMoreMenuId;
  surface.knowledgeUniverseRelationsInsightExpanded = runtime.relationsInsightExpanded;
  surface.knowledgeUniverseSupplySectionExpanded = runtime.supplySectionExpanded;
  surface.knowledgeUniverseSelectedKbSearchHighlightKey = runtime.selectedKbSearchHighlightKey;
  surface.knowledgeUniverseWorkspaceDeliverablesExpanded = runtime.workspaceDeliverablesExpanded;
  surface.knowledgeUniverseSearchPanelOpen = runtime.searchPanelOpen;
  surface.knowledgeUniverseWorkspaceDeliverableTrace = runtime.workspaceDeliverableTrace;
  surface.knowledgeUniverseWorkspaceDeliverableTraceLoading =
    runtime.workspaceDeliverableTraceLoading;
  surface.knowledgeUniverseDeliverableDetailFocus = runtime.deliverableDetailFocus;
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
  surface.knowledgeUniverseLibraryWorkspaceInviteDrawerOpen =
    runtime.libraryWorkspaceInviteDrawerOpen;
  surface.knowledgeUniverseLibraryWorkspaceInviteEmail = runtime.libraryWorkspaceInviteEmail;
  surface.knowledgeUniverseLibraryWorkspaceInviteRole = runtime.libraryWorkspaceInviteRole;
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
  surface.knowledgeUniverseLibraryWorkspaceLocalFolderPath =
    runtime.libraryWorkspaceLocalFolderPath;
  surface.knowledgeUniverseLibraryWorkspaceLocalFolderLabel =
    runtime.libraryWorkspaceLocalFolderLabel;
  surface.knowledgeUniverseLibraryWorkspaceLocalFolderDeletePolicy =
    runtime.libraryWorkspaceLocalFolderDeletePolicy;
  surface.knowledgeUniverseLibraryWorkspaceLocalFolderWatcherEnabled =
    runtime.libraryWorkspaceLocalFolderWatcherEnabled;
  surface.knowledgeUniverseLibraryWorkspaceLocalFolderMode =
    runtime.libraryWorkspaceLocalFolderMode;
  surface.knowledgeUniverseLibraryWorkspaceLocalFolderStatusItems =
    runtime.libraryWorkspaceLocalFolderStatusItems;
  surface.knowledgeUniverseGovernanceSummary = runtime.governanceSummary;
  surface.knowledgeUniverseGovernanceTasks = runtime.governanceTasks;
  surface.knowledgeUniverseGovernanceLoading = runtime.governanceLoading;
  surface.knowledgeUniverseGovernanceError = runtime.governanceError;
  surface.knowledgeUniverseGovernanceNotice = runtime.governanceNotice;
  surface.knowledgeUniverseGovernanceTaskBusyId = runtime.governanceTaskBusyId;
  surface.knowledgeUniverseGovernanceSelectedTaskId = runtime.governanceSelectedTaskId;
  surface.knowledgeUniverseGovernanceTaskGraph = runtime.governanceTaskGraph;
  surface.knowledgeUniverseGovernanceTaskGraphViewModel = runtime.governanceTaskGraphViewModel;
  surface.knowledgeUniverseGovernanceTaskGraphLoading = runtime.governanceTaskGraphLoading;
  surface.knowledgeUniverseGovernanceTaskGraphZoom = runtime.governanceTaskGraphZoom;
  surface.knowledgeUniverseGovernanceTaskGraphPanX = runtime.governanceTaskGraphPanX;
  surface.knowledgeUniverseGovernanceTaskGraphPanY = runtime.governanceTaskGraphPanY;
  surface.knowledgeUniverseGovernanceTaskGraphSelectedNodeId =
    runtime.governanceTaskGraphSelectedNodeId;
  surface.knowledgeUniverseGovernanceTaskGraphHoveredNodeId =
    runtime.governanceTaskGraphHoveredNodeId;
  runtime.chatScopeSyncKey = syncKnowledgeUniverseSelectionToChatHost(
    state as KnowledgeUniverseChatScopeHost,
    runtime,
  );
}

function createInitialRuntime(): KnowledgeUniverseControllerState {
  return {
    loading: false,
    graphLoading: false,
    insightsLoading: false,
    error: null,
    query: "",
    homeFocus: null,
    homeCockpitTab: "relations",
    documentReaderLoading: false,
    documentReaderSaving: false,
    documentReaderEditing: false,
    documentReaderDirty: false,
    documentReaderError: null,
    documentReaderDocKey: null,
    documentReaderPreview: null,
    documentReaderDraft: "",
    selectedNodeId: null,
    selectedObject: null,
    sourceSummary: null,
    graph: null,
    graphViewModel: null,
    searchResults: [],
    dataCapabilities: [],
    sourceBrowse: { personal: [], enterprise: [], enterpriseRestricted: [] },
    externalDataSources: [],
    personalCollectTitle: "",
    personalCollectSummary: "",
    personalCollectTags: "",
    personalCollectUrl: "",
    personalDatasetText: "",
    personalUploadAttachment: null,
    personalActionBusy: false,
    personalActionNotice: null,
    personalActionError: null,
    importProgress: null,
    accessRequestBusyCapabilityId: null,
    accessRequestBusyProjectionId: null,
    accessRequestNotice: null,
    capabilityPreview: null,
    capabilityInvocation: null,
    personalManageObjectId: null,
    personalManageObjectTitle: null,
    personalManageTags: "",
    personalManageBusy: false,
    personalManageNotice: null,
    personalVersions: [],
    personalVersionCompareFrom: "",
    personalVersionCompareTo: "",
    personalVersionDiff: null,
    recommendations: [],
    discoveryEvents: [],
    actionSuggestions: [],
    recentVisits: [],
    relatedGroups: null,
    homeInsightsDegraded: false,
    graphZoom: 1,
    graphPanX: 0,
    graphPanY: 0,
    hoveredNodeId: null,
    hasLoaded: false,
    knowledgeBases: [],
    selectedKnowledgeBaseId: null,
    chatScopeSyncKey: "",
    kbSearchQuery: "",
    kbSearchEvidence: [],
    kbSearchMode: null,
    kbSearchSubstringResults: [],
    workspaceDeliverables: [],
    workspaceDeliverableStatusFilter: "all",
    workspaceBusy: false,
    workspaceNotice: null,
    workspaceError: null,
    workspaceHint: null,
    workspaceDeliverablesUnavailable: false,
    newKnowledgeBaseTitle: "",
    newKnowledgeBaseDescription: "",
    newKnowledgeBaseVisibility: "private",
    workspaceDeliverableTrace: null,
    workspaceDeliverableTraceLoading: false,
    deliverableDetailFocus: null,
    pinnedKnowledgeBaseIds: readPinnedKnowledgeBaseIds(),
    favoriteKnowledgeBaseIds: readFavoriteKnowledgeBaseIds(),
    expandedKnowledgeBaseIds: [],
    treeDocumentsByKbId: {},
    treeSourcesByKbId: {},
    treeDocumentsLoadingByKbId: {},
    libraryWorkspaceContentTab: readLibraryWorkspaceContentTab(),
    libraryWorkspaceMaterialsKindFilter: readLibraryWorkspaceMaterialsKindFilter(),
    libraryWorkspaceDocuments: [],
    libraryWorkspaceDocumentsLoading: false,
    libraryWorkspaceSources: [],
    libraryWorkspaceSourcesLoading: false,
    libraryWorkspaceSourcesPlaneFilter: "all",
    libraryWorkspaceSelectedDocumentIds: [],
    libraryWorkspaceSnippets: [],
    libraryWorkspaceSnippetsLoading: false,
    libraryWorkspaceRecycleDocuments: [],
    libraryWorkspaceRecycleLoading: false,
    libraryWorkspaceEvictedChunks: [],
    libraryWorkspaceWebPages: [],
    libraryWorkspaceWebPagesLoading: false,
    libraryWorkspaceDatasets: [],
    libraryWorkspaceDatasetsLoading: false,
    libraryWorkspaceAgentKnowledge: [],
    libraryWorkspaceAgentKnowledgeLoading: false,
    libraryWorkspaceMembers: [],
    libraryWorkspaceMembersLoading: false,
    libraryWorkspaceInviteDrawerOpen: false,
    libraryWorkspaceInviteEmail: "",
    libraryWorkspaceInviteRole: "viewer",
    libraryWorkspaceInlineRenameKbId: null,
    libraryWorkspaceSettingsKbId: null,
    libraryWorkspaceSettingsTitle: "",
    libraryWorkspaceSettingsDeleteConfirm: false,
    libraryWorkspaceImportOpen: false,
    libraryWorkspaceImportLockSpace: true,
    libraryWorkspaceImportKind: null,
    libraryWorkspaceBindSourceKind: "api",
    libraryWorkspaceBindSourceTitle: "",
    libraryWorkspaceBindSourceEndpoint: "",
    libraryWorkspaceLocalFolderPath: "",
    libraryWorkspaceLocalFolderLabel: "",
    libraryWorkspaceLocalFolderDeletePolicy: "snapshot",
    libraryWorkspaceLocalFolderWatcherEnabled: true,
    libraryWorkspaceLocalFolderMode: "local_index",
    libraryWorkspaceLocalFolderStatusItems: [],
    vaultSyncRootPath: "",
    vaultSyncPassword: "",
    vaultSyncStatus: null,
    vaultSyncVaultId: null,
    vaultSyncDeviceId: null,
    vaultSyncPendingRevisionNotice: null,
    vaultSyncRevisionId: "",
    vaultSyncIncludeImages: true,
    vaultSyncExcludeGlobsText: "",
    vaultSyncDevices: [],
    vaultSyncTeamEnabled: false,
    vaultSyncMembers: [],
    vaultSyncInvites: [],
    vaultSyncInviteeAccountId: "",
    vaultSyncAcceptInviteId: "",
    vaultSyncInviteSecret: "",
    vaultSyncLastCreatedInviteSecret: null,
    libraryWorkspaceConnectorBindDraft: createEmptySpaceConnectorBindDraft(),
    libraryWorkspaceConnectorCatalog: [],
    libraryWorkspaceConnectorCatalogLoading: false,
    libraryWorkspaceConnectorCatalogError: null,
    libraryWorkspacePassiveConnectorLocator: "",
    libraryWorkspacePassiveConnectorLabel: "",
    libraryWorkspaceConnectorCredentials: [],
    libraryWorkspaceConnectorCredentialsLoading: false,
    libraryWorkspaceConnectorProbeOk: null,
    libraryWorkspaceConnectorProbeMessage: null,
    libraryWorkspaceConnectorProbeBusy: false,
    libraryWorkspaceConnectorOAuthBusy: false,
    libraryWorkspaceConnectorOAuthNotice: null,
    libraryWorkspaceConnectorOAuthError: null,
    libraryWorkspaceConnectorOAuthSessionId: null,
    libraryWorkspaceConnectorOAuthSimulateAllowed: false,
    libraryWorkspaceHttpRestExpanded: false,
    libraryWorkspaceDatasetImportTab: "file",
    libraryWorkspaceDatasetFileAttachment: null,
    libraryWorkspaceDatasetPreview: null,
    libraryWorkspaceDatasetPreviewError: null,
    ...createEmptyWebUrlImportState(),
    ...createEmptyNoteImportState(),
    ...createEmptyFileImportState(),
    libraryWorkspaceNoteTagHistory: readNoteTagHistory(),
    workspaceSearchGroups: [],
    workspaceSearchTotalCount: 0,
    workspaceSearchMode: null,
    selectedWorkspaceSearchHitId: null,
    selectedWorkspaceSearchDeliverableId: null,
    openDeliverableMoreMenuId: null,
    relationsInsightExpanded: false,
    supplySectionExpanded: false,
    selectedKbSearchHighlightKey: null,
    workspaceDeliverablesExpanded: false,
    searchScope: "workspace",
    searchPanelOpen: false,
    governanceSummary: null,
    governanceTasks: [],
    governanceLoading: false,
    governanceError: null,
    governanceNotice: null,
    governanceTaskBusyId: null,
    governanceSelectedTaskId: null,
    governanceTaskGraph: null,
    governanceTaskGraphViewModel: null,
    governanceTaskGraphLoading: false,
    governanceTaskGraphZoom: 1,
    governanceTaskGraphPanX: 0,
    governanceTaskGraphPanY: 0,
    governanceTaskGraphSelectedNodeId: null,
    governanceTaskGraphHoveredNodeId: null,
  };
}

export function getKnowledgeUniverseRuntime(
  state: KnowledgeUniverseSession,
): KnowledgeUniverseControllerState {
  let runtime = runtimes.get(state);
  if (!runtime) {
    runtime = createInitialRuntime();
    runtimes.set(state, runtime);
  }
  return runtime;
}

type KnowledgeUniverseHomeLoadRequest = { mode: "load" | "refresh"; force?: boolean };

type HomeLoadCoalescer = {
  inFlight: Promise<void> | null;
  inFlightToken: object | null;
  queued: KnowledgeUniverseHomeLoadRequest | null;
};

const homeLoadCoalescers = new WeakMap<object, HomeLoadCoalescer>();

function getHomeLoadCoalescer(state: KnowledgeUniverseSession) {
  let entry = homeLoadCoalescers.get(state);
  if (!entry) {
    entry = { inFlight: null, inFlightToken: null, queued: null };
    homeLoadCoalescers.set(state, entry);
  }
  return entry;
}

function applyKnowledgeUniverseHomeSnapshot(
  runtime: KnowledgeUniverseControllerState,
  snapshot:
    | import("../capability/knowledge-universe/facade.ts").KnowledgeUniverseHomePartialSnapshot
    | import("../capability/knowledge-universe/endpoints.ts").KnowledgeUniverseHomeSnapshot,
) {
  if ("sourceSummary" in snapshot && snapshot.sourceSummary !== undefined) {
    runtime.sourceSummary = snapshot.sourceSummary;
  }
  if ("graph" in snapshot && snapshot.graph !== undefined) {
    runtime.graph = snapshot.graph;
    if ("graphViewModel" in snapshot && snapshot.graphViewModel !== undefined) {
      runtime.graphViewModel = snapshot.graphViewModel;
    }
    runtime.graphLoading = false;
  }
  if ("searchResults" in snapshot && snapshot.searchResults !== undefined) {
    runtime.searchResults = snapshot.searchResults;
  }
  if ("dataCapabilities" in snapshot && snapshot.dataCapabilities !== undefined) {
    runtime.dataCapabilities = snapshot.dataCapabilities;
  }
  if ("sourceBrowse" in snapshot && snapshot.sourceBrowse !== undefined) {
    runtime.sourceBrowse = snapshot.sourceBrowse;
  }
  if ("externalDataSources" in snapshot && snapshot.externalDataSources !== undefined) {
    runtime.externalDataSources = snapshot.externalDataSources;
  }
  if ("recommendations" in snapshot && snapshot.recommendations !== undefined) {
    runtime.recommendations = snapshot.recommendations;
  }
  if ("discoveryEvents" in snapshot && snapshot.discoveryEvents !== undefined) {
    runtime.discoveryEvents = snapshot.discoveryEvents;
  }
  if ("actionSuggestions" in snapshot && snapshot.actionSuggestions !== undefined) {
    runtime.actionSuggestions = snapshot.actionSuggestions;
  }
  if ("homeInsightsDegraded" in snapshot && snapshot.homeInsightsDegraded !== undefined) {
    runtime.homeInsightsDegraded = snapshot.homeInsightsDegraded;
  }
  if ("recentVisits" in snapshot && snapshot.recentVisits !== undefined) {
    runtime.recentVisits = snapshot.recentVisits;
  }
  if ("relatedGroups" in snapshot && snapshot.relatedGroups !== undefined) {
    runtime.relatedGroups = snapshot.relatedGroups;
  }
  if ("selectedObject" in snapshot && snapshot.selectedObject !== undefined) {
    runtime.selectedObject = snapshot.selectedObject;
  }
  const settled = "settled" in snapshot ? snapshot.settled : undefined;
  if (
    !settled ||
    (settled.includes("recommendations") &&
      settled.includes("actions") &&
      settled.includes("discovery"))
  ) {
    runtime.insightsLoading = false;
  }
}

async function runKnowledgeUniverseHomeLoad(
  state: KnowledgeUniverseSession,
  request: KnowledgeUniverseHomeLoadRequest,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (request.mode === "load" && runtime.hasLoaded && !request.force) {
    return;
  }
  if (!runtime.hasLoaded) {
    applyKnowledgeUniverseUiPrefs(state);
  }
  runtime.loading = true;
  runtime.graphLoading = true;
  runtime.insightsLoading = true;
  runtime.error = null;
  syncToAppState(state, runtime);
  requestUpdate(state);
  // Start the space list immediately so it can render before the graph settles.
  const workspacePromise = loadKnowledgeUniverseWorkspace(state);
  try {
    const snapshot = await loadKnowledgeUniverseHomeSnapshot({
      client: state.client,
      query: runtime.query,
      selectedNodeId: runtime.selectedNodeId,
      selectedKnowledgeBaseId: runtime.selectedKnowledgeBaseId,
      onPartial: (partial) => {
        applyKnowledgeUniverseHomeSnapshot(runtime, partial);
        syncToAppState(state, runtime);
        requestUpdate(state);
      },
    });
    applyKnowledgeUniverseHomeSnapshot(runtime, snapshot);
    runtime.hasLoaded = true;
    runtime.error = null;
    await workspacePromise;
    void loadKnowledgeUniverseGovernance(state);
    if (request.mode === "load") {
      void import("./knowledge-universe-connector-bind.ts").then((module) => {
        module.maybeResumeKnowledgeUniverseConnectorOAuthFromUrl(
          state as import("../app-port-state.ts").AppPortState,
        );
      });
    }
  } catch (error) {
    runtime.error = runtimeMessageFromError(
      error,
      request.mode === "refresh"
        ? runtimeMessageRefreshWorkbenchFailed
        : runtimeMessageLoadWorkbenchFailed,
    );
    await workspacePromise.catch(() => undefined);
  } finally {
    runtime.loading = false;
    runtime.graphLoading = false;
    runtime.insightsLoading = false;
    syncToAppState(state, runtime);
    requestUpdate(state);
  }
}

async function enqueueKnowledgeUniverseHomeLoad(
  state: KnowledgeUniverseSession,
  request: KnowledgeUniverseHomeLoadRequest,
) {
  const coalescer = getHomeLoadCoalescer(state);
  if (coalescer.inFlight) {
    // Merge or queue behind the in-flight load instead of starting a second
    // overlapping home snapshot (t316 stacked three home loads to 60s+).
    const current = coalescer.queued;
    coalescer.queued = {
      mode: request.mode === "refresh" || current?.mode === "refresh" ? "refresh" : "load",
      force:
        Boolean(request.force || current?.force) ||
        request.mode === "refresh" ||
        current?.mode === "refresh",
    };
    await coalescer.inFlight;
    if (coalescer.queued && !coalescer.inFlight) {
      const leftover = coalescer.queued;
      coalescer.queued = null;
      await enqueueKnowledgeUniverseHomeLoad(state, leftover);
    }
    return;
  }
  // Create the in-flight promise and token before work starts so a later
  // comparison does not read `run` in the TDZ, and so a previous generation
  // cannot clear a newer holder.
  let settle!: (result: Promise<void>) => void;
  const run = new Promise<void>((resolve, reject) => {
    settle = (result) => {
      result.then(resolve, reject);
    };
  });
  const token = {};
  coalescer.inFlightToken = token;
  coalescer.inFlight = run;
  const work = (async () => {
    do {
      const next = coalescer.queued ?? request;
      coalescer.queued = null;
      await runKnowledgeUniverseHomeLoad(state, next);
    } while (coalescer.queued);
  })().finally(() => {
    if (coalescer.inFlightToken === token) {
      coalescer.inFlight = null;
      coalescer.inFlightToken = null;
    }
  });
  settle(work);
  await run;
}

export async function loadKnowledgeUniverseHome(
  state: KnowledgeUniverseSession,
  options?: { force?: boolean },
) {
  await enqueueKnowledgeUniverseHomeLoad(state, { mode: "load", force: options?.force });
}

export async function refreshKnowledgeUniverseHome(state: KnowledgeUniverseSession) {
  await enqueueKnowledgeUniverseHomeLoad(state, { mode: "refresh", force: true });
}

export function setKnowledgeUniverseSearchPanelOpen(state: AppPortState, open: boolean) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.searchPanelOpen = open;
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseQuery(state: AppPortState, query: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.query = query;
  if (runtime.searchScope === "library") {
    runtime.kbSearchQuery = query;
  }
  if (!query.trim()) {
    runtime.searchPanelOpen = false;
    runtime.selectedWorkspaceSearchHitId = null;
    runtime.selectedWorkspaceSearchDeliverableId = null;
    if (runtime.searchScope === "library") {
      runtime.kbSearchEvidence = [];
      runtime.kbSearchSubstringResults = [];
      runtime.kbSearchMode = null;
      runtime.selectedKbSearchHighlightKey = null;
    }
  }
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseSearchScope(
  state: AppPortState,
  scope: KnowledgeUniverseSearchScope,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (scope === "library" && !runtime.selectedKnowledgeBaseId) {
    return;
  }
  runtime.searchScope = scope;
  if (scope === "library") {
    runtime.kbSearchQuery = runtime.query;
  }
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export function openKnowledgeUniverseAssetsPage(state: AppPortState) {
  state.workbenchPrimaryModule = "knowledge";
  setKnowledgeUniversePageTab(state, "assets");
}

export function openKnowledgeUniverseGovernancePage(state: AppPortState) {
  state.workbenchPrimaryModule = "knowledge";
  setKnowledgeUniversePageTab(state, "governance");
  void loadKnowledgeUniverseGovernance(state);
}

export function openKnowledgeUniverseDeliverablesPage(state: AppPortState) {
  state.workbenchPrimaryModule = "knowledge";
  setKnowledgeUniversePageTab(state, "workbench");
  void loadKnowledgeUniverseWorkspace(state).then(() => {
    const runtime = getKnowledgeUniverseRuntime(state);
    const folder = findReservedDeliverableKnowledgeBase(
      runtime.knowledgeBases,
      "personal_deliverables",
    );
    if (folder) {
      setKnowledgeUniverseSelectedKnowledgeBase(state, folder.id);
    }
  });
}

export function openKnowledgeUniverseLibraryCreatePage(state: AppPortState) {
  state.workbenchPrimaryModule = "knowledge";
  setKnowledgeUniversePageTab(state, "libraryCreate");
}

function resolveGovernanceKbId(
  runtime: ReturnType<typeof getKnowledgeUniverseRuntime>,
): string | undefined {
  const kbId = runtime.selectedKnowledgeBaseId?.trim();
  return kbId ? kbId : undefined;
}

export async function loadKnowledgeUniverseGovernance(state: KnowledgeUniverseSession) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!state.client) {
    return;
  }
  const kbId = resolveGovernanceKbId(runtime);
  const scopeParams = kbId ? { kbId } : {};
  runtime.governanceLoading = true;
  runtime.governanceError = null;
  syncToAppState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const [summaryRes, tasksRes] = await Promise.all([
      gateway.governanceSummary(scopeParams),
      gateway.governanceTasksList({ ...scopeParams, status: "open", limit: 50 }),
    ]);
    runtime.governanceSummary = summaryRes.summary;
    runtime.governanceTasks = tasksRes.tasks;
    runtime.governanceError = null;
  } catch (error) {
    const message = error instanceof Error ? error.message : runtimeMessageLoadGovernanceFailed();
    runtime.governanceError =
      message === "knowledge index not found" ? runtimeMessageGovernanceIndexNotReady() : message;
  } finally {
    runtime.governanceLoading = false;
    syncToAppState(state, runtime);
    requestUpdate(state);
  }
}

export async function updateKnowledgeUniverseGovernanceTask(
  state: AppPortState,
  taskId: string,
  status: "resolved" | "dismissed",
  canonicalClaimId?: string,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!state.client) {
    return;
  }
  const task = runtime.governanceTasks.find((entry) => entry.id === taskId) ?? null;
  runtime.governanceTaskBusyId = taskId;
  syncToAppState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const kbId = resolveGovernanceKbId(runtime);
    await gateway.governanceTaskUpdate({
      taskId,
      status,
      ...(kbId ? { kbId } : {}),
      ...(canonicalClaimId ? { canonicalClaimId } : {}),
    });
    if (runtime.governanceSelectedTaskId === taskId) {
      runtime.governanceSelectedTaskId = null;
      runtime.governanceTaskGraph = null;
      runtime.governanceTaskGraphViewModel = null;
      runtime.governanceTaskGraphSelectedNodeId = null;
      runtime.governanceTaskGraphHoveredNodeId = null;
    }
    runtime.governanceError = null;
    runtime.governanceNotice = buildGovernanceTaskUpdateNotice(task, status, canonicalClaimId);
    await loadKnowledgeUniverseGovernance(state);
  } catch (error) {
    runtime.governanceNotice = null;
    runtime.governanceError =
      error instanceof Error ? error.message : runtimeMessageGovernanceTaskUpdateFailed();
    syncToAppState(state, runtime);
    requestUpdate(state);
  } finally {
    runtime.governanceTaskBusyId = null;
    syncToAppState(state, runtime);
    requestUpdate(state);
  }
}

function buildGovernanceTaskUpdateNotice(
  task: import("../capability/knowledge-universe/endpoints.ts").KnowledgeGovernanceTask | null,
  status: "resolved" | "dismissed",
  canonicalClaimId?: string,
): string | null {
  if (!task) {
    return status === "resolved"
      ? runtimeNoticeGovernanceTaskResolved()
      : runtimeNoticeGovernanceTaskDismissed();
  }
  if (status === "dismissed") {
    return task.taskType === "claim_conflict"
      ? runtimeNoticeGovernanceClaimConflictDismissed()
      : runtimeNoticeGovernanceTaskDismissed();
  }
  if (task.taskType === "claim_conflict" && canonicalClaimId) {
    const adopted = resolveAdoptedClaimChoice(task, canonicalClaimId);
    if (adopted) {
      return runtimeNoticeGovernanceClaimTruthAccepted({
        subject: adopted.slotLabel,
        value: adopted.displayValue,
      });
    }
  }
  return runtimeNoticeGovernanceTaskResolved();
}

export function clearKnowledgeUniverseGovernanceNotice(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.governanceNotice = null;
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export async function selectKnowledgeUniverseGovernanceTask(
  state: AppPortState,
  taskId: string | null,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!taskId) {
    runtime.governanceSelectedTaskId = null;
    runtime.governanceTaskGraph = null;
    runtime.governanceTaskGraphViewModel = null;
    runtime.governanceTaskGraphSelectedNodeId = null;
    runtime.governanceTaskGraphHoveredNodeId = null;
    syncToAppState(state, runtime);
    requestUpdate(state);
    return;
  }
  if (runtime.governanceSelectedTaskId === taskId) {
    await selectKnowledgeUniverseGovernanceTask(state, null);
    return;
  }
  runtime.governanceSelectedTaskId = taskId;
  syncToAppState(state, runtime);
  requestUpdate(state);
  await loadKnowledgeUniverseGovernanceTaskGraph(state, taskId);
}

export async function loadKnowledgeUniverseGovernanceTaskGraph(
  state: AppPortState,
  taskId: string,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!state.client) {
    return;
  }
  runtime.governanceTaskGraphLoading = true;
  runtime.governanceTaskGraph = null;
  runtime.governanceTaskGraphViewModel = null;
  syncToAppState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const response = await gateway.governanceTaskGraph({ taskId });
    runtime.governanceTaskGraph = response.graph;
    const layout = buildRadialGraphLayout(response.graph, {
      centerNodeId: response.focusNodeId ?? undefined,
      width: 640,
      height: 280,
    });
    runtime.governanceTaskGraphViewModel = relationshipGraphToViewModel(response.graph, layout);
    runtime.governanceTaskGraphZoom = 1;
    runtime.governanceTaskGraphPanX = 0;
    runtime.governanceTaskGraphPanY = 0;
    runtime.governanceTaskGraphSelectedNodeId = response.focusNodeId;
    runtime.governanceTaskGraphHoveredNodeId = null;
    runtime.governanceError = null;
  } catch (error) {
    runtime.governanceError =
      error instanceof Error ? error.message : runtimeMessageLoadIssueGraphFailed();
    runtime.governanceTaskGraph = null;
    runtime.governanceTaskGraphViewModel = null;
  } finally {
    runtime.governanceTaskGraphLoading = false;
    syncToAppState(state, runtime);
    requestUpdate(state);
  }
}

export function setKnowledgeUniverseGovernanceTaskGraphZoom(state: AppPortState, delta: number) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.governanceTaskGraphZoom = Math.min(
    2.5,
    Math.max(0.4, runtime.governanceTaskGraphZoom + delta),
  );
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseGovernanceTaskGraphPan(
  state: AppPortState,
  dx: number,
  dy: number,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.governanceTaskGraphPanX += dx;
  runtime.governanceTaskGraphPanY += dy;
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export function resetKnowledgeUniverseGovernanceTaskGraphView(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.governanceTaskGraphZoom = 1;
  runtime.governanceTaskGraphPanX = 0;
  runtime.governanceTaskGraphPanY = 0;
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseGovernanceTaskGraphSelectedNode(
  state: AppPortState,
  nodeId: string,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.governanceTaskGraphSelectedNodeId = nodeId;
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseGovernanceTaskGraphHoveredNode(
  state: AppPortState,
  nodeId: string | null,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.governanceTaskGraphHoveredNodeId = nodeId;
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniversePageTab(
  state: AppPortState,
  tab: import("../ports/employee/views/home-page-contracts.ts").KnowledgeUniversePageTab,
) {
  // "relations" opens the standalone relations panorama page; it is no longer aliased
  // to the governance tab (the page-level router handles the "relations" case directly).
  const remappedFromDeliverables = tab === "deliverables";
  const normalizedTab = remappedFromDeliverables ? "workbench" : tab;
  state.knowledgeUniversePageTab = normalizedTab;
  writeKnowledgeUniverseUiPrefs({ pageTab: normalizedTab });
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.relationsInsightExpanded = false;
  runtime.supplySectionExpanded = normalizedTab === "supply";
  runtime.workspaceDeliverablesExpanded =
    remappedFromDeliverables || normalizedTab === "deliverableDetail";
  if (
    remappedFromDeliverables ||
    normalizedTab === "deliverableDetail" ||
    normalizedTab === "libraryCreate" ||
    normalizedTab === "assets" ||
    normalizedTab === "relations" ||
    normalizedTab === "governance"
  ) {
    state.workbenchPrimaryModule = "knowledge";
  }
  if (normalizedTab === "governance") {
    void loadKnowledgeUniverseGovernance(state);
  }
  // libraryCreate must not kick off workspace load: that sets workspaceBusy and
  // disables the name/description inputs on the create-space form.
  if (remappedFromDeliverables) {
    void loadKnowledgeUniverseWorkspace(state, {
      deliverablesLimit: 100,
    });
  }
  if (normalizedTab === "deliverableDetail") {
    void loadKnowledgeUniverseDeliverableTrace(state);
  }
  if (normalizedTab !== "personal") {
    state.knowledgeUniversePersonalCollectDrawerOpen = false;
  }
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseBrowseSubTab(
  state: AppPortState,
  tab: import("../ports/employee/views/home-page-contracts.ts").KnowledgeUniverseBrowseSubTab,
) {
  const normalized = normalizeKnowledgeUniverseBrowseSubTab(tab) ?? tab;
  state.knowledgeUniverseBrowseSubTab = normalized;
  writeKnowledgeUniverseUiPrefs({ browseSubTab: normalized });
  requestUpdate(state);
}

export function setKnowledgeUniversePersonalCollectDrawerOpen(
  state: AppPortState,
  open: boolean,
  mode?: import("../ports/employee/views/home-page-contracts.ts").KnowledgeUniversePersonalDrawerMode,
) {
  state.knowledgeUniversePersonalCollectDrawerOpen = open;
  if (mode) {
    state.knowledgeUniversePersonalDrawerMode = mode;
  }
  if (open) {
    setKnowledgeUniversePageTab(state, "personal");
    state.knowledgeUniverseBrowseSubTab = "private";
    writeKnowledgeUniverseUiPrefs({ browseSubTab: "private" });
    return;
  }
  if (state.knowledgeUniversePageTab === "personal") {
    setKnowledgeUniversePageTab(state, "workbench");
  } else {
    requestUpdate(state);
  }
}

export function setKnowledgeUniverseRelationsInsightExpanded(state: AppPortState, open: boolean) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.relationsInsightExpanded = open;
  syncToAppState(state, runtime);
  requestUpdate(state);
  if (open) {
    navigateKnowledgeUniverseAnchor(KNOWLEDGE_UNIVERSE_ANCHORS.relations, { block: "start" });
  }
}

export function setKnowledgeUniverseSupplySectionExpanded(state: AppPortState, open: boolean) {
  if (open) {
    setKnowledgeUniversePageTab(state, "supply");
    return;
  }
  if (state.knowledgeUniversePageTab === "supply") {
    setKnowledgeUniversePageTab(state, "workbench");
    return;
  }
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.supplySectionExpanded = false;
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseWorkspaceDeliverablesExpanded(
  state: AppPortState,
  expanded: boolean,
) {
  if (expanded) {
    setKnowledgeUniversePageTab(state, "deliverables");
    return;
  }
  if (state.knowledgeUniversePageTab === "deliverables") {
    setKnowledgeUniversePageTab(state, "workbench");
    return;
  }
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.workspaceDeliverablesExpanded = false;
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseKbSearchHighlightKey(
  state: AppPortState,
  highlightKey: string | null,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.selectedKbSearchHighlightKey = highlightKey;
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export async function submitKnowledgeUniverseSearch(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const query = runtime.query.trim();
  if (!query) {
    runtime.searchPanelOpen = false;
    runtime.workspaceSearchGroups = [];
    runtime.workspaceSearchTotalCount = 0;
    runtime.workspaceSearchMode = null;
    runtime.selectedWorkspaceSearchHitId = null;
    runtime.selectedWorkspaceSearchDeliverableId = null;
    runtime.relationsInsightExpanded = false;
    runtime.selectedKbSearchHighlightKey = null;
    await refreshKnowledgeUniverseHome(state);
    return;
  }

  runtime.loading = true;
  runtime.error = null;
  runtime.searchPanelOpen = true;
  runtime.selectedWorkspaceSearchHitId = null;
  runtime.selectedWorkspaceSearchDeliverableId = null;
  runtime.relationsInsightExpanded = false;
  runtime.selectedKbSearchHighlightKey = null;
  syncToAppState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const [workspaceSearch, relationships] = await Promise.all([
      gateway.searchWorkspace({ query, limitPerGroup: 5 }),
      gateway.relationships({ query, focusNodeId: runtime.selectedNodeId }),
    ]);
    runtime.workspaceSearchGroups = workspaceSearch.groups;
    runtime.workspaceSearchTotalCount = workspaceSearch.totalCount;
    runtime.workspaceSearchMode = workspaceSearch.searchMode;
    runtime.searchResults =
      workspaceSearch.legacyResults.length > 0
        ? workspaceSearch.legacyResults
        : workspaceSearch.groups
            .flatMap((group) => group.hits)
            .filter((hit) => hit.objectId)
            .map(
              (hit) =>
                ({
                  id: hit.objectId!,
                  title: hit.title,
                  source: hit.group === "enterprise" ? "enterprise" : "personal",
                  kind: "document",
                  summary: hit.subtitle ?? "",
                  tags: [],
                  updatedAt: Date.now(),
                }) satisfies KnowledgeObject,
            );
    runtime.graph = relationships.graph;
    runtime.graphViewModel = buildHomeGraphViewModel(relationships.graph);
  } catch (error) {
    runtime.error = error instanceof Error ? error.message : runtimeMessageSearchWorkspaceFailed();
    runtime.workspaceSearchGroups = [];
    runtime.workspaceSearchTotalCount = 0;
    runtime.workspaceSearchMode = null;
  } finally {
    runtime.loading = false;
    syncToAppState(state, runtime);
    requestUpdate(state);
  }
}

export async function selectKnowledgeUniverseWorkspaceSearchHit(
  state: AppPortState,
  hit: WorkspaceSearchHit,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.selectedWorkspaceSearchHitId = hit.id;
  runtime.selectedWorkspaceSearchDeliverableId = hit.deliverableId ?? null;
  runtime.searchPanelOpen = false;
  syncToAppState(state, runtime);
  requestUpdate(state);

  if (hit.kbId) {
    runtime.selectedKnowledgeBaseId = hit.kbId;
    writeKnowledgeUniverseUiPrefs({ selectedKnowledgeBaseId: hit.kbId });
    syncToAppState(state, runtime);
    requestUpdate(state);
    navigateKnowledgeUniverseAnchor(KNOWLEDGE_UNIVERSE_ANCHORS.workspace);
    return;
  }

  if (hit.docId) {
    const kbId = hit.kbId ?? runtime.selectedKnowledgeBaseId;
    if (kbId) {
      if (hit.kbId && hit.kbId !== runtime.selectedKnowledgeBaseId) {
        setKnowledgeUniverseSelectedKnowledgeBase(state, hit.kbId);
      }
      const searchQuery = runtime.query.trim() || hit.title.trim();
      if (searchQuery) {
        runtime.query = searchQuery;
      }
      setKnowledgeUniverseSearchScope(state, "library");
      runtime.selectedKbSearchHighlightKey = hit.docId;
      syncToAppState(state, runtime);
      requestUpdate(state);
      if (searchQuery) {
        await searchKnowledgeUniverseKnowledgeBase(state);
      }
      navigateKnowledgeUniverseAnchor(KNOWLEDGE_UNIVERSE_ANCHORS.workspace, {
        focusId: KNOWLEDGE_UNIVERSE_ANCHORS.kbSearchFocus,
        block: "nearest",
      });
      return;
    }

    runtime.selectedKbSearchHighlightKey = hit.docId;
    syncToAppState(state, runtime);
    requestUpdate(state);
    navigateKnowledgeUniverseAnchor(KNOWLEDGE_UNIVERSE_ANCHORS.workspace, {
      focusId: KNOWLEDGE_UNIVERSE_ANCHORS.kbSearchFocus,
      block: "nearest",
    });
    return;
  }

  if (hit.nodeId) {
    await selectKnowledgeUniverseNode(state, hit.nodeId);
    return;
  }
  if (hit.objectId) {
    await selectKnowledgeUniverseObject(state, hit.objectId);
    return;
  }
  if (hit.deliverableId) {
    runtime.workspaceDeliverableStatusFilter = "all";
    syncToAppState(state, runtime);
    requestUpdate(state);
    navigateKnowledgeUniverseAnchor(KNOWLEDGE_UNIVERSE_ANCHORS.deliverables, {
      focusId: KNOWLEDGE_UNIVERSE_ANCHORS.deliverableFocus,
      block: "nearest",
    });
    return;
  }
  if (hit.capabilityId) {
    navigateKnowledgeUniverseAnchor(KNOWLEDGE_UNIVERSE_ANCHORS.capabilityCenter);
  }
}

export async function selectKnowledgeUniverseNode(
  state: AppPortState,
  nodeId: string | null,
  options?: { focusDocumentId?: string | null; knowledgeBaseId?: string | null },
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.selectedNodeId = nodeId;
  if (nodeId) {
    runtime.relationsInsightExpanded = true;
  }
  syncToAppState(state, runtime);
  requestUpdate(state);
  if (!nodeId) {
    runtime.selectedObject = null;
    syncToAppState(state, runtime);
    requestUpdate(state);
    return;
  }
  try {
    const snapshot = await loadKnowledgeUniverseHomeSnapshot({
      client: state.client,
      query: runtime.query,
      selectedNodeId: nodeId,
      selectedKnowledgeBaseId: options?.knowledgeBaseId?.trim() || runtime.selectedKnowledgeBaseId,
      focusDocumentId: options?.focusDocumentId ?? null,
    });
    runtime.graph = snapshot.graph;
    runtime.graphViewModel = snapshot.graphViewModel;
    runtime.selectedObject = snapshot.selectedObject;
    runtime.searchResults = snapshot.searchResults;
    runtime.recommendations = snapshot.recommendations;
    runtime.discoveryEvents = snapshot.discoveryEvents;
    runtime.actionSuggestions = snapshot.actionSuggestions;
    runtime.homeInsightsDegraded = snapshot.homeInsightsDegraded ?? false;
    runtime.recentVisits = snapshot.recentVisits;
    runtime.relatedGroups = snapshot.relatedGroups;
    runtime.personalVersions = [];
    if (snapshot.selectedObject?.source === "personal") {
      try {
        const versionGateway = createKnowledgeUniverseGateway(state.client);
        const versionsResponse = await versionGateway.listPersonalVersions({
          objectId: snapshot.selectedObject.id,
        });
        runtime.personalVersions = versionsResponse.versions;
      } catch {
        runtime.personalVersions = [];
      }
    }
    runtime.error = null;
  } catch (error) {
    runtime.error = error instanceof Error ? error.message : runtimeMessageLoadNodeDetailFailed();
  }
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export function adjustKnowledgeUniverseZoom(state: AppPortState, delta: number) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const next = Math.min(1.8, Math.max(0.6, runtime.graphZoom + delta));
  runtime.graphZoom = next;
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export function panKnowledgeUniverseGraph(state: AppPortState, dx: number, dy: number) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.graphPanX += dx;
  runtime.graphPanY += dy;
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export function resetKnowledgeUniverseGraphView(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.graphZoom = 1;
  runtime.graphPanX = 0;
  runtime.graphPanY = 0;
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseHoveredNode(state: AppPortState, nodeId: string | null) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.hoveredNodeId = nodeId;
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseHomeFocus(
  state: AppPortState,
  focus: KnowledgeHomeFocus | null,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.homeFocus = focus;
  if (focus?.kind === "document" || focus?.kind === "deliverable") {
    runtime.homeCockpitTab = "document";
    void import("./knowledge-universe-document-reader.ts").then((mod) => {
      void mod.loadKnowledgeUniverseDocumentReader(state);
    });
  } else if (focus) {
    runtime.homeCockpitTab = "relations";
  }
  if (focus) {
    if (focus.kind === "document") {
      const kbId = focus.kbId?.trim() || runtime.selectedKnowledgeBaseId || null;
      if (kbId && kbId !== runtime.selectedKnowledgeBaseId) {
        setKnowledgeUniverseSelectedKnowledgeBase(state, kbId, { preserveHomeFocus: true });
      }
      // Library document leaves use document ego subgraphs (obj:doc:*), not the KB-space
      // aggregate map. Always reload relationships with focusDocumentId when kbId is known.
      if (kbId) {
        const nodeId = documentKnowledgeNodeId(focus.id);
        runtime.selectedNodeId = nodeId;
        // Reset pan so auto-center can re-run for the new focus node.
        runtime.graphPanX = 0;
        runtime.graphPanY = 0;
        syncToAppState(state, runtime);
        requestUpdate(state);
        void selectKnowledgeUniverseNode(state, nodeId, {
          focusDocumentId: focus.id,
          knowledgeBaseId: kbId,
        });
        return;
      }
      const matchedNode = findRelationshipNodeByObjectIdCandidates(runtime.graph, focus.id);
      if (matchedNode) {
        runtime.selectedNodeId = matchedNode.id;
        syncToAppState(state, runtime);
        requestUpdate(state);
        void selectKnowledgeUniverseNode(state, matchedNode.id);
        return;
      }
      const preferredObjectId = resolvePreferredKnowledgeObjectId(focus.id);
      if (preferredObjectId) {
        syncToAppState(state, runtime);
        requestUpdate(state);
        void selectKnowledgeUniverseObject(state, preferredObjectId);
        return;
      }
    } else if (focus.kind === "knowledge-base") {
      const kbId = focus.kbId?.trim() || focus.id.trim();
      if (kbId) {
        setKnowledgeUniverseSelectedKnowledgeBase(state, kbId);
      }
      return;
    } else if (focus.kind === "deliverable") {
      runtime.selectedWorkspaceSearchDeliverableId = focus.id;
      if (focus.kbId && focus.kbId !== runtime.selectedKnowledgeBaseId) {
        setKnowledgeUniverseSelectedKnowledgeBase(state, focus.kbId, { preserveHomeFocus: true });
      }
      const deliverableObjectId = `obj:deliverable:${focus.id}`;
      const matchedNode = findRelationshipNodeByObjectIdCandidates(
        runtime.graph,
        deliverableObjectId,
      );
      const nodeId = matchedNode?.id ?? nodeIdForKnowledgeObject(deliverableObjectId);
      runtime.selectedNodeId = nodeId;
      syncToAppState(state, runtime);
      requestUpdate(state);
      void selectKnowledgeUniverseNode(state, nodeId);
      return;
    }
  }
  syncToAppState(state, runtime);
  requestUpdate(state);
}

function parseTagsInput(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveKnowledgeAgentId(state: AppPortState): string {
  const parsed = parseAgentSessionKey(state.sessionKey);
  return parsed?.agentId ?? "main";
}

export function setKnowledgeUniversePersonalCollectDraft(
  state: AppPortState,
  field: "title" | "summary" | "tags" | "url" | "dataset",
  value: string,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (field === "title") {
    runtime.personalCollectTitle = value;
  } else if (field === "summary") {
    runtime.personalCollectSummary = value;
  } else if (field === "url") {
    runtime.personalCollectUrl = value;
  } else if (field === "dataset") {
    runtime.personalDatasetText = value;
  } else {
    runtime.personalCollectTags = value;
  }
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export async function quickCreateKnowledgeUniverseKnowledgeBase(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (runtime.selectedKnowledgeBaseId) {
    return;
  }
  if (!runtime.newKnowledgeBaseTitle.trim()) {
    setKnowledgeUniverseNewKnowledgeBaseTitle(state, libraryCreateDefaultQuickTitle());
  }
  await createKnowledgeUniverseKnowledgeBase(state);
}

export async function collectKnowledgeUniversePersonal(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  runtime.personalActionNotice = null;
  syncToAppState(state, runtime);
  requestUpdate(state);
  try {
    const kbId = requireSelectedKnowledgeBaseId(state);
    const afterEnsure = getKnowledgeUniverseRuntime(state);
    if (!kbId) {
      return;
    }
    const gateway = createKnowledgeUniverseGateway(state.client);
    const response = await gateway.collectPersonal({
      title: afterEnsure.personalCollectTitle,
      summary: afterEnsure.personalCollectSummary,
      tags: parseTagsInput(afterEnsure.personalCollectTags),
      sourceAgentId: resolveKnowledgeAgentId(state),
      contextId: state.sessionKey,
      knowledgeBaseId: kbId,
    });
    afterEnsure.personalCollectTitle = "";
    afterEnsure.personalCollectSummary = "";
    afterEnsure.personalCollectTags = "";
    afterEnsure.personalActionNotice = appendPersonalCompatWarnings(
      personalNoticeCollected(),
      response.compatWarnings,
    );
    await syncKnowledgeBaseAfterPersonalMutation(state, response);
    await refreshKnowledgeUniverseHome(state);
    await loadKnowledgeUniverseGovernance(state);
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error ? error.message : personalMessageCollectFailed();
  } finally {
    runtime.personalActionBusy = false;
    syncToAppState(state, runtime);
    requestUpdate(state);
  }
}

export async function collectWebKnowledgeUniversePersonal(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const url = runtime.personalCollectUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    runtime.personalActionError = personalMessageUrlRequired();
    syncToAppState(state, runtime);
    requestUpdate(state);
    return;
  }
  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  runtime.personalActionNotice = null;
  syncToAppState(state, runtime);
  requestUpdate(state);
  try {
    const kbId = requireSelectedKnowledgeBaseId(state);
    const afterEnsure = getKnowledgeUniverseRuntime(state);
    if (!kbId) {
      return;
    }
    const gateway = createKnowledgeUniverseGateway(state.client);
    const response = await gateway.collectWebPersonal({
      url,
      tags: parseTagsInput(afterEnsure.personalCollectTags),
      knowledgeBaseId: kbId,
    });
    afterEnsure.personalCollectUrl = "";
    afterEnsure.personalActionNotice = appendPersonalCompatWarnings(
      personalNoticeWebCollected(),
      response.compatWarnings,
    );
    await syncKnowledgeBaseAfterPersonalMutation(state, response);
    await refreshKnowledgeUniverseHome(state);
    await loadKnowledgeUniverseGovernance(state);
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error ? error.message : personalMessageCollectFailed();
  } finally {
    runtime.personalActionBusy = false;
    syncToAppState(state, runtime);
    requestUpdate(state);
  }
}

export async function importDatasetKnowledgeUniversePersonal(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const records = runtime.personalDatasetText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((text) => ({ text }));
  if (records.length === 0) {
    runtime.personalActionError = personalMessageDatasetEmpty();
    syncToAppState(state, runtime);
    requestUpdate(state);
    return;
  }
  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  runtime.personalActionNotice = null;
  syncToAppState(state, runtime);
  requestUpdate(state);
  try {
    const kbId = requireSelectedKnowledgeBaseId(state);
    const afterEnsure = getKnowledgeUniverseRuntime(state);
    if (!kbId) {
      return;
    }
    const gateway = createKnowledgeUniverseGateway(state.client);
    const response = await gateway.importDatasetPersonal({
      datasetTitle: afterEnsure.personalCollectTitle.trim() || personalDatasetDefaultTitle(),
      records,
      knowledgeBaseId: kbId,
    });
    afterEnsure.personalDatasetText = "";
    afterEnsure.personalActionNotice = appendPersonalCompatWarnings(
      personalNoticeDatasetImported(response.imported),
      response.compatWarnings,
    );
    await syncKnowledgeBaseAfterPersonalMutation(state, response);
    await refreshKnowledgeUniverseHome(state);
    await loadKnowledgeUniverseGovernance(state);
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error ? error.message : personalMessageCollectFailed();
  } finally {
    runtime.personalActionBusy = false;
    syncToAppState(state, runtime);
    requestUpdate(state);
  }
}

export async function pickKnowledgeUniversePersonalUploadFile(state: AppPortState, file: File) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.personalActionError = null;
  if (!isSupportedPersonalDocument(file.name, file.type)) {
    runtime.personalActionError = personalMessageUnsupportedFileType();
    syncToAppState(state, runtime);
    requestUpdate(state);
    return;
  }
  try {
    runtime.personalUploadAttachment = await readPersonalDocumentUpload(file);
    runtime.personalActionNotice = personalNoticeFileSelected(file.name);
  } catch (error) {
    runtime.personalUploadAttachment = null;
    runtime.personalActionError =
      error instanceof Error ? error.message : personalMessageReadFileFailed();
  }
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export async function uploadKnowledgeUniversePersonal(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!runtime.personalUploadAttachment) {
    runtime.personalActionError = personalMessageSelectFileFirst();
    syncToAppState(state, runtime);
    requestUpdate(state);
    return;
  }
  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  runtime.personalActionNotice = null;
  syncToAppState(state, runtime);
  requestUpdate(state);
  try {
    const kbId = requireSelectedKnowledgeBaseId(state);
    const afterEnsure = getKnowledgeUniverseRuntime(state);
    if (!kbId) {
      return;
    }
    const attachment = afterEnsure.personalUploadAttachment;
    if (!attachment) {
      runtime.personalActionError = personalMessageSelectFileFirst();
      syncToAppState(state, runtime);
      requestUpdate(state);
      return;
    }
    const gateway = createKnowledgeUniverseGateway(state.client);
    const response = await gateway.uploadPersonal({
      title: afterEnsure.personalCollectTitle,
      summary: afterEnsure.personalCollectSummary,
      tags: parseTagsInput(afterEnsure.personalCollectTags),
      attachment,
      sourceAgentId: resolveKnowledgeAgentId(state),
      knowledgeBaseId: kbId,
    });
    runtime.personalCollectTitle = "";
    runtime.personalCollectSummary = "";
    runtime.personalCollectTags = "";
    runtime.personalUploadAttachment = null;
    runtime.personalActionNotice = appendPersonalCompatWarnings(
      personalNoticeUploaded(),
      response.compatWarnings,
    );
    await syncKnowledgeBaseAfterPersonalMutation(state, response);
    await refreshKnowledgeUniverseHome(state);
    await loadKnowledgeUniverseGovernance(state);
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error ? error.message : personalMessageUploadFailed();
  } finally {
    runtime.personalActionBusy = false;
    syncToAppState(state, runtime);
    requestUpdate(state);
  }
}

export async function previewKnowledgeUniverseCapability(
  state: AppPortState,
  capabilityId: string,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.capabilityPreview = { capabilityId, busy: true, items: [], error: null };
  syncToAppState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const response = await gateway.previewCapability({ capabilityId, limit: 5 });
    runtime.capabilityPreview = {
      capabilityId,
      busy: false,
      items: response.preview.items,
      error: null,
    };
  } catch (error) {
    runtime.capabilityPreview = {
      capabilityId,
      busy: false,
      items: [],
      error: error instanceof Error ? error.message : runtimeMessageCapabilityRequestFailed(),
    };
  } finally {
    syncToAppState(state, runtime);
    requestUpdate(state);
  }
}

export async function invokeKnowledgeUniverseCapability(state: AppPortState, capabilityId: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.capabilityInvocation = {
    capabilityId,
    busy: true,
    ok: false,
    accessState: "",
    reason: null,
    data: null,
    auditId: null,
    error: null,
  };
  syncToAppState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const response = await gateway.invokeCapability({ capabilityId });
    runtime.capabilityInvocation = {
      capabilityId,
      busy: false,
      ok: response.ok,
      accessState: response.accessState,
      reason: response.reason ?? null,
      data: response.data ?? null,
      auditId: response.auditId ?? null,
      error: null,
    };
  } catch (error) {
    runtime.capabilityInvocation = {
      capabilityId,
      busy: false,
      ok: false,
      accessState: "",
      reason: null,
      data: null,
      auditId: null,
      error: error instanceof Error ? error.message : runtimeMessageCapabilityRequestFailed(),
    };
  } finally {
    syncToAppState(state, runtime);
    requestUpdate(state);
  }
}

export async function requestKnowledgeUniverseDataAccess(
  state: AppPortState,
  capabilityId: string,
  capabilityTitle: string,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.accessRequestBusyCapabilityId = capabilityId;
  runtime.accessRequestNotice = null;
  syncToAppState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const response = await gateway.requestAccess({ capabilityId, capabilityTitle });
    runtime.accessRequestNotice = runtimeNoticeCapabilityAccessSubmitted(
      response.request.capabilityTitle,
    );
    await refreshKnowledgeUniverseHome(state);
  } catch (error) {
    runtime.accessRequestNotice = null;
    runtime.error =
      error instanceof Error ? error.message : runtimeMessageCapabilityRequestFailed();
  } finally {
    runtime.accessRequestBusyCapabilityId = null;
    syncToAppState(state, runtime);
    requestUpdate(state);
  }
}

export async function requestKnowledgeUniverseEnterpriseAccess(
  state: AppPortState,
  projectionId: string,
  projectionTitle: string,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.accessRequestBusyProjectionId = projectionId;
  runtime.accessRequestNotice = null;
  syncToAppState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const response = await gateway.requestEnterpriseAccess({ projectionId, projectionTitle });
    runtime.accessRequestNotice = runtimeNoticeEnterpriseAccessSubmitted(
      response.request.projectionTitle,
    );
  } catch (error) {
    runtime.accessRequestNotice = null;
    runtime.error =
      error instanceof Error ? error.message : runtimeMessageEnterpriseAccessRequestFailed();
  } finally {
    runtime.accessRequestBusyProjectionId = null;
    syncToAppState(state, runtime);
    requestUpdate(state);
  }
}

export async function openKnowledgeUniversePersonalManage(
  state: AppPortState,
  objectId: string,
  title: string,
  tags: string[],
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.personalManageObjectId = objectId;
  runtime.personalManageObjectTitle = title;
  runtime.personalManageTags = tags.join(", ");
  runtime.personalManageNotice = null;
  runtime.personalVersionDiff = null;
  runtime.personalManageBusy = true;
  syncToAppState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const response = await gateway.listPersonalVersions({ objectId });
    runtime.personalVersions = response.versions;
    runtime.personalVersionCompareFrom = response.versions[0]?.version ?? "";
    runtime.personalVersionCompareTo =
      response.versions[response.versions.length - 1]?.version ?? "";
  } catch (error) {
    runtime.personalManageNotice =
      error instanceof Error ? error.message : personalManageMessageLoadVersionsFailed();
    runtime.personalVersions = [];
  } finally {
    runtime.personalManageBusy = false;
    syncToAppState(state, runtime);
    state.knowledgeUniversePageTab = "personal";
    state.knowledgeUniverseBrowseSubTab = "private";
    state.knowledgeUniversePersonalCollectDrawerOpen = true;
    state.knowledgeUniversePersonalDrawerMode = "manage";
    writeKnowledgeUniverseUiPrefs({ pageTab: "personal", browseSubTab: "private" });
    requestUpdate(state);
  }
}

export function setKnowledgeUniversePersonalManageTags(state: AppPortState, value: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.personalManageTags = value;
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniversePersonalVersionCompareFrom(state: AppPortState, value: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.personalVersionCompareFrom = value;
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniversePersonalVersionCompareTo(state: AppPortState, value: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.personalVersionCompareTo = value;
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export async function saveKnowledgeUniversePersonalTags(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!runtime.personalManageObjectId) {
    return;
  }
  runtime.personalManageBusy = true;
  runtime.personalManageNotice = null;
  syncToAppState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    await gateway.updatePersonalTags({
      objectId: runtime.personalManageObjectId,
      tags: parseTagsInput(runtime.personalManageTags),
    });
    runtime.personalManageNotice = personalManageNoticeTagsUpdated();
    await refreshKnowledgeUniverseHome(state);
    const versions = await gateway.listPersonalVersions({
      objectId: runtime.personalManageObjectId,
    });
    runtime.personalVersions = versions.versions;
  } catch (error) {
    runtime.personalManageNotice =
      error instanceof Error ? error.message : personalManageMessageTagsUpdateFailed();
  } finally {
    runtime.personalManageBusy = false;
    syncToAppState(state, runtime);
    requestUpdate(state);
  }
}

export async function compareKnowledgeUniversePersonalVersions(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (
    !runtime.personalManageObjectId ||
    !runtime.personalVersionCompareFrom ||
    !runtime.personalVersionCompareTo
  ) {
    return;
  }
  runtime.personalManageBusy = true;
  runtime.personalManageNotice = null;
  syncToAppState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const response = await gateway.comparePersonalVersions({
      objectId: runtime.personalManageObjectId,
      fromVersion: runtime.personalVersionCompareFrom,
      toVersion: runtime.personalVersionCompareTo,
    });
    runtime.personalVersionDiff = response.diff;
  } catch (error) {
    runtime.personalManageNotice =
      error instanceof Error ? error.message : personalManageMessageVersionCompareFailed();
    runtime.personalVersionDiff = null;
  } finally {
    runtime.personalManageBusy = false;
    syncToAppState(state, runtime);
    requestUpdate(state);
  }
}

export async function selectKnowledgeUniverseObject(state: AppPortState, objectId: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!objectId.trim()) {
    runtime.selectedObject = null;
    runtime.selectedNodeId = null;
    runtime.relatedGroups = null;
    runtime.error = null;
    syncToAppState(state, runtime);
    requestUpdate(state);
    return;
  }
  const objectCandidates = buildKnowledgeObjectIdCandidates(objectId);
  const matchedNode =
    objectCandidates
      .map((candidate) => findRelationshipNodeByObjectIdCandidates(runtime.graph, candidate))
      .find((node): node is NonNullable<typeof node> => node !== null) ?? null;
  if (matchedNode) {
    await selectKnowledgeUniverseNode(state, matchedNode.id);
    return;
  }
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    let response = null;
    for (const candidate of objectCandidates) {
      response = await gateway.object({ objectId: candidate });
      if (response?.object) {
        break;
      }
    }
    runtime.selectedObject = response?.object ?? null;
    runtime.selectedNodeId = null;
    if (response?.object) {
      runtime.relationsInsightExpanded = true;
      const [related, recorded, focusRecommendations, focusActions] = await Promise.all([
        gateway.related({ objectId: response.object.id }),
        gateway.recordRecent({ objectId: response.object.id }),
        gateway.recommendations({ limit: 4, focusObjectId: response.object.id }),
        gateway.actions({ limit: 4, focusObjectId: response.object.id }),
      ]);
      runtime.relatedGroups = related;
      runtime.recentVisits = recorded.visits;
      runtime.recommendations = focusRecommendations.recommendations;
      runtime.actionSuggestions = focusActions.actions;
    } else {
      runtime.relatedGroups = null;
    }
    runtime.error = null;
  } catch (error) {
    runtime.error =
      error instanceof Error ? error.message : runtimeMessageLoadKnowledgeObjectFailed();
  }
  syncToAppState(state, runtime);
  requestUpdate(state);
}

export function dismissKnowledgeUniverseHomeInsightsNotice(state: AppPortState) {
  dismissHomeInsightsNotice();
  requestUpdate(state);
}

export async function bindKnowledgeUniverseSource(state: AppPortState) {
  const { bindKnowledgeUniverseHttpRestSource } =
    await import("./knowledge-universe-connector-bind.ts");
  await bindKnowledgeUniverseHttpRestSource(state);
}

export { readHomeInsightsNoticeDismissed };
