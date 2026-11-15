// @vitest-environment jsdom
import { render } from "lit";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { zh_CN } from "../../i18n/locales/zh-CN.ts";
import type { KnowledgeGovernanceTask } from "../capability/knowledge-universe/endpoints.ts";
import { buildHomeGraphViewModel } from "../capability/knowledge-universe/graph-layout.ts";
import type { RelationshipGraph } from "../capability/knowledge-universe/types.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { renderKnowledgeUniverseGovernancePage } from "./knowledge-universe-governance-page.ts";
import { renderKnowledgeUniverseInsightsGrid } from "./knowledge-universe-insights-grid.ts";
import {
  renderKnowledgeTreeFolderMenu,
  renderKnowledgeTreeInlineRename,
} from "./knowledge-universe-tree-folder-actions.ts";

const CONFLICT_GRAPH: RelationshipGraph = {
  nodes: [
    { id: "node:a", kind: "knowledge-object", title: "政策 A", objectId: "obj:a" },
    { id: "node:b", kind: "knowledge-object", title: "政策 B", objectId: "obj:b" },
    { id: "node:c", kind: "knowledge-object", title: "指标 C", objectId: "obj:c" },
    { id: "node:d", kind: "knowledge-object", title: "指标 D", objectId: "obj:d" },
  ],
  edges: [
    { sourceId: "node:a", targetId: "node:b", relationType: "related", score: 99 },
    { sourceId: "node:c", targetId: "node:d", relationType: "conflicts", score: 42 },
    { sourceId: "node:a", targetId: "node:c", relationType: "related", score: 80 },
    { sourceId: "node:b", targetId: "node:d", relationType: "related", score: 70 },
  ],
};

function task(
  partial: Partial<KnowledgeGovernanceTask> & Pick<KnowledgeGovernanceTask, "id" | "taskType">,
): KnowledgeGovernanceTask {
  return {
    kbId: "kb-test",
    status: "open",
    priority: 0,
    relatedChunkIds: ["chunk-1"],
    proposedResolution: null,
    assignedTo: null,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

const EMPTY_LLM_USAGE = {
  llmCallCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  creditsCharged: 0,
  lastCallAt: null,
};

function createGovernanceSurface(
  overrides: Partial<WorkbenchKnowledgeSurface> = {},
): WorkbenchKnowledgeSurface {
  const graph = overrides.graph ?? CONFLICT_GRAPH;
  return {
    loading: false,
    error: null,
    query: "",
    selectedNodeId: null,
    selectedObject: null,
    sourceSummary: {
      personal: { documentCount: 0, recentUpdates: 0 },
      enterprise: { libraryCount: 0, accessibleCount: 0 },
      data: { grantedCount: 0, requestableCount: 0, externalSourceCount: 0 },
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
    searchScope: "workspace",
    homeFocus: null,
    selectedKbSearchHighlightKey: null,
    workspaceDeliverablesExpanded: false,
    dataCapabilities: [],
    sourceBrowse: { personal: [], enterprise: [], enterpriseRestricted: [] },
    externalDataSources: [],
    personalCollectTitle: "",
    personalCollectSummary: "",
    personalCollectTags: "",
    personalCollectUrl: "",
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
    knowledgeBases: [],
    selectedKnowledgeBaseId: null,
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
    libraryWorkspaceLocalFolderPath: "",
    libraryWorkspaceLocalFolderLabel: "",
    libraryWorkspaceLocalFolderDeletePolicy: "snapshot",
    libraryWorkspaceLocalFolderWatcherEnabled: true,
    libraryWorkspaceLocalFolderMode: "local_index",
    libraryWorkspaceLocalFolderStatusItems: [],
    actorEmail: null,
    selectedKnowledgeBaseCanWrite: true,
    searchPanelOpen: false,
    governanceSummary: {
      openConflictCount: 2,
      openClaimConflictCount: 1,
      openDuplicateCount: 3,
      openOrphanCount: 0,
      openStaleCount: 0,
      suppressedChunkCount: 0,
      indexedChunkCount: 12,
      llmUsage: { ...EMPTY_LLM_USAGE },
    },
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
    pageTab: "workbench",
    browseSubTab: "private",
    personalCollectDrawerOpen: false,
    personalDrawerMode: "collect",
    onQueryChange: vi.fn(),
    onSearchScopeChange: vi.fn(),
    onPageTabChange: vi.fn(),
    onBrowseSubTabChange: vi.fn(),
    onPersonalCollectDrawerOpenChange: vi.fn(),
    onSearch: vi.fn(async () => undefined),
    onSelectWorkspaceSearchHit: vi.fn(async () => undefined),
    onSelectNode: vi.fn(async () => undefined),
    onHoverNode: vi.fn(),
    onZoom: vi.fn(),
    onPan: vi.fn(),
    onResetView: vi.fn(),
    onPersonalCollectDraftChange: vi.fn(),
    onPersonalCollect: vi.fn(async () => undefined),
    onPickPersonalUploadFile: vi.fn(async () => undefined),
    onPersonalUpload: vi.fn(async () => undefined),
    onOpenMyAccumulation: vi.fn(),
    onSelectKnowledgeObject: vi.fn(async () => undefined),
    onRequestDataCapabilityAccess: vi.fn(async () => undefined),
    onRequestEnterpriseKnowledgeAccess: vi.fn(async () => undefined),
    onManagePersonalObject: vi.fn(async () => undefined),
    onPersonalManageTagsChange: vi.fn(),
    onSavePersonalTags: vi.fn(async () => undefined),
    onPersonalVersionCompareFromChange: vi.fn(),
    onPersonalVersionCompareToChange: vi.fn(),
    onComparePersonalVersions: vi.fn(async () => undefined),
    onSelectKnowledgeBase: vi.fn(),
    onLibraryWorkspaceContentTabChange: vi.fn(),
    onLibraryWorkspaceSourcesPlaneFilterChange: vi.fn(),
    onLibraryWorkspaceInvite: vi.fn(),
    onLibraryWorkspaceTabActionUnavailable: vi.fn(),
    onLibraryWorkspaceImportOpenChange: vi.fn(),
    onLibraryWorkspaceImportKindChange: vi.fn(),
    onLibraryWorkspaceBindSourceDraftChange: vi.fn(),
    onBindKnowledgeSource: vi.fn(async () => undefined),
    onLibraryWorkspaceInviteDrawerOpenChange: vi.fn(),
    onLibraryWorkspaceInviteEmailChange: vi.fn(),
    onLibraryWorkspaceInviteRoleChange: vi.fn(),
    onSubmitLibraryWorkspaceInvite: vi.fn(async () => undefined),
    onDetachLibraryDocument: vi.fn(async () => undefined),
    onDeleteLibraryDocument: vi.fn(async () => undefined),
    onToggleLibraryDocumentSelection: vi.fn(),
    onSelectAllLibraryDocuments: vi.fn(),
    onDeleteSelectedLibraryDocuments: vi.fn(async () => undefined),
    onOpenLibraryOriginalDocument: vi.fn(async () => undefined),
    onPreviewLibraryOriginalDocument: vi.fn(async () => undefined),
    onUnbindLibrarySource: vi.fn(async () => undefined),
    onRestoreLibraryDocument: vi.fn(async () => undefined),
    onSetWebRefreshPolicy: vi.fn(async () => undefined),
    onGenerateAgentKnowledge: vi.fn(async () => undefined),
    onNewKnowledgeBaseTitleChange: vi.fn(),
    onNewKnowledgeBaseDescriptionChange: vi.fn(),
    onNewKnowledgeBaseVisibilityChange: vi.fn(),
    onCreateKnowledgeBase: vi.fn(async () => undefined),
    onQuickCreateKnowledgeBase: vi.fn(async () => undefined),
    onKbSearchQueryChange: vi.fn(),
    onKbSearch: vi.fn(async () => undefined),
    onArchiveDeliverable: vi.fn(async () => undefined),
    onViewDeliverable: vi.fn(),
    onDeleteDeliverable: vi.fn(async () => undefined),
    onDeliverableGovernanceAction: vi.fn(async () => undefined),
    onDeliverableMoreMenuChange: vi.fn(),
    onToggleKnowledgeBasePin: vi.fn(),
    onToggleKnowledgeBaseFavorite: vi.fn(),
    onToggleKnowledgeBaseExpanded: vi.fn(),
    onDeliverableStatusFilterChange: vi.fn(),
    onRelationsInsightExpandedChange: vi.fn(),
    onHomeFocusChange: vi.fn(),
    onSupplySectionExpandedChange: vi.fn(),
    onWorkspaceDeliverablesExpandedChange: vi.fn(),
    onKbSearchHighlightKeyChange: vi.fn(),
    onSearchPanelOpenChange: vi.fn(),
    onExecuteKnowledgeAction: vi.fn(async () => undefined),
    onSelectDiscoveryEvent: vi.fn(async () => undefined),
    onDismissHomeInsightsNotice: vi.fn(),
    onDismissGovernanceNotice: vi.fn(),
    onStartLibraryWorkspaceInlineRename: vi.fn(),
    onCancelLibraryWorkspaceInlineRename: vi.fn(),
    onLibraryWorkspaceSettingsTitleChange: vi.fn(),
    onSubmitLibraryWorkspaceRename: vi.fn(async () => undefined),
    onDeleteLibraryWorkspace: vi.fn(async () => undefined),
    onGovernanceTaskUpdate: vi.fn(async () => undefined),
    onGovernanceTaskSelect: vi.fn(async () => undefined),
    onGovernanceTaskGraphZoom: vi.fn(),
    onGovernanceTaskGraphPan: vi.fn(),
    onGovernanceTaskGraphResetView: vi.fn(),
    onGovernanceTaskGraphSelectNode: vi.fn(),
    onGovernanceTaskGraphHoverNode: vi.fn(),
    ...overrides,
  } as unknown as WorkbenchKnowledgeSurface;
}

beforeAll(async () => {
  i18n.registerTranslation("zh-CN", zh_CN);
  await i18n.setLocale("zh-CN");
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("knowledge universe governance browser", () => {
  it("highlights conflict-class issues on the governance insight card", () => {
    const container = document.createElement("div");
    render(
      renderKnowledgeUniverseInsightsGrid(createGovernanceSurface(), {
        onExpandGovernance: vi.fn(),
      }),
      container,
    );

    const card = container.querySelector('[data-testid="ku-insights-governance-card"]');
    expect(card?.textContent).toContain("6 个待处理问题");
    expect(card?.textContent).toContain("其中 3 个为冲突类问题（优先处理）");
  });

  it("shows index-not-ready copy on the home governance card when no chunks are indexed", () => {
    const container = document.createElement("div");
    render(
      renderKnowledgeUniverseInsightsGrid(
        createGovernanceSurface({
          governanceSummary: {
            openConflictCount: 0,
            openClaimConflictCount: 0,
            openDuplicateCount: 0,
            openOrphanCount: 0,
            openStaleCount: 0,
            suppressedChunkCount: 0,
            indexedChunkCount: 0,
            llmUsage: { ...EMPTY_LLM_USAGE },
          },
        }),
        { onExpandGovernance: vi.fn() },
      ),
      container,
    );

    const card = container.querySelector('[data-testid="ku-insights-governance-card"]');
    expect(card?.textContent).toContain("尚未有可索引内容");
    expect(card?.textContent).not.toContain("0 个待处理问题");
  });

  it("renders governance status banner for the selected knowledge base", () => {
    const container = document.createElement("div");
    render(
      renderKnowledgeUniverseGovernancePage(
        createGovernanceSurface({
          selectedKnowledgeBaseId: "kb-test",
          knowledgeBases: [
            {
              id: "kb-test",
              title: "销售手册库",
              description: "",
              documentCount: 1,
              visibility: "private",
              updatedAtMs: Date.now(),
            },
          ],
        }),
      ),
      container,
    );

    const banner = container.querySelector('[data-testid="ku-governance-status-banner"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("销售手册库");
    expect(banner?.textContent).toContain("索引状态");
  });

  it("orders governance summary tiles and tasks by preview priority", () => {
    const container = document.createElement("div");
    const tasks: KnowledgeGovernanceTask[] = [
      task({ id: "dup", taskType: "duplicate", priority: 99 }),
      task({ id: "chunk", taskType: "conflict", priority: 10 }),
      task({ id: "claim", taskType: "claim_conflict", priority: 1 }),
    ];
    render(
      renderKnowledgeUniverseGovernancePage(
        createGovernanceSurface({
          governanceTasks: tasks,
        }),
      ),
      container,
    );

    const tileLabels = [...container.querySelectorAll('[data-testid="ku-governance-summary-tile"]')]
      .map((tile) => tile.getAttribute("data-kind") ?? "")
      .filter(Boolean);
    expect(tileLabels.slice(0, 3)).toEqual(["冲突待处理", "事实说法不一致", "重复待处理"]);

    const taskTypes = [...container.querySelectorAll('[data-testid="ku-governance-task-row"]')].map(
      (row) => row.getAttribute("data-task-type"),
    );
    expect(taskTypes).toEqual(["claim_conflict", "conflict", "duplicate"]);
  });

  it("renders governance LLM usage tiles when calls exist", () => {
    const container = document.createElement("div");
    render(
      renderKnowledgeUniverseGovernancePage(
        createGovernanceSurface({
          governanceSummary: {
            openConflictCount: 0,
            openClaimConflictCount: 0,
            openDuplicateCount: 0,
            openOrphanCount: 0,
            openStaleCount: 0,
            suppressedChunkCount: 0,
            indexedChunkCount: 0,
            llmUsage: {
              llmCallCount: 4,
              inputTokens: 800,
              outputTokens: 120,
              totalTokens: 920,
              creditsCharged: 2.5,
              lastCallAt: 1_700_000_000_000,
            },
          },
        }),
      ),
      container,
    );

    const section = container.querySelector('[data-testid="ku-governance-llm-usage"]');
    expect(section).not.toBeNull();
    const tileLabels = [
      ...container.querySelectorAll('[data-testid="ku-governance-llm-usage-tile"]'),
    ]
      .map((tile) => tile.getAttribute("data-kind") ?? "")
      .filter(Boolean);
    expect(tileLabels).toEqual(["LLM 调用", "Token 消耗", "Credits 扣减"]);
    expect(section?.textContent).toContain("4");
    expect(section?.textContent).toContain("920");
    expect(section?.textContent).toContain("2.5");
  });

  it("renders deduped claim options, recommends truth, and disables bulk resolve", async () => {
    const container = document.createElement("div");
    const onGovernanceTaskUpdate = vi.fn(async () => undefined);
    const claimTask = task({
      id: "claim-1",
      taskType: "claim_conflict",
      proposedResolution: {
        action: "review_claim_conflict",
        subject: "增长率",
        claimIds: ["claim:kb:c1:k", "claim:kb:c2:k", "claim:kb:c3:k", "claim:kb:c4:k"],
        values: ["15%", "15%", "18%", "18%"],
        candidates: [
          { claimId: "claim:kb:c1:k", value: "15%", chunkId: "c1", claimText: "增长率是15%" },
          { claimId: "claim:kb:c2:k", value: "15%", chunkId: "c2", claimText: "增长率=15%" },
          { claimId: "claim:kb:c3:k", value: "18%", chunkId: "c3", claimText: "增长率是18%" },
          { claimId: "claim:kb:c4:k", value: "18%", chunkId: "c4", claimText: "增长率达到18%" },
        ],
      },
    });
    render(
      renderKnowledgeUniverseGovernancePage(
        createGovernanceSurface({
          governanceTasks: [claimTask],
          onGovernanceTaskUpdate,
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("「增长率」说法不一致");
    expect(container.textContent).toContain("采用此说法");

    const candidates = [
      ...container.querySelectorAll('[data-testid="ku-governance-claim-candidate"]'),
    ];
    expect(candidates.length).toBe(2);
    expect(container.textContent).toContain("来自 2 个片段");
    expect(
      container.querySelector('[data-testid="ku-governance-claim-recommended"]'),
    ).not.toBeNull();

    const resolveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="ku-governance-resolve"]',
    );
    expect(resolveButton?.disabled).toBe(true);

    const truthButtons = [
      ...container.querySelectorAll<HTMLButtonElement>('[data-testid="ku-governance-claim-truth"]'),
    ];
    expect(truthButtons.length).toBe(2);
    const recommendedRow = candidates.find(
      (row) => row.getAttribute("data-recommended") === "true",
    );
    expect(recommendedRow?.textContent).toContain("15%");
    truthButtons[1].click();
    expect(onGovernanceTaskUpdate).toHaveBeenCalledWith("claim-1", "resolved", "claim:kb:c3:k");
  });

  it("renders governance success notice with dismiss action", () => {
    const container = document.createElement("div");
    const onDismissGovernanceNotice = vi.fn();
    render(
      renderKnowledgeUniverseGovernancePage(
        createGovernanceSurface({
          governanceNotice: "已采用「增长率」的说法：15%",
          onDismissGovernanceNotice,
        }),
      ),
      container,
    );

    const notice = container.querySelector('[data-testid="ku-governance-notice"]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("已采用「增长率」的说法：15%");

    const dismiss = container.querySelector<HTMLButtonElement>(
      '[data-testid="ku-governance-notice-dismiss"]',
    );
    dismiss?.click();
    expect(onDismissGovernanceNotice).toHaveBeenCalledOnce();
  });

  it("renders the issue subgraph panel when a task is expanded", () => {
    const issueGraph: RelationshipGraph = {
      nodes: [
        { id: "chunk:a", kind: "knowledge-object", title: "片段 A", objectId: "chunk:a" },
        { id: "chunk:b", kind: "knowledge-object", title: "片段 B", objectId: "chunk:b" },
      ],
      edges: [{ sourceId: "chunk:a", targetId: "chunk:b", relationType: "conflicts", score: 1 }],
    };
    const container = document.createElement("div");
    render(
      renderKnowledgeUniverseGovernancePage(
        createGovernanceSurface({
          governanceTasks: [task({ id: "conflict-1", taskType: "conflict" })],
          governanceSelectedTaskId: "conflict-1",
          governanceTaskGraph: issueGraph,
          governanceTaskGraphViewModel: buildHomeGraphViewModel(issueGraph),
        }),
      ),
      container,
    );

    const taskGraph = container.querySelector('[data-testid="ku-governance-task-graph"]');
    expect(taskGraph).not.toBeNull();
    expect(container.textContent).toContain("问题子图");
    const canvas = taskGraph!.querySelector(".knowledge-universe__graph-canvas");
    expect(canvas).not.toBeNull();
    expect(canvas!.querySelector('[data-node-id="chunk:a"]')).not.toBeNull();
    expect(canvas!.querySelector('[data-node-id="chunk:b"]')).not.toBeNull();
    // Node names stay hidden until hover; the subgraph still paints the issue nodes.
    expect(canvas!.querySelectorAll(".knowledge-universe__graph-node-label")).toHaveLength(0);
  });

  it("renders health tiles and LLM empty state when summary is null", () => {
    const container = document.createElement("div");
    render(
      renderKnowledgeUniverseGovernancePage(
        createGovernanceSurface({
          governanceSummary: null,
        }),
      ),
      container,
    );

    expect(container.querySelectorAll('[data-testid="ku-governance-summary-tile"]').length).toBe(4);
    expect(container.querySelector('[data-testid="ku-governance-status-banner"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="ku-governance-llm-usage"]')).not.toBeNull();
    expect(container.textContent).toContain("本期尚未产生治理 LLM 调用");
    expect(container.querySelector('[data-testid="ku-governance-index-not-ready"]')).not.toBeNull();
    expect(container.textContent).toContain("去沉淀知识");
  });

  it("shows healthy empty copy when indexed chunks exist but no open tasks", () => {
    const container = document.createElement("div");
    render(
      renderKnowledgeUniverseGovernancePage(
        createGovernanceSurface({
          governanceSummary: {
            openConflictCount: 0,
            openClaimConflictCount: 0,
            openDuplicateCount: 0,
            openOrphanCount: 0,
            openStaleCount: 0,
            suppressedChunkCount: 0,
            indexedChunkCount: 8,
            llmUsage: { ...EMPTY_LLM_USAGE },
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("信任态良好，暂无待处理问题");
    expect(container.querySelector('[data-testid="ku-governance-index-not-ready"]')).toBeNull();
  });

  it("shows dismissible degraded notice above insights when home insights are degraded", () => {
    const container = document.createElement("div");
    const onDismiss = vi.fn();
    render(
      renderKnowledgeUniverseInsightsGrid(
        createGovernanceSurface({
          homeInsightsDegraded: true,
          homeInsightsNoticeDismissed: false,
          onDismissHomeInsightsNotice: onDismiss,
        }),
        { onExpandGovernance: vi.fn() },
      ),
      container,
    );

    expect(container.querySelector('[data-testid="ku-insights-degraded-notice"]')).toBeTruthy();
    container
      .querySelector<HTMLButtonElement>('[data-testid="ku-insights-degraded-dismiss"]')
      ?.click();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("links empty actions card to deliverables", () => {
    const container = document.createElement("div");
    const onPageTabChange = vi.fn();
    const onBrowseSubTabChange = vi.fn();
    const onPersonalCollectDrawerOpenChange = vi.fn();
    const onWorkspaceDeliverablesExpandedChange = vi.fn(async () => undefined);
    render(
      renderKnowledgeUniverseInsightsGrid(
        createGovernanceSurface({
          onPageTabChange,
          onBrowseSubTabChange,
          onPersonalCollectDrawerOpenChange,
          onWorkspaceDeliverablesExpandedChange,
        }),
        { onExpandGovernance: vi.fn() },
      ),
      container,
    );

    container
      .querySelector<HTMLButtonElement>('[data-testid="ku-actions-empty-deliverables-cta"]')
      ?.click();
    expect(onWorkspaceDeliverablesExpandedChange).toHaveBeenCalledWith(true);
  });

  it("renders tree menu with pin, favorite, rename, and delete actions", () => {
    const container = document.createElement("div");
    const onPin = vi.fn();
    const onFavorite = vi.fn();
    const onRename = vi.fn();
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const kb = {
      id: "kb-test",
      title: "我的收录",
      description: "",
      documentCount: 0,
      visibility: "private" as const,
      updatedAtMs: Date.now(),
    };
    render(
      renderKnowledgeTreeFolderMenu(
        createGovernanceSurface({
          pageTab: "workbench",
          selectedKnowledgeBaseId: "kb-test",
          knowledgeBases: [kb],
          onToggleKnowledgeBasePin: onPin,
          onToggleKnowledgeBaseFavorite: onFavorite,
          onStartLibraryWorkspaceInlineRename: onRename,
          onDeleteLibraryWorkspace: onDelete,
        }),
        kb,
        false,
        false,
      ),
      container,
    );

    const menu = container.querySelector<HTMLDetailsElement>(
      '[data-testid="ku-library-tree-menu"]',
    );
    expect(menu).toBeTruthy();
    menu!.open = true;

    container.querySelector<HTMLButtonElement>('[data-testid="ku-library-menu-pin"]')?.click();
    expect(onPin).toHaveBeenCalledWith("kb-test");

    container.querySelector<HTMLButtonElement>('[data-testid="ku-library-menu-favorite"]')?.click();
    expect(onFavorite).toHaveBeenCalledWith("kb-test");

    container.querySelector<HTMLButtonElement>('[data-testid="ku-library-menu-rename"]')?.click();
    expect(onRename).toHaveBeenCalledWith("kb-test");

    container.querySelector<HTMLButtonElement>('[data-testid="ku-library-menu-delete"]')?.click();
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledWith("kb-test");
    confirmSpy.mockRestore();
  });

  it("renders inline rename controls when rename mode is active", () => {
    const container = document.createElement("div");
    const onRename = vi.fn();
    const onCancel = vi.fn();
    render(
      renderKnowledgeTreeInlineRename(
        createGovernanceSurface({
          pageTab: "workbench",
          selectedKnowledgeBaseId: "kb-test",
          knowledgeBases: [
            {
              id: "kb-test",
              title: "中医宝典",
              description: "",
              documentCount: 0,
              visibility: "private",
              updatedAtMs: Date.now(),
            },
          ],
          libraryWorkspaceInlineRenameKbId: "kb-test",
          libraryWorkspaceSettingsKbId: "kb-test",
          libraryWorkspaceSettingsTitle: "中医宝典",
          onSubmitLibraryWorkspaceRename: onRename,
          onCancelLibraryWorkspaceInlineRename: onCancel,
        }),
      ),
      container,
    );

    expect(container.querySelector('[data-testid="ku-library-inline-rename"]')).toBeTruthy();
    container.querySelector<HTMLButtonElement>('[data-testid="ku-library-rename-save"]')?.click();
    expect(onRename).toHaveBeenCalledOnce();

    container.querySelector<HTMLButtonElement>('[data-testid="ku-library-rename-cancel"]')?.click();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
