// @vitest-environment jsdom
import { html } from "lit";
import { render } from "lit";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AppPortState } from "../../app-port-state.ts";
import type { UiSettings } from "../../storage.ts";

let buildEmployeeWorkbenchProps: typeof import("./render-model.ts").buildEmployeeWorkbenchProps;
let renderWorkbench: typeof import("./views/workbench.ts").renderWorkbench;

beforeAll(async () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    },
  });
  ({ buildEmployeeWorkbenchProps } = await import("./render-model.ts"));
  ({ renderWorkbench } = await import("./views/workbench.ts"));
});

function createState(overrides: Partial<AppPortState> = {}): AppPortState {
  const settings: UiSettings = {
    gatewayUrl: "",
    token: "",
    navCollapsed: false,
    navGroupsCollapsed: {},
    sessionSeenAt: {},
    theme: "system",
    chatFocusMode: false,
    chatShowThinking: true,
    splitRatio: 0.6,
    locale: "zh-CN",
    sessionKey: "main",
    lastActiveSessionKey: "main",
    daibaiGuideAcknowledged: false,
    customBrandLogoDataUrl: undefined,
  };

  const baseState = {
    basePath: "",
    settings,
    tab: "chat",
    connected: true,
    theme: "light",
    hello: { greeting: "hello" } as never,
    lastError: null,
    lastErrorCode: null,
    client: null,
    assistantName: "Upbeyond",
    bootstrapAuthSession: null,
    forcePublicHomepage: false,
    platformAuthState: null,
    platformAuthBusy: false,
    platformAuthError: null,
    platformAuthNotice: null,
    platformAuthCurrentPassword: "",
    platformAuthNewPassword: "",
    channelsSnapshot: null,
    chatMessage: "",
    chatAttachments: [],
    chatLoading: false,
    chatMessages: [],
    chatAvatarUrl: null,
    chatThinkingLevel: null,
    chatStream: null,
    chatStreamStartedAt: null,
    chatRunId: null,
    chatQueue: [],
    daibaiLoading: false,
    daibaiError: null,
    daibaiAskResult: null,
    daibaiExecuteResult: null,
    daibaiActionLoading: false,
    daibaiActionPendingId: null,
    daibaiActionError: null,
    daibaiPendingConfirmation: null,
    configForm: null,
    configSnapshot: null,
    sessionKey: "space:alpha",
    sessionsResult: {
      sessions: [
        { key: "space:alpha", updatedAt: 10, kind: "group", displayName: "产品研发小组" },
        {
          key: "agent:main:space:alpha",
          updatedAt: 20,
          kind: "group",
          displayName: "产品研发小组",
        },
      ],
    } as never,
    workbenchTeamSelectedKey: "space:alpha",
    workbenchPrimaryModule: "assistant",
    workbenchSettingsView: "system",
    workbenchSystemSettingsTab: "security",
    workbenchPersonalSettingsTab: "account",
    workbenchPersonalAuthorizationIdentityTab: "personal",
    workbenchRobotWorkbenchTab: "overview",
    workbenchGroupProfileView: "chat",
    workbenchTaskDetailId: null,
    workbenchCronFocusJobId: null,
    workbenchDeliverableDetailId: null,
    workbenchReviewDetailId: null,
    workbenchDecisionDetailId: null,
    workbenchCapsuleDetailId: null,
    workbenchDecisionSelectedOptionDraft: null,
    workbenchDecisionRationaleDraft: null,
    workbenchDecisionOptionsDraft: null,
    workbenchMemberGovernanceGroupKey: null,
    workbenchMemberGovernanceTitle: "",
    workbenchMemberGovernancePrompt: "",
    workbenchMemberGovernanceBusy: false,
    workbenchMemberGovernanceError: null,
    workbenchMemberGovernanceResult: null,
    workbenchMemberGovernanceCurrentHumans: [],
    workbenchMemberGovernanceCurrentBots: [],
    workbenchMemberGovernancePendingInvites: [],
    workbenchMemberGovernancePendingBotInvites: [],
    workbenchMemberGovernanceCandidateHumans: [],
    workbenchMemberGovernanceCandidateBots: [],
    workbenchMemberGovernanceSelectorKind: null,
    workbenchMemberGovernanceSearch: "",
    workbenchMemberGovernanceSelectedHumanIds: [],
    workbenchMemberGovernanceSelectedBotIds: [],
    workbenchCollaborationOrgBotDirectory: [],
    workbenchMemberGovernanceDrawerOpen: false,
    workbenchAgentCreatorOpen: false,
    workbenchAgentCreatorBusy: false,
    workbenchAgentCreatorError: null,
    workbenchAgentCreatorName: "",
    workbenchAgentCreatorEmoji: "",
    workbenchAgentCreatorTemplateId: "",
    workbenchAgentCreatorTemplates: [],
    workbenchAgentCreatorTemplatesLoading: false,
    workbenchAgentCreatorWorkspaceKind: "local",
    workbenchAgentCreatorLocalPath: "",
    workbenchAgentCreatorLocalValidationState: "idle",
    workbenchAgentCreatorLocalValidationMessage: null,
    workbenchAgentCreatorLocalResolvedPath: null,
    workbenchAgentCreatorLocalReadable: false,
    workbenchAgentCreatorLocalWritable: false,
    workbenchAgentCreatorLocalBrowserOpen: false,
    workbenchAgentCreatorLocalBrowserBusy: false,
    workbenchAgentCreatorLocalBrowserError: null,
    workbenchAgentCreatorLocalBrowserCurrentPath: "",
    workbenchAgentCreatorLocalBrowserParentPath: null,
    workbenchAgentCreatorLocalBrowserEntries: [],
    workbenchWorkspaceCloudProvider: "aliyun-oss",
    workbenchWorkspaceCloudRegion: "",
    workbenchWorkspaceCloudBucket: "",
    workbenchWorkspaceCloudRootPrefix: "",
    workbenchWorkspaceCloudEndpoint: "",
    workbenchWorkspaceCloudAccountName: "",
    workbenchWorkspaceCloudAccessKeyId: "",
    workbenchWorkspaceCloudSecretAccessKey: "",
    workbenchWorkspaceCloudGeneratedConfig: null,
    workbenchWorkspaceCloudConnectionState: "idle",
    workbenchWorkspaceCloudConnectionMessage: null,
    workbenchWorkspaceCloudCanRead: false,
    workbenchWorkspaceCloudCanWrite: false,
    workbenchWorkspaceCloudBrowserOpen: false,
    workbenchWorkspaceCloudBrowserBusy: false,
    workbenchWorkspaceCloudBrowserError: null,
    workbenchWorkspaceCloudBrowserCurrentPath: "",
    workbenchWorkspaceCloudBrowserParentPath: null,
    workbenchWorkspaceCloudBrowserEntries: [],
    workbenchWorkspaceCloudSelectedPath: "",
    workbenchDefaultWorkspaceRootDraft: null,
    workbenchDefaultWorkspaceRootSaving: false,
    workbenchDefaultWorkspaceRootError: null,
    workbenchDefaultWorkspaceRootNotice: null,
    workbenchSystemAuthorizationNotice: null,
    workbenchSystemAuthorizationError: null,
    workbenchSpaceCreatorOpen: false,
    workbenchSpaceCreatorBusy: false,
    workbenchSpaceCreatorError: null,
    workbenchSpaceCreatorTitle: "",
    workbenchSpaceCreatorAvatar: "🛰️",
    workbenchSpaceCreatorPurpose: "",
    workbenchSpaceCreatorCurrentMission: "",
    workbenchSpaceCreatorSystemInstructions: "",
    workbenchSpaceCreatorGroupId: "",
    workbenchSpaceCreatorGroupIdTouched: false,
    workbenchSpaceCreatorStep: "details",
    workbenchSpaceCreatorSelectedHumanIds: [],
    workbenchSpaceCreatorSelectedBotIds: [],
    workbenchSpaceCreatorCoordinatorBotId: "",
    sidebarOpen: false,
    sidebarSurface: "artifact",
    sidebarPreviewMode: "markdown",
    sidebarContent: null,
    workbenchBrandLogoError: null,
    workbenchActiveGrowthStatus: null,
    collaborationSpacesLoading: false,
    collaborationSpacesError: null,
    presenceEntries: [],
    nodes: [],
    devicesLoading: false,
    devicesError: null,
    devicesList: null,
    devicesCurrentDeviceId: null,
    agentsList: {
      agents: [
        { id: "main", name: "Daibai", identity: { name: "Daibai", emoji: "AI" }, scope: "self" },
      ],
      defaultId: "main",
    } as never,
    collaborationSpacesResult: {
      spaces: [
        {
          id: "alpha",
          groupId: "group-alpha",
          title: "产品研发小组",
          members: {
            humans: [{ userId: "user-1", name: "CEO", handle: null, status: "active" }],
            bots: [],
          },
          invites: { humans: [], bots: [] },
        },
      ],
    },
    collaborationLearningLoading: false,
    collaborationLearningError: null,
    collaborationLearningSnapshot: null,
    collaborationGovernanceActionBusyKey: null,
    collaborationGovernanceActionError: null,
    knowledgeUniverseLoading: false,
    knowledgeUniverseError: null,
    knowledgeUniverseQuery: "",
    knowledgeUniverseSelectedNodeId: null,
    knowledgeUniverseSelectedObject: null,
    knowledgeUniverseSourceSummary: null,
    knowledgeUniverseGraph: null,
    knowledgeUniverseGraphViewModel: null,
    knowledgeUniverseSearchResults: [],
    knowledgeUniverseWorkspaceSearchGroups: [],
    knowledgeUniverseWorkspaceSearchTotalCount: 0,
    knowledgeUniverseWorkspaceSearchMode: null,
    knowledgeUniverseSelectedWorkspaceSearchHitId: null,
    knowledgeUniverseSelectedWorkspaceSearchDeliverableId: null,
    knowledgeUniverseDataCapabilities: [],
    knowledgeUniverseSourceBrowse: { personal: [], enterprise: [], enterpriseRestricted: [] },
    knowledgeUniverseExternalDataSources: [],
    knowledgeUniversePersonalCollectTitle: "",
    knowledgeUniversePersonalCollectSummary: "",
    knowledgeUniversePersonalCollectTags: "",
    knowledgeUniversePersonalCollectUrl: "",
    knowledgeUniversePersonalDatasetText: "",
    knowledgeUniversePersonalUploadAttachment: null,
    knowledgeUniversePersonalActionBusy: false,
    knowledgeUniversePersonalActionNotice: null,
    knowledgeUniversePersonalActionError: null,
    knowledgeUniverseAccessRequestBusyCapabilityId: null,
    knowledgeUniverseAccessRequestBusyProjectionId: null,
    knowledgeUniverseAccessRequestNotice: null,
    knowledgeUniversePersonalManageObjectId: null,
    knowledgeUniversePersonalManageObjectTitle: null,
    knowledgeUniversePersonalManageTags: "",
    knowledgeUniversePersonalManageBusy: false,
    knowledgeUniversePersonalManageNotice: null,
    knowledgeUniversePersonalVersions: [],
    knowledgeUniversePersonalVersionCompareFrom: "",
    knowledgeUniversePersonalVersionCompareTo: "",
    knowledgeUniversePersonalVersionDiff: null,
    knowledgeUniverseRecommendations: [],
    knowledgeUniverseDiscoveryEvents: [],
    knowledgeUniverseActionSuggestions: [],
    knowledgeUniverseRecentVisits: [],
    knowledgeUniverseRelatedGroups: null,
    knowledgeUniverseGraphZoom: 1,
    knowledgeUniverseGraphPanX: 0,
    knowledgeUniverseGraphPanY: 0,
    knowledgeUniverseHoveredNodeId: null,
    cronLoading: false,
    cronJobsLoadingMore: false,
    cronJobs: [],
    cronJobsTotal: 0,
    cronJobsHasMore: false,
    cronJobsQuery: "",
    cronJobsEnabledFilter: "all",
    cronJobsScheduleKindFilter: "all",
    cronJobsLastStatusFilter: "all",
    cronJobsSortBy: "nextRunAtMs",
    cronJobsSortDir: "asc",
    cronStatus: null,
    cronError: null,
    cronBusy: false,
    cronForm: {} as never,
    cronFieldErrors: {},
    cronEditingJobId: null,
    cronRunsJobId: null,
    cronRunsLoadingMore: false,
    cronRuns: [],
    cronRunsTotal: 0,
    cronRunsHasMore: false,
    cronRunsScope: "all",
    cronRunsStatuses: [],
    cronRunsDeliveryStatuses: [],
    cronRunsStatusFilter: "all",
    cronRunsQuery: "",
    cronRunsSortDir: "desc",
    cronModelSuggestions: [],
    loadKnowledgeUniverseHome: vi.fn(async () => undefined),
    applySettings: vi.fn(),
    setTab: vi.fn(),
    setTheme: vi.fn(),
    logoutPlatformAuth: vi.fn(async () => undefined),
    loadAssistantIdentity: vi.fn(async () => undefined),
    loadCollaborationLearningSnapshot: vi.fn(async () => undefined),
    loadCollaborationObservabilitySnapshot: vi.fn(async () => undefined),
    resetCollaborationLearningSnapshot: vi.fn(),
    transitionCollaborationGovernanceObject: vi.fn(async () => undefined),
    saveCollaborationDecisionDraft: vi.fn(async () => undefined),
    resetCollaborationGovernanceActionState: vi.fn(),
    resetToolStream: vi.fn(),
    resetChatScroll: vi.fn(),
    handleOpenSidebar: vi.fn(),
    handleOpenArtifact: vi.fn(),
    handleOpenArtifactPreview: vi.fn(),
    askDaibai: vi.fn(async () => undefined),
    openDaibaiHelpFromModule: vi.fn(async () => undefined),
    executeDaibaiAction: vi.fn(async () => undefined),
    workbenchPendingGroupConfigProposal: null,
    workbenchGroupConfigProposalDismissedFingerprint: null,
    workbenchGroupConfigProposalBusy: false,
    workbenchGroupConfigProposalError: null,
    workbenchGroupConfigProposalNotice: null,
    daibaiSourceSessionKey: null,
    handleBrandLogoFileChange: vi.fn(async () => undefined),
    handleResetBrandLogo: vi.fn(),
    changePlatformAuthPassword: vi.fn(async () => undefined),
    acceptPlatformSeatAssignmentOffer: vi.fn(async () => undefined),
    declinePlatformSeatAssignmentOffer: vi.fn(async () => undefined),
  } as unknown as AppPortState;

  return {
    ...baseState,
    ...overrides,
  };
}

describe("buildEmployeeWorkbenchProps", () => {
  it("uses the persisted workbench nav collapsed state and exposes a toggle handler", () => {
    const state = createState();
    state.settings.navCollapsed = true;

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.navCollapsed).toBe(true);
    expect(props.onToggleSidebar).not.toBeNull();
  });

  it("exposes knowledge universe surface contract for workbench rendering", () => {
    const props = buildEmployeeWorkbenchProps({
      state: createState(),
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.knowledgeSurface).toBeTruthy();
    expect(props.knowledgeSurface?.onSearch).toEqual(expect.any(Function));
    expect(props.knowledgeSurface?.onSelectNode).toEqual(expect.any(Function));
  });

  it("routes space selections into collaboration workbench state", () => {
    const props = buildEmployeeWorkbenchProps({
      state: createState(),
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.primaryModule).toBe("collaboration");
    expect(props.teamSelectedKey).toBe("space:alpha");
    expect(props.collaborationReadModel.teamSpaces?.[0]).toMatchObject({
      key: "space:group-alpha",
      selectionKey: "space:group-alpha",
      entityId: "alpha",
    });
  });

  it("builds collaboration nav entries from real workbench spaces data", () => {
    const props = buildEmployeeWorkbenchProps({
      state: createState({
        workbenchTeamSelectedKey: "space:beta",
        sessionKey: "space:beta",
        sessionsResult: {
          sessions: [
            { key: "space:beta", updatedAt: 12, kind: "group", displayName: "市场研究组" },
          ],
        } as never,
        collaborationSpacesResult: {
          spaces: [
            {
              id: "beta",
              groupId: "group-beta",
              title: "市场研究组",
              members: {
                humans: [{ userId: "user-1", name: "CEO", handle: null, status: "active" }],
                bots: [],
              },
              invites: { humans: [], bots: [] },
            },
          ],
        },
      }),
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.collaborationReadModel.teamSpaces).toHaveLength(1);
    expect(props.collaborationReadModel.teamSpaces?.[0]).toMatchObject({
      key: "space:group-beta",
      title: "市场研究组",
      groupId: "group-beta",
    });
  });

  it("does not surface orphaned generated collaboration aliases in the employee nav", async () => {
    const state = createState({
      workbenchTeamSelectedKey: "space:beta",
      sessionKey: "agent:main:space:beta",
      sessionsResult: {
        sessions: [
          {
            key: "space:c5d1adb4-7477-4ae4-a98e-adcaa75daea5",
            updatedAt: 30,
            kind: "group",
            displayName: "space-c5d1adb4-7477-4ae4-a98e-adcaa75daea5",
          },
          {
            key: "agent:main:space:beta",
            updatedAt: 20,
            kind: "group",
            displayName: "市场研究组",
            groupId: "group-beta",
          },
        ],
      } as never,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "beta",
            groupId: "group-beta",
            title: "市场研究组",
            members: {
              humans: [{ userId: "user-1", name: "CEO", handle: null, status: "active" }],
              bots: [],
            },
            invites: { humans: [], bots: [] },
          },
        ],
      },
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });
    const container = document.createElement("div");
    render(renderWorkbench(props), container);
    await Promise.resolve();

    const navTitles = Array.from(
      container.querySelectorAll(".employee-workbench__nav-title"),
      (node) => node.textContent?.trim() ?? "",
    );
    expect(navTitles).toContain("市场研究组");
    expect(navTitles).not.toContain("space-c5d1adb4-7477-4ae4-a98e-adcaa75daea5");
  });

  it("renders assistant and collaboration entries inside the left navigation", async () => {
    const state = createState({
      agentsList: {
        agents: [
          { id: "main", name: "大白管家", identity: { name: "大白管家", emoji: "大" } },
          { id: "market", name: "市场助手", identity: { name: "市场助手", emoji: "市" } },
        ],
        defaultId: "main",
      } as never,
      sessionsResult: {
        sessions: [
          { key: "main", updatedAt: 30, kind: "direct", displayName: "大白管家" },
          {
            key: "agent:market:main",
            updatedAt: 20,
            kind: "direct",
            displayName: "市场助手",
          },
          { key: "space:alpha", updatedAt: 10, kind: "group", displayName: "产品研发小组" },
        ],
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });
    const container = document.createElement("div");
    render(renderWorkbench(props), container);
    await Promise.resolve();

    const navTitles = Array.from(
      container.querySelectorAll(".employee-workbench__nav-title"),
      (node) => node.textContent?.trim() ?? "",
    );
    expect(navTitles).toContain("大白管家");
    expect(navTitles).toContain("市场助手");
    expect(navTitles).toContain("产品研发小组");
    expect(container.querySelector(".employee-workbench__sidebar--flat")).toBeTruthy();
    expect(container.querySelector(".employee-workbench__group-stack--flat")).toBeTruthy();
    expect(container.querySelector(".employee-workbench__modules--flat")).toBeTruthy();
  });

  it("opens the agent creator inside workbench instead of navigating to the legacy agents page", async () => {
    const request = vi.fn(async () => ({
      config: {
        agents: {
          defaults: {
            workspace: "~/openclaw-workspace",
          },
        },
      },
    }));
    const state = createState({
      client: { request } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onOpenAgentCreator?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(state.workbenchAgentCreatorOpen).toBe(true);
    expect(state.setTab).not.toHaveBeenCalled();
    expect(state.workbenchAgentCreatorLocalPath).toBe("~/openclaw-workspace");
  });

  it("opens the agent creator even when config.get never resolves", async () => {
    const request = vi.fn(
      () =>
        new Promise(() => {
          /* hang forever */
        }),
    );
    const state = createState({
      client: { request } as never,
      connected: false,
      workbenchAgentCreatorLocalPath: "~/openclaw-workspace",
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onOpenAgentCreator?.();
    await Promise.resolve();
    expect(state.workbenchAgentCreatorOpen).toBe(true);
  });

  it("creates agents on managed SaaS without local workspace validation", async () => {
    let createWorkspaceParams: Record<string, unknown> | null = null;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "workspaces.create") {
        createWorkspaceParams = params ?? null;
        return {
          ok: true,
          workspaceId: "ws_managed_1",
          runtimePath: "/root/.openbot/workspaces/runtime/managed-1",
        };
      }
      if (method === "agents.create") {
        return { agentId: "agt-hrqb-helper", name: "托管助手" };
      }
      if (method === "robots.bind-workspace") {
        return { ok: true, agentId: "agt-hrqb-helper", workspaceId: "ws_managed_1" };
      }
      if (method === "agents.list") {
        return { agents: [], defaultId: "main", mainKey: "main", scope: "self" };
      }
      return null;
    });
    const state = createState({
      client: { request } as never,
      bootstrapDataSpace: { mode: "managed" },
      workbenchAgentCreatorName: "托管助手",
      workbenchAgentCreatorOpen: true,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.agentCreator?.managedWorkspace).toBe(true);
    await props.onCreateAgent?.();

    expect(createWorkspaceParams).toMatchObject({
      name: "托管助手 Workspace",
      kind: "local",
      local: {
        path: expect.stringContaining("agents/"),
      },
    });
    expect(request).not.toHaveBeenCalledWith("workspaces.local.validate", expect.anything());
    expect(state.workbenchAgentCreatorError).toBeNull();
    expect(state.sessionKey).toBe("agent:agt-hrqb-helper:main");
  });

  it("opens managed agent creation with an automatic platform workspace", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "config.get") {
        return { hash: "managed-config", config: { data: { mode: "managed" } } };
      }
      if (method === "agent-growth.list-templates") {
        return { templates: [] };
      }
      return null;
    });
    const state = createState({ client: { request } as never });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onOpenAgentCreator?.();
    await vi.waitFor(() => {
      expect(state.workbenchAgentCreatorOpen).toBe(true);
      expect(state.workbenchAgentCreatorLocalPath).toBe("~/.openbot/workspace");
      expect(state.configSnapshot?.config).toMatchObject({ data: { mode: "managed" } });
    });

    const managedProps = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });
    expect(managedProps.agentCreator?.managedWorkspace).toBe(true);
  });

  it("opens the space creator inside workbench instead of navigating to the legacy channels page", () => {
    const state = createState();

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onOpenSpaceCreator?.();

    expect(state.workbenchSpaceCreatorOpen).toBe(true);
    expect(state.workbenchSpaceCreatorStep).toBe("details");
    expect(state.workbenchSpaceCreatorPurpose).toBe("");
    expect(state.workbenchSpaceCreatorCurrentMission).toBe("");
    expect(state.workbenchSpaceCreatorSystemInstructions).toBe("");
    expect(props.spaceCreator?.avatar).toBe("🛰️");
    expect(state.setTab).not.toHaveBeenCalled();
  });

  it("loads workspace directory entries for the agent creator browser", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "config.get") {
        return { config: { agents: { defaults: { workspace: "~/openclaw-workspace" } } } };
      }
      if (method === "workspaces.local.browse") {
        return {
          currentPath: "/Users/daniel/.openbot",
          parentPath: "/Users/daniel",
          entries: [{ name: "workspace", path: "/Users/daniel/.openbot/workspace" }],
        };
      }
      return null;
    });
    const state = createState({
      client: { request } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onOpenAgentCreator?.();
    await Promise.resolve();
    await props.onOpenAgentCreatorLocalBrowser?.();

    expect(state.workbenchAgentCreatorLocalBrowserOpen).toBe(true);
    expect(state.workbenchAgentCreatorLocalBrowserCurrentPath).toBe("/Users/daniel/.openbot");
    expect(state.workbenchAgentCreatorLocalBrowserEntries).toEqual([
      { name: "workspace", path: "/Users/daniel/.openbot/workspace" },
    ]);
  });

  it("shows a newly created agent in the left navigation immediately", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "workspaces.local.validate") {
        return {
          ok: true,
          resolvedPath: "/Users/daniel/workspace-market",
          isDirectory: true,
          readable: true,
          writable: true,
        };
      }
      if (method === "workspaces.create") {
        return {
          ok: true,
          workspaceId: "ws_1",
          runtimePath: "/Users/daniel/workspace-market",
          workspace: {
            id: "ws_1",
            name: "市场助手 Workspace",
            kind: "local",
            status: "ready",
            runtimePath: "/Users/daniel/workspace-market",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        };
      }
      if (method === "agents.create") {
        return { agentId: "market-helper", name: "市场助手" };
      }
      if (method === "robots.bind-workspace") {
        return { ok: true, agentId: "market-helper", workspaceId: "ws_1" };
      }
      if (method === "agents.list") {
        return {
          agents: [
            {
              id: "main",
              name: "大白管家",
              identity: { name: "大白管家", emoji: "AI" },
              scope: "self",
            },
            {
              id: "market-helper",
              name: "市场助手",
              identity: { name: "市场助手", emoji: "🤖" },
              scope: "self",
            },
          ],
          defaultId: "main",
          mainKey: "agent:main:main",
          scope: "global",
        };
      }
      return null;
    });
    const state = createState({
      client: { request } as never,
      workbenchAgentCreatorName: "市场助手",
      workbenchAgentCreatorLocalPath: "~/workspace-market",
      workbenchAgentCreatorEmoji: "🤖",
      workbenchAgentCreatorOpen: true,
      sessionKey: "agent:main:main",
      workbenchTeamSelectedKey: "agent:main:main",
      platformAuthState: {
        employeeAccess: {
          employeeUserId: "user-ceo",
          agentIds: ["main"],
          ownedAgentIds: [],
          currentSeat: { seatId: "seat-ceo", title: "CEO" },
        },
        session: {
          provider: "trusted-proxy",
          user: "ceo@example.com",
          displayName: "CEO",
          tenantId: "001",
        },
      } as never,
      bootstrapAuthSession: {
        provider: "trusted-proxy",
        user: "ceo@example.com",
        displayName: "CEO",
        tenantId: "001",
      } as never,
      agentsList: {
        agents: [
          {
            id: "main",
            name: "大白管家",
            identity: { name: "大白管家", emoji: "AI" },
            scope: "self",
          },
        ],
        defaultId: "main",
        mainKey: "agent:main:main",
        scope: "global",
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    await props.onCreateAgent?.();

    expect(state.sessionKey).toBe("agent:market-helper:main");
    expect(state.workbenchPrimaryModule).toBe("assistant");

    const nextProps = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });
    const container = document.createElement("div");
    render(renderWorkbench(nextProps), container);
    await Promise.resolve();

    const navTitles = Array.from(
      container.querySelectorAll(".employee-workbench__nav-title"),
      (node) => node.textContent?.trim() ?? "",
    );
    expect(navTitles).toContain("市场助手");
    expect(container.textContent ?? "").toMatch(/TO:\s*市场助手/);
  });

  it("creates a dedicated agent sub-workspace beneath the default root", async () => {
    let createWorkspaceParams: Record<string, unknown> | null = null;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "workspaces.local.validate") {
        return {
          ok: true,
          resolvedPath: "/Users/daniel/workspace-root",
          isDirectory: true,
          readable: true,
          writable: true,
        };
      }
      if (method === "workspaces.create") {
        createWorkspaceParams = params ?? null;
        return {
          ok: true,
          workspaceId: "ws_1",
          runtimePath: "/Users/daniel/workspace-root/agents/market-helper",
        };
      }
      if (method === "agents.create") {
        return { agentId: "market-helper", name: "Market Helper" };
      }
      if (method === "robots.bind-workspace") {
        return { ok: true, agentId: "market-helper", workspaceId: "ws_1" };
      }
      return null;
    });
    const state = createState({
      client: { request } as never,
      workbenchAgentCreatorName: "Market Helper",
      workbenchAgentCreatorLocalPath: "~/workspace-root",
      workbenchAgentCreatorOpen: true,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    await props.onCreateAgent?.();

    expect(createWorkspaceParams).toMatchObject({
      name: "Market Helper Workspace",
      kind: "local",
      local: {
        path: "/Users/daniel/workspace-root/agents/market-helper",
      },
    });
  });

  it("creates a managed SaaS agent without a configured local workspace root", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "workspaces.local.validate") {
        throw new Error("managed creation must not expose or validate the host filesystem");
      }
      if (method === "workspaces.create") {
        expect(params).toMatchObject({
          kind: "local",
          local: {
            path: "~/.openbot/workspace/agents/agt-member-example-com-managed-helper",
          },
        });
        return {
          ok: true,
          workspaceId: "ws-managed",
          runtimePath: "/srv/openbot/workspaces/agt-member-example-com-managed-helper",
        };
      }
      if (method === "agents.create") {
        return { agentId: "agt-member-example-com-managed-helper", name: "Managed Helper" };
      }
      if (method === "robots.bind-workspace") {
        return { ok: true };
      }
      return null;
    });
    const state = createState({
      client: { request } as never,
      configSnapshot: {
        hash: "managed-config",
        config: { data: { mode: "managed" } },
      } as never,
      platformAuthState: {
        session: { user: "member@example.com", displayName: "Member", tenantId: "acme" },
        employeeAccess: {
          currentSeat: { seatId: "seat-1", title: "Analyst" },
          employeeUserId: "user-uuid-1",
          pendingOffer: null,
        },
      } as never,
      workbenchAgentCreatorName: "Managed Helper",
      workbenchAgentCreatorLocalPath: "",
      workbenchAgentCreatorOpen: true,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    await props.onCreateAgent?.();

    expect(request).not.toHaveBeenCalledWith("workspaces.local.validate", expect.anything());
    expect(request).toHaveBeenCalledWith(
      "agents.create",
      expect.objectContaining({
        ownerPositionId: "seat-1",
        tenantId: "acme",
      }),
    );
    const createArgs = request.mock.calls.find((call) => call[0] === "agents.create")?.[1];
    expect(createArgs).not.toHaveProperty("ownerUserId");
    expect(state.sessionKey).toBe("agent:agt-member-example-com-managed-helper:main");
    expect(state.workbenchPrimaryModule).toBe("assistant");
  });

  it("blocks enterprise agent creation before creating a workspace when no seat is active", async () => {
    const request = vi.fn(async () => null);
    const state = createState({
      client: { request } as never,
      configSnapshot: {
        hash: "managed-config",
        config: { data: { mode: "managed" } },
      } as never,
      platformAuthState: {
        session: { user: "member@example.com", displayName: "Member", tenantId: "acme" },
        employeeAccess: {
          currentSeat: null,
          pendingOffer: { offerId: "offer-1", seatId: "seat-1", seatTitle: "Analyst" },
        },
      } as never,
      workbenchAgentCreatorName: "Managed Helper",
      workbenchAgentCreatorOpen: true,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    await props.onCreateAgent?.();

    expect(request).not.toHaveBeenCalledWith("workspaces.create", expect.anything());
    expect(request).not.toHaveBeenCalledWith("agents.create", expect.anything());
    expect(state.workbenchAgentCreatorOpen).toBe(false);
    expect(state.workbenchPrimaryModule).toBe("settings");
    expect(state.workbenchSettingsView).toBe("personal");
    expect(state.workbenchPersonalSettingsTab).toBe("account");
  });

  it("saves the default local workspace root through config.set after validation", async () => {
    let configSetParams: Record<string, unknown> | null = null;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "workspaces.local.validate") {
        return {
          ok: true,
          resolvedPath: "/Users/daniel/.openbot/workspace",
          isDirectory: true,
          readable: true,
          writable: true,
        };
      }
      if (method === "config.get") {
        return {
          hash: "hash-1",
          config: {
            agents: {
              defaults: {
                workspace: "/Users/daniel/.openbot/old-workspace",
              },
            },
          },
        };
      }
      if (method === "config.set") {
        configSetParams = params ?? null;
        return { ok: true };
      }
      return null;
    });
    const state = createState({
      client: { request } as never,
      configSnapshot: {
        hash: "hash-1",
        config: {
          agents: {
            defaults: {
              workspace: "/Users/daniel/.openbot/old-workspace",
            },
          },
        },
      } as never,
      workbenchDefaultWorkspaceRootDraft: "/Users/daniel/.openbot/workspace",
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    await props.onSaveDefaultWorkspaceRoot?.();

    expect(configSetParams).not.toBeNull();
    const capturedConfigSetParams = configSetParams as unknown as Record<string, unknown>;
    const raw = String((capturedConfigSetParams.raw as string | undefined) ?? "");
    expect(capturedConfigSetParams.baseHash).toBe("hash-1");
    expect(raw).toContain("/Users/daniel/.openbot/workspace");
    expect(state.workbenchDefaultWorkspaceRootNotice).toBe("OpenBot 工作空间根目录已更新。");
  });

  it("does not open workspace selector for default-local (Phase 1)", async () => {
    const request = vi.fn(async () => null);
    const state = createState({
      client: { request } as never,
      configSnapshot: {
        hash: "hash-1",
        config: {
          agents: {
            defaults: {
              workspace: "/Users/daniel/.openbot/old-workspace",
            },
          },
        },
      } as never,
      workbenchDefaultWorkspaceRootDraft: "",
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    await props.onOpenWorkspaceSelector?.("default-local");

    expect(request).not.toHaveBeenCalledWith("workspaces.local.browse", expect.any(Object));
    expect(state.workbenchWorkspaceSelectorOpen ?? false).toBe(false);
    expect(state.workbenchWorkspaceSelectorLocalBrowserOpen ?? false).toBe(false);
  });

  it("uses the native directory chooser when explicitly requested for robot-local", async () => {
    let agentsUpdateParams: Record<string, unknown> | null = null;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "workspaces.local.choose") {
        expect(params).toMatchObject({
          title: "选择 sales 工作区",
        });
        return {
          cancelled: false,
          path: "/Users/daniel/.openbot/workspace-native",
        };
      }
      if (method === "agents.update") {
        agentsUpdateParams = params ?? null;
        return { ok: true };
      }
      if (method === "agents.list") {
        return { agents: [] };
      }
      return null;
    });
    const state = createState({
      client: { request } as never,
      configSnapshot: {
        hash: "hash-1",
        config: {
          agents: {
            defaults: {
              workspace: "/Users/daniel/.openbot/old-workspace",
            },
          },
        },
      } as never,
      workbenchDefaultWorkspaceRootDraft: "",
      workbenchWorkspaceSelectorOpen: true,
      workbenchWorkspaceSelectorMode: "robot-local",
      workbenchWorkspaceSelectorTitle: "选择 sales 工作区",
      workbenchWorkspaceSelectorTargetId: "sales",
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    await props.onChooseWorkspaceSelector?.();

    expect(request).toHaveBeenCalledWith("workspaces.local.choose", expect.any(Object));
    expect(state.workbenchWorkspaceSelectorSelectedPath).toBe(
      "/Users/daniel/.openbot/workspace-native",
    );

    await props.onApplyWorkspaceSelector?.();

    expect(agentsUpdateParams).toMatchObject({
      agentId: "sales",
      workspace: "/Users/daniel/.openbot/workspace-native",
    });
    expect(state.workbenchWorkspaceSelectorOpen).toBe(false);
  });

  it("falls back to the directory browser when the native chooser is unavailable", async () => {
    const request = vi.fn(async (method: string, _params?: Record<string, unknown>) => {
      if (method === "workspaces.local.choose") {
        return {
          cancelled: true,
          message: "当前平台暂不支持系统目录选择器，请使用目录浏览或手动配置路径。",
        };
      }
      if (method === "workspaces.local.browse") {
        return {
          currentPath: "/Users/daniel/.openbot/old-workspace",
          parentPath: "/Users/daniel/.openbot",
          entries: [{ name: "workspace", path: "/Users/daniel/.openbot/old-workspace/workspace" }],
        };
      }
      return null;
    });
    const state = createState({
      client: { request } as never,
      configSnapshot: {
        hash: "hash-1",
        config: {
          agents: {
            defaults: {
              workspace: "/Users/daniel/.openbot/old-workspace",
            },
          },
        },
      } as never,
      workbenchDefaultWorkspaceRootDraft: "",
      workbenchWorkspaceSelectorOpen: true,
      workbenchWorkspaceSelectorMode: "robot-local",
      workbenchWorkspaceSelectorTitle: "选择 sales 工作区",
      workbenchWorkspaceSelectorTargetId: "sales",
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    await props.onChooseWorkspaceSelector?.();

    expect(request).toHaveBeenCalledWith("workspaces.local.choose", expect.any(Object));
    expect(request).toHaveBeenCalledWith("workspaces.local.browse", expect.any(Object));
    expect(state.workbenchWorkspaceSelectorLocalBrowserOpen).toBe(true);
    expect(state.workbenchWorkspaceSelectorLocalBrowserError).toBeNull();
  });

  it("ignores default-cloud workspace selector in employee settings (Phase 1)", async () => {
    const request = vi.fn(async () => null);
    const state = createState({
      client: { request } as never,
      configSnapshot: {
        hash: "hash-1",
        config: {
          agents: {
            defaults: {
              workspace: "/Users/daniel/.openbot/old-workspace",
            },
          },
        },
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    await props.onOpenWorkspaceSelector?.("default-cloud");

    expect(request).not.toHaveBeenCalledWith(
      "workspaces.cloud.generate-config",
      expect.any(Object),
    );
    expect(request).not.toHaveBeenCalledWith("workspaces.local.browse", expect.any(Object));
    expect(state.workbenchWorkspaceSelectorOpen ?? false).toBe(false);
  });

  it("requests node permissions before falling back to system settings", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "node.invoke") {
        expect(params).toMatchObject({
          command: "device.permissions.request",
        });
        return {
          payload: {
            permissions: {
              appleScript: true,
            },
          },
        };
      }
      if (method === "node.list") {
        return {
          nodes: [
            {
              nodeId: "mac-main",
              connected: true,
              permissions: {
                appleScript: true,
              },
            },
          ],
        };
      }
      return null;
    });
    const state = createState({
      client: { request } as never,
      nodes: [
        {
          nodeId: "mac-main",
          connected: true,
          permissions: {
            appleScript: false,
          },
        },
      ] as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    const openSystemAuthorization = props.onOpenSystemAuthorization;
    if (openSystemAuthorization) {
      await Promise.resolve(openSystemAuthorization("automation"));
    }

    expect(request).toHaveBeenCalledWith(
      "node.invoke",
      expect.objectContaining({
        nodeId: "mac-main",
        command: "device.permissions.request",
      }),
    );
    expect(state.workbenchDefaultWorkspaceRootNotice).toBe("系统授权状态已刷新。");
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("does not fake system-settings deep links without a Mac node on non-Apple browsers", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const userAgentSpy = vi
      .spyOn(window.navigator, "userAgent", "get")
      .mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    const platformSpy = vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Win32");
    const state = createState({
      client: { request: vi.fn() } as never,
      connected: true,
      nodes: [] as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    await Promise.resolve(props.onOpenSystemAuthorization?.("automation"));

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("Privacy_Automation"),
      "_blank",
      "noopener,noreferrer",
    );
    expect(state.workbenchSystemAuthorizationError).toBeNull();
    openSpy.mockRestore();
    userAgentSpy.mockRestore();
    platformSpy.mockRestore();
  });

  it("opens Mac privacy settings for full disk access without node.invoke", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const userAgentSpy = vi
      .spyOn(window.navigator, "userAgent", "get")
      .mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    const platformSpy = vi.spyOn(window.navigator, "platform", "get").mockReturnValue("MacIntel");
    const request = vi.fn();
    const state = createState({
      client: { request } as never,
      connected: true,
      nodes: [
        {
          nodeId: "mac-main",
          connected: true,
          permissions: {},
        },
      ] as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    await Promise.resolve(props.onOpenSystemAuthorization?.("fullDiskAccess"));

    expect(request.mock.calls.some((call) => call[0] === "node.invoke")).toBe(false);
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("Privacy_AllFiles"),
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
    userAgentSpy.mockRestore();
    platformSpy.mockRestore();
  });

  it("saves a selected robot workspace path on confirm", async () => {
    let updateParams: Record<string, unknown> | null = null;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "agents.update") {
        updateParams = params ?? null;
        return { ok: true };
      }
      if (method === "agents.list") {
        return {
          agents: [
            {
              id: "market-helper",
              name: "市场助手",
              identity: { name: "市场助手", emoji: "📈" },
              workspace: "/Users/daniel/workspaces/market-helper",
              scope: "self",
            },
          ],
          defaultId: "market-helper",
        };
      }
      return null;
    });
    const state = createState({
      client: { request } as never,
      workbenchWorkspaceSelectorOpen: true,
      workbenchWorkspaceSelectorMode: "robot-local",
      workbenchWorkspaceSelectorSelectedPath: "/Users/daniel/workspaces/market-helper",
      workbenchWorkspaceSelectorTargetId: "market-helper",
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    await props.onApplyWorkspaceSelector?.();

    expect(updateParams).toEqual({
      agentId: "market-helper",
      workspace: "/Users/daniel/workspaces/market-helper",
    });
    expect(request).toHaveBeenCalledWith("agents.list", {});
    expect(state.workbenchWorkspaceSelectorOpen).toBe(false);
  });

  it("renders the agent creator as a default-workspace summary instead of per-agent root selection", async () => {
    const state = createState({
      workbenchAgentCreatorOpen: true,
      workbenchAgentCreatorStep: "identity",
      workbenchAgentCreatorRoleSource: "template",
      workbenchAgentCreatorName: "市场助手",
      workbenchAgentCreatorLocalPath: "/Users/daniel/.openbot/workspace",
      workbenchAgentCreatorLocalValidationState: "valid",
      workbenchAgentCreatorLocalValidationMessage: "目录可访问，可用于机器人运行。",
      workbenchAgentCreatorLocalResolvedPath: "/Users/daniel/.openbot/workspace",
      workbenchAgentCreatorLocalReadable: true,
      workbenchAgentCreatorLocalWritable: true,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });
    const container = document.createElement("div");
    render(renderWorkbench(props), container);
    await Promise.resolve();

    expect(container.textContent).toContain("默认空间");
    expect(container.textContent).toContain("/Users/daniel/.openbot/workspace");
    expect(container.textContent).toContain("头像设置");
    expect(container.textContent).not.toContain("云端空间");
    expect(container.textContent).not.toContain("选择目录");
    expect(container.textContent).not.toContain("默认存储方式");
    expect(container.textContent).not.toContain("自动分配规则");
    expect(container.textContent).not.toContain("自动生成独立目录");
    expect(container.textContent).not.toContain("机器人信息");
  });

  it("uses an owner-scoped hidden agentId when creating a robot for the current employee", async () => {
    let createParams: Record<string, unknown> | null = null;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "workspaces.local.validate") {
        return {
          ok: true,
          resolvedPath: "/Users/daniel/workspace-market",
          isDirectory: true,
          readable: true,
          writable: true,
        };
      }
      if (method === "workspaces.create") {
        return {
          ok: true,
          workspaceId: "ws_1",
          runtimePath: "/Users/daniel/workspace-market",
        };
      }
      if (method === "agents.create") {
        createParams = params ?? null;
        return { agentId: "agt-lisi-acme-com-market-helper", name: "Market Helper" };
      }
      if (method === "robots.bind-workspace") {
        return { ok: true, agentId: "agt-lisi-acme-com-market-helper", workspaceId: "ws_1" };
      }
      return null;
    });
    const state = createState({
      bootstrapAuthSession: {
        provider: "trusted-proxy",
        user: "lisi@acme.com",
        displayName: "李四",
        tenantId: "acme",
      } as never,
      client: { request } as never,
      workbenchAgentCreatorName: "Market Helper",
      workbenchAgentCreatorLocalPath: "~/workspace-market",
      workbenchAgentCreatorOpen: true,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    await props.onCreateAgent?.();

    expect(createParams).toMatchObject({
      name: "Market Helper",
      agentId: "agt-lisi-acme-com-market-helper",
    });
    expect((createParams as Record<string, unknown> | null)?.ownerUserId).toBeUndefined();
  });

  it("sends platform employeeUserId (not login email) as agents.create ownerUserId", async () => {
    let createParams: Record<string, unknown> | null = null;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "workspaces.create") {
        return {
          ok: true,
          workspaceId: "ws_managed",
          runtimePath: "/data/runtime/agents/market-helper",
        };
      }
      if (method === "agents.create") {
        createParams = params ?? null;
        return { agentId: "market-helper", name: "市场主管" };
      }
      if (method === "robots.bind-workspace") {
        return { ok: true, agentId: "market-helper", workspaceId: "ws_managed" };
      }
      return null;
    });
    const state = createState({
      bootstrapDataSpace: { mode: "managed", displayRoot: undefined },
      bootstrapAuthSession: {
        provider: "trusted-proxy",
        user: "daniel.hhd@gmail.com",
        displayName: "Daniel",
        tenantId: "001",
      } as never,
      platformAuthState: {
        session: {
          provider: "trusted-proxy",
          user: "daniel.hhd@gmail.com",
          displayName: "Daniel",
          tenantId: "001",
        },
        employeeAccess: {
          employeeUserId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
          currentSeat: { seatId: "seat-ceo-daniel-main", title: "CEO" },
        },
      } as never,
      client: { request } as never,
      connected: true,
      workbenchAgentCreatorName: "市场主管",
      workbenchAgentCreatorOpen: true,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    await props.onCreateAgent?.();

    expect((createParams as Record<string, unknown> | null)?.ownerUserId).toBeUndefined();
    expect((createParams as Record<string, unknown> | null)?.ownerUserLabel).toBe("Daniel");
    expect((createParams as Record<string, unknown> | null)?.ownerPositionId).toBe(
      "seat-ceo-daniel-main",
    );
  });

  it("allows creating a Chinese-named robot when another Chinese-named robot already exists", async () => {
    let createParams: Record<string, unknown> | null = null;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "workspaces.local.validate") {
        return {
          ok: true,
          resolvedPath: "/Users/daniel/openbot",
          isDirectory: true,
          readable: true,
          writable: true,
        };
      }
      if (method === "workspaces.create") {
        return {
          ok: true,
          workspaceId: "ws_2",
          runtimePath: "/Users/daniel/openbot/agents/agt-daniel-knowledge-flow",
        };
      }
      if (method === "agents.create") {
        createParams = params ?? null;
        return { agentId: "agt-daniel-knowledge-flow", name: "知识流管理" };
      }
      if (method === "robots.bind-workspace") {
        return { ok: true, agentId: "agt-daniel-knowledge-flow", workspaceId: "ws_2" };
      }
      if (method === "agents.list") {
        return {
          agents: [
            {
              id: "main",
              name: "Daibai",
              identity: { name: "Daibai", emoji: "AI" },
              scope: "self",
            },
            {
              id: "agt-daniel-",
              name: "市场助手",
              identity: { name: "市场助手", emoji: "📈" },
              scope: "self",
            },
          ],
          defaultId: "main",
          mainKey: "main",
          scope: "self",
        };
      }
      return null;
    });
    const state = createState({
      bootstrapAuthSession: {
        provider: "trusted-proxy",
        user: "daniel",
        displayName: "Daniel",
        tenantId: "acme",
      } as never,
      client: { request } as never,
      connected: true,
      agentsList: {
        agents: [
          {
            id: "main",
            name: "Daibai",
            identity: { name: "Daibai", emoji: "AI" },
            scope: "self",
          },
          {
            id: "agt-daniel-",
            name: "市场助手",
            identity: { name: "市场助手", emoji: "📈" },
            scope: "self",
          },
        ],
        defaultId: "main",
      } as never,
      workbenchAgentCreatorName: "知识流管理",
      workbenchAgentCreatorLocalPath: "/Users/daniel/openbot",
      workbenchAgentCreatorOpen: true,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    await props.onCreateAgent?.();

    expect(state.workbenchAgentCreatorError).toBeNull();
    const capturedCreateParams = createParams as Record<string, unknown> | null;
    expect(capturedCreateParams?.name).toBe("知识流管理");
    expect(capturedCreateParams?.agentId).toMatch(/^agt-daniel-n[a-z0-9]+$/);
  });

  it("shows candidate humans and bots on the second step of collaboration space creation", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "collaboration.spaces.members.update") {
        return null;
      }
      if (method === "collaboration.spaces.list") {
        return { spaces: [] };
      }
      return null;
    });
    const state = createState({
      client: { request } as never,
      sessionKey: "main",
      workbenchTeamSelectedKey: "main",
      agentsList: {
        agents: [
          { id: "main", name: "Daibai", identity: { name: "Daibai", emoji: "AI" }, scope: "self" },
          {
            id: "market-bot",
            name: "市场助手",
            identity: { name: "市场助手", emoji: "📈" },
            scope: "self",
          },
        ],
        defaultId: "main",
      } as never,
      platformAuthState: {
        members: [
          {
            user: "alice@acme.com",
            displayName: "Alice",
            membershipRole: "member",
            status: "active",
            seatTitle: "研究员",
          },
        ],
      } as never,
      workbenchSpaceCreatorTitle: "设计评审组",
      workbenchSpaceCreatorGroupId: "design-review",
      workbenchSpaceCreatorOpen: true,
      workbenchCollaborationOrgBotDirectory: [
        {
          agentId: "main",
          label: "Daibai",
          ownerUserId: "owner@acme.com",
          ownerLabel: "Owner",
          scope: "self",
        },
        {
          agentId: "market-bot",
          label: "市场助手",
          ownerUserId: "owner@acme.com",
          ownerLabel: "Owner",
          scope: "self",
        },
        {
          agentId: "shared-research-bot",
          label: "研究助理",
          ownerUserId: "alice@acme.com",
          ownerLabel: "Alice",
          scope: "shared",
        },
      ],
      collaborationSpacesResult: { spaces: [] },
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    await props.onCreateSpace?.();

    const nextProps = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(state.workbenchSpaceCreatorStep).toBe("members");
    expect(nextProps.spaceCreator?.candidateHumans.map((entry) => entry.label)).toContain("Alice");
    expect(nextProps.spaceCreator?.candidateBots.map((entry) => entry.label)).toContain("市场助手");
    expect(
      nextProps.spaceCreator?.candidateBots.find((entry) => entry.id === "shared-research-bot"),
    ).toMatchObject({
      label: "研究助理",
      group: "Alice 的机器人",
    });
  });

  it("uses real enterprise members instead of session keys for space creator humans", () => {
    const state = createState({
      platformAuthState: {
        members: [
          {
            user: "owner@acme.com",
            displayName: "UPBEYOND",
            membershipRole: "enterprise-admin",
            status: "active",
            seatTitle: "负责人",
          },
        ],
      } as never,
      bootstrapAuthSession: {
        provider: "trusted-proxy",
        user: "owner@acme.com",
        displayName: "UPBEYOND",
        tenantId: "acme",
      } as never,
      workbenchSpaceCreatorOpen: true,
      workbenchSpaceCreatorStep: "members",
      sessionsResult: {
        sessions: [
          {
            key: "agent:bot:main",
            updatedAt: 9,
            kind: "direct",
            displayName: "agent:bot:main",
          },
          {
            key: "agent:main:space:space-fef40e8a-0958-4c74-b557-069d7c333981",
            updatedAt: 10,
            kind: "direct",
            displayName: "agent:main:space:space-fef40e8a-0958-4c74-b557-069d7c333981",
          },
        ],
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    // Owner is auto-added as a member — they must not appear as an invite target.
    expect(props.spaceCreator?.candidateHumans).toEqual([]);
  });

  it("filters session-like identities out of the human candidate roster", () => {
    const state = createState({
      platformAuthState: {
        members: [
          {
            user: "agent:bot:main",
            displayName: "agent:bot:main",
            membershipRole: "member",
            status: "active",
          },
          {
            user: "owner@acme.com",
            displayName: "UPBEYOND",
            membershipRole: "enterprise-admin",
            status: "active",
            seatTitle: "负责人",
          },
        ],
      } as never,
      bootstrapAuthSession: {
        provider: "trusted-proxy",
        user: "agent:bot:main",
        displayName: "agent:bot:main",
        tenantId: "acme",
      } as never,
      workbenchSpaceCreatorOpen: true,
      workbenchSpaceCreatorStep: "members",
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.spaceCreator?.candidateHumans).toEqual([
      expect.objectContaining({
        id: "owner@acme.com",
        label: "UPBEYOND",
      }),
    ]);
  });

  it("does not synthesize a human candidate from assistant display name alone", () => {
    const state = createState({
      assistantName: "Venus",
      bootstrapAuthSession: null,
      platformAuthState: null,
      workbenchSpaceCreatorOpen: true,
      workbenchSpaceCreatorStep: "members",
      sessionsResult: { sessions: [] } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.spaceCreator?.candidateHumans).toEqual([]);
  });

  it("does not list the current employee as a space-creator invite target", () => {
    const state = createState({
      bootstrapAuthSession: {
        provider: "trusted-proxy",
        user: "zhangsan@acme.com",
        displayName: "张三",
        tenantId: "acme",
      } as never,
      workbenchSpaceCreatorOpen: true,
      workbenchSpaceCreatorStep: "members",
      sessionsResult: {
        sessions: [{ key: "main", updatedAt: 8, kind: "direct", displayName: "Main Session" }],
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.spaceCreator?.candidateHumans).toEqual([]);
  });

  it("keeps the human candidate roster empty when only the current employee is known", () => {
    const state = createState({
      bootstrapAuthSession: {
        provider: "trusted-proxy",
        user: "lisi@acme.com",
        displayName: "李四",
        tenantId: "acme",
      } as never,
      workbenchSpaceCreatorOpen: true,
      workbenchSpaceCreatorStep: "members",
      sessionsResult: { sessions: [] } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.spaceCreator?.candidateHumans).toEqual([]);
  });

  it("shows a newly created collaboration space in the left navigation immediately", async () => {
    let createParams: Record<string, unknown> | null = null;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "collaboration.spaces.members.update") {
        createParams = params ?? null;
        return {
          space: {
            id: "design-review",
            groupId: "design-review",
            title: "设计评审组",
            avatar: "🛡️",
            ownerUserId: "alice@acme.com",
            members: {
              humans: [{ userId: "alice@acme.com", name: "Alice", status: "active" }],
              bots: [{ agentId: "market-bot", name: "市场助手", status: "active" }],
            },
            invites: { humans: [], bots: [] },
          },
        };
      }
      if (method === "collaboration.spaces.list") {
        return { spaces: [] };
      }
      return null;
    });
    const state = createState({
      client: { request } as never,
      sessionKey: "main",
      workbenchTeamSelectedKey: "main",
      platformAuthState: {
        members: [
          {
            user: "alice@acme.com",
            displayName: "Alice",
            membershipRole: "member",
            status: "active",
            seatTitle: "研究员",
          },
        ],
        employeeAccess: {
          ownedAgentIds: ["market-bot"],
        },
      } as never,
      bootstrapAuthSession: {
        provider: "trusted-proxy",
        user: "alice@acme.com",
        displayName: "Alice",
        tenantId: "acme",
      } as never,
      workbenchCollaborationOrgBotDirectory: [
        {
          agentId: "market-bot",
          label: "市场助手",
          ownerUserId: "alice@acme.com",
          ownerLabel: "Alice",
          scope: "self",
        },
      ],
      sessionsResult: {
        sessions: [
          { key: "main", updatedAt: 8, kind: "global", displayName: "主助手" },
          {
            key: "telegram:direct:alice",
            updatedAt: 12,
            kind: "direct",
            subject: "Alice",
            surface: "telegram",
            displayName: "Alice",
          },
        ],
      } as never,
      agentsList: {
        agents: [
          { id: "main", name: "Daibai", identity: { name: "Daibai", emoji: "AI" }, scope: "self" },
          {
            id: "market-bot",
            name: "市场助手",
            identity: { name: "市场助手", emoji: "📈" },
            scope: "self",
          },
        ],
        defaultId: "main",
      } as never,
      workbenchSpaceCreatorTitle: "设计评审组",
      workbenchSpaceCreatorAvatar: "🛡️",
      workbenchSpaceCreatorGroupId: "design-review",
      workbenchSpaceCreatorOpen: true,
      collaborationSpacesResult: { spaces: [] },
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    await props.onCreateSpace?.();
    expect(state.workbenchSpaceCreatorStep).toBe("members");
    props.onSpaceCreatorToggleHumanSelection?.("alice@acme.com");
    props.onSpaceCreatorToggleBotSelection?.("market-bot");
    await props.onCreateSpace?.();

    expect(createParams).toMatchObject({
      groupId: "grp-alice-acme-com-设计评审组",
      title: "设计评审组",
      avatar: "🛡️",
      members: {
        humans: [{ userId: "alice@acme.com", name: "Alice" }],
        bots: [{ agentId: "market-bot", name: "市场助手" }],
      },
    });
    expect(createParams).not.toHaveProperty("invites");
    expect(state.workbenchPrimaryModule).toBe("collaboration");
    expect(state.workbenchTeamSelectedKey).toBe("space:grp-alice-acme-com-设计评审组");
    expect(state.sessionKey).toBe("space:grp-alice-acme-com-设计评审组");
    expect(state.workbenchGroupProfileView).toBe("chat");

    const nextProps = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });
    const container = document.createElement("div");
    render(renderWorkbench(nextProps), container);
    await Promise.resolve();

    const navTitles = Array.from(
      container.querySelectorAll(".employee-workbench__nav-title"),
      (node) => node.textContent?.trim() ?? "",
    );
    expect(navTitles).toContain("设计评审组");
  });

  it("uses an owner-scoped hidden groupId when creating a collaboration space for the current employee", async () => {
    let createParams: Record<string, unknown> | null = null;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "collaboration.spaces.members.update") {
        createParams = params ?? null;
        return {
          space: {
            id: "grp-lisi-acme-com-product-rnd",
            groupId: "grp-lisi-acme-com-product-rnd",
            title: "Product RnD",
            members: { humans: [], bots: [] },
            invites: { humans: [], bots: [] },
          },
        };
      }
      if (method === "collaboration.spaces.list") {
        return { spaces: [] };
      }
      return null;
    });
    const state = createState({
      bootstrapAuthSession: {
        provider: "trusted-proxy",
        user: "lisi@acme.com",
        displayName: "李四",
        tenantId: "acme",
      } as never,
      client: { request } as never,
      workbenchSpaceCreatorTitle: "Product RnD",
      workbenchSpaceCreatorPurpose: "战略研究与咨询",
      workbenchSpaceCreatorCurrentMission: "明确研究方向与节奏",
      workbenchSpaceCreatorSystemInstructions: "新成员进入后先自我介绍\n重要结论要沉淀为群记忆",
      workbenchSpaceCreatorOpen: true,
      workbenchSpaceCreatorStep: "members",
      collaborationSpacesResult: { spaces: [] },
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    await props.onCreateSpace?.();

    expect(createParams).toMatchObject({
      groupId: "grp-lisi-acme-com-product-rnd",
      title: "Product RnD",
      purpose: "战略研究与咨询",
      currentMission: "明确研究方向与节奏",
      collaborationMode: "discussion_driven",
      systemInstructions: ["新成员进入后先自我介绍", "重要结论要沉淀为群记忆"],
    });
  });

  it("routes non-owned shared bots into pending invites when creating a collaboration space", async () => {
    let createParams: Record<string, unknown> | null = null;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "collaboration.spaces.members.update") {
        createParams = params ?? null;
        return {
          space: {
            id: "design-review",
            groupId: "design-review",
            title: "设计评审组",
            avatar: "🪐",
            members: {
              humans: [{ userId: "telegram:alice", name: "Alice", status: "active" }],
              bots: [],
            },
            invites: {
              humans: [],
              bots: [{ agentId: "shared-research-bot", name: "研究助理", status: "invited" }],
            },
          },
        };
      }
      if (method === "collaboration.spaces.list") {
        return { spaces: [] };
      }
      return null;
    });
    const state = createState({
      client: { request } as never,
      sessionKey: "main",
      workbenchTeamSelectedKey: "main",
      platformAuthState: {
        members: [
          {
            user: "alice@acme.com",
            displayName: "Alice",
            membershipRole: "member",
            status: "active",
          },
        ],
      } as never,
      agentsList: {
        agents: [
          { id: "main", name: "Daibai", identity: { name: "Daibai", emoji: "AI" }, scope: "self" },
        ],
        defaultId: "main",
      } as never,
      workbenchSpaceCreatorTitle: "设计评审组",
      workbenchSpaceCreatorAvatar: "🪐",
      workbenchSpaceCreatorPurpose: "负责设计评审与决策支持",
      workbenchSpaceCreatorCurrentMission: "建立统一评审口径",
      workbenchSpaceCreatorSystemInstructions: "新成员进入后先自我介绍\n重要结论要沉淀为群记忆",
      workbenchSpaceCreatorGroupId: "design-review",
      workbenchSpaceCreatorOpen: true,
      workbenchCollaborationOrgBotDirectory: [
        {
          agentId: "main",
          label: "Daibai",
          ownerUserId: "owner@acme.com",
          ownerLabel: "Owner",
          scope: "self",
        },
        {
          agentId: "shared-research-bot",
          label: "研究助理",
          ownerUserId: "alice@acme.com",
          ownerLabel: "Alice",
          scope: "shared",
        },
      ],
      collaborationSpacesResult: { spaces: [] },
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    await props.onCreateSpace?.();
    expect(state.workbenchSpaceCreatorStep).toBe("members");
    props.onSpaceCreatorToggleHumanSelection?.("alice@acme.com");
    props.onSpaceCreatorToggleBotSelection?.("shared-research-bot");
    await props.onCreateSpace?.();

    expect(createParams).toMatchObject({
      groupId: "设计评审组",
      title: "设计评审组",
      avatar: "🪐",
      purpose: "负责设计评审与决策支持",
      currentMission: "建立统一评审口径",
      collaborationMode: "discussion_driven",
      systemInstructions: ["新成员进入后先自我介绍", "重要结论要沉淀为群记忆"],
      members: {
        humans: [{ userId: "alice@acme.com", name: "Alice" }],
        bots: [],
      },
      invites: {
        bots: [{ agentId: "shared-research-bot", name: "研究助理" }],
      },
    });
  });

  it("surfaces shared bots as invite candidates in member governance", () => {
    const state = createState({
      workbenchMemberGovernanceDrawerOpen: true,
      bootstrapAuthSession: {
        provider: "trusted-proxy",
        user: "ceo@acme.com",
        displayName: "CEO",
        tenantId: "acme",
      } as never,
      workbenchCollaborationOrgBotDirectory: [
        {
          agentId: "main",
          label: "Daibai",
          ownerUserId: "ceo@acme.com",
          ownerLabel: "CEO",
          scope: "self",
        },
        {
          agentId: "shared-research-bot",
          label: "研究助理",
          ownerUserId: "alice@acme.com",
          ownerLabel: "Alice",
          scope: "shared",
        },
      ],
      agentsList: {
        agents: [
          { id: "main", name: "Daibai", identity: { name: "Daibai", emoji: "AI" }, scope: "self" },
        ],
        defaultId: "main",
      } as never,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "alpha",
            groupId: "group-alpha",
            title: "产品研发小组",
            members: { humans: [], bots: [] },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.collaborationMemberGovernance?.candidateBots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "shared-research-bot",
          actionMode: "invite",
          orgSegments: ["Alice 的机器人"],
        }),
      ]),
    );
  });

  it("does not re-initialize member governance on repeated props builds while selector is open", async () => {
    const botDirectory = await import("./collaboration-org-bot-directory.ts");
    const loadSpy = vi.spyOn(botDirectory, "loadCollaborationOrgBotDirectory");
    loadSpy.mockImplementation(async () => undefined);

    const state = createState({
      workbenchMemberGovernanceDrawerOpen: true,
      workbenchMemberGovernanceGroupKey: "space:group-alpha",
      workbenchMemberGovernanceTitle: "产品研发小组",
      workbenchMemberGovernanceSelectorKind: "human",
      workbenchMemberGovernanceCurrentHumans: [{ id: "ceo@acme.com", label: "CEO", kind: "human" }],
    });
    const input = {
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    };

    for (let index = 0; index < 10; index += 1) {
      buildEmployeeWorkbenchProps(input);
    }

    expect(state.workbenchMemberGovernanceSelectorKind).toBe("human");
    expect(state.workbenchMemberGovernanceGroupKey).toBe("space:group-alpha");
    expect(loadSpy).not.toHaveBeenCalled();

    loadSpy.mockRestore();
  });

  it("opens human selector without resetting state on subsequent props builds", () => {
    const state = createState({
      workbenchMemberGovernanceDrawerOpen: true,
    });
    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onMemberGovernanceOpenSelector?.("human");
    expect(state.workbenchMemberGovernanceSelectorKind).toBe("human");

    let latestProps = props;
    for (let index = 0; index < 5; index += 1) {
      latestProps = buildEmployeeWorkbenchProps({
        state,
        chatContent: html`
          <div>chat</div>
        `,
        authPanel: null,
      });
    }

    expect(state.workbenchMemberGovernanceSelectorKind).toBe("human");
    expect(latestProps.collaborationMemberGovernance?.selectorKind).toBe("human");
  });

  it("persists a bot candidate invite and reports awaiting-join receipt", async () => {
    let updateParams: Record<string, unknown> | null = null;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "collaboration.spaces.members.update") {
        updateParams = params ?? null;
        return {
          space: {
            id: "alpha",
            groupId: "group-alpha",
            title: "产品研发小组",
            members: { humans: [], bots: [] },
            invites: {
              humans: [],
              bots: [{ agentId: "peer-bot", name: "市场分析助手", status: "invited" }],
            },
          },
        };
      }
      return null;
    });
    const state = createState({
      client: { request } as never,
      workbenchMemberGovernanceDrawerOpen: true,
      platformAuthState: {
        session: {
          user: "owner@acme.com",
          displayName: "Owner",
          tenantId: "tenant-1",
        },
        employeeAccess: {
          employeeUserId: "user-owner",
          ownedAgentIds: [],
          currentSeat: { seatId: "seat-1", title: "产品经理" },
        },
      } as never,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "alpha",
            groupId: "group-alpha",
            title: "产品研发小组",
            members: { humans: [], bots: [] },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
    });
    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });
    state.workbenchMemberGovernanceSelectorKind = "bot";
    state.workbenchMemberGovernanceCandidateBots = [
      {
        id: "peer-bot",
        label: "市场分析助手",
        kind: "bot",
        actionMode: "invite",
        orgSegments: ["Alice 的机器人"],
      },
    ];

    props.onMemberGovernanceInviteBot?.("peer-bot");

    await vi.waitFor(() => {
      expect(updateParams).toMatchObject({
        tenantId: "tenant-1",
        ownerPositionId: "seat-1",
        ownerPositionLabel: "产品经理",
        invites: { bots: [{ agentId: "peer-bot", name: "市场分析助手" }] },
      });
      expect(state.workbenchMemberGovernanceResult).toBe("已邀请 市场分析助手，待对方加入。");
      expect(state.workbenchMemberGovernanceSelectorKind).toBe("bot");
    });
  });

  it("excludes the current user from space-creator human candidates", () => {
    const state = createState({
      platformAuthState: {
        session: {
          user: "owner@acme.com",
          displayName: "Owner",
          tenantId: "tenant-1",
        },
        employeeAccess: {
          employeeUserId: "user-owner",
          ownedAgentIds: [],
        },
        members: [
          {
            user: "owner@acme.com",
            displayName: "Owner",
            membershipRole: "member",
            status: "active",
          },
          {
            user: "alice@acme.com",
            displayName: "Alice",
            membershipRole: "member",
            status: "active",
          },
        ],
      } as never,
      workbenchSpaceCreatorOpen: true,
    });
    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });
    const humanIds = (props.spaceCreator?.candidateHumans ?? []).map((entry) => entry.id);
    expect(humanIds).toContain("alice@acme.com");
    expect(humanIds).not.toContain("owner@acme.com");
    expect(humanIds).not.toContain("user-owner");
  });

  it("creates a collaboration space with the owner as an active human member", async () => {
    let updateParams: Record<string, unknown> | null = null;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "collaboration.spaces.members.update") {
        updateParams = params ?? null;
        return {
          space: {
            id: "space-demo",
            groupId: "space-demo",
            title: "产品研发小组",
            members: {
              humans: [{ userId: "user-owner", name: "Owner", status: "active" }],
              bots: [],
            },
            invites: { humans: [], bots: [] },
          },
        };
      }
      return null;
    });
    const state = createState({
      client: { request } as never,
      platformAuthState: {
        session: {
          user: "owner@acme.com",
          displayName: "Owner",
          tenantId: "tenant-1",
        },
        employeeAccess: {
          employeeUserId: "user-owner",
          ownedAgentIds: [],
          currentSeat: { seatId: "seat-1", title: "产品经理" },
        },
        members: [],
      } as never,
      workbenchSpaceCreatorOpen: true,
      workbenchSpaceCreatorStep: "members",
      workbenchSpaceCreatorTitle: "产品研发小组",
    });
    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    await props.onCreateSpace?.();

    await vi.waitFor(() => {
      expect(updateParams).toMatchObject({
        actorEmployeeUserId: "user-owner",
        members: {
          humans: [{ userId: "user-owner", name: "Owner" }],
        },
      });
    });
  });

  it("persists a human candidate as a pending invitation and reports success", async () => {
    let updateParams: Record<string, unknown> | null = null;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "collaboration.spaces.members.update") {
        updateParams = params ?? null;
        return {
          space: {
            id: "alpha",
            groupId: "group-alpha",
            title: "产品研发小组",
            members: { humans: [], bots: [] },
            invites: {
              humans: [{ userId: "alice@acme.com", name: "Alice", status: "invited" }],
              bots: [],
            },
          },
        };
      }
      return null;
    });
    const state = createState({
      client: { request } as never,
      workbenchMemberGovernanceDrawerOpen: true,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "alpha",
            groupId: "group-alpha",
            title: "产品研发小组",
            members: { humans: [], bots: [] },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
    });
    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });
    state.workbenchMemberGovernanceSelectorKind = "human";
    state.workbenchMemberGovernanceCandidateHumans = [
      {
        id: "alice@acme.com",
        label: "Alice",
        kind: "human",
        actionMode: "invite",
      },
    ];

    props.onMemberGovernanceToggleHumanSelection?.("alice@acme.com");
    props.onMemberGovernanceCommitSelection?.();

    await vi.waitFor(() => {
      expect(updateParams).toMatchObject({
        members: { humans: [] },
        invites: { humans: [{ userId: "alice@acme.com", name: "Alice" }] },
      });
      expect(state.workbenchMemberGovernanceResult).toBe("已向 Alice 发送加入邀请。");
    });
  });

  it("allows the robot owner to approve a pending bot invite from member governance", async () => {
    let updateParams: Record<string, unknown> | null = null;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "collaboration.spaces.members.update") {
        updateParams = params ?? null;
        return {
          space: {
            id: "alpha",
            groupId: "group-alpha",
            title: "产品研发小组",
            members: {
              humans: [],
              bots: [{ agentId: "qa-bot", name: "QA 机器人", status: "active" }],
            },
            invites: { humans: [], bots: [] },
          },
        };
      }
      if (method === "collaboration.spaces.list") {
        return {
          spaces: [
            {
              id: "alpha",
              groupId: "group-alpha",
              title: "产品研发小组",
              members: {
                humans: [],
                bots: [{ agentId: "qa-bot", name: "QA 机器人", status: "active" }],
              },
              invites: { humans: [], bots: [] },
            },
          ],
        };
      }
      return null;
    });
    const state = createState({
      client: { request } as never,
      workbenchMemberGovernanceDrawerOpen: true,
      platformAuthState: {
        employeeAccess: {
          ownedAgentIds: ["qa-bot"],
        },
      } as never,
      agentsList: {
        agents: [
          { id: "main", name: "Daibai", identity: { name: "Daibai", emoji: "AI" }, scope: "self" },
          {
            id: "qa-bot",
            name: "QA 机器人",
            identity: { name: "QA 机器人", emoji: "🧪" },
            scope: "self",
          },
        ],
        defaultId: "main",
      } as never,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "alpha",
            groupId: "group-alpha",
            title: "产品研发小组",
            members: { humans: [], bots: [] },
            invites: {
              humans: [],
              bots: [{ agentId: "qa-bot", name: "QA 机器人", status: "invited" }],
            },
          },
        ],
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.collaborationMemberGovernance?.pendingBotInvites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "qa-bot",
          canApprove: true,
        }),
      ]),
    );

    props.onMemberGovernanceApproveBotInvite?.("qa-bot");
    await Promise.resolve();
    await Promise.resolve();

    expect(updateParams).toMatchObject({
      groupId: "group-alpha",
      members: {
        bots: [{ agentId: "qa-bot", name: "QA 机器人" }],
      },
      invites: {
        bots: [],
      },
    });
  });

  it("lets the invitee accept a pending human invite from member governance", async () => {
    let updateParams: Record<string, unknown> | null = null;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "collaboration.spaces.members.update") {
        updateParams = params ?? null;
        return {
          space: {
            id: "alpha",
            groupId: "group-alpha",
            title: "产品研发小组",
            members: {
              humans: [
                { userId: "user-1", name: "Owner", status: "active" },
                { userId: "user-2", name: "Invitee", status: "active" },
              ],
              bots: [],
            },
            invites: { humans: [], bots: [] },
          },
        };
      }
      return null;
    });
    const state = createState({
      client: { request } as never,
      hello: {
        auth: {
          provider: "trusted-proxy",
          user: "user-2",
          displayName: "Invitee",
          tenantId: "tenant-1",
        },
      } as never,
      workbenchMemberGovernanceDrawerOpen: true,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "alpha",
            groupId: "group-alpha",
            title: "产品研发小组",
            ownerUserId: "user-1",
            members: {
              humans: [{ userId: "user-1", name: "Owner", status: "active" }],
              bots: [],
            },
            invites: {
              humans: [{ userId: "user-2", name: "Invitee", status: "invited" }],
              bots: [],
            },
          },
        ],
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.collaborationMemberGovernance?.selfPendingInvite).toEqual(
      expect.objectContaining({ intentId: "invite:user-2", label: "Invitee" }),
    );

    props.onMemberGovernanceAcceptSelfInvite?.();

    await vi.waitFor(() => {
      expect(updateParams).toMatchObject({
        groupId: "group-alpha",
        members: {
          humans: expect.arrayContaining([
            { userId: "user-1", name: "Owner" },
            { userId: "user-2", name: "Invitee" },
          ]),
        },
        invites: {
          humans: [],
        },
      });
      expect(state.workbenchMemberGovernanceResult).toBe("已加入协作小组。");
    });
    expect(state.workbenchMemberGovernancePendingInvites).toEqual([]);
  });

  it("lets the invitee reject a pending human invite from member governance", async () => {
    let updateParams: Record<string, unknown> | null = null;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "collaboration.spaces.members.update") {
        updateParams = params ?? null;
        return {
          space: {
            id: "alpha",
            groupId: "group-alpha",
            title: "产品研发小组",
            members: {
              humans: [{ userId: "user-1", name: "Owner", status: "active" }],
              bots: [],
            },
            invites: { humans: [], bots: [] },
          },
        };
      }
      return null;
    });
    const state = createState({
      client: { request } as never,
      hello: {
        auth: {
          provider: "trusted-proxy",
          user: "user-2",
          displayName: "Invitee",
          tenantId: "tenant-1",
        },
      } as never,
      workbenchMemberGovernanceDrawerOpen: true,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "alpha",
            groupId: "group-alpha",
            title: "产品研发小组",
            ownerUserId: "user-1",
            members: {
              humans: [{ userId: "user-1", name: "Owner", status: "active" }],
              bots: [],
            },
            invites: {
              humans: [{ userId: "user-2", name: "Invitee", status: "invited" }],
              bots: [],
            },
          },
        ],
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onMemberGovernanceRejectSelfInvite?.();

    await vi.waitFor(() => {
      expect(updateParams).toMatchObject({
        groupId: "group-alpha",
        members: {
          humans: [{ userId: "user-1", name: "Owner" }],
        },
        invites: {
          humans: [],
        },
      });
      expect(state.workbenchMemberGovernanceResult).toBe("已拒绝加入协作小组。");
    });
  });

  it("shows the reset action only to the group owner in member governance", () => {
    const ownerState = createState({
      hello: {
        auth: {
          provider: "trusted-proxy",
          user: "user-1",
          displayName: "Owner",
          tenantId: "tenant-1",
        },
      } as never,
      workbenchMemberGovernanceDrawerOpen: true,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "alpha",
            groupId: "group-alpha",
            title: "产品研发小组",
            ownerUserId: "user-1",
            members: {
              humans: [{ userId: "user-1", name: "Owner", status: "active" }],
              bots: [],
            },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
    });
    const ownerProps = buildEmployeeWorkbenchProps({
      state: ownerState,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(ownerProps.collaborationMemberGovernance?.canReset).toBe(true);

    const memberState = createState({
      hello: {
        auth: {
          provider: "trusted-proxy",
          user: "user-2",
          displayName: "Member",
          tenantId: "tenant-1",
        },
      } as never,
      workbenchMemberGovernanceDrawerOpen: true,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "alpha",
            groupId: "group-alpha",
            title: "产品研发小组",
            ownerUserId: "user-1",
            members: {
              humans: [{ userId: "user-1", name: "Owner", status: "active" }],
              bots: [],
            },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
    });
    const memberProps = buildEmployeeWorkbenchProps({
      state: memberState,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(memberProps.collaborationMemberGovernance?.canReset).toBe(false);
  });

  it("treats human:<uuid> memberRoleMap owner as owner so member governance stays writable", () => {
    const ownerUuid = "90fed19a-1c8b-4420-87e0-bcc6165e32fa";
    const state = createState({
      hello: {
        auth: {
          provider: "trusted-proxy",
          user: ownerUuid,
          displayName: "Owner",
          tenantId: "tenant-1",
        },
      } as never,
      platformAuthState: {
        session: {
          user: ownerUuid,
          displayName: "Owner",
          tenantId: "tenant-1",
        },
        employeeAccess: {
          employeeUserId: ownerUuid,
          ownedAgentIds: [],
          currentSeat: { seatId: "seat-1", title: "CEO" },
        },
      } as never,
      workbenchMemberGovernanceDrawerOpen: true,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "alpha",
            groupId: "grp-digital-human-team",
            title: "数字人战队",
            // Digital-human teams often leave governance.ownerUserId null and
            // only record the owner as human:<uuid> in memberRoleMap.
            ownerUserId: null,
            operatingState: {
              governance: { ownerUserId: null },
              memberRoleMap: [
                {
                  memberId: `human:${ownerUuid}`,
                  memberKind: "human",
                  governanceRole: "owner",
                  label: "Owner",
                },
              ],
            },
            members: {
              humans: [{ userId: ownerUuid, name: "Owner", status: "active" }],
              bots: [],
            },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    const governance = props.collaborationMemberGovernance;
    expect(governance?.activeGroupRole).toBe("owner");
    expect(governance?.currentOwnerUserId).toBe(ownerUuid);
    expect(governance?.canReset).toBe(true);
    // workbench-stage-collaboration: isReadOnly = activeGroupRole === "member" || isInvitee
    expect(governance?.activeGroupRole === "member" || Boolean(governance?.selfPendingInvite)).toBe(
      false,
    );
  });

  it("treats memberRoleMap governanceRole=admin as writable (not readOnly)", () => {
    const adminUuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const ownerUuid = "11111111-2222-3333-4444-555555555555";
    const state = createState({
      workbenchPrimaryModule: "collaboration",
      workbenchTeamSelectedKey: "space:alpha",
      sessionKey: "space:alpha",

      platformAuthState: {
        session: {
          user: adminUuid,
          displayName: "Admin",
          tenantId: "tenant-1",
        },
        employeeAccess: {
          employeeUserId: adminUuid,
          ownedAgentIds: [],
          currentSeat: { seatId: "seat-1", title: "Admin" },
        },
      } as never,
      workbenchMemberGovernanceDrawerOpen: true,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "alpha",
            groupId: "grp-daniel-hhd-gmail-com-upbeyond",
            title: "数字人战队",
            ownerUserId: null,
            operatingState: {
              governance: {
                ownerUserId: null,
                adminUserIds: [`human:${adminUuid}`],
              },
              memberRoleMap: [
                {
                  memberId: `human:${ownerUuid}`,
                  memberKind: "human",
                  governanceRole: "owner",
                  label: "CEO",
                },
                {
                  memberId: `human:${adminUuid}`,
                  memberKind: "human",
                  governanceRole: "admin",
                  label: "Admin",
                },
              ],
            },
            members: {
              humans: [
                { userId: ownerUuid, name: "CEO", status: "active" },
                { userId: adminUuid, name: "Admin", status: "active" },
              ],
              bots: [],
            },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    const governance = props.collaborationMemberGovernance;
    expect(governance?.activeGroupRole).toBe("admin");
    expect(governance?.activeGroupRole === "member" || Boolean(governance?.selfPendingInvite)).toBe(
      false,
    );
  });

  it("treats adminUserIds match as admin even without memberRoleMap row", () => {
    const adminUuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const ownerUuid = "11111111-2222-3333-4444-555555555555";
    const state = createState({
      workbenchPrimaryModule: "collaboration",
      workbenchTeamSelectedKey: "space:alpha",
      sessionKey: "space:alpha",

      platformAuthState: {
        session: {
          user: adminUuid,
          displayName: "Admin",
          tenantId: "tenant-1",
        },
        employeeAccess: {
          employeeUserId: adminUuid,
          ownedAgentIds: [],
          currentSeat: { seatId: "seat-1", title: "Admin" },
        },
      } as never,
      workbenchMemberGovernanceDrawerOpen: true,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "alpha",
            groupId: "grp-admin-ids-only",
            title: "Admin Ids Group",
            ownerUserId: ownerUuid,
            operatingState: {
              governance: {
                ownerUserId: ownerUuid,
                adminUserIds: [adminUuid],
              },
              memberRoleMap: [
                {
                  memberId: ownerUuid,
                  memberKind: "human",
                  governanceRole: "owner",
                },
              ],
            },
            members: {
              humans: [
                { userId: ownerUuid, name: "Owner", status: "active" },
                { userId: adminUuid, name: "Admin", status: "active" },
              ],
              bots: [],
            },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.collaborationMemberGovernance?.activeGroupRole).toBe("admin");
  });

  it("treats email OS owner as owner when hello user is uuid but platform session user is email", () => {
    const ownerUuid = "90fed19a-1c8b-4420-87e0-bcc6165e32fa";
    const ownerEmail = "daniel.hhd@gmail.com";
    const state = createState({
      hello: {
        auth: {
          provider: "trusted-proxy",
          // Device/hello can surface the platform uuid while OS stores the mailbox.
          user: ownerUuid,
          displayName: "CEO",
          tenantId: "001",
        },
      } as never,
      platformAuthState: {
        session: {
          provider: "trusted-proxy",
          user: ownerEmail,
          email: ownerEmail,
          displayName: "CEO",
          tenantId: "001",
        },
        employeeAccess: {
          employeeUserId: ownerUuid,
          ownedAgentIds: [],
          currentSeat: { seatId: "seat-1", title: "CEO" },
        },
      } as never,
      workbenchMemberGovernanceDrawerOpen: true,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "alpha",
            groupId: "grp-daniel-hhd-gmail-com-upbeyond",
            title: "数字人战队",
            ownerUserId: ownerEmail,
            operatingState: {
              governance: { ownerUserId: ownerEmail, adminUserIds: [] },
              memberRoleMap: [
                {
                  memberId: ownerEmail,
                  memberKind: "human",
                  governanceRole: "owner",
                  label: "CEO",
                },
              ],
            },
            members: {
              humans: [{ userId: ownerEmail, name: "CEO", status: "active" }],
              bots: [],
            },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    const governance = props.collaborationMemberGovernance;
    expect(governance?.activeGroupRole).toBe("owner");
    expect(governance?.canReset).toBe(true);
    expect(governance?.activeGroupRole === "member" || Boolean(governance?.selfPendingInvite)).toBe(
      false,
    );
  });

  it("resets collaboration data from member governance for the group owner", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "collaboration.spaces.reset") {
        expect(params).toEqual({ groupId: "group-alpha" });
        return {
          space: {
            id: "alpha",
            groupId: "group-alpha",
            title: "产品研发小组",
            ownerUserId: "user-1",
            members: {
              humans: [{ userId: "user-1", name: "Owner", status: "active" }],
              bots: [],
            },
            invites: { humans: [], bots: [] },
          },
        };
      }
      if (method === "collaboration.spaces.list") {
        return {
          spaces: [
            {
              id: "alpha",
              groupId: "group-alpha",
              title: "产品研发小组",
              ownerUserId: "user-1",
              members: {
                humans: [{ userId: "user-1", name: "Owner", status: "active" }],
                bots: [],
              },
              invites: { humans: [], bots: [] },
            },
          ],
        };
      }
      return null;
    });
    const state = createState({
      client: { request } as never,
      hello: {
        auth: {
          provider: "trusted-proxy",
          user: "user-1",
          displayName: "Owner",
          tenantId: "tenant-1",
        },
      } as never,
      workbenchMemberGovernanceDrawerOpen: true,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "alpha",
            groupId: "group-alpha",
            title: "产品研发小组",
            ownerUserId: "user-1",
            members: {
              humans: [{ userId: "user-1", name: "Owner", status: "active" }],
              bots: [{ agentId: "qa-bot", name: "QA 机器人", status: "active" }],
            },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onMemberGovernanceReset?.();

    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith("collaboration.spaces.reset", {
        groupId: "group-alpha",
      });
      expect(state.resetCollaborationLearningSnapshot).toHaveBeenCalledTimes(1);
      expect(state.resetCollaborationGovernanceActionState).toHaveBeenCalledTimes(1);
      expect(state.workbenchMemberGovernanceResult).toBe("已重置协作小组数据并完成重建。");
    });
  });

  it("routes member-governance parse to steward session send instead of group chat draft", async () => {
    const openDaibaiHelpFromModule = vi.fn(
      async (_params: {
        moduleLabel: string;
        contextMessage?: string;
        sourceSessionKey?: string;
      }) => undefined,
    );
    const state = createState({
      workbenchMemberGovernanceDrawerOpen: true,
      workbenchMemberGovernanceGroupKey: "space:group-alpha",
      workbenchMemberGovernanceTitle: "产品研发小组",
      workbenchMemberGovernancePrompt: "优化分工",
      workbenchMemberGovernanceCurrentHumans: [{ id: "u1", label: "Alice", kind: "human" }],
      workbenchMemberGovernanceCurrentBots: [{ id: "bot-1", label: "分析助手", kind: "bot" }],
      collaborationSpacesResult: {
        spaces: [
          {
            id: "alpha",
            groupId: "group-alpha",
            title: "产品研发小组",
            purpose: "交付",
            currentMission: "评审",
            members: { humans: [], bots: [] },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
      openDaibaiHelpFromModule,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onMemberGovernanceParse?.();

    expect(state.chatMessage).toBe("");
    expect(state.workbenchMemberGovernanceDrawerOpen).toBe(false);
    expect(state.workbenchMemberGovernanceResult).toContain("已发送给大白管家");
    await vi.waitFor(() => {
      expect(openDaibaiHelpFromModule).toHaveBeenCalledTimes(1);
    });
    const firstCall = openDaibaiHelpFromModule.mock.calls[0] ?? [];
    expect(firstCall).toEqual([
      expect.objectContaining({
        moduleLabel: "成员治理",
        sourceSessionKey: "space:group-alpha",
      }),
    ]);
    const [call] = firstCall;
    expect(call).toBeDefined();
    expect(call?.contextMessage).toContain("groupId：group-alpha");
    expect(call?.contextMessage).toContain("```group-config-proposal");
    expect(call?.contextMessage).toContain("优化分工");
  });

  it("applies a pending group-config-proposal through settings and members writers", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "collaboration.spaces.list") {
        return {
          spaces: [
            {
              id: "alpha",
              groupId: "group-alpha",
              title: "产品研发小组",
              purpose: "新目标",
              members: { humans: [{ userId: "u1", name: "Alice" }], bots: [] },
              invites: { humans: [], bots: [] },
            },
          ],
        };
      }
      return {};
    });
    const state = createState({
      client: { request } as never,
      connected: true,
      daibaiSourceSessionKey: "space:group-alpha",
      workbenchPendingGroupConfigProposal: {
        groupId: "group-alpha",
        fingerprint: "fp-1",
        summaryLines: ["目标：新目标"],
        sourceSessionKey: "space:group-alpha",
        proposal: {
          groupId: "group-alpha",
          summary: "应用测试",
          settings: {
            purpose: "新目标",
            currentMission: "新使命",
            systemInstructions: ["指令 A"],
          },
          roster: {
            humans: [{ userId: "u1", name: "Alice" }],
            bots: [{ agentId: "bot-1", name: "分析助手" }],
          },
        },
      },
      collaborationSpacesResult: {
        spaces: [
          {
            id: "alpha",
            groupId: "group-alpha",
            title: "产品研发小组",
            purpose: "旧目标",
            currentMission: "旧使命",
            members: { humans: [], bots: [] },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.groupConfigProposal?.groupId).toBe("group-alpha");
    await props.onApplyGroupConfigProposal?.();

    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        "collaboration.space.updateMission",
        expect.objectContaining({
          groupId: "group-alpha",
          purpose: "新目标",
          currentMission: "新使命",
        }),
      );
      expect(request).toHaveBeenCalledWith(
        "collaboration.spaces.members.update",
        expect.objectContaining({
          groupId: "group-alpha",
          members: {
            humans: [{ userId: "u1", name: "Alice" }],
            bots: [{ agentId: "bot-1", name: "分析助手" }],
          },
        }),
      );
      expect(state.workbenchPendingGroupConfigProposal).toBeNull();
      expect(state.workbenchMemberGovernanceResult).toBe("已应用大白建议");
      expect(state.workbenchPrimaryModule).toBe("collaboration");
      expect(state.workbenchGroupProfileView).toBe("members");
    });
  });

  it("passes custom brand logo state into the workbench props", () => {
    const state = createState();
    state.settings.customBrandLogoDataUrl = "data:image/png;base64,AAAA";
    state.workbenchBrandLogoError = "Logo 读取失败";

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.brandLogoSrc).toBe("data:image/png;base64,AAAA");
    expect(props.bundledBrandLogoSrc).toBe("/openbot-logo.webp");
    expect(props.customBrandLogoEnabled).toBe(true);
    expect(props.brandLogoError).toBe("Logo 读取失败");
  });

  it("passes the bundled brand wordmark into the workbench props", () => {
    const props = buildEmployeeWorkbenchProps({
      state: createState(),
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.brandLogoSrc).toBeNull();
    expect(props.bundledBrandLogoSrc).toBe("/openbot-logo.webp");
    expect(props.customBrandLogoEnabled).toBe(false);
  });

  it("projects active-session collaboration governance data into the workbench props", () => {
    const state = createState({
      sessionsResult: {
        sessions: [
          {
            key: "agent:main:space:alpha",
            updatedAt: 20,
            kind: "group",
            displayName: "产品研发小组",
            groupId: "group-alpha",
            collaborationPersonalCapabilities: ["draft", "search"],
            collaborationGroupProfile: {
              groupId: "group-alpha",
              enabledSkills: ["summarize", "review"],
              blockedSkills: ["search"],
              systemInstructions: ["Follow the release review rubric."],
              confidentialityTier: "restricted",
              updatedAtMs: 1,
            },
            collaborationParticipationOverlay: {
              participationId: "group-alpha::bot-main",
              botId: "bot-main",
              groupId: "group-alpha",
              overlayCapabilities: ["diff-analysis"],
              policyFilters: [
                "allow:draft",
                "allow:review",
                "allow:summarize",
                "allow:diff-analysis",
              ],
              systemInstructions: ["Act as the release reviewer for this collaboration."],
              confidentialityTier: "restricted",
            },
          },
        ],
      } as never,
      sessionKey: "agent:main:space:alpha",
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.collaborationGovernanceSnapshot).toMatchObject({
      sessionKey: "agent:main:space:alpha",
      groupId: "group-alpha",
      personalCapabilities: ["draft", "search"],
      groupProfile: expect.objectContaining({
        enabledSkills: ["summarize", "review"],
      }),
      participationOverlay: expect.objectContaining({
        overlayCapabilities: ["diff-analysis"],
      }),
    });
  });

  it("switches selected system settings group based on user selection", () => {
    const requestUpdate = vi.fn();
    const state = createState({
      workbenchPrimaryModule: "settings",
      workbenchSystemSettingsTab: "groups",
      platformAuthState: {
        session: {
          user: "owner-1",
          displayName: "Owner",
          tenantId: "acme",
        },
      } as never,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "space:product",
            groupId: "product",
            title: "产品研发小组",
            ownerUserId: "owner-1",
            members: {
              humans: [{ userId: "owner-1", status: "active" }],
              bots: [],
            },
            invites: { humans: [], bots: [] },
          },
          {
            id: "space:research",
            groupId: "research",
            title: "市场研究组",
            ownerUserId: "owner-1",
            members: {
              humans: [{ userId: "owner-1", status: "active" }],
              bots: [],
            },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
      requestUpdate,
    } as Partial<AppPortState> & { requestUpdate: () => void });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.selectedGroupEntry?.groupId).toBe("product");

    props.onSystemSettingsGroupSelect?.("research");

    const nextProps = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(state.workbenchSystemSettingsSelectedGroupId).toBe("research");
    expect(nextProps.selectedGroupEntry?.groupId).toBe("research");
    expect(requestUpdate).toHaveBeenCalled();
  });

  it("guards unsaved system settings group changes before switching groups", async () => {
    const state = createState({
      workbenchPrimaryModule: "settings",
      workbenchSystemSettingsTab: "groups",
      requestUpdate: vi.fn(),
      platformAuthState: {
        session: { user: "owner-1", displayName: "Owner", tenantId: "acme" },
      } as never,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "space:product",
            groupId: "product",
            title: "产品研发小组",
            ownerUserId: "owner-1",
            members: {
              humans: [{ userId: "owner-1", status: "active" }],
              bots: [],
            },
            invites: { humans: [], bots: [] },
          },
          {
            id: "space:research",
            groupId: "research",
            title: "市场研究组",
            ownerUserId: "owner-1",
            members: {
              humans: [{ userId: "owner-1", status: "active" }],
              bots: [],
            },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
    });

    const build = () =>
      buildEmployeeWorkbenchProps({
        state,
        chatContent: html`
          <div>chat</div>
        `,
        authPanel: null,
      });

    build().onSystemSettingsGroupSelect?.("product");
    expect(state.workbenchSystemSettingsSelectedGroupId).toBe("product");

    // 产生未保存修改后切换到其它小组 → 应拦截为待确认，而非直接切换丢弃。
    build().onSystemSettingsGroupDraftChange?.({ title: "产品研发与运营组" });
    build().onSystemSettingsGroupSelect?.("research");
    expect(state.workbenchSystemSettingsSelectedGroupId).toBe("product");
    expect(state.workbenchSystemSettingsPendingGroupId).toBe("research");

    // 取消 → 停留在当前小组并清空待确认（草稿保留）。
    await build().onResolveSystemSettingsGroupSwitch?.("cancel");
    expect(state.workbenchSystemSettingsSelectedGroupId).toBe("product");
    expect(state.workbenchSystemSettingsPendingGroupId ?? null).toBeNull();

    // 放弃修改 → 切换到目标小组并清空待确认。
    build().onSystemSettingsGroupSelect?.("research");
    expect(state.workbenchSystemSettingsPendingGroupId).toBe("research");
    await build().onResolveSystemSettingsGroupSwitch?.("discard");
    expect(state.workbenchSystemSettingsSelectedGroupId).toBe("research");
    expect(state.workbenchSystemSettingsPendingGroupId ?? null).toBeNull();
  });

  it("opens collaboration member governance from system-settings Manage Members", () => {
    const requestUpdate = vi.fn();
    const state = createState({
      workbenchPrimaryModule: "settings",
      workbenchSystemSettingsTab: "groups",
      workbenchSystemSettingsSelectedGroupId: "product",
      requestUpdate,
      platformAuthState: {
        session: { user: "owner-1", displayName: "Owner", tenantId: "acme" },
      } as never,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "space:product",
            groupId: "product",
            title: "产品研发小组",
            ownerUserId: "owner-1",
            members: {
              humans: [{ userId: "owner-1", name: "Owner", status: "active" }],
              bots: [],
            },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    requestUpdate.mockClear();
    props.onOpenSystemSettingsGroupMembers?.();

    expect(state.workbenchPrimaryModule).toBe("collaboration");
    expect(state.workbenchMemberGovernanceDrawerOpen).toBe(true);
    expect(state.workbenchGroupProfileView).toBe("members");
    expect(state.workbenchTeamSelectedKey).toBe("space:product");
    expect(requestUpdate).toHaveBeenCalled();

    // Next props build hydrates member-governance for the members page.
    const nextProps = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });
    expect(state.workbenchMemberGovernanceGroupKey).toBeTruthy();
    expect(nextProps.collaborationMemberGovernance?.title).toBeTruthy();
  });

  it("wires onSystemSettingsGroupSelect through renderWorkbench so the right detail panel switches on click", async () => {
    const requestUpdate = vi.fn();
    const state = createState({
      workbenchPrimaryModule: "settings",
      workbenchSystemSettingsTab: "groups",
      platformAuthState: {
        session: {
          user: "owner-1",
          displayName: "Owner",
          tenantId: "acme",
        },
      } as never,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "space:product",
            groupId: "product",
            title: "产品研发小组",
            ownerUserId: "owner-1",
            members: {
              humans: [{ userId: "owner-1", status: "active" }],
              bots: [],
            },
            invites: { humans: [], bots: [] },
          },
          {
            id: "space:aegis",
            groupId: "aegis",
            title: "Aegis产品开发",
            ownerUserId: "owner-1",
            members: {
              humans: [{ userId: "owner-1", status: "active" }],
              bots: [],
            },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
      requestUpdate,
    } as Partial<AppPortState> & { requestUpdate: () => void });

    const container = document.createElement("div");
    document.body.append(container);

    const renderCurrent = () => {
      const props = buildEmployeeWorkbenchProps({
        state,
        chatContent: html`
          <div>chat</div>
        `,
        authPanel: null,
      });
      render(renderWorkbench(props), container);
    };

    renderCurrent();
    await Promise.resolve();

    expect(container.querySelector(".wb-groups__stage")?.textContent).toContain("产品研发小组");

    const aegisItem = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".wb-groups__row"),
    ).find((button) => button.textContent?.includes("Aegis产品开发"));
    expect(aegisItem).toBeTruthy();
    aegisItem?.click();

    renderCurrent();
    await Promise.resolve();

    expect(state.workbenchSystemSettingsSelectedGroupId).toBe("aegis");
    const detailText = container.querySelector(".wb-groups__stage")?.textContent ?? "";
    expect(detailText).toContain("Aegis产品开发");
    expect(detailText).not.toContain("产品研发小组");
  });

  it("deduplicates repeated system settings groups by title and keeps the richer owner entry", () => {
    const state = createState({
      workbenchPrimaryModule: "settings",
      workbenchSystemSettingsTab: "groups",
      platformAuthState: {
        session: {
          user: "owner-1",
          displayName: "Owner",
          tenantId: "acme",
        },
      } as never,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "space:upbeyond-owner",
            groupId: "grp-upbeyond-owner",
            title: "upbeyond",
            ownerUserId: "owner-1",
            members: {
              humans: [{ userId: "owner-1", status: "active" }],
              bots: [{ agentId: "main", status: "active" }],
            },
            invites: { humans: [], bots: [] },
          },
          {
            id: "space:upbeyond-empty",
            groupId: "grp-upbeyond-empty",
            title: "upbeyond",
            ownerUserId: "someone-else",
            members: { humans: [], bots: [] },
            invites: { humans: [], bots: [] },
          },
          {
            id: "space:aegis",
            groupId: "aegis",
            title: "Aegis产品开发",
            ownerUserId: "someone-else",
            members: { humans: [], bots: [] },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });
    const upbeyondEntries = (props.groupEntries ?? []).filter(
      (entry) => entry.title === "upbeyond",
    );

    expect(upbeyondEntries).toHaveLength(1);
    expect(upbeyondEntries[0]?.role).toBe("owner");
    expect(upbeyondEntries[0]?.memberCount).toBe(2);
  });

  it("recognizes group owner when ownerUserId matches login email but employeeUserId differs", async () => {
    const state = createState({
      platformAuthState: {
        session: {
          user: "owner@acme.com",
          displayName: "Owner",
          tenantId: "acme",
        },
        employeeAccess: {
          employeeUserId: "emp-uuid-42",
          ownedAgentIds: [],
        },
      } as never,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "space:market-research",
            groupId: "grp-market",
            title: "市场研究组",
            ownerUserId: "owner@acme.com",
            members: {
              humans: [{ userId: "owner@acme.com", status: "active", name: "Owner" }],
              bots: [],
            },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.groupEntries?.[0]?.role).toBe("owner");
  });

  it("keeps settings robot list owned-only and drops empty or left groups", () => {
    const state = createState({
      workbenchPrimaryModule: "settings",
      workbenchSystemSettingsTab: "robots",
      platformAuthState: {
        session: {
          user: "ceo@example.com",
          displayName: "CEO",
          tenantId: "acme",
        },
        employeeAccess: {
          employeeUserId: "user-ceo",
          ownedAgentIds: ["my-bot"],
        },
      } as never,
      agentsList: {
        agents: [
          {
            id: "my-bot",
            name: "我的助理",
            identity: { name: "我的助理", emoji: "🤖" },
            scope: "self",
          },
        ],
        defaultId: "my-bot",
      } as never,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "space:living",
            groupId: "grp-living",
            title: "活着的协作组",
            ownerUserId: "user-ceo",
            members: {
              humans: [{ userId: "user-ceo", email: "ceo@example.com", status: "active" }],
              bots: [
                { agentId: "my-bot", name: "我的助理", status: "active" },
                { agentId: "hr-bot", name: "招聘经理", status: "active" },
              ],
            },
            invites: { humans: [], bots: [] },
          },
          {
            id: "space:left",
            groupId: "grp-left",
            title: "权变思维解决问题小组",
            ownerUserId: "user-ceo",
            members: {
              humans: [{ userId: "user-ceo", email: "ceo@example.com", status: "removed" }],
              bots: [{ agentId: "culture-bot", name: "文化总监", status: "active" }],
            },
            invites: { humans: [], bots: [] },
          },
          {
            id: "space:empty",
            groupId: "grp-empty",
            title: "空壳组",
            ownerUserId: "user-ceo",
            members: { humans: [], bots: [] },
            invites: { humans: [], bots: [] },
          },
          {
            id: "space-b1e30f37-aaaa-bbbb-cccc-ddddeeeeffff",
            groupId: "space-b1e30f37-aaaa-bbbb-cccc-ddddeeeeffff",
            title: "space-b1e30f37-aaaa-bbbb-cccc-ddddeeeeffff",
            ownerUserId: "user-ceo",
            members: {
              humans: [{ userId: "user-ceo", status: "active" }],
              bots: [],
            },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.robotEntries?.map((entry) => entry.id)).toEqual(["my-bot"]);
    expect(props.robotEntries?.every((entry) => entry.source === "owned")).toBe(true);
    expect(props.robotEntries?.some((entry) => entry.id === "hr-bot")).toBe(false);
    expect(props.groupEntries?.map((entry) => entry.title)).toEqual(["活着的协作组"]);
  });

  it("passes daibai state and callbacks into the workbench props", async () => {
    const state = createState({
      daibaiLoading: true,
      daibaiAskResult: {
        summary: "我已经找到一个待处理支持单。",
        suggestedActions: [],
      },
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.daibaiLoading).toBe(true);
    expect(props.daibaiAskResult?.summary).toBe("我已经找到一个待处理支持单。");
    await props.onAskDaibai?.();
    expect(state.askDaibai).toHaveBeenCalledTimes(1);
  });

  it("does not render a separate daibai overview card when daibai is the selected assistant", async () => {
    const state = createState({
      workbenchTeamSelectedKey: "main",
      sessionKey: "main",
      daibaiAskResult: {
        summary: "我已经找到 2 条支持单。",
        suggestedActions: [],
        latestProposal: {
          caseId: "sc_2",
          proposalVersion: 3,
          userFacingReply: "请先补充触发词和 schema 示例。",
          requiresUserConfirmation: true,
          seenByUser: false,
        },
        supportContext: {
          openCaseCount: 2,
          waitingOnUserCount: 1,
          cases: [],
        },
      },
      sessionsResult: {
        sessions: [{ key: "main", updatedAt: 10, kind: "direct", displayName: "大白管家" }],
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });
    const container = document.createElement("div");
    render(renderWorkbench(props), container);
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__daibai-overview")).toBeNull();
  });

  it("keeps the stage free of the legacy daibai summary surface across proposal states", async () => {
    const seenContainer = document.createElement("div");
    const seenState = createState({
      workbenchTeamSelectedKey: "main",
      sessionKey: "main",
      daibaiAskResult: {
        summary: "当前可以执行平台给出的解决方案。",
        suggestedActions: [],
        latestProposal: {
          caseId: "sc_3",
          proposalVersion: 4,
          userFacingReply: "请按当前方案执行并完成收口。",
          requiresUserConfirmation: true,
          seenByUser: true,
        },
        supportContext: {
          openCaseCount: 1,
          waitingOnUserCount: 1,
          cases: [],
        },
      },
      sessionsResult: {
        sessions: [{ key: "main", updatedAt: 10, kind: "direct", displayName: "大白管家" }],
      } as never,
    });

    render(
      renderWorkbench(
        buildEmployeeWorkbenchProps({
          state: seenState,
          chatContent: html`
            <div>chat</div>
          `,
          authPanel: null,
        }),
      ),
      seenContainer,
    );
    await Promise.resolve();

    expect(seenContainer.querySelector(".employee-workbench__daibai-overview")).toBeNull();

    const closedContainer = document.createElement("div");
    const closedState = createState({
      workbenchTeamSelectedKey: "main",
      sessionKey: "main",
      daibaiAskResult: {
        summary: "当前没有开放支持单。",
        suggestedActions: [],
        supportContext: {
          openCaseCount: 0,
          waitingOnUserCount: 0,
          cases: [],
        },
      },
      sessionsResult: {
        sessions: [{ key: "main", updatedAt: 10, kind: "direct", displayName: "大白管家" }],
      } as never,
    });

    render(
      renderWorkbench(
        buildEmployeeWorkbenchProps({
          state: closedState,
          chatContent: html`
            <div>chat</div>
          `,
          authPanel: null,
        }),
      ),
      closedContainer,
    );
    await Promise.resolve();

    expect(closedContainer.querySelector(".employee-workbench__daibai-overview")).toBeNull();
  });

  it("loads real collaboration learning data when opening the capability summary view", () => {
    const state = createState({
      sessionsResult: {
        sessions: [
          {
            key: "space:alpha",
            updatedAt: 20,
            kind: "group",
            displayName: "产品研发小组",
            groupId: "group-alpha",
            collaborationPersonalCapabilities: ["draft"],
            collaborationGroupProfile: {
              groupId: "group-alpha",
              enabledSkills: ["review"],
            },
          },
        ],
      } as never,
      sessionKey: "space:alpha",
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onGroupProfileViewChange?.("governance");

    expect(state.workbenchGroupProfileView).toBe("governance");
    expect(state.loadCollaborationLearningSnapshot).toHaveBeenCalledTimes(1);
    expect(state.resetCollaborationLearningSnapshot).not.toHaveBeenCalled();
  });

  it("opens member governance drawer from group profile view change", () => {
    const requestUpdate = vi.fn();
    const state = createState({
      workbenchPrimaryModule: "collaboration",
      workbenchTeamSelectedKey: "space:alpha",
      sessionKey: "space:alpha",
      requestUpdate,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "alpha",
            groupId: "group-alpha",
            title: "openbot市场部",
            ownerUserId: "user-1",
            members: {
              humans: [{ userId: "user-1", name: "Owner", status: "active" }],
              bots: [{ agentId: "bot-main", name: "Bot", status: "active" }],
            },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    requestUpdate.mockClear();
    props.onGroupProfileViewChange?.("members");

    expect(state.workbenchMemberGovernanceDrawerOpen).toBe(true);
    expect(state.workbenchGroupProfileView).toBe("chat");
    expect(requestUpdate).toHaveBeenCalled();

    const nextProps = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });
    expect(nextProps.collaborationMemberGovernance).not.toBeNull();
    expect(nextProps.memberGovernanceDrawerOpen).toBe(true);
  });

  it("requests workbench render when opening member governance directly", () => {
    const requestUpdate = vi.fn();
    const state = createState({
      workbenchPrimaryModule: "collaboration",
      workbenchTeamSelectedKey: "space:alpha",
      sessionKey: "space:alpha",
      requestUpdate,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "alpha",
            groupId: "group-alpha",
            title: "openbot市场部",
            ownerUserId: "user-1",
            members: {
              humans: [{ userId: "user-1", name: "Owner", status: "active" }],
              bots: [{ agentId: "bot-main", name: "Bot", status: "active" }],
            },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    requestUpdate.mockClear();
    props.onOpenCollaborationMemberGovernance?.();

    expect(state.workbenchMemberGovernanceDrawerOpen).toBe(true);
    expect(requestUpdate).toHaveBeenCalled();
    expect(state.workbenchMemberGovernanceGroupKey).not.toBeNull();

    props.onOpenCollaborationMemberGovernance?.();
    expect(state.workbenchMemberGovernanceDrawerOpen).toBe(false);
  });

  it("toggles artifact preview from the collaboration file tool", () => {
    const handleCloseSidebar = vi.fn();
    const handleOpenArtifact = vi.fn();
    const state = createState({
      sidebarOpen: true,
      sidebarPreviewMode: "artifact",
      handleCloseSidebar,
      handleOpenArtifact,
      chatMessages: [
        {
          role: "assistant",
          artifact: { artifactId: "artifact-1", title: "Report" },
        },
      ] as never,
    });
    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.artifactPreviewOpen).toBe(true);
    props.onOpenFilePreview?.();
    expect(handleCloseSidebar).toHaveBeenCalledTimes(1);
    expect(handleOpenArtifact).not.toHaveBeenCalled();
  });

  it("closes artifact preview when opening member governance drawer", () => {
    const handleCloseSidebar = vi.fn();
    const requestUpdate = vi.fn();
    const state = createState({
      workbenchPrimaryModule: "collaboration",
      workbenchTeamSelectedKey: "space:alpha",
      sessionKey: "space:alpha",
      sidebarOpen: true,
      sidebarPreviewMode: "artifact",
      sidebarSurface: "artifact",
      handleCloseSidebar,
      requestUpdate,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "alpha",
            groupId: "group-alpha",
            title: "openbot市场部",
            ownerUserId: "user-1",
            members: {
              humans: [{ userId: "user-1", name: "Owner", status: "active" }],
              bots: [{ agentId: "bot-main", name: "Bot", status: "active" }],
            },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
    });
    handleCloseSidebar.mockImplementation(() => {
      state.sidebarOpen = false;
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onOpenCollaborationMemberGovernance?.();

    expect(handleCloseSidebar).toHaveBeenCalledTimes(1);
    expect(state.workbenchMemberGovernanceDrawerOpen).toBe(true);
    expect(state.sidebarOpen).toBe(false);
  });

  it("closes computer sidebar when opening member governance drawer", () => {
    const handleCloseSidebar = vi.fn();
    const requestUpdate = vi.fn();
    const state = createState({
      workbenchPrimaryModule: "collaboration",
      workbenchTeamSelectedKey: "space:alpha",
      sessionKey: "space:alpha",
      sidebarOpen: true,
      sidebarPreviewMode: "markdown",
      sidebarSurface: "computer",
      sidebarArtifactWorkspace: null,
      handleCloseSidebar,
      requestUpdate,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "alpha",
            groupId: "group-alpha",
            title: "openbot市场部",
            ownerUserId: "user-1",
            members: {
              humans: [{ userId: "user-1", name: "Owner", status: "active" }],
              bots: [{ agentId: "bot-main", name: "Bot", status: "active" }],
            },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
    });
    handleCloseSidebar.mockImplementation(() => {
      state.sidebarOpen = false;
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onOpenCollaborationMemberGovernance?.();

    expect(handleCloseSidebar).toHaveBeenCalledTimes(1);
    expect(state.workbenchMemberGovernanceDrawerOpen).toBe(true);
    expect(state.sidebarOpen).toBe(false);
  });

  it("closes member governance drawer when opening artifact preview", () => {
    const handleOpenArtifact = vi.fn();
    const state = createState({
      workbenchPrimaryModule: "collaboration",
      workbenchTeamSelectedKey: "space:alpha",
      sessionKey: "space:alpha",
      workbenchMemberGovernanceDrawerOpen: true,
      workbenchMemberGovernanceGroupKey: "space:alpha",
      sidebarOpen: false,
      handleOpenArtifact,
      chatMessages: [
        {
          role: "assistant",
          artifact: { artifactId: "artifact-1", title: "Report" },
        },
      ] as never,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "alpha",
            groupId: "group-alpha",
            title: "openbot市场部",
            ownerUserId: "user-1",
            members: {
              humans: [{ userId: "user-1", name: "Owner", status: "active" }],
              bots: [{ agentId: "bot-main", name: "Bot", status: "active" }],
            },
            invites: { humans: [], bots: [] },
          },
        ],
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onOpenFilePreview?.();

    expect(state.workbenchMemberGovernanceDrawerOpen).toBe(false);
    expect(handleOpenArtifact).toHaveBeenCalledWith("artifact-1");
  });

  it("clears collaboration learning snapshot when leaving the capability summary view", () => {
    const state = createState({
      workbenchGroupProfileView: "governance",
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onGroupProfileViewChange?.("chat");

    expect(state.workbenchGroupProfileView).toBe("chat");
    expect(state.resetCollaborationLearningSnapshot).toHaveBeenCalledTimes(1);
    expect(state.resetCollaborationGovernanceActionState).toHaveBeenCalledTimes(1);
    expect(state.loadCollaborationLearningSnapshot).not.toHaveBeenCalled();
  });

  it("resets collaboration capability summary state when switching to a different team", () => {
    const state = createState({
      workbenchGroupProfileView: "governance",
      workbenchTaskDetailId: "task-1",
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onTeamSelectedKeyChange?.("space:beta");

    expect(state.workbenchTeamSelectedKey).toBe("space:beta");
    expect(state.sessionKey).toBe("space:beta");
    expect(state.workbenchPrimaryModule).toBe("collaboration");
    expect(state.workbenchGroupProfileView).toBe("chat");
    expect(state.workbenchTaskDetailId).toBeNull();
    expect(state.resetCollaborationLearningSnapshot).toHaveBeenCalledTimes(1);
    expect(state.resetCollaborationGovernanceActionState).toHaveBeenCalledTimes(1);
  });

  it("opens governance object detail pages through the workbench action bridge", () => {
    const state = createState();

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onOpenGovernanceObjectDetail?.("decision", "decision-7");

    expect(state.workbenchGroupProfileView).toBe("decision-detail");
    expect(state.workbenchDecisionDetailId).toBe("decision-7");
    expect(state.workbenchCapsuleDetailId).toBeNull();
    expect(state.workbenchTaskDetailId).toBeNull();
    expect(state.loadCollaborationLearningSnapshot).toHaveBeenCalledTimes(1);

    props.onOpenGovernanceObjectDetail?.("capsule", "capsule-9");

    expect(state.workbenchGroupProfileView).toBe("capsule-detail");
    expect(state.workbenchCapsuleDetailId).toBe("capsule-9");
    expect(state.workbenchDecisionDetailId).toBeNull();
  });

  it("forwards governance transition actions to the app state handler", () => {
    const state = createState();

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onTransitionGovernanceObject?.("task", "task-7", "review");

    expect(state.transitionCollaborationGovernanceObject).toHaveBeenCalledWith({
      kind: "task",
      id: "task-7",
      toStatus: "review",
    });
  });

  it("builds real myAccumulationProps for the knowledge assets page", async () => {
    const requestUpdate = vi.fn();
    let calls = 0;
    const state = createState({
      workbenchPrimaryModule: "knowledge",
      knowledgeUniversePageTab: "assets",
      requestUpdate,
      client: {
        request: vi.fn(async (method: string, params?: Record<string, unknown>) => {
          if (method === "employee-capability.my-accumulation") {
            calls += 1;
            return {
              items: [
                {
                  id: "cap-1",
                  name: "客户情绪分析",
                  summary: "分析客户消息中的情绪倾向",
                  health: "运行稳定",
                  shareVisibility: "私有",
                  isDraft: false,
                  recentUpdate: null,
                  updatedAt: 1_700_000_000_000,
                  sourceRobotName: "销售助手",
                  usageBrief: { robotCount: 1, lastUsedAt: 1_700_000_000_000 },
                },
              ],
            };
          }
          if (method === "employee-capability.detail") {
            return {
              capability: {
                id: "cap-1",
                name: "客户情绪分析",
                summary: "分析客户消息中的情绪倾向",
                usageExamples: ["客户投诉处理"],
                inputDescription: "客户消息",
                outputDescription: "情绪摘要和建议",
                tags: ["客户", "分析"],
                category: "客户服务",
                avatar: null,
                health: "运行稳定",
                shareVisibility: "私有",
                maturity: null,
                attribution: {
                  sourceRobot: { id: "robot-1", name: "销售助手" },
                  sourceTaskSummary: "客户服务任务",
                  firstFormedScenario: "首次在客户投诉处理时形成",
                  highFrequencyScenarios: [],
                },
                usage: {
                  robots: [{ id: "robot-1", name: "销售助手" }],
                  totalUsageCount: 12,
                  lastUsedAt: 1_700_000_000_000,
                },
                recentUpdate: null,
                isDraft: false,
                createdAt: 1,
                updatedAt: 1,
              },
            };
          }
          if (method === "employee-capability.usage-brief") {
            return {
              usage: {
                robots: [{ id: "robot-1", name: "销售助手" }],
                totalUsageCount: 12,
                lastUsedAt: 1_700_000_000_000,
              },
            };
          }
          if (method === "employee-capability.share-to-group") {
            return {
              capabilityId: "cap-1",
              groupId: params?.groupId ?? "group-1",
              shareVisibility: "已共享到协作小组",
            };
          }
          if (method === "employee-capability.submit-to-enterprise") {
            expect(params?.packageDraft).toMatchObject({
              packageTitle: "客户情绪分析",
              packageSummary: "分析客户消息中的情绪倾向",
              assetPackageType: "single_capability",
              executionMode: "assistive",
            });
            return { capabilityId: "cap-1", shareVisibility: "审核中" };
          }
          if (method === "employee-capability.delete") {
            return { capabilityId: "cap-1" };
          }
          return {};
        }),
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.myAccumulationProps).not.toBeNull();
    expect(props.myAccumulationProps?.searchQuery).toBe("");
    expect(props.myAccumulationProps?.availableShareVisibilities).toContain("私有");
    expect(props.myAccumulationProps?.loading).toBe(true);

    await Promise.resolve();
    expect(calls).toBe(1);

    window.dispatchEvent(new CustomEvent("openbot:employee-asset-status-changed"));
    await Promise.resolve();

    expect(calls).toBe(2);
    expect(requestUpdate).toHaveBeenCalled();
  });

  it("threads the selected robot as the capability install target and clears it for general assets", () => {
    const state = createState({
      workbenchPrimaryModule: "knowledge",
      knowledgeUniversePageTab: "assets",
      requestUpdate: vi.fn(),
    });

    const initial = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });
    expect(initial.myAccumulationProps?.installTargetRobotId ?? null).toBeNull();

    // 从某个机器人行发起安装 → 目标机器人被记录，供资产页安装流程使用。
    initial.onOpenInstallCapability?.("sales-bot");
    const afterInstall = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });
    expect(afterInstall.myAccumulationProps?.installTargetRobotId).toBe("sales-bot");

    // 「查看相关能力」是通用视图 → 清空安装目标，避免误装到上次选中的机器人。
    afterInstall.onOpenMyAssets?.();
    const afterAssets = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });
    expect(afterAssets.myAccumulationProps?.installTargetRobotId ?? null).toBeNull();
  });

  it("tracks decision option draft selection in app state", () => {
    const state = createState();

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onDecisionOptionDraftChange?.("adopt");

    expect(state.workbenchDecisionSelectedOptionDraft).toBe("adopt");
  });

  it("tracks decision rationale draft selection in app state", () => {
    const state = createState();

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onDecisionRationaleDraftChange?.("Ship gradually first");

    expect(state.workbenchDecisionRationaleDraft).toBe("Ship gradually first");
  });

  it("forwards draft decision saves to the app state handler", () => {
    const state = createState({
      workbenchDecisionSelectedOptionDraft: "gradual",
      workbenchDecisionRationaleDraft: "Ship gradually first",
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onSaveDecisionDraft?.("decision-2");

    expect(state.saveCollaborationDecisionDraft).toHaveBeenCalledWith({
      id: "decision-2",
      rationale: "Ship gradually first",
      selectedOption: "gradual",
    });
  });

  it("opens the latest conversation artifact from the collaboration file-preview tool", () => {
    const handleOpenArtifact = vi.fn();
    const handleOpenSidebar = vi.fn();
    const state = createState({
      chatMessages: [
        { role: "assistant", content: [{ type: "text", text: "done" }] },
        {
          role: "assistant",
          artifact: {
            artifactId: "artifact-report-1",
            title: "Weekly Report",
          },
        },
      ],
      handleOpenArtifact,
      handleOpenSidebar,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onOpenFilePreview?.();

    expect(handleOpenArtifact).toHaveBeenCalledWith("artifact-report-1");
    expect(handleOpenSidebar).not.toHaveBeenCalled();
  });

  it("opens the artifact preview empty state when no conversation artifact exists", () => {
    const handleOpenArtifact = vi.fn();
    const handleOpenSidebar = vi.fn();
    const handleOpenArtifactPreview = vi.fn();
    const state = createState({
      chatMessages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }],
      handleOpenArtifact,
      handleOpenSidebar,
      handleOpenArtifactPreview,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onOpenFilePreview?.();

    expect(handleOpenArtifactPreview).toHaveBeenCalledWith();
    expect(handleOpenArtifact).not.toHaveBeenCalled();
    expect(handleOpenSidebar).not.toHaveBeenCalled();
  });

  it("does not treat an inferred chat article as a collaboration file-preview target", () => {
    const handleOpenArtifact = vi.fn();
    const handleOpenArtifactPreview = vi.fn();
    const state = createState({
      chatMessages: [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: [
                "---",
                "",
                "以下是完整正文：",
                "",
                "---",
                "",
                "小米AGI狂飙：罗福莉的两年赌约，胜算几何？",
                "",
                "“我正在 Xiaomi MiMo，和一群富有创造力、才华横溢且真诚热爱研究的研究员，致力于构建这样的未来，全力奔赴我们心目中的 AGI。”",
                "",
                "这是罗福莉加入小米后发布的一条动态。",
                "",
                "2026年3月19日凌晨，小米没有任何预热，悄然发布三款自研大模型——MiMo-V2-Pro、MiMo-V2-Omni、MiMo-V2-TTS，同期宣布 MiMo-V2-Flash 正式开源。",
                "",
                "一个月后，“小米两年AGI”成为科技圈最热的话题之一。",
                "",
                "在 OpenAI 还在谨慎推进 GPT-5、Google DeepMind 强调“安全优先”的氛围下，小米凭什么敢喊出“两年”？这个豪言背后，是真正的技术自信，还是“人车家全生态”战略下的营销叙事？",
                "",
                "今天，我们把这件事说清楚。",
                "",
                "一、小米的 AGI 底牌：MiMo-V2 到底什么水平？",
                "",
                "先说技术。小米这次并不是只丢出一个大模型名字，而是把推理、语音、端侧与开源节奏一起推到台前。",
              ].join("\n"),
            },
          ],
        },
      ],
      handleOpenArtifact,
      handleOpenArtifactPreview,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.onOpenFilePreview?.();

    expect(handleOpenArtifact).not.toHaveBeenCalled();
    expect(handleOpenArtifactPreview).toHaveBeenCalledWith();
  });

  it("prefers resolved assistant and collaboration titles in overview signals", () => {
    const scheduleStart = Date.now() + 20 * 60_000;
    const state = createState({
      workbenchPrimaryModule: "assistant",
      workbenchTeamSelectedKey: "agent:secretary:main",
      sessionKey: "agent:bot:main",
      cronStatus: { nextWakeAtMs: Date.now() + 15 * 60_000 } as never,
      workbenchSchedule: {
        todayCount: 1,
        upcomingCount: 1,
        cronDerivedCount: 0,
        nextStartAtMs: scheduleStart,
        nextTitle: "Standup",
        hasRealEntries: true,
        items: [
          {
            id: "soon",
            title: "Standup",
            startAtMs: scheduleStart,
            kind: "personal",
            cronDerived: false,
          },
        ],
      },
      workbenchPendingTasks: {
        totalCount: 1,
        taskCount: 1,
        ackRequiredCount: 0,
        governanceCount: 0,
        inviteCount: 0,
        items: [{ id: "task:1", title: "审批", origin: "task" }],
      },
      agentsList: {
        agents: [
          {
            id: "secretary",
            name: "高级秘书",
            identity: { name: "高级秘书", emoji: "秘" },
            scope: "self",
          },
        ],
        defaultId: "secretary",
      } as never,
      sessionsResult: {
        sessions: [
          {
            key: "agent:bot:main",
            updatedAt: 20,
            kind: "direct",
            displayName: "agent:bot:main",
          },
          {
            key: "space:alpha",
            updatedAt: 10,
            kind: "group",
            displayName: "市场研究组",
          },
        ],
      } as never,
      collaborationSpacesResult: {
        spaces: [{ id: "alpha", groupId: "group-alpha", title: "市场研究组" }],
      },
    });
    state.settings.daibaiGuideAcknowledged = true;

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    const container = document.createElement("div");
    render(renderWorkbench(props), container);

    const grid = container.querySelector(".employee-workbench__signals-grid--parallel");
    expect(grid).toBeTruthy();
    const cards = Array.from(
      grid?.querySelectorAll(".employee-workbench__signal-card--parallel") ?? [],
    );
    expect(cards).toHaveLength(2);
    const titles = cards.map(
      (card) =>
        card.querySelector(".employee-workbench__signal-card-rail-label")?.textContent?.trim() ??
        "",
    );
    expect(titles).toEqual(["Today's schedule", "To-dos"]);
    const entryTitles = Array.from(
      container.querySelectorAll(".employee-workbench__signal-card-entry-title"),
      (node) => node.textContent?.trim() ?? "",
    );
    // Parallel overview cards show entry summaries — not raw session keys.
    expect(entryTitles.some((text) => text.length > 0)).toBe(true);
    expect(entryTitles.join("\n")).not.toContain("agent:bot:main");
  });

  it("marks the main column with --with-signals on assistant overview so compose can dock", async () => {
    const state = createState({
      workbenchPrimaryModule: "assistant",
      workbenchTeamSelectedKey: "main",
      sessionKey: "main",
      agentsList: {
        agents: [{ id: "main", name: "大白管家", identity: { name: "大白管家", emoji: "大" } }],
        defaultId: "main",
      } as never,
      sessionsResult: {
        sessions: [{ key: "main", updatedAt: 30, kind: "direct", displayName: "大白管家" }],
      } as never,
      collaborationSpacesResult: { spaces: [] },
    });
    state.settings.daibaiGuideAcknowledged = true;

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div class="chat">
          <div class="chat-thread"></div>
          <div class="chat-compose"></div>
        </div>
      `,
      authPanel: null,
    });
    expect(props.primaryModule).toBe("assistant");

    const container = document.createElement("div");
    render(renderWorkbench(props), container);
    await Promise.resolve();

    const main = container.querySelector(".employee-workbench__main");
    expect(main?.classList.contains("employee-workbench__main--with-signals")).toBe(true);
    // Overview signals render as a direct main child between header and stage.
    expect(main?.querySelectorAll(":scope > .employee-workbench__signals-overview")).toHaveLength(
      1,
    );
    expect(main?.querySelectorAll(":scope > .employee-workbench__steward-bar")).toHaveLength(0);
  });

  it("does not mark --with-signals when overview signals are hidden", async () => {
    const state = createState({
      workbenchPrimaryModule: "tasks",
      workbenchTeamSelectedKey: "main",
      sessionKey: "main",
      agentsList: {
        agents: [{ id: "main", name: "大白管家", identity: { name: "大白管家", emoji: "大" } }],
        defaultId: "main",
      } as never,
      sessionsResult: {
        sessions: [{ key: "main", updatedAt: 30, kind: "direct", displayName: "大白管家" }],
      } as never,
      collaborationSpacesResult: { spaces: [] },
    });
    state.settings.daibaiGuideAcknowledged = true;

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });
    expect(props.primaryModule).toBe("tasks");

    const container = document.createElement("div");
    render(renderWorkbench(props), container);
    await Promise.resolve();

    const main = container.querySelector(".employee-workbench__main");
    expect(main?.classList.contains("employee-workbench__main--with-signals")).toBe(false);
  });

  it("projects owned-bot pending approvals onto collaboration nav badges", () => {
    const state = createState({
      sessionKey: "space:alpha",
      workbenchPrimaryModule: "collaboration",
      workbenchTeamSelectedKey: "space:alpha",
      agentsList: {
        agents: [
          {
            id: "bot-owned",
            name: "我的机器人",
            identity: { name: "我的机器人", emoji: "机" },
            scope: "self",
          },
        ],
        defaultId: "bot-owned",
      } as never,
      sessionsResult: {
        sessions: [
          {
            key: "space:alpha",
            updatedAt: 20,
            kind: "group",
            displayName: "产品研发小组",
            groupId: "grp-alpha",
          },
        ],
      } as never,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "space:alpha",
            groupId: "grp-alpha",
            title: "产品研发小组",
            members: {
              humans: [],
              bots: [],
            },
            invites: {
              humans: [],
              bots: [{ agentId: "bot-owned", name: "我的机器人", status: "pending" }],
            },
          },
        ],
      } as never,
      platformAuthState: {
        employeeAccess: {
          ownedAgentIds: ["bot-owned"],
        },
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    const container = document.createElement("div");
    render(renderWorkbench(props), container);

    const navItems = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".employee-workbench__nav-item"),
    );
    const targetItem = navItems.find((node) => node.textContent?.includes("产品研发小组")) ?? null;

    expect(props.pendingBotApprovalCount).toBe(1);
    expect(props.pendingBotApprovalCountsBySelectionKey?.["space:alpha"]).toBe(1);
    expect(targetItem?.querySelector(".employee-workbench__nav-badge")?.textContent?.trim()).toBe(
      "1",
    );
  });

  it("maps pending seat offers into personal settings actions", async () => {
    const acceptPlatformSeatAssignmentOffer = vi.fn(async () => undefined);
    const declinePlatformSeatAssignmentOffer = vi.fn(async () => undefined);
    const state = createState({
      workbenchSettingsView: "personal",
      platformAuthBusy: false,
      platformAuthError: null,
      platformAuthNotice: "请确认岗位绑定。",
      acceptPlatformSeatAssignmentOffer,
      declinePlatformSeatAssignmentOffer,
      platformAuthState: {
        enabled: true,
        employeeAccess: {
          currentSeat: null,
          defaultAgentId: null,
          defaultSpaceIds: [],
          pendingOffer: {
            offerId: "offer-1",
            seatId: "seat-1",
            seatTitle: "Sales Lead",
            defaultAgentId: "agent-sales",
            defaultSpaceIds: ["space-alpha"],
            offeredAt: "2026-04-20T00:00:00.000Z",
          },
          notice: "A seat assignment is waiting for your confirmation.",
        },
      } as never,
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.pendingSeatOffer).toMatchObject({
      offerId: "offer-1",
      seatTitle: "Sales Lead",
      defaultAgentId: "agent-sales",
      defaultSpaceIds: ["space-alpha"],
    });
    expect(props.pendingSeatOfferNotice).toBe("请确认岗位绑定。");

    await props.onAcceptPendingSeatOffer?.("offer-1");
    await props.onDeclinePendingSeatOffer?.("offer-1");

    expect(acceptPlatformSeatAssignmentOffer).toHaveBeenCalledWith("offer-1");
    expect(declinePlatformSeatAssignmentOffer).toHaveBeenCalledWith("offer-1");
  });

  it("recommends direct enterprise submission for workflow-like asset drafts", () => {
    const state = createState({
      workbenchSkillSaveModalOpen: true,
      workbenchSkillSaveModalFormData: {
        name: "公众号文章编辑与发布",
        summary: "通过脚本、接口、凭证与人工审核把文章推进到公众号草稿箱",
        assetType: "workflow",
      },
      workbenchSkillExtractedPreview: {
        suggestedName: "公众号文章编辑与发布",
        suggestedSummary: "整理完成后提交企业资产包",
        confidence: 0.91,
        detectedAt: Date.now(),
      },
    });

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.skillSaveModalOpen).toBe(true);
    expect(props.skillSaveModalShowEnterpriseSubmitAction).toBe(true);
  });

  it("prefills enterprise package draft from the active conversation context", async () => {
    const state = createState({
      client: {
        request: vi.fn(async (method: string) => {
          if (method === "employee-capability.my-accumulation") {
            return {
              items: [
                {
                  id: "cap-1",
                  name: "客户情绪分析",
                  summary: "分析客户消息中的情绪倾向",
                  health: "运行稳定",
                  shareVisibility: "私有",
                  isDraft: false,
                  recentUpdate: null,
                  updatedAt: 1_700_000_000_000,
                  sourceRobotName: "销售助手",
                  usageBrief: { robotCount: 1, lastUsedAt: 1_700_000_000_000 },
                },
              ],
            };
          }
          if (method === "employee-capability.detail") {
            return {
              capability: {
                id: "cap-1",
                name: "客户情绪分析",
                summary: "分析客户消息中的情绪倾向",
                usageExamples: ["客户投诉处理"],
                inputDescription: "客户消息",
                outputDescription: "情绪摘要和建议",
                tags: ["客户", "分析"],
                category: "客户服务",
                avatar: null,
                health: "运行稳定",
                shareVisibility: "私有",
                maturity: null,
                attribution: {
                  sourceRobot: { id: "robot-1", name: "销售助手" },
                  sourceTaskSummary: "客户服务任务",
                  firstFormedScenario: "首次在客户投诉处理时形成",
                  highFrequencyScenarios: [],
                },
                usage: {
                  robots: [{ id: "robot-1", name: "销售助手" }],
                  totalUsageCount: 12,
                  lastUsedAt: 1_700_000_000_000,
                },
                recentUpdate: null,
                isDraft: false,
                createdAt: 1,
                updatedAt: 1,
              },
            };
          }
          return {};
        }),
      } as never,
      chatMessages: [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: [
                "请把这次公众号文章编辑与发布整理成可提交企业的资产包。",
                "输入包括：标题、摘要、正文 Markdown、封面图、正文配图。",
                "输出包括：微信公众号草稿 media_id、thumb_media_id、正文图片 URL、可预览草稿。",
                "依赖 scripts/publish_agi_axios.js、scripts/gen_cover.sh、references/wechat-config.md。",
                "需要人工预览后群发，并依赖公众号凭证。",
              ].join("\n"),
            },
          ],
        },
      ],
    });

    let props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    await Promise.resolve();

    props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    props.myAccumulationProps?.onSubmitToEnterprise("cap-1");

    props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });

    expect(props.myAccumulationProps?.enterpriseSubmissionOpen).toBe(true);
    expect(props.myAccumulationProps?.enterpriseSubmissionDraft).toMatchObject({
      packageTitle: "公众号文章编辑与发布",
      businessScenario: "公众号文章编辑与发布",
      assetPackageType: "composite_pack",
      executionMode: "semi_automatic",
      needsEnterpriseSecrets: true,
    });
    expect(props.myAccumulationProps?.enterpriseSubmissionDraft?.dependencies).toEqual(
      expect.arrayContaining([
        "scripts/publish_agi_axios.js",
        "scripts/gen_cover.sh",
        "references/wechat-config.md",
      ]),
    );
    expect(props.myAccumulationProps?.enterpriseSubmissionDraft?.inputArtifacts).toEqual(
      expect.arrayContaining(["文章标题", "摘要", "正文 Markdown", "封面图", "正文配图"]),
    );
    expect(props.myAccumulationProps?.enterpriseSubmissionDraft?.outputArtifacts).toEqual(
      expect.arrayContaining([
        "微信公众号草稿 media_id",
        "thumb_media_id",
        "正文图片 URL",
        "可预览草稿",
      ]),
    );
    expect(props.myAccumulationProps?.enterpriseSubmissionReasonLines).toEqual(
      expect.arrayContaining([
        expect.stringContaining("复合资产包"),
        expect.stringContaining("半自动执行"),
        expect.stringContaining("托管密钥"),
      ]),
    );
  });

  it("renders the my devices system settings tab as a login-device list", async () => {
    const now = Date.now();
    const state = createState({
      workbenchPrimaryModule: "settings",
      workbenchSettingsView: "system",
      workbenchSystemSettingsTab: "devices",
      devicesLoading: false,
      devicesError: null,
      devicesCurrentDeviceId: "mac-1",
      gatewayConnectedAtMs: now - 3_600_000,
      nodes: [
        {
          nodeId: "mac-node",
          connected: true,
          permissions: { accessibility: true, appleScript: false, notifications: false },
        },
      ],
      devicesList: {
        pending: [
          {
            requestId: "req-1",
            deviceId: "ios-pending-1",
            displayName: "Safari · iPhone",
            clientId: "openbot-ios",
            ts: now - 60_000,
          },
        ],
        paired: [
          {
            deviceId: "mac-1",
            displayName: "Chrome · Mac",
            clientId: "openbot-control-ui",
            platform: "MacIntel",
            roles: ["operator"],
            scopes: ["operator.admin"],
            approvedAtMs: now - 86_400_000,
            tokens: [
              {
                role: "operator",
                scopes: ["operator.admin"],
                createdAtMs: now - 86_400_000,
                lastUsedAtMs: now - 3_600_000,
              },
            ],
          },
          {
            deviceId: "win-2",
            clientId: "openbot-control-ui",
            platform: "Win32",
            roles: ["operator"],
            scopes: ["operator.read"],
            approvedAtMs: now - 172_800_000,
            tokens: [
              { role: "operator", scopes: ["operator.read"], lastUsedAtMs: now - 7_200_000 },
            ],
          },
          {
            deviceId: "stale-3",
            clientId: "openclaw-control-ui",
            platform: "MacIntel",
            roles: ["operator"],
            approvedAtMs: now - 90 * 86_400_000,
            tokens: [{ role: "operator", scopes: [], lastUsedAtMs: now - 45 * 86_400_000 }],
          },
          {
            deviceId: "gw-internal-1",
            clientId: "gateway-client",
            clientMode: "backend",
            roles: ["operator"],
          },
        ],
      },
    } as never);

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });
    const container = document.createElement("div");
    render(renderWorkbench(props), container);
    await Promise.resolve();

    expect(container.textContent).toContain("我的设备");
    expect(container.textContent).toContain("设备");
    expect(container.textContent).toContain("客户端");
    expect(container.textContent).toContain("最近登录");
    expect(container.textContent).toContain("Mac");
    expect(container.textContent).toContain("Chrome");
    expect(container.textContent).toContain("当前");
    expect(container.textContent).toContain("在线");
    expect(container.textContent).not.toContain("首次配对");
    expect(container.textContent).toContain("Windows");
    expect(container.textContent).toContain("浏览器");
    expect(container.textContent).toContain("移除");
    expect(container.textContent).toContain("更早的设备（1）");
    expect(container.textContent).toContain("全部移除");
    expect(container.textContent).not.toContain("已隐藏");
    // Pending pairing requests are approvable inline.
    expect(container.textContent).toContain("新设备配对请求");
    expect(container.textContent).toContain("Safari · iPhone");
    expect(container.textContent).toContain("待批准");
    expect(container.textContent).toContain("批准");
    expect(container.querySelector(".employee-workbench__devices-table--flat")).toBeTruthy();
    // Internal gateway self-connections stay hidden; token ops are gone.
    expect(container.textContent).not.toContain("gw-internal-1");
    expect(container.textContent).not.toContain("轮换令牌");
  });

  it("renders the personal cron sub-tab inside the tasks module", async () => {
    const state = createState({
      workbenchPrimaryModule: "tasks",
      workbenchTasksSubTab: "cron",
      cronLoading: false,
      cronJobsLoadingMore: false,
      cronJobs: [],
      cronJobsTotal: 0,
      cronJobsHasMore: false,
      cronJobsQuery: "",
      cronJobsEnabledFilter: "all",
      cronJobsScheduleKindFilter: "all",
      cronJobsLastStatusFilter: "all",
      cronJobsSortBy: "nextRunAtMs",
      cronJobsSortDir: "asc",
      cronStatus: null,
      cronError: null,
      cronBusy: false,
      cronForm: {} as never,
      cronFieldErrors: {} as never,
      cronEditingJobId: null,
      cronRunsJobId: null,
      cronRunsLoadingMore: false,
      cronRuns: [],
      cronRunsTotal: 0,
      cronRunsHasMore: false,
      cronRunsScope: "all",
      cronRunsStatuses: [],
      cronRunsDeliveryStatuses: [],
      cronRunsStatusFilter: "all",
      cronRunsQuery: "",
      cronRunsSortDir: "desc",
      cronModelSuggestions: [],
    } as never);

    const props = buildEmployeeWorkbenchProps({
      state,
      chatContent: html`
        <div>chat</div>
      `,
      authPanel: null,
    });
    const container = document.createElement("div");
    render(renderWorkbench(props), container);
    // The tasks module renders the two-segment nav (定时任务 / 开发监督) synchronously.
    expect(container.textContent).toContain("定时任务");
    expect(container.textContent).toContain("开发监督");
  });
});
