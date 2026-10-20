// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { buildHomeGraphViewModel } from "../../../capability/knowledge-universe/graph-layout.ts";
import type { RelationshipGraph } from "../../../capability/knowledge-universe/types.ts";
import { renderKnowledgeUniverseWorkOutputCenterPage } from "../../../views/knowledge-universe-work-output-center-page.ts";
import type { WorkbenchKnowledgeSurface } from "./home-page-contracts.ts";
import type { WorkbenchShellModel } from "./workbench-shell-model.ts";
import type { WorkbenchStageModuleContract } from "./workbench-stage-contracts.ts";
import { renderModuleContentPage } from "./workbench-stage-module.ts";

const MOCK_GRAPH: RelationshipGraph = {
  nodes: [
    { id: "node:me", kind: "owner", title: "我" },
    { id: "node:personal", kind: "knowledge-object", title: "我的知识", objectId: "obj:personal" },
    {
      id: "node:enterprise",
      kind: "knowledge-object",
      title: "企业知识",
      objectId: "obj:enterprise",
    },
    { id: "node:data", kind: "data-capability", title: "数据能力", objectId: "obj:data" },
  ],
  edges: [
    { sourceId: "node:me", targetId: "node:personal", relationType: "related", score: 90 },
    { sourceId: "node:me", targetId: "node:enterprise", relationType: "related", score: 88 },
    { sourceId: "node:me", targetId: "node:data", relationType: "related", score: 86 },
  ],
};

function createKnowledgeSurface(): WorkbenchKnowledgeSurface {
  const graph = MOCK_GRAPH;
  return {
    loading: false,
    error: null,
    query: "",
    selectedNodeId: null,
    selectedObject: null,
    sourceSummary: {
      personal: { documentCount: 128, recentUpdates: 8 },
      enterprise: { libraryCount: 42, accessibleCount: 17 },
      data: { grantedCount: 12, requestableCount: 5, externalSourceCount: 3 },
    },
    graph,
    graphViewModel: buildHomeGraphViewModel(graph),
    searchResults: [],
    workspaceSearchGroups: [],
    workspaceSearchTotalCount: 0,
    workspaceSearchMode: null,
    selectedWorkspaceSearchHitId: null,
    selectedWorkspaceSearchDeliverableId: null,
    openDeliverableMoreMenuId: null,
    relationsInsightExpanded: false,
    supplySectionExpanded: false,
    searchScope: "workspace" as const,
    selectedKbSearchHighlightKey: null,
    homeFocus: null,
    workspaceDeliverablesExpanded: false,
    dataCapabilities: [
      {
        id: "cap-1",
        title: "客户画像能力",
        summary: "mock",
        sourceSystems: ["CRM"],
        scenarios: ["客户画像"],
        visibleAgents: [],
        accessState: "granted",
      },
      {
        id: "cap-2",
        title: "销售预测能力",
        summary: "mock",
        sourceSystems: ["ERP"],
        scenarios: ["销售预测"],
        visibleAgents: [],
        accessState: "requestable",
      },
    ],
    sourceBrowse: {
      personal: [
        {
          id: "obj:personal:1",
          title: "个人文档",
          source: "personal",
          kind: "document",
          summary: "mock",
          tags: ["个人"],
          updatedAt: Date.now(),
        },
      ],
      enterprise: [
        {
          id: "obj:enterprise:1",
          title: "销售手册",
          source: "enterprise",
          kind: "policy",
          summary: "mock",
          tags: ["销售"],
          updatedAt: Date.now(),
          scopeLabel: "销售知识空间",
        },
      ],
      enterpriseRestricted: [
        {
          id: "obj:enterprise:hr-handbook",
          title: "HR 制度手册",
          source: "enterprise",
          kind: "policy",
          summary: "mock restricted",
          tags: ["HR"],
          updatedAt: Date.now(),
          scopeLabel: "HR 知识空间",
          accessState: "restricted",
          projectionId: "hr-handbook",
        },
      ],
    },
    externalDataSources: [
      {
        id: "ds-1",
        title: "外部 CRM",
        category: "external",
        status: "disconnected",
        connectorId: "crm",
      },
    ],
    personalCollectTitle: "",
    personalCollectSummary: "",
    personalCollectTags: "",
    personalUploadAttachment: null,
    personalActionBusy: false,
    personalActionNotice: null,
    personalActionError: null,
    accessRequestBusyCapabilityId: null,
    accessRequestBusyProjectionId: null,
    accessRequestNotice: null,
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
    homeInsightsDegraded: false,
    homeInsightsNoticeDismissed: false,
    recentVisits: [],
    relatedGroups: null,
    hoveredNodeId: null,
    graphZoom: 1,
    graphPanX: 0,
    graphPanY: 0,
    knowledgeBases: [
      {
        id: "kb-mock",
        title: "Mock Library",
        description: "",
        documentCount: 1,
        visibility: "private",
        updatedAtMs: Date.now(),
      },
    ],
    selectedKnowledgeBaseId: "kb-mock",
    expandedKnowledgeBaseIds: [],
    treeDocumentsByKbId: {},
    treeSourcesByKbId: {},
    treeDocumentsLoadingByKbId: {},
    kbSearchQuery: "",
    kbSearchEvidence: [],
    kbSearchMode: null,
    kbSearchSubstringResults: [],
    workspaceDeliverables: [],
    workspaceDeliverableStatusFilter: "all" as const,
    workspaceBusy: false,
    workspaceNotice: null,
    workspaceError: null,
    workspaceHint: null,
    workspaceDeliverablesUnavailable: false,
    newKnowledgeBaseTitle: "",
    newKnowledgeBaseDescription: "",
    newKnowledgeBaseVisibility: "private" as const,
    workspaceDeliverableTrace: null,
    workspaceDeliverableTraceLoading: false,
    deliverableDetailFocus: null,
    pinnedKnowledgeBaseIds: [],
    favoriteKnowledgeBaseIds: [],
    libraryWorkspaceContentTab: "documents" as const,
    libraryWorkspaceDocuments: [],
    libraryWorkspaceDocumentsLoading: false,
    libraryWorkspaceSources: [],
    libraryWorkspaceSourcesLoading: false,
    libraryWorkspaceSourcesPlaneFilter: "all" as const,
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
    libraryWorkspaceInviteRole: "viewer" as const,
    libraryWorkspaceSettingsKbId: null,
    libraryWorkspaceSettingsTitle: "",
    libraryWorkspaceInlineRenameKbId: null,
    libraryWorkspaceImportOpen: false,
    libraryWorkspaceImportLockSpace: true,
    libraryWorkspaceImportKind: null,
    libraryWorkspaceBindSourceKind: "api" as const,
    libraryWorkspaceBindSourceTitle: "",
    libraryWorkspaceBindSourceEndpoint: "",
    actorEmail: "viewer@example.com",
    selectedKnowledgeBaseCanWrite: true,
    searchPanelOpen: false,
    governanceSummary: {
      openConflictCount: 0,
      openClaimConflictCount: 0,
      openDuplicateCount: 2,
      openOrphanCount: 0,
      openStaleCount: 0,
      suppressedChunkCount: 0,
      indexedChunkCount: 0,
      llmUsage: {
        llmCallCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        creditsCharged: 0,
        lastCallAt: null,
      },
    },
    governanceTasks: [],
    governanceLoading: false,
    governanceError: null,
    governanceNotice: null,
    governanceTaskBusyId: null,
    pageTab: "workbench" as const,
    browseSubTab: "private" as const,
    personalCollectDrawerOpen: false,
    personalDrawerMode: "collect" as const,
    onQueryChange: () => undefined,
    onSearchScopeChange: () => undefined,
    onPageTabChange: () => undefined,
    onBrowseSubTabChange: () => undefined,
    onPersonalCollectDrawerOpenChange: () => undefined,
    onSearch: async () => undefined,
    onSelectWorkspaceSearchHit: async () => undefined,
    onSelectNode: async () => undefined,
    onHoverNode: () => undefined,
    onZoom: () => undefined,
    onPan: () => undefined,
    onResetView: () => undefined,
    onPersonalCollectDraftChange: () => undefined,
    onPersonalCollect: async () => undefined,
    onPickPersonalUploadFile: async () => undefined,
    onPersonalUpload: async () => undefined,
    onOpenMyAccumulation: () => undefined,
    onSelectKnowledgeObject: async () => undefined,
    onRequestDataCapabilityAccess: async () => undefined,
    onRequestEnterpriseKnowledgeAccess: async () => undefined,
    onManagePersonalObject: async () => undefined,
    onPersonalManageTagsChange: () => undefined,
    onSavePersonalTags: async () => undefined,
    onPersonalVersionCompareFromChange: () => undefined,
    onPersonalVersionCompareToChange: () => undefined,
    onComparePersonalVersions: async () => undefined,
    onSelectKnowledgeBase: () => undefined,
    onLibraryWorkspaceContentTabChange: () => undefined,
    onLibraryWorkspaceSourcesPlaneFilterChange: () => undefined,
    onLibraryWorkspaceInvite: () => undefined,
    onLibraryWorkspaceTabActionUnavailable: () => undefined,
    onLibraryWorkspaceImportOpenChange: () => undefined,
    onLibraryWorkspaceImportKindChange: () => undefined,
    onLibraryWorkspaceBindSourceDraftChange: () => undefined,
    onBindKnowledgeSource: async () => undefined,
    onLibraryWorkspaceInviteDrawerOpenChange: () => undefined,
    onLibraryWorkspaceInviteEmailChange: () => undefined,
    onLibraryWorkspaceInviteRoleChange: () => undefined,
    onSubmitLibraryWorkspaceInvite: async () => undefined,
    onDetachLibraryDocument: async () => undefined,
    onDeleteLibraryDocument: async () => undefined,
    onToggleLibraryDocumentSelection: () => undefined,
    onSelectAllLibraryDocuments: () => undefined,
    onDeleteSelectedLibraryDocuments: async () => undefined,
    onOpenLibraryOriginalDocument: async () => undefined,
    onPreviewLibraryOriginalDocument: async () => undefined,
    onUnbindLibrarySource: async () => undefined,
    onIngestLibrarySource: async () => undefined,
    onRestoreLibraryDocument: async () => undefined,
    onSetWebRefreshPolicy: async () => undefined,
    onGenerateAgentKnowledge: async () => undefined,
    onNewKnowledgeBaseTitleChange: () => undefined,
    onNewKnowledgeBaseDescriptionChange: () => undefined,
    onNewKnowledgeBaseVisibilityChange: () => undefined,
    onCreateKnowledgeBase: async () => undefined,
    onQuickCreateKnowledgeBase: async () => undefined,
    onKbSearchQueryChange: () => undefined,
    onKbSearch: async () => undefined,
    onArchiveDeliverable: async () => undefined,
    onViewDeliverable: () => undefined,
    onDeleteDeliverable: async () => undefined,
    onDeliverableGovernanceAction: async () => undefined,
    onDeliverableMoreMenuChange: () => undefined,
    onRefreshDeliverableTrace: async () => undefined,
    onToggleKnowledgeBasePin: () => undefined,
    onToggleKnowledgeBaseFavorite: () => undefined,
    onToggleKnowledgeBaseExpanded: () => undefined,
    onDeliverableStatusFilterChange: () => undefined,
    onRelationsInsightExpandedChange: () => undefined,
    onHomeFocusChange: () => undefined,
    onSupplySectionExpandedChange: () => undefined,
    onWorkspaceDeliverablesExpandedChange: () => undefined,
    onKbSearchHighlightKeyChange: () => undefined,
    onSearchPanelOpenChange: () => undefined,
    onExecuteKnowledgeAction: async () => undefined,
    onSelectDiscoveryEvent: async () => undefined,
    onDismissHomeInsightsNotice: () => undefined,
    onDismissGovernanceNotice: () => undefined,
    onStartLibraryWorkspaceInlineRename: () => undefined,
    onCancelLibraryWorkspaceInlineRename: () => undefined,
    onLibraryWorkspaceSettingsTitleChange: () => undefined,
    onSubmitLibraryWorkspaceRename: async () => undefined,
    onDeleteLibraryWorkspace: async () => undefined,
    onCreateFolderInSection: async () => undefined,
    onGovernanceTaskUpdate: async () => undefined,
  } as unknown as WorkbenchKnowledgeSurface;
}

function createContract(surface: WorkbenchKnowledgeSurface | null): WorkbenchStageModuleContract {
  return {
    collaboration: {
      activeSessionKey: "main",
      groupMembers: [],
      ownedAgents: [],
      pendingBotApprovalCount: 0,
      onOpenAssistantSettings: () => undefined,
      onOpenMemberGovernance: () => undefined,
      onOpenFilePreview: () => undefined,
      onClosePreview: () => undefined,
      onComposeFromPreview: () => undefined,
      memberGovernance: null,
      onMemberGovernancePromptChange: () => undefined,
      onMemberGovernanceParse: () => undefined,
      onMemberGovernanceOpenSelector: () => undefined,
      onMemberGovernanceSearchChange: () => undefined,
      onMemberGovernanceToggleHumanSelection: () => undefined,
      onMemberGovernanceToggleBotSelection: () => undefined,
      onMemberGovernanceCommitSelection: () => undefined,
      onMemberGovernanceInviteHuman: () => undefined,
      onMemberGovernanceInviteBot: () => undefined,
      onMemberGovernanceCancelInvite: () => undefined,
      onMemberGovernanceRemoveMember: () => undefined,
      onMemberGovernanceApproveBotInvite: () => undefined,
      onMemberGovernanceRejectBotInvite: () => undefined,
      onMemberGovernanceAcceptSelfInvite: () => undefined,
      onMemberGovernanceRejectSelfInvite: () => undefined,
      onMemberGovernanceReset: () => undefined,
    },
    daibai: {},
    knowledge: surface,
    settings: {
      view: "system",
      userProfileName: "Tester",
      userProfileSignature: "",
      tenantLabel: "",
      systemTab: "security",
      personalTab: "account",
      tasksSubTab: "cron",
      chatFocusMode: false,
      chatShowThinking: true,
      platformAuthEnabled: false,
      passwordChangeBusy: false,
      passwordChangeError: null,
      passwordChangeNotice: null,
      pendingSeatOfferBusy: false,
      pendingSeatOfferError: null,
      pendingSeatOfferNotice: null,
      passwordCurrentValue: "",
      passwordNewValue: "",
      currentLocale: "zh-CN",
      currentTheme: "system",
      connected: true,
      onLocaleChange: () => undefined,
      onThemeChange: () => undefined,
      onUserProfileNameChange: () => undefined,
      onUserProfileSignatureChange: () => undefined,
      onDefaultWorkspaceRootDraftChange: () => undefined,
      onSaveDefaultWorkspaceRoot: async () => undefined,
      onOpenWorkspaceSelector: async () => undefined,
      onCloseWorkspaceSelector: () => undefined,
      onChooseWorkspaceSelector: async () => undefined,
      onBrowseWorkspaceSelector: async () => undefined,
      onWorkspaceSelectorPathDraftChange: () => undefined,
      onUseCurrentWorkspaceSelectorDirectory: () => undefined,
      onNavigateWorkspaceSelector: async () => undefined,
      onSelectWorkspaceSelectorPath: () => undefined,
      onApplyWorkspaceSelector: async () => undefined,
      onOpenSystemAuthorization: () => undefined,
      onWorkspaceSelectorCloudProviderChange: () => undefined,
      onWorkspaceSelectorCloudRegionChange: () => undefined,
      onWorkspaceSelectorCloudBucketChange: () => undefined,
      onWorkspaceSelectorCloudRootPrefixChange: () => undefined,
      onWorkspaceSelectorCloudEndpointChange: () => undefined,
      onWorkspaceSelectorCloudAccountNameChange: () => undefined,
      onGenerateWorkspaceSelectorCloudConfig: async () => undefined,
      onTestWorkspaceSelectorCloudConnection: async () => undefined,
      onChatFocusModeChange: () => undefined,
      onChatShowThinkingChange: () => undefined,
      onPasswordCurrentChange: () => undefined,
      onPasswordNewChange: () => undefined,
      onChangePassword: async () => undefined,
      onOpenForgotPassword: async () => undefined,
      onAcceptPendingSeatOffer: async () => undefined,
      onDeclinePendingSeatOffer: async () => undefined,
      onSystemTabChange: () => undefined,
      onPersonalTabChange: () => undefined,
      onTasksSubTabChange: () => undefined,
      onSystemSettingsGroupSelect: () => undefined,
      onSystemSettingsGroupDraftChange: () => undefined,
      onSaveSystemSettingsGroup: async () => undefined,
      onResetSystemSettingsGroup: async () => undefined,
      onDissolveSystemSettingsGroup: async () => undefined,
      onOpenSystemSettingsGroupMembers: () => undefined,
      onExportSystemSettingsGroupSummary: () => undefined,
      onSelectSession: () => undefined,
      onOpenInstallCapability: () => undefined,
      onLogout: () => undefined,
    } as unknown as NonNullable<WorkbenchStageModuleContract["settings"]>,
    signals: null,
  } as WorkbenchStageModuleContract;
}

function renderKnowledgePage(surface: WorkbenchKnowledgeSurface) {
  const container = document.createElement("div");
  render(
    renderModuleContentPage(
      createContract(surface),
      { primaryModule: "knowledge" } as WorkbenchShellModel,
      "知识宇宙",
      "",
    ),
    container,
  );
  return container;
}

function renderDeliverablesCenter(surface: WorkbenchKnowledgeSurface) {
  const container = document.createElement("div");
  render(renderKnowledgeUniverseWorkOutputCenterPage(surface), container);
  return container;
}

describe("workbench knowledge module page", () => {
  it("renders single-page workspace home instead of placeholder empty state", () => {
    const container = renderKnowledgePage(createKnowledgeSurface());
    expect(container.querySelector(".knowledge-universe--workspace-home")).toBeTruthy();
    expect(container.querySelector("#ku-workspace")).toBeTruthy();
    expect(container.querySelector(".knowledge-universe--cockpit")).toBeTruthy();
    expect(container.querySelector(".ku-home__grid")).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-home-deliverables-rail"]')).toBeFalsy();
    expect(container.querySelector(".employee-workbench__module-empty")).toBeFalsy();
  });

  it("creates a folder in-list via section + (no libraryCreate page hop)", async () => {
    const surface = createKnowledgeSurface();
    const onCreateFolderInSection = vi.fn(async () => undefined);
    const onPageTabChange = vi.fn();
    const onLibraryWorkspaceImportOpenChange = vi.fn();
    surface.onCreateFolderInSection = onCreateFolderInSection;
    surface.onPageTabChange = onPageTabChange;
    surface.onLibraryWorkspaceImportOpenChange = onLibraryWorkspaceImportOpenChange;
    const container = renderKnowledgePage(surface);
    const addPersonal = container.querySelector('[data-testid="ku-cockpit-tree-add-private"]');
    expect(addPersonal).toBeTruthy();
    (addPersonal as HTMLButtonElement | null)?.click();
    expect(onCreateFolderInSection).toHaveBeenCalledWith("private");
    expect(onPageTabChange).not.toHaveBeenCalledWith("libraryCreate");
    expect(onLibraryWorkspaceImportOpenChange).not.toHaveBeenCalled();
  });

  it("opens the four-tab space import page", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "spaceImport";
    surface.libraryWorkspaceImportOpen = true;
    surface.libraryWorkspaceImportKind = null;
    const container = renderKnowledgePage(surface);
    expect(container.querySelector('[data-testid="ku-space-import-page"]')).toBeTruthy();
    expect(container.querySelectorAll('[data-testid^="ku-space-import-tab-"]')).toHaveLength(4);
    expect(
      container.querySelector('[data-testid="ku-space-import-form-localFolder"]'),
    ).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-space-import-picker"]')).toBeFalsy();
  });

  it("does not render legacy top-level page tabs", () => {
    const container = renderKnowledgePage(createKnowledgeSurface());
    expect(container.querySelector(".knowledge-universe__tabs")).toBeFalsy();
    expect(container.querySelector('[data-testid="ku-home-command-bar"]')).toBeTruthy();
    expect(container.querySelector(".knowledge-universe__filter-belt")).toBeFalsy();
  });

  it("does not render assistant artifact preview in knowledge stage head", () => {
    const container = renderKnowledgePage(createKnowledgeSurface());
    expect(
      container.querySelector(
        ".employee-workbench__stage-head-actions .employee-workbench__stage-collaboration-tool--icon",
      ),
    ).toBeFalsy();
  });

  it("removes the cabin metric strip and keeps the upload action in the command bar", () => {
    const container = renderKnowledgePage(createKnowledgeSurface());
    expect(container.querySelector('[data-testid="ku-home-action-upload"]')).toBeTruthy();
    expect(container.querySelector(".knowledge-universe__action-cards")).toBeFalsy();
    // The 4空间/6成果/13片段/16治理/12关系 strip was removed from the simplified knowledge cabin.
    expect(container.querySelector('[data-testid="ku-workspace-metric-strip"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="ku-metric-governance"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="ku-metric-relations"]')).toBeFalsy();
    expect(container.querySelector(".knowledge-universe__library-inline-stats")).toBeFalsy();
  });

  it("renders home command bar and relations cockpit (rebuilt home)", () => {
    const container = renderKnowledgePage(createKnowledgeSurface());
    const text = container.textContent ?? "";
    expect(text.includes("上传知识") || text.includes("Upload knowledge")).toBe(true);
    expect(text.includes("知识供给管理") || text.includes("Knowledge supply")).toBe(false);
    expect(container.querySelector('[data-testid="ku-supply-manage-action-card"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="ku-home-action-upload"]')).toBeTruthy();
    // 数字能力 sits between 上传知识 and 我的资产 in the command bar.
    expect(container.querySelector('[data-testid="ku-home-action-data-capability"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-home-relations-cockpit"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-home-cockpit-topology"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-home-governance-actions"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-intelligence-band"]')).toBeFalsy();
    // 我的资产 now lives only in the top command bar (the in-cabin link was removed).
    expect(container.querySelector('[data-testid="ku-home-action-assets"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-my-assets-workspace-link"]')).toBeFalsy();
  });

  it("opens unified space import from home upload action", () => {
    const surface = createKnowledgeSurface();
    const onPageTabChange = vi.fn();
    const onLibraryWorkspaceImportOpenChange = vi.fn();
    surface.onPageTabChange = onPageTabChange;
    surface.onLibraryWorkspaceImportOpenChange = onLibraryWorkspaceImportOpenChange;
    const container = renderKnowledgePage(surface);
    container.querySelector<HTMLButtonElement>('[data-testid="ku-home-action-upload"]')?.click();
    expect(onPageTabChange).toHaveBeenCalledWith("spaceImport");
    expect(onLibraryWorkspaceImportOpenChange).toHaveBeenCalledWith(true, { lockSpace: false });
  });

  it("returns from space import to the home cockpit, not the library workspace", () => {
    const surface = createKnowledgeSurface();
    const onPageTabChange = vi.fn();
    const onLibraryWorkspaceImportOpenChange = vi.fn();
    surface.pageTab = "spaceImport";
    surface.libraryWorkspaceImportOpen = true;
    surface.onPageTabChange = onPageTabChange;
    surface.onLibraryWorkspaceImportOpenChange = onLibraryWorkspaceImportOpenChange;
    const container = renderKnowledgePage(surface);
    container.querySelector<HTMLButtonElement>(".knowledge-universe__secondary-back")?.click();
    expect(onLibraryWorkspaceImportOpenChange).toHaveBeenCalledWith(false);
    expect(onPageTabChange).toHaveBeenCalledWith("workbench");
    expect(onPageTabChange).not.toHaveBeenCalledWith("libraryWorkspace");
  });

  it("returns from library create to the home cockpit, not the library workspace", () => {
    const surface = createKnowledgeSurface();
    const onPageTabChange = vi.fn();
    surface.pageTab = "libraryCreate";
    surface.onPageTabChange = onPageTabChange;
    const container = renderKnowledgePage(surface);
    container.querySelector<HTMLButtonElement>(".knowledge-universe__secondary-back")?.click();
    expect(onPageTabChange).toHaveBeenCalledWith("workbench");
    expect(onPageTabChange).not.toHaveBeenCalledWith("libraryWorkspace");
    container
      .querySelector<HTMLButtonElement>(".ku-library-create__actions .btn:not(.btn--primary)")
      ?.click();
    expect(onPageTabChange).toHaveBeenCalledWith("workbench");
  });

  it("keeps library create name and description inputs editable and wired", () => {
    const surface = createKnowledgeSurface();
    const onTitle = vi.fn();
    const onDescription = vi.fn();
    surface.pageTab = "libraryCreate";
    surface.workspaceBusy = false;
    surface.newKnowledgeBaseTitle = "";
    surface.newKnowledgeBaseDescription = "";
    surface.onNewKnowledgeBaseTitleChange = onTitle;
    surface.onNewKnowledgeBaseDescriptionChange = onDescription;
    const container = renderKnowledgePage(surface);
    const titleInput = container.querySelector<HTMLInputElement>(".ku-library-create__input");
    const descriptionInput = container.querySelector<HTMLTextAreaElement>(
      ".ku-library-create__textarea",
    );
    expect(titleInput).toBeTruthy();
    expect(descriptionInput).toBeTruthy();
    expect(titleInput?.disabled).toBe(false);
    expect(descriptionInput?.disabled).toBe(false);

    titleInput!.value = "合规知识库";
    titleInput!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onTitle).toHaveBeenCalledWith("合规知识库");

    descriptionInput!.value = "制度与流程";
    descriptionInput!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onDescription).toHaveBeenCalledWith("制度与流程");
  });

  it("opens my assets from the command bar assets action", () => {
    const surface = createKnowledgeSurface();
    const onOpenMyAccumulation = vi.fn();
    surface.onOpenMyAccumulation = onOpenMyAccumulation;
    const container = renderKnowledgePage(surface);
    const link = container.querySelector('[data-testid="ku-home-action-assets"]');
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onOpenMyAccumulation).toHaveBeenCalledTimes(1);
  });

  it("drops the in-cabin assets link, search, and top create CTA", () => {
    const container = renderKnowledgePage(createKnowledgeSurface());
    // Both moved/removed: 我的资产 link → command bar; 搜索知识空间 input → removed.
    expect(container.querySelector('[data-testid="ku-my-assets-workspace-link"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="ku-cockpit-tree-search"]')).toBeFalsy();
    // No rail-head 新建/导入 CTA — import lives in the command bar / library workspace.
    expect(container.querySelector('[data-testid="ku-cockpit-create-space"]')).toBeFalsy();
    // Without a selected folder, L3 document leaves stay collapsed.
    expect(container.querySelector('[data-testid="ku-cockpit-tree-doc"]')).toBeFalsy();
    // Body shows the categorized tree directly.
    expect(container.querySelector(".ku-cockpit__rail-body .ku-cockpit__tree")).toBeTruthy();
  });

  it("does not render deliverable rail status dots after the rail was retired", () => {
    const surface = createKnowledgeSurface();
    surface.workspaceDeliverables = [
      {
        deliverableId: "dlv-1",
        title: "季度返点政策",
        kind: "doc",
        source: "chat",
        sourceType: "personal",
        governanceStatus: "conflict",
        creators: ["u1"],
        status: "done",
        updatedAtMs: Date.now(),
      },
    ];
    const container = renderKnowledgePage(surface);
    expect(container.querySelector('[data-testid="ku-home-rail-status"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="ku-home-deliverables-rail"]')).toBeFalsy();
  });

  it("simplifies tree nodes to names only (no runtime badges) on the home cabin", () => {
    const surface = createKnowledgeSurface();
    surface.knowledgeBases = [
      {
        id: "kb-conflict",
        title: "销售手册库",
        description: "",
        documentCount: 4,
        chunkCount: 12,
        relationCount: 3,
        conflictCount: 2,
        healthScore: 68,
        governanceStatus: "conflict",
        visibility: "private",
        updatedAtMs: Date.now(),
      },
    ];
    const container = renderKnowledgePage(surface);
    const leaf = container.querySelector(".ku-cockpit__tree-leaf");
    expect(leaf).toBeTruthy();
    // Minimal tree: the leaf shows only the space name, no conflict / health badges.
    expect(leaf?.querySelector('[data-testid="ku-library-runtime-badges"]')).toBeFalsy();
    expect(container.querySelector('[data-runtime-status="conflict"]')).toBeFalsy();
    expect(leaf?.querySelector(".ku-cockpit__tree-leaf-title")?.textContent?.trim()).toBe(
      "销售手册库",
    );
  });

  it("renders my assets secondary page", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "assets";
    const container = renderKnowledgePage(surface);
    expect(container.querySelector(".knowledge-universe--secondary-page")).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text.includes("我的资产") || text.includes("My assets")).toBe(true);
  });

  it("renders home governance actions cockpit without legacy intelligence band", () => {
    const container = renderKnowledgePage(createKnowledgeSurface());
    expect(container.querySelector('[data-testid="ku-home-governance-actions"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-home-relations-cockpit"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-intelligence-band"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="ku-insights-governance-card"]')).toBeFalsy();
    expect(container.querySelector(".knowledge-universe__expansion-deck")).toBeFalsy();
    expect(container.querySelector("#ku-supply-accordion")).toBeFalsy();
    expect(container.querySelector('[data-testid="ku-home-cockpit-topology"]')).toBeTruthy();
    expect(container.querySelector(".knowledge-universe__insights-grid")).toBeFalsy();
  });

  it("renders the relationship topology inside the home relations cockpit", () => {
    const surface = createKnowledgeSurface();
    surface.graph = {
      nodes: [
        {
          id: "node:sales-policy",
          kind: "knowledge-object",
          title: "销售制度",
          objectId: "obj:sales-policy",
        },
      ],
      edges: [],
    };
    surface.graphViewModel = {
      nodes: [
        {
          id: "node:sales-policy",
          x: 0,
          y: 0,
          radius: 8,
          label: "销售制度",
          category: "knowledge",
          objectId: "obj:sales-policy",
        },
      ],
      edges: [],
      width: 400,
      height: 240,
    };
    const container = renderKnowledgePage(surface);
    expect(container.querySelector("#ku-relations")).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-home-cockpit-topology"]')).toBeTruthy();
    expect(
      container.querySelector(
        '[data-testid="ku-home-cockpit-topology"] .knowledge-universe__graph-shell',
      ),
    ).toBeTruthy();
  });

  it("renders supply page with visibility-aligned space segments (同源 KnowledgeBase)", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "supply";
    surface.browseSubTab = "private";
    surface.knowledgeBases = [
      {
        id: "kb-private",
        title: "我的收录",
        description: "",
        documentCount: 2,
        visibility: "private",
        updatedAtMs: Date.now(),
      },
    ];
    const container = renderKnowledgePage(surface);
    expect(container.querySelector(".knowledge-universe--secondary-page")).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-supply-segment"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-supply-private"]')).toBeTruthy();
    expect(container.querySelector(".knowledge-universe__data-capability-page")).toBeFalsy();
    expect(container.textContent).toContain("我的收录");
  });

  it("renders the dedicated 数字能力 page without supply chrome or space tabs", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "supply";
    surface.browseSubTab = "capabilities";
    const container = renderKnowledgePage(surface);
    expect(container.querySelector(".knowledge-universe__data-capability-page")).toBeTruthy();
    expect(container.querySelector("#ku-capability-center")).toBeTruthy();
    // Dedicated plane: no「知识供给与管理」segment tabs / copy chrome.
    expect(container.querySelector('[data-testid="ku-supply-segment"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="ku-supply-private"]')).toBeFalsy();
    const text = container.textContent ?? "";
    expect(
      text.includes("知识供给与管理") || text.includes("Knowledge supply and management"),
    ).toBe(false);
    expect(text.includes("数字能力") || text.includes("Data capability")).toBe(true);
  });

  it("only surfaces governance signals that trace to a relation chain", () => {
    const surface = createKnowledgeSurface();
    surface.actionSuggestions = [
      {
        actionId: "action-traced",
        actionType: "review_conflict",
        title: "复核可追溯冲突",
        reason: "冲突会污染 Agent 消费结果",
        score: 90,
        // obj:personal exists in MOCK_GRAPH → traceable to a visible relation chain.
        context: { objectId: "obj:personal", knowledgeBaseId: "kb-mock" },
        executable: true,
      },
      {
        actionId: "action-orphan",
        actionType: "review_conflict",
        title: "无链路冲突",
        reason: "孤立信号，无法追溯",
        score: 80,
        // No graph node / task / deliverable backs this context → must be hidden.
        context: { objectId: "obj:does-not-exist" },
        executable: true,
      },
    ];
    const container = renderKnowledgePage(surface);
    expect(container.querySelector('[data-testid="ku-home-governance-actions"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-intelligence-band"]')).toBeFalsy();
    const signals = container.querySelectorAll('[data-testid="ku-home-gov-signal"]');
    expect(signals.length).toBe(1);
    expect(signals[0]?.textContent).toContain("复核可追溯冲突");
    expect(container.textContent).not.toContain("无链路冲突");
    // Trace chain is no longer rendered inline — ticker keeps titles only.
    expect(container.querySelector('[data-testid="ku-home-gov-ticker"]')).toBeTruthy();
  });

  it("highlights kb search terms in evidence excerpt via unified search overlay", () => {
    const surface = createKnowledgeSurface();
    surface.searchScope = "library";
    surface.query = "销售";
    surface.searchPanelOpen = true;
    surface.kbSearchQuery = "销售";
    surface.kbSearchMode = "indexed";
    surface.kbSearchEvidence = [
      {
        sourceKind: "knowledge",
        docId: "doc-1",
        docTitle: "Playbook",
        kbId: "kb-mock",
        versionId: "v1",
        score: 0.9,
        chunkText: "企业销售手册摘要",
        sourceUri: "file://playbook",
      },
    ];
    const container = renderKnowledgePage(surface);
    const mark = container.querySelector(".knowledge-universe__evidence-excerpt mark");
    expect(mark?.textContent).toBe("销售");
    expect(container.querySelector(".knowledge-universe__source-pill")).toBeTruthy();
  });

  it("renders the standalone relations panorama page when the relations tab is requested", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "relations";
    const container = renderKnowledgePage(surface);
    expect(container.querySelector(".knowledge-universe--secondary-page")).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-relations-page"]')).toBeTruthy();
    // Relations is now its own page, no longer aliased to the governance page.
    expect(container.querySelector(".knowledge-universe__governance-page")).toBeFalsy();
    expect(container.querySelector(".knowledge-universe__graph-shell")).toBeTruthy();
  });

  it("does not lazy-mount supply panels on workbench home", () => {
    const container = renderKnowledgePage(createKnowledgeSurface());
    expect(container.querySelector(".knowledge-universe__management-footer")).toBeFalsy();
    expect(container.querySelector(".knowledge-universe__personal-panel")).toBeFalsy();
  });

  it("renders agent deliverable governance actions without source pill in table row", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "deliverables";
    surface.workspaceDeliverables = [
      {
        deliverableId: "del-agent",
        title: "Agent output",
        kind: "document",
        source: "agent",
        creators: ["main"],
        primaryCreatorName: "Main Agent",
        status: "published",
        updatedAtMs: Date.now(),
      },
    ];
    const container = renderDeliverablesCenter(surface);
    expect(container.querySelector(".knowledge-universe__artifact-source-pill--agent")).toBeFalsy();
    expect(
      container.querySelector(".knowledge-universe__deliverable-owner-label")?.textContent,
    ).toBe("Main Agent");
    expect(container.querySelector(".knowledge-universe__artifact-governance")).toBeTruthy();
    expect(
      container.querySelector(".knowledge-universe__deliverable-governance-actions"),
    ).toBeTruthy();
    expect(container.querySelector(".knowledge-universe__deliverable-row-grid--head")).toBeTruthy();
    expect(container.querySelector(".knowledge-universe__deliverable-index")?.textContent).toBe(
      "1",
    );
    // High-density row: a single highlighted [查看] primary action; 沉淀/归档 + governance
    // collapse into an icon-only 更多(··) overflow menu instead of a row of disabled buttons.
    expect(container.querySelector('[data-testid="ku-deliverable-view"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-deliverable-more"]')).toBeTruthy();
    expect(container.querySelectorAll(".knowledge-universe__deliverable-action-label").length).toBe(
      1,
    );
    expect(container.querySelectorAll(".knowledge-universe__deliverable-action").length).toBe(2);
    // The deliverables center embeds the table with its own toolbar shell.
    expect(container.querySelector(".ku-output-center__table-shell")).toBeTruthy();
  });

  it("renders deliverable table rows when multiple preview items", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "deliverables";
    surface.workspaceDeliverables = [
      {
        deliverableId: "del-a",
        title: "Featured deliverable",
        kind: "document",
        source: "agent",
        creators: ["agent"],
        status: "published",
        updatedAtMs: Date.now(),
      },
      {
        deliverableId: "del-b",
        title: "Second deliverable",
        kind: "document",
        source: "task",
        creators: ["user"],
        status: "draft",
        updatedAtMs: Date.now() - 60_000,
      },
    ];
    const container = renderDeliverablesCenter(surface);
    expect(container.querySelector(".knowledge-universe__deliverables-table")).toBeTruthy();
    expect(container.querySelectorAll(".knowledge-universe__deliverable-row").length).toBe(2);
    expect(
      container.querySelectorAll(".knowledge-universe__deliverable-governance-actions").length,
    ).toBe(2);
  });

  it("does not render archived knowledge base badges inside deliverable title cells", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "deliverables";
    surface.workspaceDeliverables = [
      {
        deliverableId: "del-archived",
        title: "Archived deliverable",
        kind: "document",
        source: "agent",
        creators: ["agent"],
        relatedKnowledgeBaseId: "kb_328e58923fd3415b",
        status: "archived",
        updatedAtMs: Date.now(),
      },
    ];
    const container = renderDeliverablesCenter(surface);
    const titleCell = container.querySelector(".knowledge-universe__deliverable-titlecell");
    expect(titleCell?.textContent).toContain("Archived deliverable");
    expect(titleCell?.textContent).not.toContain("kb_328e58923fd3415b");
    expect(titleCell?.textContent).not.toContain("已归档");
    expect(container.querySelector(".knowledge-universe__deliverable-archived")).toBeFalsy();
  });

  it("does not render the retired deliverables rail on home", () => {
    const surface = createKnowledgeSurface();
    surface.workspaceDeliverables = [
      {
        deliverableId: "del-1",
        title: "Deliverable 1",
        kind: "document",
        source: "chat" as const,
        creators: ["user"],
        status: "draft",
        updatedAtMs: Date.now(),
      },
    ];
    const container = renderKnowledgePage(surface);
    expect(container.querySelector('[data-testid="ku-home-deliverables-rail"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="ku-home-rail-view-all"]')).toBeFalsy();
    expect(container.querySelector(".ku-home")).toBeTruthy();
  });

  it("pins reserved deliverable folders in the home tree", () => {
    const surface = createKnowledgeSurface();
    surface.knowledgeBases = [
      {
        id: "kb-personal-out",
        title: "个人成果",
        description: "",
        documentCount: 2,
        visibility: "private",
        reservedKind: "personal_deliverables",
        updatedAtMs: Date.now(),
      },
      {
        id: "kb-notes",
        title: "个人资料",
        description: "",
        documentCount: 1,
        visibility: "private",
        updatedAtMs: Date.now(),
      },
      {
        id: "kb-team-out",
        title: "团队成果",
        description: "",
        documentCount: 1,
        visibility: "team",
        reservedKind: "team_deliverables",
        updatedAtMs: Date.now(),
      },
    ];
    const container = renderKnowledgePage(surface);
    const titles = [...container.querySelectorAll(".ku-cockpit__tree-leaf-title")].map((node) =>
      node.textContent?.trim(),
    );
    expect(titles[0]).toBe("个人成果");
    expect(titles).toContain("团队成果");
    expect(titles).toContain("个人资料");
  });

  it("highlights selected kb search evidence card", () => {
    const surface = createKnowledgeSurface();
    surface.searchScope = "library";
    surface.query = "playbook";
    surface.searchPanelOpen = true;
    surface.kbSearchMode = "indexed";
    surface.kbSearchEvidence = [
      {
        sourceKind: "document",
        docId: "doc-1",
        docTitle: "Playbook",
        kbId: "kb-mock",
        versionId: "v1",
        score: 0.9,
        chunkText: "Sample excerpt",
        sourceUri: "file://playbook",
      },
    ];
    surface.selectedKbSearchHighlightKey = "doc-1";
    const container = renderKnowledgePage(surface);
    expect(container.querySelector(".knowledge-universe__evidence-card.is-selected")).toBeTruthy();
  });

  it("reveals deliverable row actions on hover styling hook", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "deliverables";
    surface.workspaceDeliverables = [
      {
        deliverableId: "del-spotlight",
        title: "Featured",
        kind: "document",
        source: "agent",
        creators: ["agent"],
        status: "published",
        updatedAtMs: Date.now(),
      },
      {
        deliverableId: "del-hover",
        title: "Hover actions",
        kind: "document",
        source: "agent",
        creators: ["agent"],
        status: "published",
        updatedAtMs: Date.now() - 60_000,
      },
    ];
    const container = renderDeliverablesCenter(surface);
    expect(
      container.querySelector(".knowledge-universe__deliverable-governance-actions"),
    ).toBeTruthy();
    expect(container.querySelector(".ku-output-center")).toBeTruthy();
  });

  it("renders personal collect on personal secondary page", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "personal";
    surface.browseSubTab = "private";
    surface.personalCollectDrawerOpen = true;
    surface.personalDrawerMode = "collect";
    const container = renderKnowledgePage(surface);
    expect(container.querySelector(".knowledge-universe--secondary-page")).toBeTruthy();
    expect(container.querySelector(".knowledge-universe__drawer-backdrop")).toBeFalsy();
    expect(container.querySelector(".knowledge-universe__personal-inline-panel")).toBeTruthy();
    expect(container.querySelector(".knowledge-universe__personal-form")).toBeTruthy();
  });

  it("renders personal manage on personal secondary page", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "personal";
    surface.browseSubTab = "private";
    surface.personalCollectDrawerOpen = true;
    surface.personalDrawerMode = "manage";
    surface.personalManageObjectId = "obj:personal:1";
    surface.personalManageObjectTitle = "个人文档";
    const container = renderKnowledgePage(surface);
    expect(container.querySelector(".knowledge-universe__personal-inline-panel")).toBeTruthy();
    expect(container.querySelector(".knowledge-universe__personal-manage")).toBeTruthy();
    expect(container.querySelector(".knowledge-universe__personal-form")).toBeFalsy();
  });

  it("routes the retired deliverables tab back to the home cockpit", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "deliverables";
    surface.workspaceDeliverables = Array.from({ length: 7 }, (_, index) => ({
      deliverableId: `del-${index}`,
      title: `Deliverable ${index}`,
      kind: "document",
      source: "chat" as const,
      creators: ["user"],
      status: "draft",
      updatedAtMs: Date.now(),
    }));
    const container = renderKnowledgePage(surface);
    expect(container.querySelector(".knowledge-universe--workspace-home")).toBeTruthy();
    expect(container.querySelector(".ku-output-center")).toBeFalsy();
    expect(container.querySelector('[data-testid="ku-home-deliverables-rail"]')).toBeFalsy();
  });

  it("renders deliverable detail page when viewing a deliverable", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "deliverableDetail";
    surface.selectedWorkspaceSearchDeliverableId = "del-detail";
    surface.knowledgeBases = [
      {
        id: "kb-1",
        title: "销售制度库",
        description: "销售",
        documentCount: 5,
        visibility: "team",
        updatedAtMs: Date.now(),
      },
    ];
    surface.workspaceDeliverables = [
      {
        deliverableId: "del-detail",
        title: "Q2 报价分析",
        kind: "report",
        source: "agent",
        creators: ["bot-1"],
        primaryCreatorName: "销售分析机器人",
        status: "done",
        updatedAtMs: Date.now(),
      },
    ];
    surface.workspaceDeliverableTrace = {
      deliverableId: "del-detail",
      deliverable: surface.workspaceDeliverables[0],
      steps: [
        {
          id: "s1",
          kind: "agent",
          title: "Agent 执行",
          description: "销售分析机器人完成任务",
          actorName: "销售分析机器人",
        },
      ],
      citedKnowledge: [],
      dataSource: "reconstructed",
    };
    const container = renderKnowledgePage(surface);
    expect(container.querySelector(".ku-deliverable-detail")).toBeTruthy();
    expect(container.querySelector(".ku-deliverable-detail__trace-list")).toBeTruthy();
    expect(container.querySelector(".ku-deliverable-detail__archive")).toBeTruthy();
    expect(container.textContent).toContain("Q2 报价分析");
    // Outcome Object 五层显式呈现 (内容/语义/来源/关系/治理)。
    expect(container.querySelector(".ku-deliverable-detail--layers")).toBeTruthy();
    for (const layer of ["content", "semantic", "lineage", "relationship", "governance"]) {
      expect(container.querySelector(`[data-testid="ku-outcome-layer-${layer}"]`)).toBeTruthy();
    }
    // Lineage 层承载生成过程链路，关系层承载与知识/参与者的关联，治理层承载状态。
    expect(
      container.querySelector(
        '[data-testid="ku-outcome-layer-lineage"] .ku-deliverable-detail__trace-list',
      ),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="ku-outcome-layer-relationship"] .ku-outcome-rel'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="ku-outcome-layer-governance"] .ku-outcome-gov-status'),
    ).toBeTruthy();
  });

  it("renders downstream deliverable links on the relationship layer and navigates on click", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "deliverableDetail";
    surface.selectedWorkspaceSearchDeliverableId = "del-detail";
    surface.workspaceDeliverables = [
      {
        deliverableId: "del-detail",
        title: "客户画像报告",
        kind: "report",
        source: "agent",
        creators: ["bot-1"],
        primaryCreatorName: "画像机器人",
        status: "done",
        updatedAtMs: Date.now(),
      },
    ];
    surface.workspaceDeliverableTrace = {
      deliverableId: "del-detail",
      deliverable: surface.workspaceDeliverables[0],
      steps: [],
      citedKnowledge: [],
      downstreamDeliverables: [
        {
          deliverableId: "del-followup",
          title: "跟进策略",
          agentName: "销售 Agent",
          atMs: Date.now(),
        },
      ],
      dataSource: "reconstructed",
    };
    const onViewDeliverable = vi.fn();
    surface.onViewDeliverable = onViewDeliverable;
    const container = renderKnowledgePage(surface);
    const items = container.querySelectorAll('[data-testid="ku-deliverable-downstream-item"]');
    expect(items.length).toBe(1);
    expect(container.textContent).toContain("跟进策略");
    expect(container.textContent).toContain("销售 Agent");
    (items[0] as HTMLButtonElement).click();
    expect(onViewDeliverable).toHaveBeenCalledWith("del-followup");
  });

  it("shows the downstream empty-state when the deliverable has no downstream references", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "deliverableDetail";
    surface.selectedWorkspaceSearchDeliverableId = "del-detail";
    surface.workspaceDeliverables = [
      {
        deliverableId: "del-detail",
        title: "客户画像报告",
        kind: "report",
        source: "agent",
        creators: ["bot-1"],
        primaryCreatorName: "画像机器人",
        status: "done",
        updatedAtMs: Date.now(),
      },
    ];
    surface.workspaceDeliverableTrace = {
      deliverableId: "del-detail",
      deliverable: surface.workspaceDeliverables[0],
      steps: [],
      citedKnowledge: [],
      downstreamDeliverables: [],
      dataSource: "reconstructed",
    };
    const container = renderKnowledgePage(surface);
    expect(container.querySelector(".ku-deliverable-detail__downstream")).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-deliverable-downstream-item"]')).toBeFalsy();
    expect(container.querySelector(".ku-deliverable-detail__downstream-empty")).toBeTruthy();
  });

  it("surfaces the 过时/stale governance chip on the deliverable detail governance layer", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "deliverableDetail";
    surface.selectedWorkspaceSearchDeliverableId = "dlv-stale";
    surface.knowledgeBases = [
      {
        id: "kb-mock",
        title: "销售制度库",
        description: "",
        documentCount: 5,
        visibility: "team",
        updatedAtMs: Date.now(),
      },
    ];
    surface.workspaceDeliverables = [
      {
        deliverableId: "dlv-stale",
        title: "季度返点政策",
        kind: "doc",
        source: "agent",
        sourceType: "agent",
        governanceStatus: "verified",
        relatedKnowledgeBaseId: "kb-mock",
        stale: true,
        creators: ["bot"],
        status: "published",
        updatedAtMs: Date.now(),
      },
    ];
    const container = renderKnowledgePage(surface);
    expect(container.querySelector('[data-testid="ku-deliverable-stale"]')).toBeTruthy();

    // A non-stale deliverable must not show the chip.
    surface.workspaceDeliverables[0].stale = false;
    const fresh = renderKnowledgePage(surface);
    expect(fresh.querySelector('[data-testid="ku-deliverable-stale"]')).toBeFalsy();
  });

  it("renders the create page as a Runtime Scope selector with consumption scopes", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "libraryCreate";
    const container = renderKnowledgePage(surface);
    expect(container.querySelectorAll('[data-testid="ku-space-consume"]').length).toBe(3);
    expect(container.querySelector('[data-scope="private"]')).toBeTruthy();
    expect(container.querySelector('[data-scope="team"]')).toBeTruthy();
    expect(container.querySelector('[data-scope="enterprise"]')).toBeTruthy();
    // Each scope carries a non-empty "who can consume" label.
    expect(
      container.querySelector('[data-scope="enterprise"]')?.textContent?.trim().length,
    ).toBeGreaterThan(0);
    expect(container.querySelector('[data-testid="ku-space-runtime-note"]')).toBeTruthy();
  });

  it("renders library create secondary page", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "libraryCreate";
    const container = renderKnowledgePage(surface);
    expect(container.querySelector(".knowledge-universe--secondary-page")).toBeTruthy();
    expect(container.querySelector(".ku-library-create")).toBeTruthy();
    expect(container.querySelector(".ku-library-create__form")).toBeTruthy();
    expect(container.querySelector(".ku-library-create__actions .btn--primary")).toBeTruthy();
  });

  it("renders deliverable detail toolbar actions", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "deliverableDetail";
    surface.selectedWorkspaceSearchDeliverableId = "del-toolbar";
    surface.workspaceDeliverables = [
      {
        deliverableId: "del-toolbar",
        title: "Toolbar test",
        kind: "document",
        source: "agent",
        creators: ["bot"],
        status: "done",
        updatedAtMs: Date.now(),
      },
    ];
    const container = renderKnowledgePage(surface);
    expect(container.querySelector(".ku-deliverable-detail__toolbar")).toBeTruthy();
    expect(
      container.querySelectorAll(".ku-deliverable-detail__toolbar-actions .btn").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("renders search panel when open with query and results", () => {
    const surface = createKnowledgeSurface();
    surface.query = "企业";
    surface.searchPanelOpen = true;
    surface.searchResults = [
      {
        id: "obj:enterprise",
        title: "企业知识",
        source: "enterprise",
        kind: "document",
        summary: "mock",
        tags: [],
        updatedAt: 1,
      },
    ];
    const container = renderKnowledgePage(surface);
    expect(container.querySelector(".knowledge-universe__search-panel")).toBeTruthy();
    expect(container.querySelector(".knowledge-universe__search-scrim")).toBeTruthy();
    expect(container.querySelector(".knowledge-universe__search-panel-close")).toBeTruthy();
    expect(container.querySelector(".knowledge-universe__search-feedback")).toBeTruthy();
    expect(container.textContent).toContain("企业知识");
  });

  it("does not render search panel when closed", () => {
    const surface = createKnowledgeSurface();
    surface.query = "企业";
    surface.searchPanelOpen = false;
    surface.searchResults = [
      {
        id: "obj:enterprise",
        title: "企业知识",
        source: "enterprise",
        kind: "document",
        summary: "mock",
        tags: [],
        updatedAt: 1,
      },
    ];
    const container = renderKnowledgePage(surface);
    expect(container.querySelector(".knowledge-universe__search-panel")).toBeFalsy();
  });

  it("renders the data-capability space content on the 数字能力 page", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "supply";
    surface.browseSubTab = "capabilities";
    const container = renderKnowledgePage(surface);
    expect(container.querySelector('[data-testid="ku-supply-capabilities"]')).toBeTruthy();
    expect(container.querySelector("#ku-capability-center")).toBeTruthy();
    expect(container.querySelector(".knowledge-universe__data-space")).toBeTruthy();
    expect(container.textContent).toContain("客户画像");
    expect(container.textContent).toContain("Request access");
    expect(container.textContent).toContain("外部 CRM");
  });

  it("renders a single unified search bar without legacy library search row", () => {
    const container = renderKnowledgePage(createKnowledgeSurface());
    expect(container.querySelectorAll("#knowledge-universe-search").length).toBe(1);
    expect(container.querySelector(".knowledge-universe__search-scope")).toBeFalsy();
    expect(container.querySelector(".knowledge-universe__search-suggestion")).toBeFalsy();
    expect(container.querySelector(".knowledge-universe__filter-belt")).toBeFalsy();
    expect(container.querySelector(".knowledge-universe__library-search")).toBeFalsy();
    expect(container.querySelector(".knowledge-universe__library-column")).toBeTruthy();
    expect(container.querySelector(".ku-cockpit__tree")).toBeTruthy();
    expect(container.querySelector(".ku-cockpit__tree-group")).toBeTruthy();
  });

  it("does not render inline search suggestion chips on workspace home", () => {
    const surface = createKnowledgeSurface();
    surface.searchScope = "library";
    surface.kbSearchEvidence = [
      {
        sourceKind: "knowledge",
        docId: "doc-1",
        docTitle: "库内 Playbook",
        kbId: "kb-mock",
        versionId: "v1",
        score: 0.9,
        chunkText: "正文",
        sourceUri: "file://playbook",
      },
    ];
    const container = renderKnowledgePage(surface);
    expect(container.querySelector(".knowledge-universe__search-suggestion")).toBeFalsy();
  });

  it("invokes governance action when more menu item is clicked", async () => {
    const onDeliverableGovernanceAction = vi.fn(async () => undefined);
    const surface = createKnowledgeSurface();
    surface.pageTab = "deliverables";
    surface.onDeliverableGovernanceAction = onDeliverableGovernanceAction;
    surface.workspaceDeliverables = [
      {
        deliverableId: "del-gov",
        title: "Governed output",
        kind: "report",
        source: "agent",
        creators: ["bot-2"],
        status: "published",
        updatedAtMs: Date.now(),
      },
    ];
    surface.openDeliverableMoreMenuId = "del-gov";
    const container = renderDeliverablesCenter(surface);
    const menuItem = container.querySelector(
      ".knowledge-universe__deliverable-more-item:not([data-testid='ku-deliverable-archive-item'])",
    );
    expect(menuItem).toBeTruthy();
    (menuItem as HTMLButtonElement | null)?.click();
    expect(onDeliverableGovernanceAction).toHaveBeenCalledWith("del-gov", "viewRelations");
  });

  it("renders deliverable governance menu actions enabled on deliverables page", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "deliverables";
    surface.workspaceDeliverables = [
      {
        deliverableId: "del-gov",
        title: "Governed output",
        kind: "report",
        source: "agent",
        creators: ["bot-2"],
        status: "published",
        updatedAtMs: Date.now(),
      },
    ];
    surface.openDeliverableMoreMenuId = "del-gov";
    const container = renderDeliverablesCenter(surface);
    // Archive/沉淀 is now folded into the overflow menu (high-density rows); the six
    // governance actions sit below it and remain enabled on the deliverables page.
    expect(container.querySelector('[data-testid="ku-deliverable-archive-item"]')).toBeTruthy();
    const menuItems = container.querySelectorAll(
      ".knowledge-universe__deliverable-more-item:not([data-testid='ku-deliverable-archive-item']):not([data-testid='ku-deliverable-delete-item'])",
    );
    expect(menuItems.length).toBe(6);
    for (const item of menuItems) {
      expect((item as HTMLButtonElement).disabled).toBe(false);
    }
    expect(container.textContent).toContain("View relations");
    expect(container.textContent).toContain("Assign expert");
    // The destructive 删除 (delete) item sits below the governance actions and is enabled.
    const deleteItem = container.querySelector<HTMLButtonElement>(
      '[data-testid="ku-deliverable-delete-item"]',
    );
    expect(deleteItem).toBeTruthy();
    expect(deleteItem?.disabled).toBe(false);
  });

  it("deletes a deliverable from the more menu after confirmation", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "deliverables";
    surface.workspaceDeliverables = [
      {
        deliverableId: "del-del",
        title: "Disposable output",
        kind: "report",
        source: "agent",
        creators: ["bot-2"],
        status: "draft",
        updatedAtMs: Date.now(),
      },
    ];
    surface.openDeliverableMoreMenuId = "del-del";
    const onDeleteDeliverable = vi.fn(async () => undefined);
    surface.onDeleteDeliverable = onDeleteDeliverable;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    const container = renderDeliverablesCenter(surface);
    container
      .querySelector<HTMLButtonElement>('[data-testid="ku-deliverable-delete-item"]')
      ?.click();

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(onDeleteDeliverable).toHaveBeenCalledWith("del-del");
    confirmSpy.mockRestore();
  });

  it("does not delete a deliverable when the confirmation is dismissed", () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "deliverables";
    surface.workspaceDeliverables = [
      {
        deliverableId: "del-keep",
        title: "Kept output",
        kind: "report",
        source: "agent",
        creators: ["bot-2"],
        status: "draft",
        updatedAtMs: Date.now(),
      },
    ];
    surface.openDeliverableMoreMenuId = "del-keep";
    const onDeleteDeliverable = vi.fn(async () => undefined);
    surface.onDeleteDeliverable = onDeleteDeliverable;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    const container = renderDeliverablesCenter(surface);
    container
      .querySelector<HTMLButtonElement>('[data-testid="ku-deliverable-delete-item"]')
      ?.click();

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(onDeleteDeliverable).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe("workbench knowledge productivity cockpit", () => {
  it("renders the rebuilt home cockpit shell (command bar + 25/75 grid + linked cockpit)", () => {
    const container = renderKnowledgePage(createKnowledgeSurface());
    expect(container.querySelector(".knowledge-universe--cockpit")).toBeTruthy();
    expect(container.querySelector(".ku-home")).toBeTruthy();
    expect(container.querySelector(".ku-home__grid")).toBeTruthy();
    expect(container.querySelector(".ku-home__col--rail")).toBeTruthy();
    expect(container.querySelector(".ku-home__col--main")).toBeTruthy();
    expect(container.querySelector("#ku-workspace")).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-home-deliverables-rail"]')).toBeFalsy();
    // Right column = 关系洞察 cockpit: topology dominates; governance is a ticker strip.
    expect(container.querySelector('[data-testid="ku-home-relations-cockpit"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-home-cockpit-topology"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-home-governance-actions"]')).toBeTruthy();
    // Command bar with search + four action slots preserved.
    expect(container.querySelector('[data-testid="ku-home-command-bar"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-home-action-upload"]')).toBeTruthy();
  });

  it("renders the left rail as a collapsible directory tree of knowledge spaces", () => {
    const surface = createKnowledgeSurface();
    surface.knowledgeBases = [
      {
        id: "kb-private",
        title: "我的收录",
        description: "",
        documentCount: 100,
        visibility: "private",
        updatedAtMs: Date.now(),
      },
      {
        id: "kb-team",
        title: "团队空间",
        description: "",
        documentCount: 100,
        visibility: "team",
        updatedAtMs: Date.now(),
      },
      {
        id: "kb-ent",
        title: "人力资源管理",
        description: "",
        documentCount: 16,
        visibility: "enterprise",
        updatedAtMs: Date.now(),
      },
    ];
    surface.selectedKnowledgeBaseId = "kb-private";
    const container = renderKnowledgePage(surface);
    const tree = container.querySelector(".ku-cockpit__tree");
    expect(tree).toBeTruthy();
    // 个人 / 团队 / 企业 persistent groups via native <details>.
    expect(container.querySelectorAll(".ku-cockpit__tree-group").length).toBeGreaterThanOrEqual(3);
    expect(
      container.querySelectorAll(".ku-cockpit__tree-group--section").length,
    ).toBeGreaterThanOrEqual(3);
    const leaves = container.querySelectorAll(".ku-cockpit__tree-leaf");
    expect(leaves.length).toBe(3);
    // Selected leaf is highlighted; the simplified tree shows names only (no runtime badges).
    expect(container.querySelector(".ku-cockpit__tree-leaf.is-active")).toBeTruthy();
    expect(
      container.querySelector('.ku-cockpit__tree-leaf [data-testid="ku-library-runtime-badges"]'),
    ).toBeFalsy();
  });

  it("selects a knowledge base when a tree leaf is clicked (stays on home)", () => {
    const surface = createKnowledgeSurface();
    const onSelectKnowledgeBase = vi.fn();
    const onPageTabChange = vi.fn();
    surface.onSelectKnowledgeBase = onSelectKnowledgeBase;
    surface.onPageTabChange = onPageTabChange;
    // Ensure click targets a non-selected leaf so select is exercised.
    surface.selectedKnowledgeBaseId = null;
    const container = renderKnowledgePage(surface);
    const leaf = container.querySelector<HTMLButtonElement>(
      '[data-testid="ku-cockpit-tree-folder"]',
    );
    expect(leaf).toBeTruthy();
    const kbId = leaf?.getAttribute("data-kb-id");
    expect(kbId).toBeTruthy();
    leaf?.click();
    expect(onSelectKnowledgeBase).toHaveBeenCalledWith(kbId);
    expect(onPageTabChange).not.toHaveBeenCalled();
  });

  it("opens the data-capability supply page from the command bar action", () => {
    const surface = createKnowledgeSurface();
    const onPageTabChange = vi.fn();
    const onBrowseSubTabChange = vi.fn();
    surface.onPageTabChange = onPageTabChange;
    surface.onBrowseSubTabChange = onBrowseSubTabChange;
    const container = renderKnowledgePage(surface);
    const dataCapability = container.querySelector<HTMLButtonElement>(
      '[data-testid="ku-home-action-data-capability"]',
    );
    expect(dataCapability).toBeTruthy();
    // The in-cabin 浏览企业知识 footer was removed; the entry now lives in the command bar.
    expect(container.querySelector('[data-testid="ku-cockpit-open-supply"]')).toBeFalsy();
    dataCapability?.click();
    expect(onBrowseSubTabChange).toHaveBeenCalledWith("capabilities");
    expect(onPageTabChange).toHaveBeenCalledWith("supply");
  });

  it("does not render the rail manage-all entry into the library workspace", () => {
    const surface = createKnowledgeSurface();
    const onPageTabChange = vi.fn();
    surface.onPageTabChange = onPageTabChange;
    const container = renderKnowledgePage(surface);
    expect(container.querySelector('[data-testid="ku-cockpit-manage-libraries"]')).toBeFalsy();
    expect(onPageTabChange).not.toHaveBeenCalled();
  });

  it("renders traceable governance items as a compact scrolling ticker", () => {
    const surface = createKnowledgeSurface();
    surface.selectedKnowledgeBaseId = "kb-mock";
    surface.actionSuggestions = [
      {
        actionId: "a1",
        actionType: "review_conflict",
        title: "确认事实说法",
        reason: "同一主题存在不一致事实",
        score: 95,
        // obj:personal is in MOCK_GRAPH → signal traces to a visible relation chain.
        context: { objectId: "obj:personal", knowledgeBaseId: "kb-mock" },
        executable: true,
      },
    ];
    const container = renderKnowledgePage(surface);
    expect(container.querySelector('[data-testid="ku-home-gov-ticker"]')).toBeTruthy();
    const signal = container.querySelector('[data-testid="ku-home-gov-signal"]');
    expect(signal).toBeTruthy();
    expect(signal?.textContent).toContain("确认事实说法");
    // Header / per-row CTA removed — ticker only.
    expect(container.querySelector('[data-testid="ku-home-gov-open-center"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="ku-home-gov-signal-action"]')).toBeFalsy();
    expect(container.querySelector(".ku-home-cockpit__governance-head")).toBeFalsy();
  });

  it("shows concrete knowledge titles in the ticker instead of generic open_object copy", () => {
    const surface = createKnowledgeSurface();
    surface.actionSuggestions = [
      {
        actionId: "open-generic",
        actionType: "open_object",
        title: "查看相关知识",
        reason: "相关推荐",
        score: 88,
        context: { objectId: "obj:personal" },
        executable: true,
      },
    ];
    const container = renderKnowledgePage(surface);
    const signal = container.querySelector('[data-testid="ku-home-gov-signal"]');
    expect(signal?.textContent).toContain("我的知识");
    expect(signal?.textContent).not.toContain("查看相关知识");
  });

  it("executes the governance ticker item when clicked", () => {
    const surface = createKnowledgeSurface();
    const onExecuteKnowledgeAction = vi.fn(async () => undefined);
    surface.onExecuteKnowledgeAction = onExecuteKnowledgeAction;
    surface.actionSuggestions = [
      {
        actionId: "a1",
        actionType: "review_conflict",
        title: "确认事实说法",
        reason: "同一主题存在不一致事实",
        score: 95,
        context: { objectId: "obj:personal" },
        executable: true,
      },
    ];
    const container = renderKnowledgePage(surface);
    const btn = container.querySelector<HTMLButtonElement>('[data-testid="ku-home-gov-signal"]');
    btn?.click();
    expect(onExecuteKnowledgeAction).toHaveBeenCalledTimes(1);
  });

  it("archives a deliverable from the consolidated more menu", async () => {
    const surface = createKnowledgeSurface();
    surface.pageTab = "deliverables";
    const onArchiveDeliverable = vi.fn(async () => undefined);
    surface.onArchiveDeliverable = onArchiveDeliverable;
    surface.workspaceDeliverables = [
      {
        deliverableId: "dlv-1",
        title: "会议通知模版",
        kind: "doc",
        source: "agent",
        creators: ["bot"],
        status: "draft",
        updatedAtMs: Date.now(),
      },
    ];
    surface.openDeliverableMoreMenuId = "dlv-1";
    const container = renderDeliverablesCenter(surface);
    const archiveItem = container.querySelector<HTMLButtonElement>(
      '[data-testid="ku-deliverable-archive-item"]',
    );
    expect(archiveItem).toBeTruthy();
    archiveItem?.click();
    expect(onArchiveDeliverable).toHaveBeenCalledWith("dlv-1");
  });
});

describe("workbench knowledge home cockpit linkage (homeFocus)", () => {
  it("keeps homeFocus on reserved folders instead of a deliverables rail", () => {
    const surface = createKnowledgeSurface();
    const onHomeFocusChange = vi.fn();
    const onSelectKnowledgeBase = vi.fn();
    surface.onHomeFocusChange = onHomeFocusChange;
    surface.onSelectKnowledgeBase = onSelectKnowledgeBase;
    surface.knowledgeBases = [
      {
        id: "kb-personal-out",
        title: "个人成果",
        description: "",
        documentCount: 1,
        visibility: "private",
        reservedKind: "personal_deliverables",
        updatedAtMs: Date.now(),
      },
    ];
    const container = renderKnowledgePage(surface);
    expect(container.querySelector('[data-testid="ku-home-rail-row"]')).toBeFalsy();
    container.querySelector<HTMLButtonElement>('[data-testid="ku-cockpit-tree-folder"]')?.click();
    expect(onSelectKnowledgeBase).toHaveBeenCalledWith("kb-personal-out");
  });

  it("anchors the relations cockpit title to the focused deliverable", () => {
    const surface = createKnowledgeSurface();
    surface.workspaceDeliverables = [
      {
        deliverableId: "dlv-link",
        title: "销售周报",
        kind: "report",
        source: "agent",
        creators: ["bot"],
        status: "published",
        updatedAtMs: Date.now(),
      },
    ];
    surface.homeFocus = { kind: "deliverable", id: "dlv-link" };
    const container = renderKnowledgePage(surface);
    const anchor = container.querySelector('[data-testid="ku-home-cockpit-anchor"]');
    expect(anchor).toBeTruthy();
    expect(anchor?.textContent).toContain("销售周报");
  });

  it("expands document leaves under the selected folder and focuses on doc click", () => {
    const surface = createKnowledgeSurface();
    const onSelectKnowledgeBase = vi.fn();
    const onHomeFocusChange = vi.fn();
    const onPageTabChange = vi.fn();
    const onLibraryWorkspaceContentTabChange = vi.fn();
    surface.onSelectKnowledgeBase = onSelectKnowledgeBase;
    surface.onHomeFocusChange = onHomeFocusChange;
    surface.onPageTabChange = onPageTabChange;
    surface.onLibraryWorkspaceContentTabChange = onLibraryWorkspaceContentTabChange;
    surface.selectedKnowledgeBaseId = "kb-mock";
    surface.expandedKnowledgeBaseIds = ["kb-mock"];
    surface.knowledgeBases = [
      {
        id: "kb-mock",
        title: "Mock space",
        description: "",
        documentCount: 1,
        visibility: "private",
        updatedAtMs: Date.now(),
      },
    ];
    surface.libraryWorkspaceDocuments = [
      {
        docId: "doc-1",
        title: "季度报告",
        contentType: null,
        updatedAtMs: Date.now(),
        indexed: true,
      },
    ];
    const container = renderKnowledgePage(surface);
    const folder = container.querySelector<HTMLButtonElement>(
      '[data-testid="ku-cockpit-tree-folder"]',
    );
    expect(folder).toBeTruthy();
    expect(folder?.getAttribute("aria-expanded")).toBe("true");
    const docs = container.querySelectorAll('[data-testid="ku-cockpit-tree-doc"]');
    expect(docs.length).toBe(1);
    expect(docs[0]?.textContent).toContain("季度报告");
    (docs[0] as HTMLButtonElement).click();
    expect(onHomeFocusChange).toHaveBeenCalledWith({
      kind: "document",
      id: "doc-1",
      kbId: "kb-mock",
    });
    expect(onLibraryWorkspaceContentTabChange).not.toHaveBeenCalled();
    expect(onPageTabChange).not.toHaveBeenCalled();
  });

  it("selects a collapsed folder without navigating away", () => {
    const surface = createKnowledgeSurface();
    const onSelectKnowledgeBase = vi.fn();
    const onPageTabChange = vi.fn();
    surface.onSelectKnowledgeBase = onSelectKnowledgeBase;
    surface.onPageTabChange = onPageTabChange;
    surface.selectedKnowledgeBaseId = null;
    surface.knowledgeBases = [
      {
        id: "kb-mock",
        title: "Mock space",
        description: "",
        documentCount: 1,
        visibility: "private",
        updatedAtMs: Date.now(),
      },
    ];
    const container = renderKnowledgePage(surface);
    expect(container.querySelector('[data-testid="ku-cockpit-tree-docs"]')).toBeFalsy();
    const folder = container.querySelector<HTMLButtonElement>(
      '[data-testid="ku-cockpit-tree-folder"]',
    );
    folder?.click();
    expect(onSelectKnowledgeBase).toHaveBeenCalledWith("kb-mock");
    expect(onPageTabChange).not.toHaveBeenCalled();
  });

  it("anchors the relations cockpit title to the focused document", () => {
    const surface = createKnowledgeSurface();
    surface.selectedKnowledgeBaseId = "kb-mock";
    surface.libraryWorkspaceDocuments = [
      {
        docId: "doc-1",
        title: "季度报告",
        contentType: null,
        updatedAtMs: Date.now(),
        indexed: true,
      },
    ];
    surface.homeFocus = { kind: "document", id: "doc-1", kbId: "kb-mock" };
    const container = renderKnowledgePage(surface);
    const anchor = container.querySelector('[data-testid="ku-home-cockpit-anchor"]');
    expect(anchor).toBeTruthy();
    expect(anchor?.textContent).toContain("季度报告");
  });

  it("shows a no-anchor hint on the relations cockpit when nothing is focused", () => {
    const surface = createKnowledgeSurface();
    surface.homeFocus = null;
    const container = renderKnowledgePage(surface);
    expect(container.querySelector('[data-testid="ku-home-cockpit-anchor"]')).toBeFalsy();
    expect(container.querySelector(".ku-home-cockpit__anchor--empty")).toBeTruthy();
  });

  it("opens the standalone relations panorama from the cockpit expand control", () => {
    const surface = createKnowledgeSurface();
    const onPageTabChange = vi.fn();
    surface.onPageTabChange = onPageTabChange;
    const container = renderKnowledgePage(surface);
    container.querySelector<HTMLButtonElement>('[data-testid="ku-home-cockpit-expand"]')?.click();
    expect(onPageTabChange).toHaveBeenCalledWith("relations");
  });
});

describe("workbench knowledge home cockpit toolbar + governance adjustments", () => {
  it("docks icon-only graph controls in the cockpit head (off the topology canvas)", () => {
    const container = renderKnowledgePage(createKnowledgeSurface());
    const headTools = container.querySelector(
      ".ku-home-cockpit__head .ku-home-cockpit__graph-tools--head",
    );
    expect(headTools).toBeTruthy();
    expect(headTools?.querySelector('[data-testid="ku-graph-zoom-in"]')).toBeTruthy();
    expect(headTools?.querySelector('[data-testid="ku-graph-zoom-out"]')).toBeTruthy();
    expect(headTools?.querySelector('[data-testid="ku-graph-reset"]')).toBeTruthy();
    expect(headTools?.querySelector('[data-testid="ku-home-cockpit-expand"]')).toBeTruthy();
    // Topology canvas stays chrome-free so the graph can breathe.
    expect(
      container.querySelector(".ku-home-cockpit__topology .ku-home-cockpit__graph-tools"),
    ).toBeFalsy();
    expect(container.querySelector(".knowledge-universe__graph-caption")).toBeFalsy();
    expect(headTools?.textContent?.includes("放大")).toBe(false);
    expect(headTools?.textContent?.includes("展开全景图")).toBe(false);
  });

  it("keeps governance as a ticker strip without header CTA or footer", () => {
    const container = renderKnowledgePage(createKnowledgeSurface());
    expect(container.querySelector('[data-testid="ku-home-governance-actions"]')).toBeTruthy();
    expect(container.querySelector(".ku-home-cockpit__governance--ticker")).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-home-gov-open-center"]')).toBeFalsy();
    expect(container.querySelector(".ku-home-cockpit__governance-head")).toBeFalsy();
    expect(container.querySelector(".ku-home-cockpit__governance-foot")).toBeFalsy();
    expect(container.querySelector('[data-testid="ku-home-gov-expand-panorama"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="ku-home-gov-announcement"]')).toBeFalsy();
  });
});
