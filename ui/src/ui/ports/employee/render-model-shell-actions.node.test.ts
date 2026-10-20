import { describe, expect, it, vi } from "vitest";
import type { AppPortState } from "../../app-port-state.ts";
import type { UiSettings } from "../../storage.ts";
import { buildEmployeeWorkbenchShellActionProps } from "./render-model-shell-actions.ts";

function createSettings(): UiSettings {
  return {
    gatewayUrl: "",
    token: "token-123",
    sessionKey: "main",
    lastActiveSessionKey: "main",
    sessionSeenAt: {},
    theme: "system",
    chatFocusMode: false,
    chatShowThinking: true,
    splitRatio: 0.6,
    navCollapsed: false,
    navGroupsCollapsed: {},
  };
}

function createState(overrides: Partial<AppPortState> = {}): AppPortState {
  return {
    settings: createSettings(),
    forcePublicHomepage: false,
    hello: null,
    platformAuthState: null,
    bootstrapAuthSession: null,
    client: { stop: vi.fn() } as never,
    connected: true,
    lastError: "existing-error",
    lastErrorCode: "existing-code",
    basePath: "",
    tab: "me",
    workbenchPrimaryModule: "assistant",
    workbenchSettingsView: "system",
    workbenchSystemSettingsTab: "security",
    workbenchPersonalSettingsTab: "account",
    workbenchRobotWorkbenchTab: "overview",
    workbenchGroupProfileView: "chat",
    workbenchTeamSelectedKey: "main",
    logoutPlatformAuth: vi.fn(async () => undefined),
    applySettings: vi.fn(),
    setTab: vi.fn(),
    setTheme: vi.fn(),
    loadAssistantIdentity: vi.fn(async () => undefined),
    loadCollaborationLearningSnapshot: vi.fn(async () => undefined),
    loadKnowledgeUniverseHome: vi.fn(async () => undefined),
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
    executeDaibaiAction: vi.fn(async () => undefined),
    handleBrandLogoFileChange: vi.fn(async () => undefined),
    handleResetBrandLogo: vi.fn(),
    ...overrides,
  } as AppPortState;
}

describe("employee workbench shell actions", () => {
  it("uses platform logout for trusted-proxy sessions even when platform auth is not enabled", () => {
    const state = createState({
      hello: {
        auth: {
          provider: "trusted-proxy",
          user: "alice@example.com",
          displayName: "Alice",
        },
      } as never,
      platformAuthState: {
        enabled: false,
      } as never,
    });

    const props = buildEmployeeWorkbenchShellActionProps({
      state,
      collaborationSelectionKeys: [],
      resetWorkbenchMemberGovernanceState: vi.fn(),
    });
    props.onLogout();

    expect(state.logoutPlatformAuth).toHaveBeenCalledTimes(1);
    expect(
      (state.client as unknown as { stop: ReturnType<typeof vi.fn> }).stop,
    ).not.toHaveBeenCalled();
    expect(state.applySettings).not.toHaveBeenCalled();
  });

  it("falls back to local token logout when no platform session is active", () => {
    const state = createState();

    const props = buildEmployeeWorkbenchShellActionProps({
      state,
      collaborationSelectionKeys: [],
      resetWorkbenchMemberGovernanceState: vi.fn(),
    });
    props.onLogout();

    expect(state.logoutPlatformAuth).not.toHaveBeenCalled();
    expect(
      (state.client as unknown as { stop: ReturnType<typeof vi.fn> }).stop,
    ).toHaveBeenCalledTimes(1);
    expect(state.connected).toBe(false);
    expect(state.lastError).toBeNull();
    expect(state.lastErrorCode).toBeNull();
    expect(state.forcePublicHomepage).toBe(true);
    expect(state.tab).toBe("me");
    expect(state.applySettings).toHaveBeenCalledWith({
      ...state.settings,
      token: "",
    });
  });

  it("loads knowledge universe home when switching to knowledge module", () => {
    const state = createState();
    const props = buildEmployeeWorkbenchShellActionProps({
      state,
      collaborationSelectionKeys: [],
      resetWorkbenchMemberGovernanceState: vi.fn(),
    });

    props.onPrimaryModuleChange("knowledge");

    expect(state.workbenchPrimaryModule).toBe("knowledge");
    expect(state.loadKnowledgeUniverseHome).toHaveBeenCalledTimes(1);
  });

  it("routes manual schedule add through Daibai confirmation action", () => {
    const state = createState();
    const props = buildEmployeeWorkbenchShellActionProps({
      state,
      collaborationSelectionKeys: [],
      resetWorkbenchMemberGovernanceState: vi.fn(),
    });

    void props.onAddScheduleEntry?.({
      title: "产品评审",
      startAtMs: 1_720_000_000_000,
      kind: "personal",
    });

    expect(state.executeDaibaiAction).toHaveBeenCalledWith("schedule.entry.add", {
      title: "产品评审",
      startAtMs: 1_720_000_000_000,
      kind: "personal",
    });
  });

  it("switches sessionKey when selecting another assistant so nav and send stay isolated", () => {
    const state = createState({
      sessionKey: "main",
      workbenchTeamSelectedKey: "main",
      workbenchPrimaryModule: "assistant",
      chatMessages: [{ role: "assistant", content: "steward" }],
      chatStream: "partial",
      chatRunId: "run-steward",
      loadAssistantIdentity: vi.fn(async () => undefined),
      resetToolStream: vi.fn(),
      resetChatScroll: vi.fn(),
      applySettings: vi.fn(),
      settings: createSettings(),
    });
    // Minimal fields used by switchEmployeeWorkbenchSession bootstrap.
    Object.assign(state, {
      chatAttachments: [],
      chatQueue: [],
      chatMessage: "draft",
      workbenchTaskDetailId: null,
      workbenchDeliverableDetailId: null,
      workbenchReviewDetailId: null,
      workbenchDecisionDetailId: null,
      workbenchCapsuleDetailId: null,
      workbenchDecisionSelectedOptionDraft: null,
      workbenchDecisionRationaleDraft: null,
      workbenchDecisionOptionsDraft: null,
      workbenchActiveGrowthStatus: null,
      workbenchGrowthBirthAwakening: false,
      workbenchGrowthBirthTurnSentKey: null,
      resetCollaborationLearningSnapshot: vi.fn(),
      resetCollaborationGovernanceActionState: vi.fn(),
    });

    const props = buildEmployeeWorkbenchShellActionProps({
      state,
      collaborationSelectionKeys: [],
      resetWorkbenchMemberGovernanceState: vi.fn(),
    });

    props.onTeamSelectedKeyChange("agent:bot-skill:main");

    expect(state.workbenchTeamSelectedKey).toBe("agent:bot-skill:main");
    expect(state.sessionKey).toBe("agent:bot-skill:main");
    expect(state.workbenchPrimaryModule).toBe("assistant");
    expect(state.chatRunId).toBeNull();
    expect(state.chatStream).toBeNull();
  });

  it("opens member governance for invite todos deep-links", () => {
    const resetWorkbenchMemberGovernanceState = vi.fn();
    const state = createState({
      sessionKey: "main",
      workbenchTeamSelectedKey: "main",
      workbenchPrimaryModule: "assistant",
      workbenchGroupProfileView: "chat",
      workbenchMemberGovernanceDrawerOpen: false,
      chatMessages: [],
      chatStream: null,
      chatRunId: null,
      chatAttachments: [],
      chatQueue: [],
      chatMessage: "",
      sessionsResult: {
        sessions: [
          {
            key: "space:colleague-space",
            groupId: "colleague-space",
            kind: "group",
          },
        ],
      } as never,
      applySettings: vi.fn(),
      settings: createSettings(),
      resetToolStream: vi.fn(),
      resetChatScroll: vi.fn(),
      resetCollaborationLearningSnapshot: vi.fn(),
      resetCollaborationGovernanceActionState: vi.fn(),
      loadAssistantIdentity: vi.fn(async () => undefined),
      loadCollaborationLearningSnapshot: vi.fn(async () => undefined),
      loadKnowledgeUniverseHome: vi.fn(async () => undefined),
    });

    const props = buildEmployeeWorkbenchShellActionProps({
      state,
      collaborationSelectionKeys: ["space:colleague-space"],
      resetWorkbenchMemberGovernanceState,
    });

    props.onOpenCollaborationInvite?.({
      kind: "bot",
      groupId: "colleague-space",
      subjectId: "market-assistant",
    });

    expect(resetWorkbenchMemberGovernanceState).toHaveBeenCalledTimes(1);
    expect(state.workbenchTeamSelectedKey).toBe("space:colleague-space");
    expect(state.workbenchPrimaryModule).toBe("collaboration");
    expect(state.workbenchGroupProfileView).toBe("members");
    expect(state.workbenchMemberGovernanceDrawerOpen).toBe(true);
  });

  it("routes steward attention/conflict suggestions to knowledge governance", () => {
    const state = createState({
      workbenchPrimaryModule: "collaboration",
      workbenchTeamSelectedKey: "space:market",
      knowledgeUniversePageTab: "assets",
    });
    const props = buildEmployeeWorkbenchShellActionProps({
      state,
      collaborationSelectionKeys: ["space:market"],
      resetWorkbenchMemberGovernanceState: vi.fn(),
    });

    props.onOpenStewardSuggestion?.("attention");

    expect(state.workbenchPrimaryModule).toBe("knowledge");
    expect(state.knowledgeUniversePageTab).toBe("governance");
  });
});
