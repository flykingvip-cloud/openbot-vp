import type {
  DataConnectorCatalogEntry,
  DataConnectorCredentialRecord,
} from "../../../capability/enterprise-data-capability/types.ts";
import type {
  KnowledgeGovernanceSummary,
  KnowledgeGovernanceTask,
  KnowledgePersonalDocumentAttachment,
} from "../../../capability/knowledge-universe/endpoints.ts";
import type { PersonalDocumentUploadAttachment } from "../../../capability/knowledge-universe/personal-document-upload.ts";
import type {
  DataCapabilityDescriptor,
  ExternalDataSourceSummary,
  GraphViewModel,
  KnowledgeActionSuggestion,
  KnowledgeDiscoveryEvent,
  KnowledgeObject,
  KnowledgeRecommendationItem,
  KnowledgeRecentVisit,
  KnowledgeRelatedGroups,
  KnowledgeSourceBrowse,
  KnowledgeSourceSummary,
  PersonalKnowledgeVersionDiff,
  PersonalKnowledgeVersionSummary,
  RelationshipGraph,
} from "../../../capability/knowledge-universe/types.ts";
import type {
  DeliverableDetailFocus,
  DeliverableGovernanceAction,
  KnowledgeBaseSummary,
  KnowledgeEvidenceDto,
  WorkspaceDeliverableDto,
  WorkspaceDeliverableTraceDto,
  WorkspaceSearchGroup,
  WorkspaceSearchHit,
  WorkspaceSearchMode,
} from "../../../capability/knowledge-universe/workspace-endpoints.ts";
import type {
  DatasetImportPreview,
  DatasetImportTab,
} from "../../../views/knowledge-universe-dataset-import.ts";
import type { SpaceConnectorBindDraft } from "../../../views/knowledge-universe-space-connector-bind.ts";
import type {
  WebUrlImportMode,
  WebUrlSyncSchedule,
} from "../../../views/knowledge-universe-url-import.ts";
import type {
  WorkbenchDaibaiOverviewCapabilityContract,
  WorkbenchViewCapabilityContract,
} from "./workbench-capability-contracts.ts";
import type { WorkbenchProps } from "./workbench-types.ts";

export type WorkspaceDeliverableStatusFilter =
  | "all"
  | "draft"
  | "in_progress"
  | "done"
  | "archived";

export type KnowledgeUniversePageTab =
  | "workbench"
  | "relations"
  | "supply"
  | "personal"
  | "deliverables"
  | "deliverableDetail"
  | "libraryCreate"
  | "spaceImport"
  | "assets"
  | "governance";

/**
 * Supply-page facet: visibility-aligned space lists + active capabilities plane.
 * Legacy prefs may still store `personal` (→ private) or omit `team`.
 */
export type KnowledgeUniverseBrowseSubTab =
  | "private"
  | "team"
  | "enterprise"
  | "capabilities"
  /** @deprecated Prefer `private` — kept for prefs / deep-link compatibility. */
  | "personal";

export type KnowledgeUniversePersonalDrawerMode = "collect" | "upload" | "manage";

export type SpaceImportKind = "localFolder" | "url" | "note" | "active" | "vaultSync";

export type ActiveSourceBindKind = "api" | "external" | "capability";

export type KnowledgeUniverseSearchScope = "workspace" | "library";

/**
 * Primary content tabs shown in the library workspace shell.
 * Legacy values `datasets` | `web` | `agent` are still accepted for prefs/API
 * compatibility and normalize to `documents` + a materials kind filter.
 */
export type LibraryWorkspaceContentTab =
  | "documents"
  | "snippets"
  | "datasets"
  | "web"
  | "agent"
  | "recycle";

/** Primary tabs only (materials / evidence / recycle). */
export type LibraryWorkspacePrimaryContentTab = "documents" | "snippets" | "recycle";

/**
 * Kind chips on the materials tab — replaces top-level 数据集/网页/Agent tabs.
 * `document` covers document | upload | note rows.
 */
export type LibraryWorkspaceMaterialsKindFilter =
  | "all"
  | "document"
  | "web"
  | "dataset"
  | "agent"
  | "active";

export type LibraryWorkspaceSourcesPlaneFilter = "all" | "passive" | "active";

export type KnowledgeHomeFocusKind = "document" | "deliverable" | "task" | "knowledge-base";

export type KnowledgeHomeCockpitTab = "relations" | "document";

export type KnowledgeDocumentReaderState = {
  loading: boolean;
  saving: boolean;
  editing: boolean;
  dirty: boolean;
  error: string | null;
  docKey: string | null;
  preview:
    | import("../../../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeDocumentPreviewResponse
    | null;
  draftText: string;
};

export type KnowledgeHomeFocus = {
  kind: KnowledgeHomeFocusKind;
  id: string;
  kbId?: string | null;
};

export type WorkbenchKnowledgeSurface = {
  loading: boolean;
  /** Relation graph request still in flight. Optional so older fixtures stay valid. */
  graphLoading?: boolean;
  /** Recommendations / actions / discovery still in flight. Optional so older fixtures stay valid. */
  insightsLoading?: boolean;
  error: string | null;
  query: string;
  searchScope: KnowledgeUniverseSearchScope;
  pageTab: KnowledgeUniversePageTab;
  browseSubTab: KnowledgeUniverseBrowseSubTab;
  personalCollectDrawerOpen: boolean;
  personalDrawerMode: KnowledgeUniversePersonalDrawerMode;
  homeFocus: KnowledgeHomeFocus | null;
  homeCockpitTab?: KnowledgeHomeCockpitTab;
  documentReader?: KnowledgeDocumentReaderState | null;
  selectedNodeId: string | null;
  selectedObject: KnowledgeObject | null;
  sourceSummary: KnowledgeSourceSummary | null;
  graph: RelationshipGraph | null;
  graphViewModel: GraphViewModel | null;
  searchResults: KnowledgeObject[];
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
  dataCapabilities: DataCapabilityDescriptor[];
  sourceBrowse: KnowledgeSourceBrowse;
  externalDataSources: ExternalDataSourceSummary[];
  personalCollectTitle: string;
  personalCollectSummary: string;
  personalCollectTags: string;
  personalCollectUrl?: string;
  personalDatasetText?: string;
  personalUploadAttachment: KnowledgePersonalDocumentAttachment | null;
  personalActionBusy: boolean;
  personalActionNotice: string | null;
  personalActionError: string | null;
  /** Live import/connect progress. Optional so older surface fixtures stay valid. */
  importProgress?: { current: number; total: number; label: string } | null;
  accessRequestBusyCapabilityId: string | null;
  accessRequestBusyProjectionId: string | null;
  accessRequestNotice: string | null;
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
  homeInsightsDegraded: boolean;
  homeInsightsNoticeDismissed: boolean;
  recentVisits: KnowledgeRecentVisit[];
  relatedGroups: KnowledgeRelatedGroups | null;
  /** Current viewer's display name, used to label the self-owner node ("我") in relations detail. */
  viewerOwnerLabel: string | null;
  hoveredNodeId: string | null;
  graphZoom: number;
  graphPanX: number;
  graphPanY: number;
  knowledgeBases: KnowledgeBaseSummary[];
  selectedKnowledgeBaseId: string | null;
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
  newKnowledgeBaseVisibility: KnowledgeBaseSummary["visibility"];
  workspaceDeliverableTrace: WorkspaceDeliverableTraceDto | null;
  workspaceDeliverableTraceLoading: boolean;
  deliverableDetailFocus: DeliverableDetailFocus | null;
  pinnedKnowledgeBaseIds: string[];
  favoriteKnowledgeBaseIds: string[];
  /** Folder rows currently expanded in the left directory tree. Independent of selection. */
  expandedKnowledgeBaseIds: string[];
  /** Per-space document cache so favorites funnel / collapsed folders can render without a select. */
  treeDocumentsByKbId: Record<
    string,
    import("../../../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseDocumentSummaryDto[]
  >;
  treeSourcesByKbId: Record<
    string,
    import("../../../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseSourceListItemDto[]
  >;
  treeDocumentsLoadingByKbId: Record<string, boolean>;
  libraryWorkspaceContentTab: LibraryWorkspaceContentTab;
  /** Kind chips on the materials tab (all / document / web / dataset / agent / active). */
  libraryWorkspaceMaterialsKindFilter: LibraryWorkspaceMaterialsKindFilter;
  libraryWorkspaceDocuments: import("../../../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseDocumentSummaryDto[];
  libraryWorkspaceDocumentsLoading: boolean;
  libraryWorkspaceSources: import("../../../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseSourceListItemDto[];
  libraryWorkspaceSourcesLoading: boolean;
  libraryWorkspaceSourcesPlaneFilter: LibraryWorkspaceSourcesPlaneFilter;
  /** Selected document ids for multi-select delete in the sources table. */
  libraryWorkspaceSelectedDocumentIds: string[];
  libraryWorkspaceSnippets: import("../../../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseSnippetSummaryDto[];
  libraryWorkspaceSnippetsLoading: boolean;
  libraryWorkspaceRecycleDocuments: import("../../../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseDocumentSummaryDto[];
  libraryWorkspaceRecycleLoading: boolean;
  libraryWorkspaceEvictedChunks: import("../../../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseEvictedChunkSummaryDto[];
  libraryWorkspaceWebPages: import("../../../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseWebPageSummaryDto[];
  libraryWorkspaceWebPagesLoading: boolean;
  libraryWorkspaceDatasets: import("../../../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseDatasetSummaryDto[];
  libraryWorkspaceDatasetsLoading: boolean;
  libraryWorkspaceAgentKnowledge: import("../../../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseAgentKnowledgeDto[];
  libraryWorkspaceAgentKnowledgeLoading: boolean;
  libraryWorkspaceMembers: import("../../../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseMemberDto[];
  libraryWorkspaceMembersLoading: boolean;
  libraryWorkspaceInviteDrawerOpen: boolean;
  libraryWorkspaceInviteEmail: string;
  libraryWorkspaceInviteRole: import("../../../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseMemberRoleDto;
  libraryWorkspaceSettingsKbId: string | null;
  libraryWorkspaceSettingsTitle: string;
  libraryWorkspaceInlineRenameKbId: string | null;
  libraryWorkspaceImportOpen: boolean;
  /** When true, import drawer shows a locked target label (space-detail entry). */
  libraryWorkspaceImportLockSpace: boolean;
  libraryWorkspaceImportKind: SpaceImportKind | null;
  libraryWorkspaceBindSourceKind: ActiveSourceBindKind;
  libraryWorkspaceBindSourceTitle: string;
  libraryWorkspaceBindSourceEndpoint: string;
  libraryWorkspaceLocalFolderPath: string;
  libraryWorkspaceLocalFolderLabel: string;
  libraryWorkspaceLocalFolderDeletePolicy: import("../../../capability/knowledge-universe/endpoints.ts").LocalFolderDeletePolicy;
  libraryWorkspaceLocalFolderWatcherEnabled: boolean;
  libraryWorkspaceLocalFolderMode: import("../../../capability/knowledge-universe/endpoints.ts").LocalFolderBindingMode;
  libraryWorkspaceLocalFolderStatusItems: import("../../../capability/knowledge-universe/endpoints.ts").LocalFolderStatusItem[];
  vaultSyncRootPath?: string;
  vaultSyncPassword?: string;
  vaultSyncStatus?: string | null;
  vaultSyncVaultId?: string | null;
  vaultSyncDeviceId?: string | null;
  vaultSyncRevisionId?: string;
  vaultSyncIncludeImages?: boolean;
  vaultSyncExcludeGlobsText?: string;
  vaultSyncDevices?: Array<{
    deviceId: string;
    status?: string;
    platform?: string;
    label?: string;
  }>;
  vaultSyncTeamEnabled?: boolean;
  vaultSyncMembers?: Array<{
    memberAccountId: string;
    role?: string;
    status?: string;
    joinedAt?: string;
  }>;
  vaultSyncInvites?: Array<{
    inviteId: string;
    inviteeAccountId?: string | null;
    role?: string;
    status?: string;
    expiresAt?: string;
  }>;
  vaultSyncInviteeAccountId?: string;
  vaultSyncAcceptInviteId?: string;
  vaultSyncInviteSecret?: string;
  vaultSyncLastCreatedInviteSecret?: string | null;
  enterpriseTenantId: string | null;
  libraryWorkspaceConnectorBindDraft: SpaceConnectorBindDraft;
  libraryWorkspaceConnectorCatalog: DataConnectorCatalogEntry[];
  libraryWorkspaceConnectorCatalogLoading: boolean;
  libraryWorkspaceConnectorCatalogError: string | null;
  libraryWorkspaceConnectorCredentials: DataConnectorCredentialRecord[];
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
  libraryWorkspaceDatasetImportTab: DatasetImportTab;
  libraryWorkspaceDatasetFileAttachment: PersonalDocumentUploadAttachment | null;
  libraryWorkspaceDatasetPreview: DatasetImportPreview | null;
  libraryWorkspaceDatasetPreviewError: string | null;
  libraryWorkspaceUrlImportMode: WebUrlImportMode;
  libraryWorkspaceUrlImportText: string;
  libraryWorkspaceUrlImportAdvancedOpen: boolean;
  libraryWorkspaceUrlSyncSchedule: WebUrlSyncSchedule;
  libraryWorkspaceUrlStripNavAds: boolean;
  libraryWorkspaceUrlMainContentOnly: boolean;
  libraryWorkspaceNoteTags: string[];
  libraryWorkspaceNoteTagDraft: string;
  libraryWorkspaceNoteTagSuggestionsOpen: boolean;
  libraryWorkspaceNoteTagHistory: string[];
  libraryWorkspaceNoteAiBusy: boolean;
  libraryWorkspaceFileImportItems: import("../../../views/knowledge-universe-file-import.ts").FileImportQueueItem[];
  libraryWorkspaceFileImportAdvancedOpen: boolean;
  libraryWorkspaceFileChunkingStrategy: import("../../../views/knowledge-universe-file-import.ts").FileChunkingStrategy;
  libraryWorkspaceFileOcrEnabled: boolean;
  /** Session email for write-role checks in shared spaces. */
  actorEmail?: string | null;
  selectedKnowledgeBaseCanWrite: boolean;
  searchPanelOpen: boolean;
  governanceSummary: KnowledgeGovernanceSummary | null;
  governanceTasks: KnowledgeGovernanceTask[];
  governanceLoading: boolean;
  governanceError: string | null;
  governanceNotice: string | null;
  governanceTaskBusyId: string | null;
  governanceSelectedTaskId: string | null;
  governanceTaskGraph: RelationshipGraph | null;
  governanceTaskGraphViewModel: GraphViewModel | null;
  governanceTaskGraphLoading: boolean;
  governanceTaskGraphZoom: number;
  governanceTaskGraphPanX: number;
  governanceTaskGraphPanY: number;
  governanceTaskGraphSelectedNodeId: string | null;
  governanceTaskGraphHoveredNodeId: string | null;
  onQueryChange: (query: string) => void;
  onSearchScopeChange: (scope: KnowledgeUniverseSearchScope) => void;
  onPageTabChange: (tab: KnowledgeUniversePageTab) => void;
  onBrowseSubTabChange: (tab: KnowledgeUniverseBrowseSubTab) => void;
  onPersonalCollectDrawerOpenChange: (
    open: boolean,
    mode?: KnowledgeUniversePersonalDrawerMode,
  ) => void;
  onSearch: () => Promise<void>;
  onSelectWorkspaceSearchHit: (hit: WorkspaceSearchHit) => Promise<void>;
  onSelectNode: (nodeId: string) => Promise<void>;
  onHomeFocusChange: (focus: KnowledgeHomeFocus | null) => void;
  onHomeCockpitTabChange?: (tab: KnowledgeHomeCockpitTab) => void;
  onDocumentReaderEdit?: () => void;
  onDocumentReaderCancel?: () => void;
  onDocumentReaderDraftChange?: (value: string) => void;
  onDocumentReaderSave?: () => Promise<void>;
  onDocumentReaderDelete?: () => Promise<void>;
  onHoverNode: (nodeId: string | null) => void;
  onZoom: (delta: number) => void;
  onPan: (dx: number, dy: number) => void;
  onResetView: () => void;
  onPersonalCollectDraftChange: (
    field: "title" | "summary" | "tags" | "url" | "dataset",
    value: string,
  ) => void;
  onPersonalCollect: () => Promise<void>;
  onPickPersonalUploadFile: (file: File) => Promise<void>;
  onPersonalUpload: () => Promise<void>;
  onCollectWebPersonal?: () => Promise<void>;
  onImportDatasetPersonal?: () => Promise<void>;
  onOpenMyAccumulation: () => void;
  onSelectKnowledgeObject: (objectId: string) => Promise<void>;
  onRequestDataCapabilityAccess: (capabilityId: string, title: string) => Promise<void>;
  capabilityPreview?:
    | import("../../../capability/knowledge-universe/types.ts").KnowledgeCapabilityPreviewState
    | null;
  onPreviewCapability?: (capabilityId: string) => Promise<void>;
  capabilityInvocation?:
    | import("../../../capability/knowledge-universe/types.ts").KnowledgeCapabilityInvocationState
    | null;
  onInvokeCapability?: (capabilityId: string) => Promise<void>;
  onRequestEnterpriseKnowledgeAccess: (projectionId: string, title: string) => Promise<void>;
  onManagePersonalObject: (objectId: string, title: string, tags: string[]) => Promise<void>;
  onPersonalManageTagsChange: (value: string) => void;
  onSavePersonalTags: () => Promise<void>;
  onPersonalVersionCompareFromChange: (value: string) => void;
  onPersonalVersionCompareToChange: (value: string) => void;
  onComparePersonalVersions: () => Promise<void>;
  onSelectKnowledgeBase: (kbId: string) => void;
  onLibraryWorkspaceContentTabChange: (tab: LibraryWorkspaceContentTab) => void;
  onLibraryWorkspaceMaterialsKindFilterChange: (
    filter: LibraryWorkspaceMaterialsKindFilter,
  ) => void;
  onLibraryWorkspaceSourcesPlaneFilterChange: (filter: LibraryWorkspaceSourcesPlaneFilter) => void;
  onLibraryWorkspaceInvite: () => void;
  onLibraryWorkspaceTabActionUnavailable: () => void;
  onLibraryWorkspaceImportOpenChange: (open: boolean, options?: { lockSpace?: boolean }) => void;
  /** Create/select personal space then open the locked import page (录入知识 with no private space). */
  onEnsurePersonalSpaceForImport?: () => Promise<void>;
  onLibraryWorkspaceImportKindChange: (kind: SpaceImportKind | null) => void;
  onLibraryWorkspaceBindSourceDraftChange: (
    field: "kind" | "title" | "endpoint",
    value: string,
  ) => void;
  onBindKnowledgeSource: () => Promise<void>;
  onLibraryWorkspaceLocalFolderPathChange?: (value: string) => void;
  onLibraryWorkspaceLocalFolderLabelChange?: (value: string) => void;
  onLibraryWorkspaceLocalFolderDeletePolicyChange?: (
    value: import("../../../capability/knowledge-universe/endpoints.ts").LocalFolderDeletePolicy,
  ) => void;
  onLibraryWorkspaceLocalFolderWatcherEnabledChange?: (enabled: boolean) => void;
  onLibraryWorkspaceLocalFolderModeChange?: (
    mode: import("../../../capability/knowledge-universe/endpoints.ts").LocalFolderBindingMode,
  ) => void;
  onPickLocalFolderPath?: () => Promise<void>;
  onBindLocalFolder?: () => Promise<void>;
  onLoadLocalFolderStatus?: () => Promise<void>;
  onScanLocalFolderNow?: (bindingId: string) => Promise<void>;
  onVaultSyncRootPathChange?: (value: string) => void;
  onVaultSyncPasswordChange?: (value: string) => void;
  onVaultSyncRevisionIdChange?: (value: string) => void;
  onVaultSyncIncludeImagesChange?: (value: boolean) => void;
  onVaultSyncExcludeGlobsTextChange?: (value: string) => void;
  onPickVaultSyncFolder?: () => Promise<void>;
  onCreateVaultSync?: () => Promise<void>;
  onSyncVaultNow?: () => Promise<void>;
  onRestoreVaultRevision?: () => Promise<void>;
  onLoadVaultSyncSelective?: () => Promise<void>;
  onSaveVaultSyncSelective?: () => Promise<void>;
  onLoadVaultSyncDevices?: () => Promise<void>;
  onRevokeVaultSyncDevice?: (deviceId: string) => Promise<void>;
  onRefreshVaultSyncTeam?: () => Promise<void>;
  onEnableVaultSyncTeam?: () => Promise<void>;
  onBumpVaultSyncEncryptionEpoch?: () => Promise<void>;
  onCreateVaultSyncInvite?: () => Promise<void>;
  onRevokeVaultSyncMember?: (memberAccountId: string) => Promise<void>;
  onRevokeVaultSyncInvite?: (inviteId: string) => Promise<void>;
  onAcceptVaultSyncInvite?: () => Promise<void>;
  onVaultSyncInviteeAccountIdChange?: (value: string) => void;
  onVaultSyncAcceptInviteIdChange?: (value: string) => void;
  onVaultSyncInviteSecretChange?: (value: string) => void;
  onLibraryWorkspaceConnectorBindDraftChange: (
    field: keyof SpaceConnectorBindDraft,
    value: string,
  ) => void;
  onLibraryWorkspaceConnectorCredentialSelect: (value: string) => void;
  onLibraryWorkspaceHttpRestExpandedChange: (expanded: boolean) => void;
  onEnsureConnectorPackageForImport?: () => Promise<void>;
  onTestConnectorConnectionForImport?: () => Promise<void>;
  onStartConnectorOAuthForImport?: () => Promise<void>;
  onSimulateConnectorOAuthForImport?: () => Promise<void>;
  onBindConnectorSourceToKnowledgeBase?: () => Promise<void>;
  onLibraryWorkspaceDatasetImportTabChange?: (tab: DatasetImportTab) => void;
  onDatasetImportManualTextChange?: (value: string) => void;
  onPickDatasetImportFile?: (file: File) => Promise<void>;
  onDownloadDatasetImportTemplate?: () => void;
  onImportDatasetToSpace?: () => Promise<void>;
  onLibraryWorkspaceUrlImportModeChange?: (mode: WebUrlImportMode) => void;
  onLibraryWorkspaceUrlImportTextChange?: (value: string) => void;
  onLibraryWorkspaceUrlImportAdvancedOpenChange?: (open: boolean) => void;
  onLibraryWorkspaceUrlSyncScheduleChange?: (schedule: WebUrlSyncSchedule) => void;
  onLibraryWorkspaceUrlStripNavAdsChange?: (enabled: boolean) => void;
  onLibraryWorkspaceUrlMainContentOnlyChange?: (enabled: boolean) => void;
  onImportWebUrlsToSpace?: () => Promise<void>;
  onGenerateNoteMetadataFromContent?: () => Promise<void>;
  onLibraryWorkspaceNoteTagDraftChange?: (value: string) => void;
  onLibraryWorkspaceNoteTagSuggestionsOpenChange?: (open: boolean) => void;
  onAddLibraryWorkspaceNoteTag?: (tag: string) => void;
  onRemoveLibraryWorkspaceNoteTag?: (tag: string) => void;
  onCommitLibraryWorkspaceNoteTagDraft?: () => void;
  onImportNoteToSpace?: () => Promise<void>;
  onPickFileImportFiles?: (files: File[]) => Promise<void>;
  onRemoveFileImportFile?: (id: string) => void;
  onLibraryWorkspaceFileImportAdvancedOpenChange?: (open: boolean) => void;
  onLibraryWorkspaceFileChunkingStrategyChange?: (
    strategy: import("../../../views/knowledge-universe-file-import.ts").FileChunkingStrategy,
  ) => void;
  onLibraryWorkspaceFileOcrEnabledChange?: (enabled: boolean) => void;
  onImportFilesToSpace?: () => Promise<void>;
  onLibraryWorkspaceImportReadOnly?: () => void;
  onLibraryWorkspaceInviteDrawerOpenChange: (open: boolean) => void;
  onLibraryWorkspaceInviteEmailChange: (email: string) => void;
  onLibraryWorkspaceInviteRoleChange: (
    role: import("../../../capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseMemberRoleDto,
  ) => void;
  onSubmitLibraryWorkspaceInvite: () => void | Promise<void>;
  onStartLibraryWorkspaceInlineRename: (kbId: string) => void;
  onCancelLibraryWorkspaceInlineRename: () => void;
  onLibraryWorkspaceSettingsTitleChange: (title: string) => void;
  onSubmitLibraryWorkspaceRename: () => void | Promise<void>;
  onDeleteLibraryWorkspace: (kbId: string) => void | Promise<void>;
  onDeleteLibraryDocument: (documentId: string) => Promise<void>;
  onToggleLibraryDocumentSelection: (documentId: string) => void;
  onSelectAllLibraryDocuments: (selected: boolean) => void;
  onDeleteSelectedLibraryDocuments: () => Promise<void>;
  /** Open the host-local original file (local_index binding) with the OS default app. */
  onOpenLibraryOriginalDocument: (documentId: string) => Promise<void>;
  /** Preview retained original bytes in the artifact sidebar (upload blob or local_index). */
  onPreviewLibraryOriginalDocument: (documentId: string) => Promise<void>;
  /** Unbind a connector/folder/API source that has no documentId (e.g. 云盘 / 本地文件夹). */
  onUnbindLibrarySource: (item: {
    id: string;
    kind: string;
    sourceDescriptorId?: string;
  }) => Promise<void>;
  /** Sync/ingest an active api/external binding into kb-index for graph + RAG. */
  onIngestLibrarySource: (item: {
    id: string;
    kind: string;
    sourceDescriptorId?: string;
  }) => Promise<void>;
  onDetachLibraryDocument: (documentId: string) => Promise<void>;
  onRestoreLibraryDocument: (documentId: string) => Promise<void>;
  onSetWebRefreshPolicy: (params: {
    url: string;
    docId?: string | null;
    enabled: boolean;
  }) => Promise<void>;
  onGenerateAgentKnowledge: () => Promise<void>;
  onNewKnowledgeBaseTitleChange: (title: string) => void;
  onNewKnowledgeBaseDescriptionChange: (description: string) => void;
  onNewKnowledgeBaseVisibilityChange: (visibility: KnowledgeBaseSummary["visibility"]) => void;
  onCreateKnowledgeBase: () => Promise<void>;
  /** Pre-create default library when none exists (quick action: 创建并收录). */
  onQuickCreateKnowledgeBase: () => Promise<void>;
  /**
   * Inline create a folder under a visibility section (home / library tree "+").
   * Stays on the current page; default title then enters rename mode.
   */
  onCreateFolderInSection: (visibility: KnowledgeBaseSummary["visibility"]) => Promise<void>;
  onKbSearchQueryChange: (query: string) => void;
  onKbSearch: () => Promise<void>;
  onArchiveDeliverable: (deliverableId: string) => Promise<void>;
  onDeleteDeliverable: (deliverableId: string) => Promise<void>;
  onViewDeliverable: (deliverableId: string) => void;
  onDeliverableGovernanceAction: (
    deliverableId: string,
    action: DeliverableGovernanceAction,
  ) => Promise<void>;
  onDeliverableMoreMenuChange: (deliverableId: string | null) => void;
  onRefreshDeliverableTrace?: () => Promise<void>;
  onToggleKnowledgeBasePin: (kbId: string) => void;
  onToggleKnowledgeBaseFavorite: (kbId: string) => void;
  onToggleKnowledgeBaseExpanded: (kbId: string) => void;
  onDeliverableStatusFilterChange: (filter: WorkspaceDeliverableStatusFilter) => void;
  onRelationsInsightExpandedChange: (open: boolean) => void;
  onSupplySectionExpandedChange: (open: boolean) => void;
  onWorkspaceDeliverablesExpandedChange: (expanded: boolean) => void;
  onKbSearchHighlightKeyChange: (highlightKey: string | null) => void;
  onSearchPanelOpenChange: (open: boolean) => void;
  onRefreshHome?: () => Promise<void>;
  onDismissHomeInsightsNotice: () => void;
  onExecuteKnowledgeAction: (action: KnowledgeActionSuggestion) => Promise<void>;
  onSelectDiscoveryEvent: (event: KnowledgeDiscoveryEvent) => Promise<void>;
  onRefreshGovernance?: () => Promise<void>;
  onDismissGovernanceNotice?: () => void;
  onGovernanceTaskUpdate: (
    taskId: string,
    status: "resolved" | "dismissed",
    canonicalClaimId?: string,
  ) => Promise<void>;
  onGovernanceTaskSelect: (taskId: string | null) => Promise<void>;
  onGovernanceTaskGraphZoom: (delta: number) => void;
  onGovernanceTaskGraphPan: (dx: number, dy: number) => void;
  onGovernanceTaskGraphResetView: () => void;
  onGovernanceTaskGraphSelectNode: (nodeId: string) => void;
  onGovernanceTaskGraphHoverNode: (nodeId: string | null) => void;
  onCreatePublishIntent?: (params: {
    objectId: string;
    objectTitle: string;
    objectSummary?: string;
    provider?: string;
    suggestedAction?: string;
  }) => void;
};

export type WorkbenchPageContract<TProps = WorkbenchProps> = {
  props: TProps;
  capabilities: Pick<WorkbenchViewCapabilityContract, "signals" | "daibaiStage">;
};

export type EmployeeOverviewSurfaceRuntime = {
  daibai: WorkbenchDaibaiOverviewCapabilityContract;
};

export type WorkbenchProactiveCollaborationSurface = object | null;
export type WorkbenchFutureKnowledgeSurface = WorkbenchKnowledgeSurface | null;

export type EmployeeWorkbenchSurfaceRuntime = {
  view: WorkbenchViewCapabilityContract;
  proactive: {
    collaboration?: WorkbenchProactiveCollaborationSurface;
  };
  future: {
    knowledge?: WorkbenchFutureKnowledgeSurface;
  };
};

export type EmployeeDomainSurfaceRuntime = {
  overview: EmployeeOverviewSurfaceRuntime;
  workspace: EmployeeWorkbenchSurfaceRuntime;
};

export type EmployeePrimaryPageContractMap = {
  overview: WorkbenchPageContract;
  workspace: WorkbenchPageContract;
  schedule: WorkbenchPageContract;
  tasks: WorkbenchPageContract;
  collaboration: WorkbenchPageContract;
  services: WorkbenchPageContract;
};

export type EmployeeHomeDomainContract = {
  pages: EmployeePrimaryPageContractMap;
  capabilities: {
    overviewDaibai: WorkbenchDaibaiOverviewCapabilityContract;
    workspaceView: WorkbenchViewCapabilityContract;
    proactivePages: EmployeeWorkbenchSurfaceRuntime["proactive"];
    futureSurfaces: EmployeeWorkbenchSurfaceRuntime["future"];
  };
};
