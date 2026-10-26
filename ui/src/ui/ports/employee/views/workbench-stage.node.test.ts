// @vitest-environment jsdom
import { html, render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, t } from "../../../../i18n/index.ts";
import { resetGuidanceUiControlStateForTests } from "../../../controllers/guidance-orchestrator.ts";
import {
  renderDaibaiThreadPrelude,
  renderMeetingConfirmationCard,
} from "./workbench-stage-assistant.ts";
import { renderWorkbenchStage, sanitizeWorkbenchPeerTitle } from "./workbench-stage.ts";

afterEach(() => {
  document.body.innerHTML = "";
});

function createShellModel(overrides: Record<string, unknown> = {}) {
  return {
    primaryModule: "collaboration",
    selectedSpaceItem: {
      title: "产品研发小组",
      rawTitle: "产品研发小组",
      selectionKey: "space:product",
    },
    selectedAssistantItem: null,
    headerTitle: "产品研发小组",
    panelSubtitle: "共享协作线程",
    ...overrides,
  } as never;
}

function createHomeModel() {
  return {
    teamSpaces: [],
    teamAssistants: [],
    signals: { cards: [] },
  } as never;
}

function createStageProps(overrides: Record<string, unknown> = {}) {
  return {
    authPanel: null,
    chatContent: html`
      <section class="chat">chat thread</section>
    `,
    chatComposer: html`
      <div class="chat-composer">composer</div>
    `,
    activeSessionKey: "space:product",
    connected: true,
    currentLocale: "zh-CN",
    currentTheme: "light",
    userProfileName: "OpenBot",
    userProfileSignature: "",
    groupProfileView: "chat",
    collaborationSpacesSnapshot: {
      spaces: [
        {
          id: "space:product",
          groupId: "grp_product",
          title: "产品研发小组",
          members: {
            humans: [{ userId: "u1", name: "Alice Zhang" }],
            bots: [{ agentId: "bot-main", name: "Aegis" }],
          },
          invites: {
            humans: [],
            bots: [],
          },
        },
      ],
    },
    groupMembers: [
      { id: "u1", kind: "human", name: "Alice Zhang" },
      { id: "bot-main", kind: "bot", name: "Aegis" },
    ],
    ownedAgents: [{ id: "bot-main", name: "Aegis", identity: { emoji: "AI", name: "Aegis" } }],
    onOpenAssistantSettings: vi.fn(),
    onLogout: vi.fn(),
    signals: { cards: [] },
    ...overrides,
  } as never;
}

function createGovernanceSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    sessionKey: "space:product",
    groupId: "grp_product",
    personalCapabilities: ["draft"],
    groupProfile: {
      groupId: "grp_product",
      enabledSkills: ["summarize", "review"],
      blockedSkills: [],
      systemInstructions: ["Follow the release review rubric."],
      confidentialityTier: "internal",
      updatedAtMs: 1,
    },
    participationOverlay: {
      participationId: "grp_product::bot-main",
      botId: "bot-main",
      groupId: "grp_product",
      overlayCapabilities: ["diff-analysis"],
      policyFilters: [],
      systemInstructions: ["Act as the release reviewer for this collaboration."],
      confidentialityTier: "internal",
    },
    learningObjects: {
      groupId: "grp_product",
      botId: "bot-main",
      groupCapabilities: null,
      participations: [],
      participationOverlays: [],
      capsules: [],
      projections: [],
      assets: [],
      tasks: [],
      deliverables: [],
      reviews: [],
      decisions: [],
    },
    selectedTaskId: null,
    selectedDeliverableId: null,
    selectedReviewId: null,
    selectedDecisionId: null,
    selectedDecisionOptionDraft: null,
    selectedDecisionRationaleDraft: null,
    ...overrides,
  } as never;
}

describe("workbench stage", () => {
  it("puts 退出全屏 in the stage header left of the member tool", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onExitComputerFullscreen = vi.fn();

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          computerFullscreen: true,
          onExitComputerFullscreen,
        }),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    const exit = container.querySelector<HTMLButtonElement>(
      "[data-testid=computer-exit-fullscreen]",
    );
    const actions = container.querySelector(".employee-workbench__stage-head-actions");
    const memberTool = container.querySelector(
      ".employee-workbench__stage-collaboration-tools .employee-workbench__stage-collaboration-tool",
    );
    expect(exit).not.toBeNull();
    expect(exit?.getAttribute("title")).toBe(t("chat.computerExitFullscreen"));
    expect(exit?.getAttribute("aria-label")).toBe(t("chat.computerExitFullscreen"));
    expect(actions?.firstElementChild).toBe(exit);
    expect(memberTool).not.toBeNull();
    expect(
      memberTool &&
        exit &&
        exit.compareDocumentPosition(memberTool) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    exit?.click();
    expect(onExitComputerFullscreen).toHaveBeenCalledTimes(1);

    render(
      html`${renderWorkbenchStage(createStageProps(), createShellModel(), createHomeModel(), true)}`,
      container,
    );
    await Promise.resolve();
    expect(container.querySelector("[data-testid=computer-exit-fullscreen]")).toBeNull();
  });

  it("puts 退出全屏 in the assistant stage header", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onExitComputerFullscreen = vi.fn();

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          activeSessionKey: "agent:market:main",
          computerFullscreen: true,
          onExitComputerFullscreen,
        }),
        createShellModel({
          primaryModule: "assistant",
          selectedAssistantItem: {
            title: "市场助手",
            rawTitle: "市场助手",
            selectionKey: "agent:market:main",
          },
          selectedSpaceItem: null,
          headerTitle: "市场助手",
        }),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    const exit = container.querySelector<HTMLButtonElement>(
      "[data-testid=computer-exit-fullscreen]",
    );
    expect(exit?.closest(".employee-workbench__stage-head--assistant")).not.toBeNull();
    expect(exit?.getAttribute("title")).toBe(t("chat.computerExitFullscreen"));
    exit?.click();
    expect(onExitComputerFullscreen).toHaveBeenCalledTimes(1);
  });

  it("renders an assistant header with a preview shortcut action", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onOpenFilePreview = vi.fn();
    const onOpenSkillSave = vi.fn();
    const onOpenSkillOrganizeManual = vi.fn();

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          activeSessionKey: "agent:market:main",
          onOpenFilePreview,
          onOpenSkillSave,
          onOpenSkillOrganizeManual,
          canOrganizeCurrentCapability: true,
          showSystemAssetSuggestCta: true,
        }),
        createShellModel({
          primaryModule: "assistant",
          selectedAssistantItem: {
            title: "市场助手",
            rawTitle: "市场助手",
            selectionKey: "agent:market:main",
          },
          selectedSpaceItem: null,
          headerTitle: "市场助手",
        }),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__stage-title")?.textContent?.trim()).toBe(
      "TO: 市场助手",
    );
    expect(container.querySelector(".employee-workbench__stage-head--assistant")).not.toBeNull();
    expect(container.querySelector(".employee-workbench__stage-head-align")).not.toBeNull();
    expect(container.querySelector(".employee-workbench__stage-shell--flat")).toBeTruthy();
    expect(container.querySelector(".employee-workbench__stage-head--flat")).toBeTruthy();
    // Stage 顶栏不再展示资产整理入口（预览区为唯一治理入口）。
    expect(container.textContent).not.toContain("整理为草稿");
    expect(container.textContent).not.toContain("整理本次能力");
    expect(container.textContent).not.toContain("可整理为能力");
    expect(onOpenSkillSave).not.toHaveBeenCalled();
    expect(onOpenSkillOrganizeManual).not.toHaveBeenCalled();

    container
      .querySelector<HTMLButtonElement>(".employee-workbench__stage-collaboration-tool--icon")
      ?.click();
    expect(onOpenFilePreview).toHaveBeenCalledTimes(1);
  });

  it("keeps L2/L3 asset organize CTAs out of the stage header", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onOpenSkillOrganizeManual = vi.fn();

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          activeSessionKey: "agent:market:main",
          onOpenSkillOrganizeManual,
          canOrganizeCurrentCapability: true,
          showSystemAssetSuggestCta: false,
          showWeakAssetHint: true,
        }),
        createShellModel({
          primaryModule: "assistant",
          selectedAssistantItem: {
            title: "市场助手",
            rawTitle: "市场助手",
            selectionKey: "agent:market:main",
          },
          selectedSpaceItem: null,
          headerTitle: "市场助手",
        }),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).not.toContain("可整理为能力");
    expect(container.textContent).not.toContain("整理本次能力");
    expect(container.textContent).not.toContain("整理为草稿");
    expect(onOpenSkillOrganizeManual).not.toHaveBeenCalled();
  });

  it("renders auth-only assistant state without chat content or composer", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          authPanel: html`
            <div class="auth-panel">auth required</div>
          `,
        }),
        createShellModel({
          primaryModule: "assistant",
          selectedAssistantItem: {
            title: "高级秘书",
            rawTitle: "高级秘书",
            selectionKey: "agent:secretary:main",
          },
          selectedSpaceItem: null,
          headerTitle: "每日概览",
        }),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__stage-head")).toBeNull();
    expect(
      container.querySelector(".employee-workbench__assistant-stage .auth-panel"),
    ).not.toBeNull();
    expect(container.querySelector(".employee-workbench__assistant-stage .chat")).toBeNull();
    expect(container.querySelector(".chat-composer")).toBeNull();
  });

  it("hides stage head for knowledge, tasks, and system settings modules", async () => {
    for (const primaryModule of ["knowledge", "tasks", "settings"] as const) {
      const container = document.createElement("div");
      render(
        html`${renderWorkbenchStage(
          createStageProps(),
          createShellModel({
            primaryModule,
            headerTitle: "",
            selectedAssistantItem: null,
            selectedSpaceItem: null,
          }),
          createHomeModel(),
          false,
        )}`,
        container,
      );
      await Promise.resolve();
      expect(container.querySelector(".employee-workbench__stage-head")).toBeNull();
      expect(container.querySelector(".employee-workbench__stage-shell--headless")).not.toBeNull();
      container.remove();
    }
  });

  it("renders collaboration layout without the summary sidecar or legacy compose dock", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps(),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__stage-shell")).not.toBeNull();
    expect(container.querySelector(".employee-workbench__stage-shell--flat")).toBeTruthy();
    expect(container.querySelector(".employee-workbench__stage-head--flat")).toBeTruthy();
    expect(container.querySelector(".employee-workbench__stage-head-align")).not.toBeNull();
    expect(container.querySelector(".employee-workbench__collaboration-stage")).not.toBeNull();
    expect(
      container.querySelector(".employee-workbench__collaboration-stage-main--flat .chat"),
    ).not.toBeNull();
    expect(container.querySelector(".employee-workbench__collaboration-stage-side")).toBeNull();
    expect(container.querySelector(".employee-workbench__stage-title")?.textContent?.trim()).toBe(
      "TO: 产品研发小组",
    );
    expect(container.querySelector(".chat-composer")).not.toBeNull();
    expect(container.querySelector(".employee-workbench__compose-dock")).toBeNull();
  });

  it("renders collaboration stage title in Chinese", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps(),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__stage-title")?.textContent?.trim()).toBe(
      "TO: 产品研发小组",
    );
  });

  it("renders the composer on the assistant primary page", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          activeSessionKey: "agent:market:main",
        }),
        createShellModel({
          primaryModule: "assistant",
          selectedAssistantItem: {
            title: "市场助手",
            rawTitle: "市场助手",
            selectionKey: "agent:market:main",
          },
          selectedSpaceItem: null,
          headerTitle: "市场助手",
        }),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(
      container.querySelector(".employee-workbench__assistant-stage .chat-composer"),
    ).not.toBeNull();
  });

  it("renders the assistant page as a plain conversation surface", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          activeSessionKey: "agent:market:main",
          defaultWorkspaceRoot: "/Users/you/.openbot/workspace",
          robotWorkbenchOutputs: [
            {
              id: "artifact-report-1",
              title: "Weekly Report",
              type: "report",
              createdAt: Date.now() - 10 * 60 * 1000,
            },
          ],
          robotWorkbenchTasks: [
            {
              id: "agent:market:main",
              title: "市场周报",
              updatedAt: Date.now() - 5 * 60 * 1000,
              status: "running",
            },
          ],
        }),
        createShellModel({
          primaryModule: "assistant",
          selectedAssistantItem: {
            title: "市场助手",
            rawTitle: "市场助手",
            selectionKey: "agent:market:main",
          },
          selectedSpaceItem: null,
          headerTitle: "市场助手",
        }),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("市场助手");
    expect(container.textContent).toContain("chat thread");
    expect(container.textContent).toContain("composer");
    expect(container.textContent).not.toContain("继续工作");
    expect(container.textContent).not.toContain("概览");
    expect(container.querySelector(".employee-workbench__robot-workbench")).toBeNull();
  });

  it("keeps collaboration capsule labels in hover tooltips instead of inline text", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps(),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(
      container.querySelector(".employee-workbench__collaboration-capsule-member-label"),
    ).toBeNull();

    const members = Array.from(
      container.querySelectorAll<HTMLElement>(".employee-workbench__collaboration-capsule-member"),
    );
    expect(members.map((node) => node.getAttribute("title"))).toEqual(["Alice Zhang", "Aegis"]);

    const tooltips = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".employee-workbench__collaboration-capsule-member-tooltip",
      ),
    );
    expect(tooltips.map((node) => node.textContent?.trim())).toEqual(["Alice Zhang", "Aegis"]);
  });

  it("shows only active collaboration members in capsule and member count", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          collaborationSpacesSnapshot: {
            spaces: [
              {
                id: "space:product",
                groupId: "grp_product",
                title: "产品研发小组",
                members: {
                  humans: [{ userId: "u1", name: "Alice Zhang", status: "active" }],
                  bots: [
                    { agentId: "bot-main", name: "Aegis", status: "active" },
                    { agentId: "bot-removed", name: "Removed Bot", status: "removed" },
                    { agentId: "bot-revoked", name: "Revoked Bot", status: "revoked" },
                  ],
                },
                invites: {
                  humans: [{ userId: "u2", name: "Pending Human", status: "invited" }],
                  bots: [{ agentId: "bot-pending", name: "Pending Bot", status: "invited" }],
                },
              },
            ],
          },
        }),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    const members = Array.from(
      container.querySelectorAll<HTMLElement>(".employee-workbench__collaboration-capsule-member"),
    );
    expect(members.map((node) => node.getAttribute("title"))).toEqual(["Alice Zhang", "Aegis"]);

    const buttons = container.querySelectorAll<HTMLButtonElement>(
      ".employee-workbench__stage-head-actions .employee-workbench__stage-collaboration-tool",
    );
    expect(Array.from(buttons).some((button) => button.textContent?.includes("2"))).toBe(true);
  });

  it("renders bot runtime status dots on the collaboration capsule", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          collaborationSpacesSnapshot: {
            spaces: [
              {
                id: "space:product",
                groupId: "grp_product",
                title: "产品研发小组",
                members: {
                  humans: [],
                  bots: [
                    {
                      agentId: "bot-online",
                      name: "在线助手",
                      status: "active",
                      runtimeStatus: "online",
                    },
                    {
                      agentId: "bot-busy",
                      name: "忙碌助手",
                      status: "active",
                      runtimeStatus: "busy",
                      currentTask: "文章质量审核",
                      openTaskCount: 2,
                    },
                    {
                      agentId: "bot-offline",
                      name: "离线助手",
                      status: "active",
                      runtimeStatus: "offline",
                    },
                  ],
                },
                invites: {
                  humans: [],
                  bots: [],
                },
              },
            ],
          },
        }),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(
      container.querySelectorAll(".employee-workbench__collaboration-capsule-status--green"),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll(".employee-workbench__collaboration-capsule-status--yellow"),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll(".employee-workbench__collaboration-capsule-status--red"),
    ).toHaveLength(1);
    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>(
          ".employee-workbench__collaboration-capsule-member",
        ),
      ).map((node) => node.getAttribute("title")),
    ).toContain("忙碌助手\n当前任务：文章质量审核\n未完成任务：2");
  });

  it("renders human presence green dots on the collaboration capsule", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          collaborationSpacesSnapshot: {
            spaces: [
              {
                id: "space:product",
                groupId: "grp_product",
                title: "测试组",
                members: {
                  humans: [
                    {
                      userId: "ceo@example.com",
                      name: "CEO",
                      status: "active",
                      presenceStatus: "online",
                    },
                    {
                      userId: "offline@example.com",
                      name: "离线成员",
                      status: "active",
                      presenceStatus: "offline",
                    },
                  ],
                  bots: [{ agentId: "bot-main", name: "大白管家", status: "active" }],
                },
                invites: {
                  humans: [],
                  bots: [],
                },
              },
            ],
          },
        }),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    const humanZone = container.querySelector(
      ".employee-workbench__collaboration-capsule-zone--human",
    );
    expect(humanZone).not.toBeNull();
    expect(
      humanZone?.querySelectorAll(".employee-workbench__collaboration-capsule-status--green"),
    ).toHaveLength(1);
    expect(
      humanZone?.querySelectorAll(".employee-workbench__collaboration-capsule-status--red"),
    ).toHaveLength(0);

    const humanMembers = Array.from(
      humanZone?.querySelectorAll<HTMLElement>(
        ".employee-workbench__collaboration-capsule-member",
      ) ?? [],
    );
    const onlineMember = humanMembers.find((node) =>
      node.getAttribute("aria-label")?.includes("CEO"),
    );
    expect(onlineMember?.getAttribute("aria-label")).toBe("CEO，在线");
    expect(onlineMember?.getAttribute("title")).toContain("在线");
  });

  it("sizes the collaboration capsule split by human and bot counts and keeps overflow scrollable", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          collaborationSpacesSnapshot: {
            spaces: [
              {
                id: "space:product",
                groupId: "grp_product",
                title: "upbeyond",
                members: {
                  humans: [{ userId: "u1", name: "UPBEYOND", status: "active" }],
                  bots: [
                    { agentId: "bot-main", name: "大白管家", status: "active" },
                    { agentId: "bot-secretary", name: "高级秘书", status: "active" },
                    { agentId: "bot-analysis", name: "高密度分析", status: "active" },
                    { agentId: "bot-market", name: "市场助手", status: "active" },
                    { agentId: "bot-skill", name: "Skill孵化", status: "active" },
                    { agentId: "bot-panda", name: "熊猫学习", status: "active" },
                  ],
                },
                invites: {
                  humans: [],
                  bots: [],
                },
              },
            ],
          },
          groupMembers: [
            { id: "u1", kind: "human", name: "UPBEYOND" },
            { id: "bot-main", kind: "bot", name: "大白管家" },
            { id: "bot-secretary", kind: "bot", name: "高级秘书" },
            { id: "bot-analysis", kind: "bot", name: "高密度分析" },
            { id: "bot-market", kind: "bot", name: "市场助手" },
            { id: "bot-skill", kind: "bot", name: "Skill孵化" },
            { id: "bot-panda", kind: "bot", name: "熊猫学习" },
          ],
          ownedAgents: [
            { id: "bot-main", name: "大白管家", identity: { emoji: "大", name: "大白管家" } },
            { id: "bot-secretary", name: "高级秘书", identity: { emoji: "高", name: "高级秘书" } },
            {
              id: "bot-analysis",
              name: "高密度分析",
              identity: { emoji: "高", name: "高密度分析" },
            },
            { id: "bot-market", name: "市场助手", identity: { emoji: "市", name: "市场助手" } },
            { id: "bot-skill", name: "Skill孵化", identity: { emoji: "S", name: "Skill孵化" } },
            { id: "bot-panda", name: "熊猫学习", identity: { emoji: "熊", name: "熊猫学习" } },
          ],
        }),
        createShellModel({
          selectedSpaceItem: {
            title: "upbeyond",
            rawTitle: "upbeyond",
            selectionKey: "space:product",
          },
          headerTitle: "upbeyond",
        }),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    const capsule = container.querySelector<HTMLElement>(
      ".employee-workbench__collaboration-capsule",
    );
    const track = container.querySelector<HTMLElement>(
      ".employee-workbench__collaboration-capsule-track",
    );
    expect(capsule).not.toBeNull();
    expect(capsule?.classList.contains("employee-workbench__collaboration-capsule--flat")).toBe(
      true,
    );
    expect(capsule?.classList.contains("card")).toBe(false);
    expect(track).not.toBeNull();
    expect(track?.getAttribute("style")).toContain(
      "--employee-workbench-collaboration-track-width: 298px",
    );
    expect(track?.getAttribute("style")).toContain("grid-template-columns: 54px 244px");
  });

  it("routes the member-count tool into member governance and keeps governance as a separate tool", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onOpenCollaborationMemberGovernance = vi.fn();
    const onOpenFilePreview = vi.fn();

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          onOpenCollaborationMemberGovernance,
          onOpenFilePreview,
        }),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    const buttons = container.querySelectorAll<HTMLButtonElement>(
      ".employee-workbench__stage-head-actions .employee-workbench__stage-collaboration-tool",
    );
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.textContent?.trim()).toBe("2");

    buttons[0]?.click();
    expect(onOpenCollaborationMemberGovernance).toHaveBeenCalledTimes(1);

    buttons[1]?.click();
    expect(onOpenFilePreview).toHaveBeenCalledTimes(1);
  });

  it("marks collaboration tools active when their panels are open", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          memberGovernanceDrawerOpen: true,
          artifactPreviewOpen: true,
        }),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    const activeButtons = container.querySelectorAll(
      ".employee-workbench__stage-collaboration-tool.is-active",
    );
    expect(activeButtons).toHaveLength(2);
  });

  it("renders pending-bot approval count as a badge on the member governance tool", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onOpenCollaborationMemberGovernance = vi.fn();

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          onOpenCollaborationMemberGovernance,
          pendingBotApprovalCount: 2,
        }),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".employee-workbench__stage-head-actions .employee-workbench__stage-collaboration-tool",
      ),
    );
    const memberTool = buttons.find((button) =>
      button.querySelector(".employee-workbench__stage-collaboration-tool-badge"),
    );
    const approvalShortcut = buttons.find((button) => button.textContent?.includes("待审批"));

    expect(approvalShortcut).toBeUndefined();
    expect(memberTool).toBeTruthy();
    expect(
      memberTool?.querySelector(".employee-workbench__stage-collaboration-tool-badge")?.textContent,
    ).toBe("2");
    expect(memberTool?.getAttribute("aria-label") ?? "").toContain("待审批 2");

    memberTool?.click();
    expect(onOpenCollaborationMemberGovernance).toHaveBeenCalledTimes(1);
  });

  it("renders docked member governance drawer inside collaboration stage when open", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          groupProfileView: "chat",
          memberGovernanceDrawerOpen: true,
          collaborationMemberGovernance: {
            activeGroupKey: "space:product",
            title: "产品研发小组",
            prompt: "请帮我优化成员分工",
            busy: false,
            error: null,
            result: null,
            canReset: true,
            selectorKind: null,
            search: "",
            currentHumans: [{ id: "u1", label: "Alice Zhang", kind: "human" }],
            currentBots: [{ id: "bot-main", label: "Aegis", kind: "bot" }],
            pendingHumanInvites: [{ intentId: "draft:u2", label: "Bob Li" }],
            candidateHumans: [],
            candidateBots: [],
            selectedHumanIds: [],
            selectedBotIds: [],
          },
        }),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(
      container.querySelector(".employee-workbench__collaboration-stage--with-member-governance"),
    ).not.toBeNull();
    expect(
      container.querySelector(".employee-workbench__member-governance-drawer--docked"),
    ).not.toBeNull();
    expect(container.querySelector(".employee-workbench__member-governance-overlay")).toBeNull();
  });

  it("renders full-stage member management page when groupProfileView is members", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          groupProfileView: "members",
          memberGovernanceDrawerOpen: true,
          collaborationMemberGovernance: {
            activeGroupKey: "space:product",
            title: "产品研发小组",
            prompt: "请帮我优化成员分工",
            busy: false,
            error: null,
            result: null,
            canReset: true,
            selectorKind: null,
            search: "",
            currentHumans: [{ id: "u1", label: "Alice Zhang", kind: "human" }],
            currentBots: [{ id: "bot-main", label: "Aegis", kind: "bot" }],
            pendingHumanInvites: [{ intentId: "draft:u2", label: "Bob Li" }],
            candidateHumans: [],
            candidateBots: [],
            selectedHumanIds: [],
            selectedBotIds: [],
          },
        }),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(
      container.querySelector(".employee-workbench__collaboration-stage--members-page"),
    ).not.toBeNull();
    expect(
      container.querySelector(".employee-workbench__member-governance-panel--inline"),
    ).not.toBeNull();
    expect(
      container.querySelector(".employee-workbench__member-governance-drawer--docked"),
    ).toBeNull();
    expect(container.querySelector(".employee-workbench__member-governance-overlay")).toBeNull();
    expect(container.textContent).toMatch(/Member management|成员管理/);
    expect(container.textContent).toContain("产品研发小组");
    // Must not look like a conversation jump.
    expect(container.querySelector(".employee-workbench__stage-main--conversation")).toBeNull();
  });

  it("shows the capability summary page for legacy detailed collaboration views", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          groupProfileView: "capsule-detail",
          collaborationGovernanceSnapshot: {
            sessionKey: "space:product",
            groupId: "grp_product",
            personalCapabilities: ["draft"],
            groupProfile: {
              groupId: "grp_product",
              enabledSkills: ["summarize"],
              blockedSkills: ["search"],
              systemInstructions: ["Keep collaboration knowledge scoped."],
              confidentialityTier: "internal",
              updatedAtMs: 1,
            },
            participationOverlay: {
              participationId: "grp_product::bot-main",
              botId: "bot-main",
              groupId: "grp_product",
              overlayCapabilities: ["diff-analysis"],
              policyFilters: ["allow:draft", "allow:summarize", "allow:diff-analysis"],
              systemInstructions: ["Act as the release reviewer for this collaboration."],
              confidentialityTier: "internal",
            },
          },
        }),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__capsule-preview-modal")).toBeNull();
    expect(container.textContent).toContain(
      "No experience capsules awaiting review in the current collaboration scope.",
    );
    expect(container.textContent).not.toContain("Effective Capabilities");
  });

  it("renders a real governance view instead of the placeholder when collaboration snapshot exists", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          groupProfileView: "governance",
          collaborationGovernanceSnapshot: {
            sessionKey: "space:product",
            groupId: "grp_product",
            personalCapabilities: ["draft", "search"],
            groupProfile: {
              groupId: "grp_product",
              enabledSkills: ["summarize", "review"],
              blockedSkills: ["search"],
              systemInstructions: ["Follow the release review rubric."],
              confidentialityTier: "restricted",
              updatedAtMs: 1,
            },
            participationOverlay: {
              participationId: "grp_product::bot-main",
              botId: "bot-main",
              groupId: "grp_product",
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
          onGroupProfileViewChange: vi.fn(),
        }),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Effective Capabilities");
    expect(container.textContent).toContain("draft, summarize, review, diff-analysis");
    expect(container.textContent).toContain("Capability Boundaries");
    expect(container.textContent).toContain("Learned and Retained");
    expect(container.textContent).not.toContain("This profile view has not been restored yet.");
    expect(container.querySelector(".employee-workbench__governance-shell--flat")).toBeTruthy();
    expect(container.querySelector(".employee-workbench__governance-section--flat")).toBeTruthy();
    expect(container.querySelector(".employee-workbench__module-page--governance")).toBeTruthy();
  });

  it("collapses projection-detail into the same capability summary page", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          groupProfileView: "projection-detail",
          collaborationGovernanceSnapshot: {
            sessionKey: "space:product",
            groupId: "grp_product",
            personalCapabilities: ["draft", "search"],
            groupProfile: {
              groupId: "grp_product",
              enabledSkills: ["summarize", "review"],
              blockedSkills: ["search"],
              systemInstructions: ["Follow the release review rubric."],
              confidentialityTier: "restricted",
              updatedAtMs: 1,
            },
            participationOverlay: {
              participationId: "grp_product::bot-main",
              botId: "bot-main",
              groupId: "grp_product",
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
          onGroupProfileViewChange: vi.fn(),
        }),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Effective Capabilities");
    expect(container.textContent).toContain("Collaboration-only Capabilities");
    expect(container.textContent).not.toContain("Projection Identity");
  });

  it("summarizes persisted learning state instead of exposing projection detail", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          groupProfileView: "projection-detail",
          collaborationGovernanceSnapshot: {
            sessionKey: "space:product",
            groupId: "grp_product",
            personalCapabilities: ["draft", "search"],
            groupProfile: {
              groupId: "grp_product",
              enabledSkills: ["summarize", "review"],
              blockedSkills: ["search"],
              systemInstructions: ["Follow the release review rubric."],
              confidentialityTier: "restricted",
              updatedAtMs: 1,
            },
            participationOverlay: {
              participationId: "grp_product::bot-main",
              botId: "bot-main",
              groupId: "grp_product",
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
            learningObjects: {
              groupId: "grp_product",
              botId: "bot-main",
              groupCapabilities: null,
              participations: [
                {
                  participationId: "grp_product::bot-main",
                  groupId: "grp_product",
                  botId: "bot-main",
                  governanceRole: "member",
                  status: "active",
                  joinedAtMs: 1,
                  updatedAtMs: 2,
                },
              ],
              participationOverlays: [],
              capsules: [],
              projections: [
                {
                  projectionId: "projection-real-1",
                  sourceGroupId: "grp_product",
                  sourceCapsuleId: "capsule-real-1",
                  sourceParticipationId: "grp_product::bot-main",
                  targetBotId: "bot-main",
                  projectionType: "personal_transferable",
                  transformationRule: "summary",
                  sensitivity: "internal",
                  confidentialityScope: "tenant",
                  requiresApproval: false,
                  approvalStatus: "approved",
                  eligibilityReason: "ok",
                  createdAt: 1,
                  updatedAt: 2,
                },
              ],
              assets: [],
              tasks: [],
              deliverables: [],
              reviews: [],
              decisions: [],
            },
          },
          onGroupProfileViewChange: vi.fn(),
        }),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Retained learnings: 0");
    expect(container.textContent).toContain("Pending approvals: 0");
    expect(container.textContent).not.toContain("projection-real-1");
  });

  it("surfaces retained capabilities without exposing asset detail objects", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          groupProfileView: "asset-detail",
          collaborationGovernanceSnapshot: {
            sessionKey: "space:product",
            groupId: "grp_product",
            personalCapabilities: ["draft"],
            groupProfile: {
              groupId: "grp_product",
              enabledSkills: ["summarize", "review"],
              blockedSkills: [],
              systemInstructions: ["Follow the release review rubric."],
              confidentialityTier: "internal",
              updatedAtMs: 1,
            },
            participationOverlay: {
              participationId: "grp_product::bot-main",
              botId: "bot-main",
              groupId: "grp_product",
              overlayCapabilities: ["diff-analysis"],
              policyFilters: [
                "allow:draft",
                "allow:review",
                "allow:summarize",
                "allow:diff-analysis",
              ],
              systemInstructions: ["Act as the release reviewer for this collaboration."],
              confidentialityTier: "internal",
            },
            learningObjects: {
              groupId: "grp_product",
              botId: "bot-main",
              groupCapabilities: null,
              participations: [],
              participationOverlays: [],
              capsules: [],
              projections: [],
              assets: [
                {
                  assetId: "asset-real-1",
                  botId: "bot-main",
                  sourceGroupId: "grp_product",
                  sourceCapsuleId: "capsule-real-1",
                  status: "active",
                  abstractedContent: {
                    capabilities: ["risk-scan", "signoff-review"],
                  },
                },
              ],
              tasks: [],
              deliverables: [],
              reviews: [],
              decisions: [],
            },
          },
          onGroupProfileViewChange: vi.fn(),
        }),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Learned and Retained");
    expect(container.textContent).toContain("risk-scan, signoff-review");
    expect(container.textContent).not.toContain("Asset Identity");
  });

  it("shows the summary page instead of capsule detail when real learning objects are loaded", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          groupProfileView: "capsule-detail",
          collaborationGovernanceSnapshot: {
            sessionKey: "space:product",
            groupId: "grp_product",
            personalCapabilities: ["draft"],
            groupProfile: {
              groupId: "grp_product",
              enabledSkills: ["summarize"],
              blockedSkills: [],
              systemInstructions: [],
              confidentialityTier: "internal",
              updatedAtMs: 1,
            },
            participationOverlay: {
              participationId: "grp_product::bot-main",
              botId: "bot-main",
              groupId: "grp_product",
              overlayCapabilities: ["diff-analysis"],
              policyFilters: [],
              systemInstructions: [],
              confidentialityTier: "internal",
            },
            selectedCapsuleId: "capsule-real-1",
            learningObjects: {
              groupId: "grp_product",
              botId: "bot-main",
              groupCapabilities: null,
              participations: [],
              participationOverlays: [],
              capsules: [
                {
                  capsuleId: "capsule-real-1",
                  groupId: "grp_product",
                  sourceType: "memory",
                  sourceIds: ["session-1"],
                  capsuleType: "lesson",
                  sensitivity: "internal",
                  reusability: "exportable",
                  confidentialityScope: "tenant",
                  status: "approved",
                  createdAt: 1,
                  updatedAt: 2,
                },
              ],
              projections: [],
              assets: [],
              tasks: [],
              deliverables: [],
              reviews: [],
              decisions: [],
            },
          },
          onGroupProfileViewChange: vi.fn(),
        }),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("capsule-real-1");
    expect(container.textContent).toContain("Capsule detail for capsule-real-1");
    expect(container.textContent).not.toContain("Effective Capabilities");
    expect(container.querySelector(".employee-workbench__capsule-preview-modal")).toBeNull();
  });

  it("renders persisted task objects in the governance workbench", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          groupProfileView: "tasks",
          collaborationGovernanceSnapshot: createGovernanceSnapshot({
            learningObjects: {
              groupId: "grp_product",
              botId: "bot-main",
              groupCapabilities: null,
              participations: [],
              participationOverlays: [],
              capsules: [],
              projections: [],
              assets: [],
              tasks: [
                {
                  taskId: "task-1",
                  groupId: "grp_product",
                  title: "Ship governance recovery",
                  status: "in_progress",
                  priority: "high",
                  assignedMemberIds: ["bot-main"],
                  createdAtMs: 1,
                  updatedAtMs: 2,
                },
              ],
              deliverables: [],
              reviews: [],
              decisions: [],
            },
          }),
        }),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Ship governance recovery");
    expect(container.textContent).toContain("in_progress");
    expect(container.textContent).not.toContain("Effective Capabilities");
    expect(container.querySelector(".employee-workbench__governance-list--flat")).toBeTruthy();
    expect(container.querySelector(".employee-workbench__governance-list-row")).toBeTruthy();
  });

  it("renders task detail with cross-links to related governance objects", async () => {
    const container = document.createElement("div");
    const onOpenGovernanceObjectDetail = vi.fn();
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          groupProfileView: "task-detail",
          onOpenGovernanceObjectDetail,
          collaborationGovernanceSnapshot: createGovernanceSnapshot({
            selectedTaskId: "task-1",
            learningObjects: {
              groupId: "grp_product",
              botId: "bot-main",
              groupCapabilities: null,
              participations: [],
              participationOverlays: [],
              capsules: [],
              projections: [],
              assets: [],
              tasks: [
                {
                  taskId: "task-1",
                  groupId: "grp_product",
                  title: "Ship governance recovery",
                  status: "in_progress",
                  priority: "high",
                  assignedMemberIds: ["bot-main"],
                  createdAtMs: 1,
                  updatedAtMs: 2,
                },
              ],
              deliverables: [
                {
                  deliverableId: "deliverable-1",
                  groupId: "grp_product",
                  taskId: "task-1",
                  title: "Governance report",
                  status: "published",
                  version: 2,
                  createdAtMs: 1,
                  updatedAtMs: 2,
                },
              ],
              reviews: [
                {
                  reviewId: "review-1",
                  groupId: "grp_product",
                  deliverableId: "deliverable-1",
                  taskId: "task-1",
                  reviewerMemberId: "bot-main",
                  status: "resolved",
                  requestedAtMs: 1,
                  createdAtMs: 1,
                  updatedAtMs: 2,
                },
              ],
              decisions: [
                {
                  decisionId: "decision-1",
                  groupId: "grp_product",
                  title: "Adopt recovered governance",
                  options: [{ optionId: "adopt", title: "Adopt" }],
                  status: "finalized",
                  relatedTaskId: "task-1",
                  createdAt: 1,
                  updatedAt: 2,
                },
              ],
            },
          }),
        }),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Task detail for task-1");
    expect(container.textContent).toContain("Related deliverables");
    expect(container.querySelector(".employee-workbench__governance-back")).toBeTruthy();
    expect(container.querySelector(".employee-workbench__governance-kv")).toBeTruthy();
    const relationButton = [...container.querySelectorAll("button")].find((entry) =>
      entry.textContent?.includes("Governance report"),
    );
    relationButton?.dispatchEvent(new MouseEvent("click"));
    expect(onOpenGovernanceObjectDetail).toHaveBeenCalledWith("deliverable", "deliverable-1");
  });

  it("submits an explicit task handoff contract from task detail", async () => {
    const container = document.createElement("div");
    const onTransitionGovernanceObject = vi.fn();
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          groupProfileView: "task-detail",
          onTransitionGovernanceObject,
          collaborationGovernanceSnapshot: createGovernanceSnapshot({
            selectedTaskId: "task-1",
            learningObjects: {
              groupId: "grp_product",
              botId: "bot-main",
              groupCapabilities: null,
              participations: [],
              participationOverlays: [],
              capsules: [],
              projections: [],
              assets: [],
              tasks: [
                {
                  taskId: "task-1",
                  groupId: "grp_product",
                  title: "Ship governance recovery",
                  status: "in_progress",
                  assignedMemberIds: ["bot-main"],
                  createdAtMs: 1,
                  updatedAtMs: 2,
                },
              ],
              deliverables: [],
              reviews: [],
              decisions: [],
            },
          }),
        }),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    const form = container.querySelector(
      "form.employee-workbench__task-handoff",
    ) as HTMLFormElement;
    expect(form).toBeTruthy();
    const toInput = form.querySelector('input[name="to"]') as HTMLInputElement;
    const remaining = form.querySelector('textarea[name="remainingWork"]') as HTMLTextAreaElement;
    const criteria = form.querySelector(
      'textarea[name="acceptanceCriteria"]',
    ) as HTMLTextAreaElement;
    toInput.value = "bot-reviewer";
    remaining.value = "Finish the rollout checklist";
    criteria.value = "checklist reviewed";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(onTransitionGovernanceObject).toHaveBeenCalledWith("task", "task-1", "in_progress", {
      handoff: {
        from: "bot-main",
        to: "bot-reviewer",
        reason: "need_specialist",
        remainingWork: "Finish the rollout checklist",
        acceptanceCriteria: ["checklist reviewed"],
        completedArtifacts: [],
        assumptions: [],
        blockers: [],
      },
    });
  });

  it("renders review detail pages from persisted collaboration objects", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          groupProfileView: "review-detail",
          collaborationGovernanceSnapshot: createGovernanceSnapshot({
            selectedReviewId: "review-1",
            learningObjects: {
              groupId: "grp_product",
              botId: "bot-main",
              groupCapabilities: null,
              participations: [],
              participationOverlays: [],
              capsules: [],
              projections: [],
              assets: [],
              tasks: [
                {
                  taskId: "task-1",
                  groupId: "grp_product",
                  title: "Ship governance recovery",
                  status: "in_progress",
                  createdAtMs: 1,
                  updatedAtMs: 2,
                },
              ],
              deliverables: [
                {
                  deliverableId: "deliverable-1",
                  groupId: "grp_product",
                  taskId: "task-1",
                  title: "Governance report",
                  status: "published",
                  version: 2,
                  createdAtMs: 1,
                  updatedAtMs: 2,
                },
              ],
              reviews: [
                {
                  reviewId: "review-1",
                  groupId: "grp_product",
                  deliverableId: "deliverable-1",
                  taskId: "task-1",
                  reviewerMemberId: "bot-main",
                  status: "resolved",
                  verdict: "approve",
                  comments: "Looks good",
                  requestedAtMs: 1,
                  resolvedAtMs: 2,
                  createdAtMs: 1,
                  updatedAtMs: 2,
                },
              ],
              decisions: [],
            },
          }),
        }),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Review detail for review-1");
    expect(container.textContent).toContain("Looks good");
    expect(container.textContent).toContain("Governance report");
  });

  it("renders decision detail pages from persisted collaboration objects", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          groupProfileView: "decision-detail",
          collaborationGovernanceSnapshot: createGovernanceSnapshot({
            selectedDecisionId: "decision-1",
            learningObjects: {
              groupId: "grp_product",
              botId: "bot-main",
              groupCapabilities: null,
              participations: [],
              participationOverlays: [],
              capsules: [],
              projections: [],
              assets: [],
              tasks: [
                {
                  taskId: "task-1",
                  groupId: "grp_product",
                  title: "Ship governance recovery",
                  status: "in_progress",
                  createdAtMs: 1,
                  updatedAtMs: 2,
                },
              ],
              deliverables: [
                {
                  deliverableId: "deliverable-1",
                  groupId: "grp_product",
                  taskId: "task-1",
                  title: "Governance report",
                  status: "published",
                  version: 2,
                  createdAtMs: 1,
                  updatedAtMs: 2,
                },
              ],
              reviews: [],
              decisions: [
                {
                  decisionId: "decision-1",
                  groupId: "grp_product",
                  title: "Adopt recovered governance",
                  options: [
                    { optionId: "adopt", title: "Adopt" },
                    { optionId: "delay", title: "Delay" },
                  ],
                  selectedOption: "adopt",
                  rationale: "The recovered chain is now stable enough.",
                  status: "finalized",
                  relatedTaskId: "task-1",
                  relatedDeliverableId: "deliverable-1",
                  createdAt: 1,
                  updatedAt: 2,
                  finalizedAt: 3,
                },
              ],
            },
          }),
        }),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Decision detail for decision-1");
    expect(container.textContent).toContain("The recovered chain is now stable enough.");
    expect(container.textContent).toContain("Adopt (selected)");
  });

  it("dispatches governance transition actions from detail pages", async () => {
    const container = document.createElement("div");
    const onTransitionGovernanceObject = vi.fn();
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          groupProfileView: "deliverable-detail",
          onTransitionGovernanceObject,
          collaborationGovernanceSnapshot: createGovernanceSnapshot({
            selectedDeliverableId: "deliverable-2",
            learningObjects: {
              groupId: "grp_product",
              botId: "bot-main",
              groupCapabilities: null,
              participations: [],
              participationOverlays: [],
              capsules: [],
              projections: [],
              assets: [],
              tasks: [],
              deliverables: [
                {
                  deliverableId: "deliverable-2",
                  groupId: "grp_product",
                  title: "Rollout checklist",
                  status: "in_review",
                  version: 1,
                  createdAtMs: 1,
                  updatedAtMs: 2,
                },
              ],
              reviews: [],
              decisions: [],
            },
          }),
        }),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    const transitionButton = [...container.querySelectorAll("button")].find((entry) =>
      entry.textContent?.includes("approved"),
    );
    transitionButton?.dispatchEvent(new MouseEvent("click"));
    expect(onTransitionGovernanceObject).toHaveBeenCalledWith(
      "deliverable",
      "deliverable-2",
      "approved",
      {},
    );
  });

  it("lets draft decisions pick an option before finalize", async () => {
    const container = document.createElement("div");
    const onDecisionOptionDraftChange = vi.fn();
    const onDecisionRationaleDraftChange = vi.fn();
    const onSaveDecisionDraft = vi.fn();
    const onTransitionGovernanceObject = vi.fn();
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          groupProfileView: "decision-detail",
          onDecisionOptionDraftChange,
          onDecisionRationaleDraftChange,
          onSaveDecisionDraft,
          onTransitionGovernanceObject,
          collaborationGovernanceSnapshot: createGovernanceSnapshot({
            selectedDecisionId: "decision-1",
            selectedDecisionOptionDraft: "adopt",
            selectedDecisionRationaleDraft: "Ship gradually first",
            learningObjects: {
              groupId: "grp_product",
              botId: "bot-main",
              groupCapabilities: null,
              participations: [],
              participationOverlays: [],
              capsules: [],
              projections: [],
              assets: [],
              tasks: [],
              deliverables: [],
              reviews: [],
              decisions: [
                {
                  decisionId: "decision-1",
                  groupId: "grp_product",
                  title: "Choose rollout path",
                  options: [
                    { optionId: "adopt", title: "Adopt" },
                    { optionId: "delay", title: "Delay" },
                  ],
                  status: "draft",
                  createdAt: 1,
                  updatedAt: 2,
                },
              ],
            },
          }),
        }),
        createShellModel(),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    const delayButton = [...container.querySelectorAll("button")].find((entry) =>
      entry.textContent?.includes("Delay"),
    );
    delayButton?.dispatchEvent(new MouseEvent("click"));
    expect(onDecisionOptionDraftChange).toHaveBeenCalledWith("delay");

    const rationaleInput = container.querySelector("textarea");
    expect(rationaleInput).not.toBeNull();
    expect((rationaleInput as HTMLTextAreaElement).value).toBe("Ship gradually first");
    (rationaleInput as HTMLTextAreaElement).value = "Roll out gradually to reduce risk";
    rationaleInput?.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onDecisionRationaleDraftChange).toHaveBeenCalledWith(
      "Roll out gradually to reduce risk",
    );

    const saveButton = [...container.querySelectorAll("button")].find((entry) =>
      entry.textContent?.includes("Save draft"),
    );
    saveButton?.dispatchEvent(new MouseEvent("click"));
    expect(onSaveDecisionDraft).toHaveBeenCalledWith("decision-1");

    const finalizeButton = [...container.querySelectorAll("button")].find((entry) =>
      entry.textContent?.includes("finalized"),
    );
    finalizeButton?.dispatchEvent(new MouseEvent("click"));
    expect(onTransitionGovernanceObject).toHaveBeenCalledWith(
      "decision",
      "decision-1",
      "finalized",
      { selectedOption: "adopt" },
    );
  });

  it("renders assistant conversations inside the unified stage shell without a fixed overview panel", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          collaborationSpacesSnapshot: { spaces: [] },
          groupMembers: [],
          ownedAgents: [],
          daibaiAskResult: {
            summary: "我可以先帮你整理问题，再升级给平台技术支持。",
            rationale: "当前建议基于支持单状态生成。",
            latestProposal: {
              caseId: "sc_1",
              proposalVersion: 1,
              userFacingReply: "请先确认 skill 触发词和输入 schema。",
              requiresUserConfirmation: true,
              seenByUser: false,
            },
            supportContext: {
              openCaseCount: 1,
              waitingOnUserCount: 1,
              latestCase: {
                caseId: "sc_1",
                category: "unknown",
                status: "waiting_user",
                userProblem: "创建 skill 时 schema 不清楚",
                userId: "u1",
                updatedAtMs: 1,
              },
              cases: [
                {
                  caseId: "sc_1",
                  category: "unknown",
                  status: "waiting_user",
                  userProblem: "创建 skill 时 schema 不清楚",
                  userId: "u1",
                  updatedAtMs: 1,
                },
              ],
            },
            suggestedActions: [
              {
                actionId: "support.case.create",
                label: "升级给平台技术支持",
                description: "把当前问题整理成支持单并转给平台技术人员。",
              },
            ],
          },
        }),
        createShellModel({
          primaryModule: "assistant",
          selectedAssistantItem: {
            title: "大白管家",
            rawTitle: "大白管家",
            selectionKey: "main",
          },
          selectedSpaceItem: null,
          panelSubtitle: "主工作线程",
        }),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__assistant-stage")).not.toBeNull();
    expect(container.querySelector(".employee-workbench__assistant-stage .chat")).not.toBeNull();
    expect(container.textContent).not.toContain("开放支持单");
    expect(container.textContent).not.toContain("平台最新回复");
  });

  it("renders the daibai prelude inside the chat thread", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`<div class="chat-thread">
        ${renderDaibaiThreadPrelude(
          {
            daibaiLoading: false,
            daibaiAskResult: {
              summary: "我已经帮你整理好当前方案。",
              latestProposal: {
                caseId: "sc_2",
                proposalVersion: 2,
                userFacingReply: "现在可以按平台建议执行解决方案。",
                requiresUserConfirmation: true,
                seenByUser: true,
              },
              supportContext: {
                openCaseCount: 1,
                waitingOnUserCount: 1,
                latestCase: {
                  caseId: "sc_2",
                  category: "unknown",
                  status: "waiting_user",
                  userProblem: "创建 skill 时 schema 不清楚",
                  userId: "u1",
                  updatedAtMs: 2,
                },
                cases: [],
              },
              suggestedActions: [
                {
                  actionId: "support.case.create",
                  label: "升级给平台技术支持",
                  description: "把当前问题整理成支持单并转给平台技术人员。",
                },
              ],
            },
            daibaiExecuteResult: null,
            daibaiActionLoading: false,
            daibaiActionPendingId: null,
            daibaiActionError: null,
            onAskDaibai: vi.fn(async () => undefined),
            onExecuteDaibaiAction: vi.fn(async () => undefined),
          },
          {
            guideAcknowledged: false,
            onDismissGuide: vi.fn(),
          },
        )}
      </div>`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("当前解决方案");
    expect(container.textContent).toContain("现在可以按平台建议执行解决方案。");
    expect(container.textContent).toContain("开放支持单");
    const actionChip = container.querySelector<HTMLButtonElement>(
      ".employee-workbench__assistant-action-chip",
    );
    expect(actionChip?.textContent?.trim()).toBe("升级给平台技术支持");
    expect(actionChip?.getAttribute("title")).toBe("把当前问题整理成支持单并转给平台技术人员。");
    expect(actionChip?.getAttribute("aria-label")).toBe(
      "升级给平台技术支持：把当前问题整理成支持单并转给平台技术人员。",
    );
    expect(container.querySelector(".employee-workbench__assistant-prelude-action")).toBeNull();
  });

  it("first-run daibai prelude keeps one primary CTA and hides leaked keys", async () => {
    resetGuidanceUiControlStateForTests();
    const container = document.createElement("div");
    document.body.append(container);
    render(
      html`${renderDaibaiThreadPrelude(
        {
          daibaiLoading: false,
          daibaiAskResult: null,
          daibaiExecuteResult: null,
          daibaiActionLoading: false,
          daibaiActionPendingId: null,
          daibaiActionError: null,
          onAskDaibai: vi.fn(async () => undefined),
        },
        { guideAcknowledged: false, onDismissGuide: vi.fn() },
      )}`,
      container,
    );
    await Promise.resolve();
    expect(container.textContent).toContain("开始引导");
    expect(container.textContent).toContain("我是大白管家，我来帮你创建专属你的数字员工团队。");
    expect(container.textContent).not.toContain("带你熟悉工作台");
    expect(container.textContent).not.toContain("专属工作助手");
    expect(container.textContent).not.toMatch(/欢迎入驻\s*openbot/i);
    expect(container.textContent).not.toContain("guidance.recommend");
    expect(container.textContent).not.toContain("从进度恢复");
    expect(container.textContent).not.toContain("失败恢复");
    expect(container.querySelector("[data-daibai-primary-cta]")).toBeNull();
    expect(container.querySelectorAll("[data-guidance-primary-cta]").length).toBe(1);
    expect(container.textContent?.match(/我知道了/g)?.length).toBe(1);
  });

  it("sanitizes stacked steward titles in the stage header", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      html`${renderWorkbenchStage(
        createStageProps({ activeSessionKey: "main" }),
        createShellModel({
          primaryModule: "assistant",
          selectedAssistantItem: {
            title: "大白管家家",
            rawTitle: "大白管家家",
            selectionKey: "main",
          },
          selectedSpaceItem: null,
          headerTitle: "大白管家家",
        }),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();
    expect(sanitizeWorkbenchPeerTitle("大白管家家")).toBe("大白管家");
    expect(container.querySelector(".employee-workbench__stage-title")?.textContent?.trim()).toBe(
      "TO: 大白管家",
    );
  });

  it("renders the Daibai workspace overview card with current group members", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`<div class="chat-thread">
        ${renderDaibaiThreadPrelude(
          {
            daibaiLoading: false,
            daibaiAskResult: {
              summary:
                "当前可见 2 个机器人、1 个协作群。 当前群「数字人战队」共有 4 位成员（人类 2 / 机器人 2）。",
              workspaceOverview: {
                visibleRobotCount: 2,
                visibleSpaceCount: 1,
                currentSpace: {
                  groupId: "group-alpha",
                  title: "数字人战队",
                  memberCount: 4,
                  humanCount: 2,
                  botCount: 2,
                  humans: ["CEO", "高级秘书"],
                  bots: ["大白管家", "销售助理"],
                },
              },
              suggestedActions: [],
            },
            daibaiExecuteResult: null,
            daibaiActionLoading: false,
            daibaiActionPendingId: null,
            daibaiActionError: null,
            onAskDaibai: vi.fn(async () => undefined),
            onExecuteDaibaiAction: vi.fn(async () => undefined),
          },
          { guideAcknowledged: true, onDismissGuide: vi.fn() },
        )}
      </div>`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("当前工作台概览");
    expect(container.textContent).toContain("可见机器人");
    expect(container.textContent).toContain("可见协作群");
    expect(container.textContent).toContain("当前群：数字人战队");
    expect(container.textContent).toContain("人类成员：CEO、高级秘书");
    expect(container.textContent).toContain("机器人成员：大白管家、销售助理");
  });

  it("renders the group-config-proposal apply card on the steward prelude", async () => {
    const onApply = vi.fn(async () => undefined);
    const onDismiss = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    render(
      html`<div class="chat-thread">
        ${renderDaibaiThreadPrelude(
          {
            daibaiLoading: false,
            daibaiAskResult: null,
            daibaiExecuteResult: null,
            daibaiActionLoading: false,
            daibaiActionPendingId: null,
            daibaiActionError: null,
            daibaiPendingConfirmation: null,
            groupConfigProposal: {
              groupId: "group-alpha",
              summaryLines: ["目标：产品交付", "真人成员：1 人"],
              busy: false,
              error: null,
              notice: null,
            },
            onApplyGroupConfigProposal: onApply,
            onDismissGroupConfigProposal: onDismiss,
          },
          { guideAcknowledged: true, onDismissGuide: vi.fn() },
        )}
      </div>`,
      container,
    );
    await Promise.resolve();
    expect(container.textContent).toContain("应用到协作小组");
    expect(container.textContent).toContain("group-alpha");
    expect(container.textContent).toContain("目标：产品交付");
    const applyButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("采纳并写回小组"),
    );
    expect(applyButton).toBeTruthy();
    applyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("keeps meeting confirm card out of the assistant prelude when pending (epilogue placement)", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const meetingPending = {
      meeting: { id: "mtg_1", title: "周会", status: "pending_confirmation" },
      confirmation: {
        proposalId: "mcp_1",
        confirmationToken: "tok-meeting",
        payloadHash: "hash",
        expiresAtMs: Date.now() + 300_000,
      },
      confirmationDetail: {
        title: "周会",
        impact: "通知组织内相关成员",
        irreversible: false,
        expiresAtMs: Date.now() + 300_000,
      },
      message: "请确认是否发送组织通知：周会。",
    };
    render(
      html`<div class="chat-thread">
        ${renderDaibaiThreadPrelude(
          {
            daibaiLoading: false,
            daibaiAskResult: null,
            daibaiExecuteResult: null,
            daibaiActionLoading: false,
            daibaiActionPendingId: null,
            daibaiActionError: null,
            daibaiPendingConfirmation: null,
            meetingPendingConfirmation: meetingPending,
            meetingConfirmationLoading: false,
            meetingConfirmationError: null,
            onAskDaibai: vi.fn(async () => undefined),
            onExecuteDaibaiAction: vi.fn(async () => undefined),
            onConfirmMeetingPendingApproval: vi.fn(async () => undefined),
            onCancelMeetingPendingConfirmation: vi.fn(),
          },
          { guideAcknowledged: true, onDismissGuide: vi.fn() },
        )}
        ${renderMeetingConfirmationCard({
          meetingPendingConfirmation: meetingPending,
          meetingConfirmationLoading: false,
          meetingConfirmationError: null,
          onConfirmMeetingPendingApproval: vi.fn(async () => undefined),
          onCancelMeetingPendingConfirmation: vi.fn(),
        })}
      </div>`,
      container,
    );
    await Promise.resolve();
    const prelude = container.querySelector(".employee-workbench__assistant-prelude");
    expect(prelude).toBeNull();
    const card = container.querySelector('[data-meeting-confirm-card="true"]');
    expect(card).not.toBeNull();
    expect(card?.closest(".employee-workbench__assistant-prelude")).toBeNull();
    expect(container.textContent).toContain("确认发送会议");
    expect(container.textContent).not.toContain("会议通知：周会");
    expect(container.textContent).not.toContain("确认发送组织通知");
    expect(container.textContent).not.toContain("tok-meeting");
    expect(container.querySelector('[data-confirm-chrome="thin"]')).not.toBeNull();
  });

  it("renders meeting confirm card via exported renderer with steward ticket fields", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onConfirm = vi.fn(async () => undefined);
    const onCancel = vi.fn();
    render(
      html`${renderMeetingConfirmationCard({
        meetingPendingConfirmation: {
          meeting: { id: "mtg_2", title: "发布评审", status: "pending_confirmation" },
          confirmation: {
            proposalId: "mcp_2",
            confirmationToken: "tok-2",
            payloadHash: "h2",
            expiresAtMs: Date.now() + 120_000,
          },
          confirmationDetail: {
            title: "发布评审",
            impact: "向组织发送会议通知",
            irreversible: false,
            expiresAtMs: Date.now() + 120_000,
          },
          message: "请确认是否发送组织通知：发布评审。",
        },
        meetingConfirmationLoading: false,
        meetingConfirmationError: null,
        onConfirmMeetingPendingApproval: onConfirm,
        onCancelMeetingPendingConfirmation: onCancel,
      })}`,
      container,
    );
    await Promise.resolve();
    const card = container.querySelector('[data-meeting-confirm-card="true"]');
    expect(card).not.toBeNull();
    expect(card?.classList.contains("employee-workbench__steward-confirm-card")).toBe(true);
    const confirmBtn = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("确认发送"),
    );
    expect(confirmBtn).toBeTruthy();
    confirmBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("renders meeting confirm release epilogue when pending card is cleared", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      html`${renderMeetingConfirmationCard({
        meetingPendingConfirmation: null,
        meetingConfirmationLoading: false,
        meetingConfirmationError: null,
        meetingConfirmRelease: {
          meetingId: "mtg_release",
          title: "周会",
          phase: "releasing",
          progressMessage: "已确认，正在发送邀请并写入日程…",
        },
        onConfirmMeetingPendingApproval: vi.fn(async () => undefined),
        onCancelMeetingPendingConfirmation: vi.fn(),
      })}`,
      container,
    );
    await Promise.resolve();
    const card = container.querySelector('[data-meeting-confirm-release="releasing"]');
    expect(card).not.toBeNull();
    expect(container.textContent).toContain("已确认，正在发送邀请并写入日程");
    expect(container.textContent).toContain("确认中…");
    expect(container.querySelector('[data-meeting-confirm-card="true"]')).toBeNull();
    expect(container.textContent).not.toContain("放行中");
    expect(container.textContent).not.toContain("收起");
  });

  it("marks a finished meeting notice as sent on the same bubble", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      html`${renderMeetingConfirmationCard({
        meetingPendingConfirmation: null,
        meetingConfirmationLoading: false,
        meetingConfirmationError: null,
        meetingConfirmRelease: {
          meetingId: "mtg_release",
          title: "openbot体验交流会",
          phase: "released",
          progressMessage: "已确认，正在发送邀请并写入日程…",
          resultMessage: "已确认发送「openbot体验交流会」。发起人日程已写入；投递：已投递 3。",
          noticeText: "会议通知：openbot体验交流会\n链接：https://meeting.tencent.com/dm/abc",
        },
        onConfirmMeetingPendingApproval: vi.fn(async () => undefined),
        onCancelMeetingPendingConfirmation: vi.fn(),
      })}`,
      container,
    );
    await Promise.resolve();
    const sent = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("已发送"),
    );
    expect(sent).toBeTruthy();
    expect(sent?.disabled).toBe(true);
    expect(container.textContent).toContain("会议通知：openbot体验交流会");
    expect(container.textContent).toContain("已投递 3");
    expect(container.textContent).not.toContain("已放行");
    expect(container.textContent).not.toContain("收起");
  });

  it("defensively hides confirm controls when online pending lacks joinUrl", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onConfirm = vi.fn(async () => undefined);
    render(
      html`${renderMeetingConfirmationCard({
        meetingPendingConfirmation: {
          meeting: {
            id: "mtg_online",
            title: "体验交流会",
            status: "pending_approval",
            meetingMode: "online",
            location: "线上",
          },
          confirmation: {
            proposalId: "mcp_online",
            confirmationToken: "secret-token",
            payloadHash: "h",
            expiresAtMs: Date.now() + 120_000,
          },
          message: "请确认会议范本",
        },
        meetingConfirmationLoading: false,
        meetingConfirmationError: null,
        onConfirmMeetingPendingApproval: onConfirm,
        onCancelMeetingPendingConfirmation: vi.fn(),
      })}`,
      container,
    );
    await Promise.resolve();
    expect(container.textContent).toContain("缺少入会链接");
    expect(container.textContent).not.toContain("会议通知：体验交流会");
    expect(container.textContent).not.toContain("secret-token");
    const confirmBtn = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("确认发送"),
    );
    expect(confirmBtn).toBeUndefined();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("thin confirm card omits notice body and shows action title + optional hint", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      html`${renderMeetingConfirmationCard({
        meetingPendingConfirmation: {
          meeting: {
            id: "mtg_ready",
            title: "体验交流会",
            status: "pending_approval",
            meetingMode: "online",
            location: "线上",
            joinUrl: "https://meeting.tencent.com/dm/ready",
            externalMeetingCode: "137 883 890",
            agenda: ["主流程"],
            attendees: [{ userId: "市场助手" }],
          },
          confirmation: {
            proposalId: "mcp_ready",
            confirmationToken: "secret-token",
            payloadHash: "h",
            expiresAtMs: Date.now() + 120_000,
          },
          confirmationDetail: {
            title: "体验交流会",
            impact: "确认后发送给 1 位参会人，并写入你的日程",
            irreversible: false,
            expiresAtMs: Date.now() + 120_000,
          },
          message: "请确认会议范本",
        },
        meetingConfirmationLoading: false,
        meetingConfirmationError: null,
        onConfirmMeetingPendingApproval: vi.fn(async () => undefined),
        onCancelMeetingPendingConfirmation: vi.fn(),
      })}`,
      container,
    );
    await Promise.resolve();
    expect(container.textContent).toContain("确认发送会议");
    expect(container.textContent).toContain("确认后发送给 1 位参会人");
    expect(container.textContent).not.toContain("链接：https://meeting.tencent.com/dm/ready");
    expect(container.textContent).not.toContain("会议号：137 883 890");
    expect(container.textContent).not.toContain("参会人：市场助手");
    expect(container.textContent).not.toContain("议程");
    expect(container.textContent).not.toContain("secret-token");
    expect(container.querySelector(".employee-workbench__meeting-notice")).toBeNull();
    expect(container.querySelector('[data-confirm-chrome="thin"]')).not.toBeNull();
    const confirmBtn = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("确认发送"),
    );
    expect(confirmBtn).toBeTruthy();
  });

  it("renders an enriched confirmation card with impact/permission/irreversible/expiry (Phase 8.4)", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      html`<div class="chat-thread">
        ${renderDaibaiThreadPrelude(
          {
            daibaiLoading: false,
            daibaiAskResult: null,
            daibaiExecuteResult: null,
            daibaiActionLoading: false,
            daibaiActionPendingId: null,
            daibaiActionError: null,
            daibaiPendingConfirmation: {
              actionId: "robot-skills.remove",
              confirmation: {
                proposalId: "dbc_1",
                confirmationToken: "tok",
                payloadHash: "h",
                expiresAtMs: Date.now() + 300000,
              },
              message: "请确认是否执行：卸载机器人技能。",
              detail: {
                title: "卸载机器人技能",
                impact: "从该机器人移除某个技能",
                secondaryPermission: "usage:budget",
                irreversible: true,
                expiresAtMs: Date.now() + 300000,
              },
            },
            onAskDaibai: vi.fn(async () => undefined),
            onExecuteDaibaiAction: vi.fn(async () => undefined),
            onConfirmDaibaiPendingAction: vi.fn(async () => undefined),
            onCancelDaibaiPendingConfirmation: vi.fn(),
          },
          { guideAcknowledged: true, onDismissGuide: vi.fn() },
        )}
      </div>`,
      container,
    );
    await Promise.resolve();
    const group = container.querySelector(".employee-workbench__steward-confirm-card");
    expect(group?.getAttribute("role")).toBe("group");
    expect(group?.classList.contains("is-danger")).toBe(true);
    expect(container.textContent).toContain("影响范围");
    expect(container.textContent).toContain("从该机器人移除某个技能");
    expect(container.textContent).toContain("usage:budget");
    expect(container.textContent).toContain("不可逆");
    // Confirm button text carries the action verb (a11y).
    expect(container.textContent).toContain("确认执行（不可逆）：卸载机器人技能");
    expect(container.textContent).toContain("取消，不执行");
  });

  it("does not render canned read suggestion cards when only route metadata is present (D2)", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      html`<div class="chat-thread">
        ${renderDaibaiThreadPrelude(
          {
            daibaiLoading: false,
            daibaiAskResult: {
              summary: "我可以帮你查询。",
              suggestedActions: [],
              route: {
                tier: "self_serve",
                domain: "billing",
                readPayload: {
                  recommendedMethod: "billing.dashboard",
                  description: "我可以帮你查看当前的用量与预算情况。",
                },
                suggestedActions: [],
              },
            },
            daibaiExecuteResult: null,
            daibaiActionLoading: false,
            daibaiActionPendingId: null,
            daibaiActionError: null,
            onAskDaibai: vi.fn(async () => undefined),
            onExecuteDaibaiAction: vi.fn(async () => undefined),
          },
          { guideAcknowledged: true, onDismissGuide: vi.fn() },
        )}
      </div>`,
      container,
    );
    await Promise.resolve();
    expect(container.textContent).not.toContain("我可以帮你直接查询");
    expect(container.textContent).not.toContain("billing.dashboard");
    expect(container.querySelector(".employee-workbench__steward-read-card")).toBeNull();
    expect(container.querySelector(".employee-workbench__assistant-prelude")).toBeNull();
  });

  it("hides empty support context metrics", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      html`<div class="chat-thread">
        ${renderDaibaiThreadPrelude(
          {
            daibaiLoading: false,
            daibaiAskResult: {
              summary: "我可以继续帮你处理。",
              supportContext: {
                openCaseCount: 0,
                waitingOnUserCount: 0,
                latestCase: null,
                cases: [],
              },
              suggestedActions: [],
            },
            daibaiExecuteResult: null,
            daibaiActionLoading: false,
            daibaiActionPendingId: null,
            daibaiActionError: null,
            onAskDaibai: vi.fn(async () => undefined),
            onExecuteDaibaiAction: vi.fn(async () => undefined),
          },
          { guideAcknowledged: true, onDismissGuide: vi.fn() },
        )}
      </div>`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).not.toContain("我可以继续帮你处理。");
    expect(container.textContent).not.toContain("开放支持单");
    expect(container.querySelector(".employee-workbench__assistant-prelude-metric")).toBeNull();
  });

  it("does not render guide snapshot or read cards when guide and route coexist (D2)", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      html`<div class="chat-thread">
        ${renderDaibaiThreadPrelude(
          {
            daibaiLoading: false,
            daibaiAskResult: {
              summary: "我可以帮你查询。",
              suggestedActions: [],
              guide: {
                headline: "你现在有 2 个可用能力；我可以帮你查询、代办或在需要时升级平台。",
                availableNow: [],
                recommendations: [],
                nextSteps: ["遇到问题可随时让我整理成支持单，转给平台技术人员。"],
                stewardActions: [],
              },
              route: {
                tier: "self_serve",
                domain: "billing",
                readPayload: {
                  recommendedMethod: "billing.dashboard",
                  description: "我可以帮你查看当前的用量与预算情况。",
                },
                suggestedActions: [],
              },
            },
            daibaiExecuteResult: null,
            daibaiActionLoading: false,
            daibaiActionPendingId: null,
            daibaiActionError: null,
            onAskDaibai: vi.fn(async () => undefined),
            onExecuteDaibaiAction: vi.fn(async () => undefined),
          },
          { guideAcknowledged: true, onDismissGuide: vi.fn() },
        )}
      </div>`,
      container,
    );
    await Promise.resolve();
    expect(container.textContent).not.toContain("我可以帮你直接查询");
    expect(container.textContent).not.toContain("能力引导");
    expect(container.textContent).not.toContain("遇到问题可随时让我整理成支持单");
    expect(container.querySelector(".employee-workbench__assistant-prelude")).toBeNull();
  });

  it("does not render canned guide snapshot when ask result has no prelude chips (D2)", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      html`<div class="chat-thread">
        ${renderDaibaiThreadPrelude(
          {
            daibaiLoading: false,
            daibaiAskResult: {
              summary: "我可以带你熟悉平台能力。",
              suggestedActions: [],
              guide: {
                headline: "我可以带你熟悉平台能力，并在授权范围内代你处理常见操作。",
                availableNow: [],
                recommendations: [],
                nextSteps: ["当前还没有安装能力，可以从推荐列表挑选一个开始。"],
                stewardActions: [],
              },
              route: {
                tier: "assisted_action",
                suggestedActions: [],
              },
            },
            daibaiExecuteResult: null,
            daibaiActionLoading: false,
            daibaiActionPendingId: null,
            daibaiActionError: null,
            onAskDaibai: vi.fn(async () => undefined),
            onExecuteDaibaiAction: vi.fn(async () => undefined),
          },
          { guideAcknowledged: true, onDismissGuide: vi.fn() },
        )}
      </div>`,
      container,
    );
    await Promise.resolve();
    expect(container.textContent).not.toContain("能力引导");
    expect(container.textContent).not.toContain("当前还没有安装能力");
    expect(container.querySelector(".employee-workbench__assistant-prelude")).toBeNull();
  });

  it("hides the guide prelude after the user has acknowledged it", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`<div class="chat-thread">
        ${renderDaibaiThreadPrelude(
          {
            daibaiLoading: false,
            daibaiAskResult: null,
            daibaiExecuteResult: null,
            daibaiActionLoading: false,
            daibaiActionPendingId: null,
            daibaiActionError: null,
            onAskDaibai: vi.fn(async () => undefined),
            onExecuteDaibaiAction: vi.fn(async () => undefined),
          },
          {
            guideAcknowledged: true,
            onDismissGuide: vi.fn(),
          },
        )}
      </div>`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent?.trim()).toBe("");
  });

  it("renders personal settings as a real preference surface without legacy signal rows", async () => {
    const previousLocale = i18n.getLocale();
    await i18n.setLocale("zh-CN");
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          settingsView: "personal",
          userProfileName: "UPBEYOND",
          userProfileSignature: "openbot",
          tenantLabel: "upbeyond-91aeea3c",
          currentSeatTitle: "Sales Lead",
          currentSeatStatus: "occupied",
          currentSeatStatusLabel: "在岗",
          defaultAgentId: "main",
          defaultAgentLabel: "主秘书",
          robotTeamLabels: ["主秘书", "市场助手"],
          defaultSpaceIds: ["space-alpha", "space-beta"],
          defaultSpaceLabels: ["Alpha 小组", "Beta 小组"],
          defaultWorkspaceRoot: "/Users/daniel/.openbot/workspace",
          workspaceNotice: "Seat is ready.",
          chatFocusMode: true,
          chatShowThinking: false,
        }),
        createShellModel({
          primaryModule: "settings",
          selectedAssistantItem: null,
          selectedSpaceItem: null,
          headerTitle: "",
        }),
        createHomeModel(),
        false,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__stage-head")).toBeNull();
    expect(container.textContent).toContain("upbeyond-91aeea3c");
    expect(container.textContent).toContain("Sales Lead");
    expect(container.textContent).toContain("在岗");
    expect(container.textContent).toContain("主秘书");
    expect(container.textContent).toContain("市场助手");
    expect(container.textContent).toContain("Alpha 小组");
    expect(container.textContent).toContain("Beta 小组");
    expect(container.textContent).not.toContain("space-alpha");
    expect(container.textContent).not.toContain("occupied");
    expect(container.textContent).toContain("Seat is ready.");
    const inputs = container.querySelectorAll<HTMLInputElement>(
      ".employee-workbench__settings-input",
    );
    expect(inputs[0]?.value).toBe("UPBEYOND");
    expect(inputs[1]?.value).toBe("openbot");
    expect(container.querySelector(".employee-workbench__module-signals")).toBeNull();
    expect(container.querySelector(".employee-workbench__settings-logout")).toBeNull();
    expect(container.textContent).not.toContain("Allocation rule");
    expect(container.querySelectorAll(".employee-workbench__settings-toggle")).toHaveLength(0);
    expect(container.querySelectorAll(".employee-workbench__settings-tab")).toHaveLength(6);
    expect(container.querySelector(".employee-workbench__personal-settings-tabs")).not.toBeNull();
    expect(container.querySelector(".employee-workbench__personal-settings-rail")).toBeNull();
    expect(container.textContent).toContain("数据与备份");
    const tabLabels = Array.from(
      container.querySelectorAll(".employee-workbench__settings-tab"),
    ).map((el) => el.textContent?.trim() ?? "");
    expect(tabLabels).toContain("设备与硬件");
    expect(tabLabels).toContain("数据与备份");
    expect(tabLabels).not.toContain("高级");
    await i18n.setLocale(previousLocale);
  });

  it("renders pending seat offer actions inside personal settings", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onAcceptPendingSeatOffer = vi.fn(async () => undefined);
    const onDeclinePendingSeatOffer = vi.fn(async () => undefined);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          settingsView: "personal",
          pendingSeatOffer: {
            offerId: "offer-1",
            seatTitle: "Sales Lead",
            defaultAgentId: "agent-sales",
            defaultAgentLabel: "销售助手",
            agentToolLabels: ["销售助手"],
            defaultSpaceIds: ["space-alpha"],
            defaultSpaceLabels: ["Alpha 小组"],
            reauthorizationRequired: true,
            offeredAt: "2026-04-20T00:00:00.000Z",
          },
          pendingSeatOfferBusy: false,
          pendingSeatOfferError: null,
          pendingSeatOfferNotice: "请确认岗位绑定。",
          onAcceptPendingSeatOffer,
          onDeclinePendingSeatOffer,
        }),
        createShellModel({
          primaryModule: "settings",
          selectedAssistantItem: null,
          selectedSpaceItem: null,
          headerTitle: "",
        }),
        createHomeModel(),
        false,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Pending seat assignment");
    expect(container.textContent).toContain("Sales Lead");
    expect(container.textContent).toContain("销售助手");
    expect(container.textContent).toContain("Alpha 小组");
    expect(container.textContent).not.toContain("agent-sales");
    expect(container.textContent).not.toContain("space-alpha");
    expect(container.textContent).toContain("请确认岗位绑定。");
    expect(container.textContent).toContain("需要你重新确认或授权");

    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("Accept assignment"))
      ?.click();
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("Decline assignment"))
      ?.click();

    expect(onAcceptPendingSeatOffer).toHaveBeenCalledWith("offer-1");
    expect(onDeclinePendingSeatOffer).toHaveBeenCalledWith("offer-1");
  });

  it("renders operational identity in personal settings without deferred catalog clutter", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          settingsView: "personal",
          personalSettingsTab: "authorization",
          platformAuthEnabled: true,
          userOperationalIdentityNav: "bound",
          userOperationalIdentitySnapshot: {
            identities: [
              {
                identityId: "id-1",
                provider: "github-personal",
                providerLabel: "GitHub",
                displayName: "My GitHub",
                status: "active",
                grantCount: 1,
                createdAt: "2026-06-06T00:00:00.000Z",
                updatedAt: "2026-06-06T00:00:00.000Z",
              },
            ],
            grants: [
              {
                grantId: "grant-1",
                identityId: "id-1",
                agentId: "main",
                agentScope: "shared",
                allowedActions: ["create_issue"],
                grantMode: "explicit",
                status: "active",
                confirmedAt: "2026-06-06T00:00:00.000Z",
              },
            ],
            usageHistory: [
              {
                eventId: "evt-1",
                agentId: "main",
                identityId: "id-1",
                provider: "github-personal",
                action: "create_issue",
                result: "allowed",
                createdAt: "2026-06-06T00:00:00.000Z",
              },
            ],
            providerCatalog: [
              {
                provider: "github-personal",
                label: "GitHub",
                category: "developer",
                rolloutTier: "pilot",
                registrationReady: true,
                operationalActions: [{ action: "create_issue", label: "创建 Issue" }],
                reauthHint: "",
                degradedHint: null,
              },
              {
                provider: "feishu-personal",
                label: "飞书个人账号",
                category: "communication",
                rolloutTier: "deferred",
                registrationReady: false,
                operationalActions: [],
                reauthHint: "",
                degradedHint: "暂不支持绑定",
              },
            ],
            pendingBindingRequests: [],
          },
        }),
        createShellModel({
          primaryModule: "settings",
          selectedAssistantItem: null,
          selectedSpaceItem: null,
          headerTitle: "",
        }),
        createHomeModel(),
        false,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__auth-split")).not.toBeNull();
    expect(container.textContent).toContain("My GitHub");
    expect(container.textContent).toContain("GitHub");
    expect(container.textContent).not.toContain("暂未开放");
    expect(container.textContent).not.toContain("飞书个人账号");
    expect(container.textContent).toContain("已绑定");
    expect(container.textContent).not.toContain("授权管理");
    expect(container.textContent).toContain("身份 1");
    expect(container.querySelector(".employee-workbench__identity-card")).not.toBeNull();
  });

  it("shows assistant binding banner when pending operational identity requests exist", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onOpenUserOperationalIdentityBindingFlow = vi.fn();

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          chatContent: html`
            <div class="chat">thread</div>
          `,
          chatComposer: html`
            <div class="composer">composer</div>
          `,
          userOperationalIdentitySnapshot: {
            identities: [],
            grants: [],
            usageHistory: [],
            providerCatalog: [],
            pendingBindingRequests: [
              {
                requestId: "req-1",
                agentId: "main",
                agentScope: "owned",
                provider: "github-personal",
                requestedAction: "create_issue",
                status: "pending",
                sessionKey: "agent:main:main",
                createdAt: "2026-06-06T00:00:00.000Z",
                expiresAt: "2026-06-06T01:00:00.000Z",
              },
            ],
          },
          onOpenUserOperationalIdentityBindingFlow,
        }),
        createShellModel({
          primaryModule: "assistant",
          selectedAssistantItem: { title: "Main", selectionKey: "main" },
          selectedSpaceItem: null,
          headerTitle: "Assistant",
        }),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("去绑定");
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("去绑定"))
      ?.click();
    expect(onOpenUserOperationalIdentityBindingFlow).toHaveBeenCalled();
  });

  it("treats operational identity as the employee-facing personal channel binding surface", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          settingsView: "personal",
          personalSettingsTab: "authorization",
          platformAuthEnabled: true,
          userOperationalIdentityNav: "grants",
          userOperationalIdentitySnapshot: {
            identities: [],
            grants: [],
            usageHistory: [],
            providerCatalog: [
              {
                provider: "wecom",
                label: "企业微信",
                category: "communication",
                rolloutTier: "pilot",
                registrationReady: true,
                operationalActions: [{ action: "send_message", label: "发送消息" }],
                reauthHint: "",
                degradedHint: null,
              },
            ],
            pendingBindingRequests: [
              {
                requestId: "req-bind-1",
                agentId: "sales-bot",
                agentScope: "owned",
                provider: "wecom",
                requestedAction: "send_message",
                status: "pending",
                createdAt: "2026-06-09T00:00:00.000Z",
                expiresAt: "2026-06-10T00:00:00.000Z",
              },
            ],
          },
        }),
        createShellModel({
          primaryModule: "settings",
          selectedAssistantItem: null,
          selectedSpaceItem: null,
          headerTitle: "",
        }),
        createHomeModel(),
        false,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__auth-split")).not.toBeNull();
    expect(container.textContent).toContain("待绑定请求");
    expect(container.textContent).toContain("wecom");
    expect(container.textContent).toContain("企业微信");
    expect(container.textContent).not.toContain("corpId");
    expect(container.textContent).not.toContain("secret");
  });

  it("shows personal wechat OA credential fields via left nav without provider dropdown", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          settingsView: "personal",
          personalSettingsTab: "authorization",
          platformAuthEnabled: true,
          connected: true,
          userOperationalIdentityNav: "add:wechat-official",
          userOperationalIdentityEditorOpen: true,
          userOperationalIdentityEditorProvider: "wechat-official",
          userOperationalIdentityEditorDisplayName: "我的订阅号",
          userOperationalIdentitySnapshot: {
            identities: [],
            grants: [],
            usageHistory: [],
            gatewayEgressIp: "203.0.113.10",
            providerCatalog: [
              {
                provider: "github-personal",
                label: "GitHub",
                category: "developer",
                rolloutTier: "pilot",
                registrationReady: true,
                authMode: "oauth",
                operationalActions: [],
                reauthHint: "",
                degradedHint: null,
              },
              {
                provider: "wechat-official",
                label: "微信公众号",
                category: "official",
                rolloutTier: "pilot",
                registrationReady: true,
                authMode: "manual",
                manualKind: "wechat_oa",
                operationalActions: [{ action: "publish_draft", label: "创建草稿" }],
                reauthHint: "请在微信公众平台刷新 AppSecret，并重新绑定公众号凭证。",
                degradedHint: null,
              },
              {
                provider: "zhihu",
                label: "知乎",
                category: "social",
                rolloutTier: "pilot",
                registrationReady: true,
                authMode: "manual",
                manualKind: "social_account",
                operationalActions: [],
                reauthHint: "",
                degradedHint: null,
              },
              {
                provider: "feishu-personal",
                label: "飞书个人账号",
                category: "communication",
                rolloutTier: "deferred",
                registrationReady: false,
                authMode: "oauth",
                operationalActions: [],
                reauthHint: "",
                degradedHint: "暂不支持绑定",
              },
              {
                provider: "x-twitter",
                label: "X",
                category: "social",
                rolloutTier: "deferred",
                registrationReady: false,
                authMode: "manual",
                manualKind: "social_account",
                operationalActions: [],
                reauthHint: "",
                degradedHint: null,
              },
            ],
            pendingBindingRequests: [],
          },
        }),
        createShellModel({
          primaryModule: "settings",
          selectedAssistantItem: null,
          selectedSpaceItem: null,
          headerTitle: "",
        }),
        createHomeModel(),
        false,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__auth-split")).not.toBeNull();
    expect(container.querySelector(".employee-workbench__auth-split-nav")).not.toBeNull();
    expect(container.textContent).toContain("微信公众号");
    expect(container.textContent).not.toContain("官方账号");
    expect(container.textContent).not.toContain("开发身份");
    expect(container.textContent).not.toContain("社交账号");
    expect(container.textContent).not.toContain("添加身份");
    expect(container.querySelector(".employee-workbench__auth-nav-category")).not.toBeNull();
    expect(container.textContent).toContain("GitHub");
    expect(container.textContent).not.toContain("GitHub（个人）");
    expect(container.textContent).toContain("知乎");
    expect(container.textContent).toContain("AppID");
    expect(container.textContent).toContain("AppSecret");
    expect(container.textContent).toContain("IP");
    expect(container.textContent).toContain("203.0.113.10");
    expect(container.textContent).not.toContain("个人微信");
    expect(container.textContent).not.toContain("创建草稿");
    expect(container.textContent).not.toContain("请在微信公众平台刷新");
    expect(container.textContent).toContain("添加并认证");
    expect(container.textContent).not.toContain("OAuth 绑定");
    expect(container.textContent).not.toContain("选择身份类型");
    expect(container.querySelectorAll("select").length).toBe(0);
    expect(container.textContent).not.toContain("暂未开放");
    expect(container.textContent).not.toContain("飞书个人账号");
    const navLabels = Array.from(
      container.querySelectorAll(".employee-workbench__auth-nav-item"),
    ).map((item) => item.textContent?.trim() ?? "");
    expect(navLabels).toEqual(expect.arrayContaining(["微信公众号", "GitHub", "知乎"]));
    expect(navLabels).not.toContain("X");
    expect(navLabels).not.toContain("飞书个人账号");
    expect(navLabels).not.toContain("可用模型");
    expect(navLabels).not.toContain("已绑定");
    const navCategoryLabels = Array.from(
      container.querySelectorAll(".employee-workbench__auth-nav-category"),
    ).map((item) => item.textContent?.trim() ?? "");
    expect(navCategoryLabels).toEqual(["绑定账户"]);
  });

  it("shows identity grant checkboxes on configured provider hub", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onApplyIdentityRobotGrants = vi.fn();

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          settingsView: "personal",
          personalSettingsTab: "authorization",
          platformAuthEnabled: true,
          connected: true,
          userOperationalIdentityNav: "add:personal-email",
          robotEntries: [
            {
              id: "main",
              sessionKey: "agent:main:main",
              name: "大白管家",
              emoji: "🤖",
              source: "owned",
              status: "running",
              shareStatus: "private",
              workspaceState: "configured",
              lastActiveAt: Date.now() - 60 * 1000,
            },
          ],
          onApplyIdentityRobotGrants,
          userOperationalIdentitySnapshot: {
            identities: [
              {
                identityId: "id-email",
                provider: "personal-email",
                providerLabel: "个人邮箱",
                displayName: "个人邮箱",
                status: "active",
                grantCount: 0,
                externalAccountId: "ceo@example.com",
                createdAt: "2026-08-01T00:00:00.000Z",
                updatedAt: "2026-08-01T00:00:00.000Z",
              },
            ],
            grants: [],
            usageHistory: [],
            providerCatalog: [
              {
                provider: "personal-email",
                label: "个人邮箱",
                category: "communication",
                rolloutTier: "ga",
                registrationReady: true,
                operationalActions: [{ action: "send_email", label: "发信" }],
                reauthHint: "",
                degradedHint: null,
              },
            ],
            pendingBindingRequests: [],
          },
        }),
        createShellModel({
          primaryModule: "settings",
          selectedAssistantItem: null,
          selectedSpaceItem: null,
          headerTitle: "",
        }),
        createHomeModel(),
        false,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__identity-hub")).not.toBeNull();
    const grantPanel = container.querySelector(
      ".employee-workbench__identity-robot-binding--grant-panel",
    );
    expect(grantPanel).not.toBeNull();
    expect(grantPanel?.tagName.toLowerCase()).toBe("section");
    expect(container.querySelector("details[data-identity-grant]")).toBeNull();
    expect(grantPanel?.querySelector(".employee-workbench__settings-section-subtitle")).toBeNull();
    expect(grantPanel?.querySelector(".employee-workbench__identity-grant-copy")).not.toBeNull();
    expect(container.textContent).toContain("数字人授权");
    expect(container.textContent).toContain("勾选要使用该账户的数字人");
    expect(container.textContent).toContain("大白管家");
    expect(grantPanel?.querySelector("[data-identity-grant-robots]")).not.toBeNull();
    const checkbox = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"][data-owned-robot-id="main"]',
    );
    expect(checkbox).not.toBeNull();
    checkbox!.checked = true;
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("保存授权"))
      ?.click();
    expect(onApplyIdentityRobotGrants).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: "id-email",
        desiredAgentIds: ["main"],
      }),
    );
  });

  it("shows identity grant checkboxes on configured wechat official hub", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onApplyIdentityRobotGrants = vi.fn();

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          settingsView: "personal",
          personalSettingsTab: "authorization",
          platformAuthEnabled: true,
          connected: true,
          userOperationalIdentityNav: "add:wechat-official",
          robotEntries: [
            {
              id: "main",
              sessionKey: "agent:main:main",
              name: "大白管家",
              emoji: "🤖",
              source: "owned",
              status: "running",
              shareStatus: "private",
              workspaceState: "configured",
              lastActiveAt: Date.now() - 60 * 1000,
            },
          ],
          onApplyIdentityRobotGrants,
          userOperationalIdentitySnapshot: {
            identities: [
              {
                identityId: "id-wx",
                provider: "wechat-official",
                providerLabel: "微信公众号",
                displayName: "微信公众号",
                status: "active",
                grantCount: 0,
                externalAccountId: "wxd207818832a76a211",
                createdAt: "2026-08-01T00:00:00.000Z",
                updatedAt: "2026-08-01T00:00:00.000Z",
              },
            ],
            grants: [],
            usageHistory: [],
            providerCatalog: [
              {
                provider: "wechat-official",
                label: "微信公众号",
                category: "official",
                rolloutTier: "pilot",
                registrationReady: true,
                authMode: "manual",
                manualKind: "wechat_oa",
                operationalActions: [{ action: "publish_draft", label: "创建草稿" }],
                reauthHint: "",
                degradedHint: null,
              },
            ],
            pendingBindingRequests: [],
          },
        }),
        createShellModel({
          primaryModule: "settings",
          selectedAssistantItem: null,
          selectedSpaceItem: null,
          headerTitle: "",
        }),
        createHomeModel(),
        false,
      )}`,
      container,
    );
    await Promise.resolve();

    const grantPanel = container.querySelector(
      ".employee-workbench__identity-robot-binding--grant-panel",
    );
    expect(grantPanel).not.toBeNull();
    expect(grantPanel?.querySelector(".employee-workbench__settings-section-subtitle")).toBeNull();
    expect(
      grantPanel?.querySelector(".employee-workbench__identity-grant-copy")?.textContent,
    ).toContain("勾选要使用该账户的数字人");
    expect(grantPanel?.querySelector("[data-identity-grant-robots]")).not.toBeNull();
    const checkbox = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"][data-owned-robot-id="main"]',
    );
    expect(checkbox).not.toBeNull();
    checkbox!.checked = true;
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("保存授权"))
      ?.click();
    expect(onApplyIdentityRobotGrants).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: "id-wx",
        desiredAgentIds: ["main"],
      }),
    );
  });

  it("keeps identity grant empty-state copy visible when no owned robots", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          settingsView: "personal",
          personalSettingsTab: "authorization",
          platformAuthEnabled: true,
          connected: true,
          userOperationalIdentityNav: "add:wechat-official",
          robotEntries: [],
          userOperationalIdentitySnapshot: {
            identities: [
              {
                identityId: "id-wx",
                provider: "wechat-official",
                providerLabel: "微信公众号",
                displayName: "微信公众号",
                status: "active",
                grantCount: 0,
                externalAccountId: "wxd207818832a76a211",
                createdAt: "2026-08-01T00:00:00.000Z",
                updatedAt: "2026-08-01T00:00:00.000Z",
              },
            ],
            grants: [],
            usageHistory: [],
            providerCatalog: [
              {
                provider: "wechat-official",
                label: "微信公众号",
                category: "official",
                rolloutTier: "pilot",
                registrationReady: true,
                operationalActions: [{ action: "publish_draft", label: "创建草稿" }],
                reauthHint: "",
                degradedHint: null,
              },
            ],
            pendingBindingRequests: [],
          },
        }),
        createShellModel({
          primaryModule: "settings",
          selectedAssistantItem: null,
          selectedSpaceItem: null,
          headerTitle: "",
        }),
        createHomeModel(),
        false,
      )}`,
      container,
    );
    await Promise.resolve();

    const grantPanel = container.querySelector(
      ".employee-workbench__identity-robot-binding--grant-panel",
    );
    expect(grantPanel).not.toBeNull();
    expect(grantPanel?.querySelector(".employee-workbench__settings-section-subtitle")).toBeNull();
    expect(
      grantPanel?.querySelector(".employee-workbench__identity-grant-copy")?.textContent,
    ).toContain("请先创建自有数字人");
    expect(container.querySelector('input[type="checkbox"][data-owned-robot-id]')).toBeNull();
    expect(
      Array.from(container.querySelectorAll("button")).some((button) =>
        button.textContent?.includes("保存授权"),
      ),
    ).toBe(false);
  });

  it("shows personal email SMTP credential fields", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          settingsView: "personal",
          personalSettingsTab: "authorization",
          platformAuthEnabled: true,
          connected: true,
          userOperationalIdentityNav: "add:personal-email",
          userOperationalIdentityEditorOpen: true,
          userOperationalIdentityEditorProvider: "personal-email",
          userOperationalIdentityEditorDisplayName: "个人邮箱",
          userOperationalIdentityEditorUsePlatformSmtp: false,
          userOperationalIdentitySnapshot: {
            identities: [],
            grants: [],
            usageHistory: [],
            platformSmtpConfigured: false,
            providerCatalog: [
              {
                provider: "personal-email",
                label: "个人邮箱",
                category: "communication",
                rolloutTier: "pilot",
                registrationReady: true,
                authMode: "manual",
                manualKind: "smtp",
                operationalActions: [],
                reauthHint: "",
                degradedHint: null,
              },
            ],
            pendingBindingRequests: [],
          },
        }),
        createShellModel({
          primaryModule: "settings",
          selectedAssistantItem: null,
          selectedSpaceItem: null,
          headerTitle: "",
        }),
        createHomeModel(),
        false,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("个人邮箱");
    expect(container.textContent).toContain("发件邮箱");
    expect(container.textContent).toContain("SMTP 主机");
    expect(container.textContent).toContain("SMTP 授权码");
    expect(container.textContent).toContain("添加并认证");
    expect(container.textContent).not.toContain("可用动作");
    expect(container.textContent).not.toContain("请更新 SMTP");
    expect(container.textContent).not.toContain("对外发送时使用的 From");
    expect(container.textContent).not.toContain("OAuth 绑定");
    expect(container.textContent).not.toContain("选择身份类型");
  });

  it("shows social account credential fields for xiaohongshu", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          settingsView: "personal",
          personalSettingsTab: "authorization",
          platformAuthEnabled: true,
          connected: true,
          userOperationalIdentityNav: "add:xiaohongshu",
          userOperationalIdentityEditorOpen: true,
          userOperationalIdentityEditorProvider: "xiaohongshu",
          userOperationalIdentityEditorDisplayName: "我的小红书",
          userOperationalIdentitySnapshot: {
            identities: [],
            grants: [],
            usageHistory: [],
            providerCatalog: [
              {
                provider: "xiaohongshu",
                label: "小红书",
                category: "social",
                rolloutTier: "pilot",
                registrationReady: true,
                authMode: "manual",
                manualKind: "social_account",
                operationalActions: [],
                reauthHint: "",
                degradedHint: null,
              },
              {
                provider: "weibo",
                label: "微博",
                category: "social",
                rolloutTier: "pilot",
                registrationReady: true,
                authMode: "manual",
                manualKind: "social_account",
                operationalActions: [],
                reauthHint: "",
                degradedHint: null,
              },
              {
                provider: "kuaishou",
                label: "快手",
                category: "social",
                rolloutTier: "pilot",
                registrationReady: true,
                authMode: "manual",
                manualKind: "social_account",
                operationalActions: [],
                reauthHint: "",
                degradedHint: null,
              },
            ],
            pendingBindingRequests: [],
          },
        }),
        createShellModel({
          primaryModule: "settings",
          selectedAssistantItem: null,
          selectedSpaceItem: null,
          headerTitle: "",
        }),
        createHomeModel(),
        false,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("小红书号");
    expect(container.textContent).toContain("Cookie / 密钥");
    expect(container.textContent).toContain("添加并认证");
    expect(container.textContent).not.toContain("AppID");
    expect(container.textContent).not.toContain("SMTP 主机");
    const navLabels = Array.from(
      container.querySelectorAll(".employee-workbench__auth-nav-item"),
    ).map((item) => item.textContent?.trim() ?? "");
    expect(navLabels).toEqual(expect.arrayContaining(["小红书", "微博", "快手"]));
    expect(container.querySelectorAll("select").length).toBe(0);
  });

  it("shows verify credentials action on bound personal wechat OA card", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onVerify = vi.fn();

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          settingsView: "personal",
          personalSettingsTab: "authorization",
          platformAuthEnabled: true,
          connected: true,
          onVerifyUserOperationalIdentityCredentials: onVerify,
          userOperationalIdentityNav: "bound",
          userOperationalIdentitySnapshot: {
            identities: [
              {
                identityId: "id-oa-1",
                provider: "wechat-official",
                providerLabel: "微信公众号",
                displayName: "我的订阅号",
                externalAccountId: "wx1234567890abcdef",
                status: "active",
                grantCount: 0,
                createdAt: "2026-07-26T00:00:00.000Z",
                updatedAt: "2026-07-26T00:00:00.000Z",
              },
            ],
            grants: [],
            usageHistory: [],
            gatewayEgressIp: "203.0.113.10",
            providerCatalog: [
              {
                provider: "wechat-official",
                label: "微信公众号",
                category: "official",
                rolloutTier: "pilot",
                registrationReady: true,
                authMode: "manual",
                manualKind: "wechat_oa",
                operationalActions: [{ action: "verify_credentials", label: "验证凭证" }],
                reauthHint: "",
                degradedHint: null,
              },
            ],
            pendingBindingRequests: [],
          },
        }),
        createShellModel({
          primaryModule: "settings",
          selectedAssistantItem: null,
          selectedSpaceItem: null,
          headerTitle: "",
        }),
        createHomeModel(),
        false,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("我的订阅号");
    expect(container.textContent).toContain("验证凭证");
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("验证凭证"))
      ?.click();
    expect(onVerify).toHaveBeenCalledWith("id-oa-1");
  });

  it("shows assistant oauth banner when pending operational identity oauth continuations exist", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onCompleteUserOperationalIdentityOAuthForContinuation = vi.fn();

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          chatContent: html`
            <div class="chat">thread</div>
          `,
          chatComposer: html`
            <div class="composer">composer</div>
          `,
          userOperationalIdentitySnapshot: {
            identities: [],
            grants: [],
            usageHistory: [],
            providerCatalog: [],
            pendingBindingRequests: [],
            pendingContinuations: [
              {
                continuationId: "cont-1",
                continuationToken: "token-oauth",
                agentId: "main",
                agentScope: "owned",
                provider: "github-personal",
                requestedAction: "create_issue",
                status: "pending_oauth",
                requiredProviders: ["github-personal"],
                completedProviders: ["github-personal"],
                oauthCompletedProviders: [],
                autoResume: true,
                createdAt: "2026-06-06T00:00:00.000Z",
                updatedAt: "2026-06-06T00:00:00.000Z",
                expiresAt: "2026-06-06T01:00:00.000Z",
              },
            ],
          },
          onCompleteUserOperationalIdentityOAuthForContinuation,
        }),
        createShellModel({
          primaryModule: "assistant",
          selectedAssistantItem: { title: "Main", selectionKey: "main" },
          selectedSpaceItem: null,
          headerTitle: "Assistant",
        }),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("完成 OAuth");
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("完成 OAuth"))
      ?.click();
    expect(onCompleteUserOperationalIdentityOAuthForContinuation).toHaveBeenCalledWith({
      continuationToken: "token-oauth",
      provider: "github-personal",
    });
  });

  it("shows assistant binding banner when pending operational identity binding continuations exist", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onOpenUserOperationalIdentityBindingFlow = vi.fn();

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          chatContent: html`
            <div class="chat">thread</div>
          `,
          chatComposer: html`
            <div class="composer">composer</div>
          `,
          userOperationalIdentitySnapshot: {
            identities: [],
            grants: [],
            usageHistory: [],
            providerCatalog: [],
            pendingBindingRequests: [],
            pendingContinuations: [
              {
                continuationId: "cont-2",
                continuationToken: "token-bind",
                agentId: "main",
                agentScope: "owned",
                provider: "github-personal",
                requestedAction: "create_issue",
                status: "pending_binding",
                requiredProviders: ["github-personal"],
                completedProviders: [],
                oauthCompletedProviders: [],
                autoResume: true,
                createdAt: "2026-06-06T00:00:00.000Z",
                updatedAt: "2026-06-06T00:00:00.000Z",
                expiresAt: "2026-06-06T01:00:00.000Z",
              },
            ],
          },
          onOpenUserOperationalIdentityBindingFlow,
        }),
        createShellModel({
          primaryModule: "assistant",
          selectedAssistantItem: { title: "Main", selectionKey: "main" },
          selectedSpaceItem: null,
          headerTitle: "Assistant",
        }),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("去绑定");
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("去绑定"))
      ?.click();
    expect(onOpenUserOperationalIdentityBindingFlow).toHaveBeenCalled();
  });

  it("wires personal settings inputs and preference toggles", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onUserProfileNameChange = vi.fn();
    const onUserProfileSignatureChange = vi.fn();
    const onLocaleChange = vi.fn();
    const onThemeChange = vi.fn();
    const onChatShowThinkingChange = vi.fn();
    const onChatFocusModeChange = vi.fn();

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          settingsView: "personal",
          personalSettingsTab: "preferences",
          userProfileName: "UPBEYOND",
          userProfileSignature: "openbot",
          tenantLabel: "upbeyond-91aeea3c",
          onUserProfileNameChange,
          onUserProfileSignatureChange,
          onLocaleChange,
          onThemeChange,
          onChatShowThinkingChange,
          onChatFocusModeChange,
          currentLocale: "en",
          currentTheme: "system",
          chatFocusMode: false,
          chatShowThinking: true,
        }),
        createShellModel({
          primaryModule: "settings",
          selectedAssistantItem: null,
          selectedSpaceItem: null,
          headerTitle: "",
        }),
        createHomeModel(),
        false,
      )}`,
      container,
    );
    await Promise.resolve();

    const segmentButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".employee-workbench__settings-segment"),
    );
    segmentButtons.find((button) => button.textContent?.includes("English"))?.click();
    segmentButtons.find((button) => button.textContent?.includes("Dark"))?.click();

    const toggles = container.querySelectorAll<HTMLButtonElement>(
      ".employee-workbench__settings-toggle",
    );
    toggles[0]?.click();
    toggles[1]?.click();

    expect(onLocaleChange).toHaveBeenCalledWith("en");
    expect(onThemeChange).toHaveBeenCalledWith("dark");
    expect(onChatShowThinkingChange).toHaveBeenCalledWith(false);
    expect(onChatFocusModeChange).toHaveBeenCalledWith(true);
  });

  it("renders the password change form for platform-auth sessions and wires submit", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onPasswordCurrentChange = vi.fn();
    const onPasswordNewChange = vi.fn();
    const onChangePassword = vi.fn();
    const onOpenForgotPassword = vi.fn();

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          settingsView: "personal",
          personalSettingsTab: "security",
          platformAuthEnabled: true,
          passwordCurrentValue: "current-123",
          passwordNewValue: "next-456789",
          passwordChangeNotice: "密码已更新。",
          onPasswordCurrentChange,
          onPasswordNewChange,
          onChangePassword,
          onOpenForgotPassword,
        }),
        createShellModel({
          primaryModule: "settings",
          selectedAssistantItem: null,
          selectedSpaceItem: null,
          headerTitle: "",
        }),
        createHomeModel(),
        false,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Confirm new password");
    expect(container.textContent).toMatch(/Forgot password|忘记密码/);

    const passwordInputs = container.querySelectorAll<HTMLInputElement>(
      'input[type="password"].employee-workbench__settings-input--password',
    );
    expect(passwordInputs.length).toBeGreaterThanOrEqual(3);
    passwordInputs[2].value = "next-456789";
    passwordInputs[2].dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();

    const toggleButtons = container.querySelectorAll<HTMLButtonElement>(
      ".employee-workbench__settings-password-toggle",
    );
    expect(toggleButtons.length).toBeGreaterThanOrEqual(3);
    toggleButtons[0]?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(container.querySelector<HTMLInputElement>("#workbench-password-current")?.type).toBe(
      "text",
    );

    Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".employee-workbench__settings-password-actions .btn--primary",
      ),
    )
      .find(
        (button) =>
          button.textContent?.includes("更新密码") ||
          button.textContent?.includes("Change password"),
      )
      ?.click();

    expect(onChangePassword).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("密码已更新。");

    Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".employee-workbench__settings-password-forgot",
      ),
    )[0]?.click();
    expect(onOpenForgotPassword).toHaveBeenCalledTimes(1);
  });

  it("renders system settings as security, robots, and groups management", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onSystemSettingsGroupSelect = vi.fn();
    const onSystemSettingsGroupDraftChange = vi.fn();
    const onSaveSystemSettingsGroup = vi.fn();
    const onOpenSystemSettingsGroupMembers = vi.fn();
    const onExportSystemSettingsGroupSummary = vi.fn();
    const onSelectSession = vi.fn();
    const selectedGroupEntry = {
      sessionKey: "space:product",
      title: "产品研发小组",
      avatar: "🛰️",
      groupId: "product",
      groupType: "delivery",
      lifecycleStatus: "active",
      memberCount: 6,
      activeHumanCount: 3,
      activeBotCount: 3,
      pendingHumanInviteCount: 1,
      pendingBotInviteCount: 1,
      role: "owner" as const,
      ownerUserId: "u1",
      ownerLabel: "Alice Zhang",
      adminUserIds: ["u2", "u3"],
      coordinatorBotId: "bot-main",
      coordinatorBotLabel: "Aegis",
      visibilityScope: "tenant",
      purpose: "负责产品与战略协同",
      currentMission: "明确未来一个季度的研发节奏",
      collaborationMode: "review_driven",
      successCriteria: ["季度目标清晰", "职责边界明确"],
      systemInstructions: ["@机器人必须响应", "达到轮次上限后等待人类确认"],
      confidentialityTier: "internal",
      finalDecisionPolicy: {
        mode: "human_required",
        defaultFinalDeciderRole: "owner",
        allowAgentPublishProposal: true,

        openDiscussionWithoutMention: true,

        maxVisibleBotRepliesPerRound: 5,
      },
      rulesSummary: ["@机器人必须响应", "达到轮次上限后等待人类确认"],
      currentOperatingPhase: "decide",
      onboardingInitialized: true,
      policyMaxVisibleBotRepliesPerRound: 3,
      workspacePath: "/tmp/openbot/product",
      members: {
        humans: [{ userId: "u1", name: "Alice Zhang" }],
        bots: [{ agentId: "bot-main", name: "Aegis" }],
      },
      invites: {
        humans: [{ userId: "u4", name: "Bob Li" }],
        bots: [{ agentId: "bot-review", name: "Reviewer" }],
      },
    };
    const selectedGroupDraft = {
      groupId: "product",
      title: "产品研发小组",
      avatar: "🛰️",
      purpose: "负责产品与战略协同",
      currentMission: "明确未来一个季度的研发节奏",
      coordinatorBotId: "bot-main",
      collaborationMode: "review_driven",
      confidentialityTier: "internal",
      visibilityScope: "tenant",
      successCriteriaText: "季度目标清晰\n职责边界明确",
      rulesSummaryText: "@机器人必须响应\n达到轮次上限后等待人类确认",
      finalDecisionMode: "human_required",
      finalDecisionRole: "owner",
      allowAgentPublishProposal: true,

      openDiscussionWithoutMention: true,

      maxVisibleBotRepliesPerRound: 5,
      workspacePath: "/tmp/openbot/product",
    };

    const renderSystemStage = (systemSettingsTab: "security" | "robots" | "groups" | "devices") =>
      render(
        html`${renderWorkbenchStage(
          createStageProps({
            settingsView: "system",
            systemSettingsTab,
            connected: true,
            defaultWorkspaceRoot: "/Users/you/.openbot/workspace",
            recentAccessEntries: [
              {
                key: "agent:main:wechat:direct:alice",
                title: "Alice",
                subtitle: "wechat · direct",
                updatedAt: Date.now() - 2 * 60 * 1000,
              },
            ],
            robotEntries: [
              {
                id: "main",
                sessionKey: "agent:main:main",
                name: "大白管家",
                emoji: "🤖",
                source: "owned",
                status: "running",
                shareStatus: "shared",
                workspaceState: "configured",
                lastActiveAt: Date.now() - 60 * 1000,
              },
            ],
            groupEntries: [selectedGroupEntry],
            selectedGroupEntry,
            selectedGroupDraft,
            onSystemSettingsGroupSelect,
            onSystemSettingsGroupDraftChange,
            onSaveSystemSettingsGroup,
            onOpenSystemSettingsGroupMembers,
            onExportSystemSettingsGroupSummary,
            onSelectSession,
            devicePairingList: {
              pending: [
                {
                  requestId: "req-1",
                  deviceId: "device-pending",
                  displayName: "Daniel 的 iPhone",
                  ts: Date.now() - 5 * 60 * 1000,
                },
              ],
              paired: [
                {
                  deviceId: "device-current",
                  displayName: "Daniel 的 MacBook Pro",
                  clientId: "openbot-mac",
                  tokens: [{ role: "operator", lastUsedAtMs: Date.now() - 60 * 1000 }],
                },
              ],
            },
            devicePairingCurrentDeviceId: "device-current",
            myAccumulationProps: {
              loading: false,
              error: null,
              items: [
                {
                  id: "cap-1",
                  assetType: "capability",
                  name: "客户情绪分析",
                  summary: "分析客户消息中的情绪倾向",
                  health: "运行稳定",
                  shareVisibility: "私有",
                  isDraft: false,
                  versionInfo: {
                    currentVersion: "v1",
                    submittedVersion: null,
                    versionCount: 1,
                  },
                  usageMetrics: {
                    totalUsageCount: 3,
                    robotCount: 1,
                  },
                  recentUpdate: {
                    id: "recap-1",
                    at: Date.now(),
                    headline: "最近更新 · 优化了使用场景说明",
                  },
                  updatedAt: Date.now(),
                  sourceRobotName: "销售助手",
                  usageBrief: {
                    robotCount: 1,
                    lastUsedAt: Date.now(),
                  },
                },
              ],
              selectedCapability: null,
              selectedLoading: false,
              pendingUsageBrief: null,
              pendingUsageBriefIntent: "edit",
              availableTags: ["客户", "分析"],
              availableCategories: ["客户服务"],
              availableSources: ["销售助手"],
              availableShareVisibilities: ["私有", "已共享到协作小组"],
              availableGroups: [{ id: "group-1", name: "销售协作组" }],
              searchQuery: "",
              filterTag: null,
              filterCategory: null,
              filterSource: null,
              filterShareVisibility: null,
              onSearchChange: vi.fn(),
              onFilterTagChange: vi.fn(),
              onFilterCategoryChange: vi.fn(),
              onFilterSourceChange: vi.fn(),
              onFilterShareVisibilityChange: vi.fn(),
              onSelectCapability: vi.fn(),
              onShareToGroup: vi.fn(),
              onPrepareEdit: vi.fn(),
              onPrepareDelete: vi.fn(),
              onConfirmUsageBrief: vi.fn(),
              onCancelUsageBrief: vi.fn(),
              onOpenRobot: vi.fn(),
            },
          }),
          createShellModel({
            primaryModule: "settings",
            selectedAssistantItem: null,
            selectedSpaceItem: null,
            headerTitle: "",
          }),
          createHomeModel(),
          false,
        )}`,
        container,
      );

    renderSystemStage("security");
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__stage-head")).toBeNull();
    expect(container.textContent).toContain("Security and privacy");
    expect(container.textContent).toContain("My robots");
    expect(container.textContent).toContain("My collaboration groups");
    expect(container.textContent).toContain("OpenBot 数据空间");
    expect(container.textContent).not.toContain("更改");
    expect(container.textContent).not.toContain("云端");
    expect(container.textContent).toContain("系统授权");
    expect(container.textContent).toContain("完全磁盘访问权限");
    expect(container.textContent).toContain("辅助功能");
    expect(container.textContent).toContain("自动化");
    expect(container.textContent).toContain("通知");
    expect(container.textContent).toContain("机器人与协作小组分别管理工作区");
    expect(container.textContent).not.toContain("最近访问");
    expect(container.textContent).not.toContain("这里会继续补充数据使用、安全提醒和访问边界说明。");
    expect(container.textContent).not.toContain("协作共享工作区");
    expect(container.textContent).not.toContain("大白管家");
    expect(container.textContent).not.toContain("产品研发小组");
    expect(container.querySelector(".employee-workbench__settings-status-grid--flat")).toBeTruthy();
    expect(
      container.querySelector(".employee-workbench__settings-authorization-list--flat"),
    ).toBeTruthy();
    expect(
      container.querySelector(".employee-workbench__settings-workspace-panel--flat"),
    ).toBeTruthy();

    renderSystemStage("robots");
    await Promise.resolve();

    expect(container.textContent).toContain("大白管家");
    expect(container.textContent).toMatch(/可管理|Manageable/);
    expect(container.textContent).toMatch(
      /分钟前|小时前|刚刚|ago|Available|可用|m ago|just now|近期活跃|Recently active/i,
    );
    expect(container.textContent).not.toContain("治理入口");
    expect(container.textContent).not.toContain("身份治理");
    expect(container.textContent).not.toContain("查看详情");
    expect(container.textContent).not.toContain("你创建并拥有的机器人");
    expect(container.textContent).not.toContain("查看相关能力");
    expect(container.textContent).toContain("进入工作区");
    expect(container.textContent).toContain("身份");
    expect(container.textContent).toContain("运营授权");
    expect(container.querySelector(".wb-bots")).toBeTruthy();
    expect(container.querySelector(".wb-bots__tabs")).toBeTruthy();
    expect(container.querySelector("[data-wb-settings-toolbar]")).toBeTruthy();
    expect(container.querySelector(".employee-workbench__mybot-drawer")).toBeNull();
    expect(container.querySelector("[data-wb-settings-stats]")).toBeNull();

    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("进入工作区"))
      ?.click();
    expect(onSelectSession).toHaveBeenCalledWith("agent:main:main");

    renderSystemStage("groups");
    await Promise.resolve();

    expect(container.textContent).toContain("产品研发小组");
    expect(container.textContent).toContain("基本信息");
    expect(container.textContent).toContain("使命");
    expect(container.textContent).toContain("成员");
    expect(container.textContent).toContain("群治理");
    expect(container.textContent).toContain("开放讨论（无需 @）");
    expect(container.textContent).toContain("每轮最大可见回复");
    expect(container.textContent).toContain("租户内");
    // No legacy duplicated section numbering / vertical segment card chrome.
    expect(container.textContent).not.toContain("一、基本信息 · 基础资料");
    expect(container.textContent).not.toContain("四、群治理 · 决策策略");
    expect(container.textContent).not.toContain("是否必须人类确认");
    expect(container.textContent).not.toContain("管理协作关系、使命与规则");
    expect(container.textContent).not.toContain("名称、身份与协调关系");
    // 使命 section 保留「当前使命」字段；危险操作独立分区
    expect(container.textContent).toContain("当前使命");
    expect(
      Array.from(container.querySelectorAll<HTMLTextAreaElement>("textarea")).some(
        (node) => node.value === "明确未来一个季度的研发节奏",
      ),
    ).toBe(true);
    expect(container.textContent).toContain("危险操作");
    expect(container.querySelector(".wb-groups__danger")).toBeTruthy();
    expect(container.querySelector(".wb-groups")).toBeTruthy();
    expect(container.querySelector(".wb-groups__chips")).toBeTruthy();
    expect(container.querySelector('[data-wb-settings-pilot="groups"]')).toBeTruthy();
    expect(container.querySelector("[data-wb-settings-toolbar]")).toBeTruthy();
    expect(container.querySelector("[data-wb-settings-intro]")).toBeNull();
    expect(container.querySelector(".wb-groups__meta")).toBeNull();
    expect(container.querySelector(".wb-groups__id-line")).toBeNull();
    const sectionTitles = Array.from(
      container.querySelectorAll<HTMLElement>("[data-wb-settings-section]"),
    ).map((node) => node.getAttribute("data-wb-settings-section"));
    expect(sectionTitles).toEqual(["基本信息", "使命", "成员", "群治理"]);
    expect(container.querySelectorAll(".wb-groups__danger")).toHaveLength(1);
    expect(container.querySelectorAll(".wb-groups__chip").length).toBeGreaterThanOrEqual(8);
    expect(container.querySelectorAll(".wb-groups__section").length).toBe(4);
    expect(container.querySelector(".wb-groups__kv")).toBeTruthy();
    expect(container.querySelector(".employee-workbench__settings-status-card")).toBeFalsy();
    expect(container.querySelector(".is-groups-workspace")).toBeTruthy();
    expect(
      Array.from(container.querySelectorAll<HTMLTextAreaElement>("textarea")).map(
        (node) => node.value,
      ),
    ).toEqual(
      expect.arrayContaining([
        "负责产品与战略协同",
        "明确未来一个季度的研发节奏",
        "季度目标清晰\n职责边界明确",
        "@机器人必须响应\n达到轮次上限后等待人类确认",
      ]),
    );

    container.querySelector<HTMLButtonElement>(".wb-groups__row")?.click();
    expect(onSystemSettingsGroupSelect).toHaveBeenCalledWith("product");

    const groupNameInput = container.querySelector<HTMLInputElement>(
      ".wb-groups__stage .employee-workbench__settings-input",
    );
    groupNameInput!.value = "产品研发与运营小组";
    groupNameInput!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onSystemSettingsGroupDraftChange).toHaveBeenCalledWith({
      title: "产品研发与运营小组",
    });

    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("管理成员"))
      ?.click();
    expect(onOpenSystemSettingsGroupMembers).toHaveBeenCalledTimes(1);

    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("导出摘要"))
      ?.click();
    expect(onExportSystemSettingsGroupSummary).toHaveBeenCalledTimes(1);

    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("保存设置"))
      ?.click();
    expect(onSaveSystemSettingsGroup).toHaveBeenCalledTimes(1);

    expect(container.textContent).not.toContain("进入小组");
    expect(container.textContent).not.toContain("未保存修改");

    renderSystemStage("devices");
    await Promise.resolve();

    expect(container.textContent).toContain("我的设备");
    expect(container.textContent).toContain("Daniel 的 MacBook Pro");
    expect(container.textContent).toContain("新设备配对请求");
    expect(container.textContent).toContain("Daniel 的 iPhone");
    expect(container.textContent).toContain("当前");
    // Current device still exposes 移除 so operators can revoke this session.
    const deviceRows = container.querySelectorAll(".employee-workbench__devices-table-row");
    const currentRow = [...deviceRows].find((row) => row.classList.contains("is-current"));
    expect(currentRow?.textContent).toContain("移除");
    expect(container.querySelector(".employee-workbench__devices-table--flat")).toBeTruthy();
    expect(
      container.querySelector(
        ".employee-workbench__devices-panel--alert .employee-workbench__settings-manage-list--flat",
      ),
    ).toBeTruthy();
  });

  it("renders skill save as inline panel in system settings without backdrop", () => {
    const container = document.createElement("div");
    render(
      html`${renderWorkbenchStage(
        createStageProps({
          settingsView: "system",
          systemSettingsTab: "security",
          skillSaveModalOpen: true,
          skillSaveModalFormData: {
            name: "合同审查",
            summary: "检查合同中的风险条款",
            assetType: "capability",
          },
          skillExtractedPreview: {
            suggestedName: "合同审查",
            suggestedSummary: "",
            confidence: 0.82,
            detectedAt: null,
          },
        }),
        createShellModel({ primaryModule: "settings", headerTitle: "系统设置" }),
        createHomeModel(),
        false,
      )}`,
      container,
    );
    expect(container.querySelector(".quick-save-dialog__backdrop")).toBeFalsy();
    expect(container.querySelector(".quick-save-panel")).toBeTruthy();
    expect(container.textContent).toContain("返回我的资产");
    expect(container.querySelector(".employee-workbench__settings-tabs")).toBeFalsy();
  });

  it("authorizes operational identities via the confirm flow from the robot detail (EM-ID-09)", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onApplyRobotIdentityGrants = vi.fn();
    const onApplyRobotEnterpriseIdentities = vi.fn();
    render(
      html`${renderWorkbenchStage(
        createStageProps({
          settingsView: "system",
          systemSettingsTab: "robots",
          connected: true,
          defaultWorkspaceRoot: "/Users/you/.openbot/workspace",
          onApplyRobotIdentityGrants,
          onApplyRobotEnterpriseIdentities,
          myBotDetail: {
            agentId: "main",
            loading: false,
            saving: false,
            error: null,
            bot: null,
            identityDraft: null,
            detailTab: "auth",
          },
          robotEntries: [
            {
              id: "main",
              sessionKey: "agent:main:main",
              name: "大白管家",
              emoji: "🤖",
              source: "owned",
              status: "running",
              shareStatus: "shared",
              workspaceState: "configured",
              lastActiveAt: Date.now() - 60 * 1000,
            },
          ],
          userOperationalIdentitySnapshot: {
            identities: [
              {
                identityId: "id-1",
                provider: "github-personal",
                providerLabel: "GitHub 个人",
                displayName: "My GitHub",
                status: "active",
                grantCount: 0,
                createdAt: "2026-06-06T00:00:00.000Z",
                updatedAt: "2026-06-06T00:00:00.000Z",
              },
            ],
            grants: [],
            usageHistory: [],
            enterpriseAccessByAgent: {
              main: [
                {
                  identityId: "ent-1",
                  displayName: "公司飞书",
                  provider: "feishu",
                  providerLabel: "飞书",
                  status: "active",
                  allowedActions: ["send_message"],
                  enrolled: false,
                },
              ],
            },
            providerCatalog: [
              {
                provider: "github-personal",
                label: "GitHub 个人",
                category: "developer",
                rolloutTier: "pilot",
                registrationReady: true,
                operationalActions: [
                  { action: "create_issue", label: "创建 Issue" },
                  { action: "comment", label: "评论" },
                ],
                reauthHint: "",
                degradedHint: null,
              },
            ],
          },
        }),
        createShellModel({
          primaryModule: "settings",
          selectedAssistantItem: null,
          selectedSpaceItem: null,
          headerTitle: "",
        }),
        createHomeModel(),
        false,
      )}`,
      container,
    );
    await Promise.resolve();

    // Auth sub-tab offers a checkbox per personal identity and a confirm action.
    expect(container.textContent).toContain("GitHub 个人");
    expect(container.textContent).toContain("飞书");
    expect(container.textContent).toContain("确认授权");
    expect(container.textContent).toContain("个人身份");
    expect(container.textContent).toContain("企业身份");

    // Tick personal + enterprise checkboxes, then confirm → both diff handlers fire.
    const checkbox = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"][data-identity-id="id-1"]',
    );
    expect(checkbox).not.toBeNull();
    checkbox!.checked = true;
    const enterpriseCheckbox = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"][data-kind="enterprise"][data-identity-id="ent-1"]',
    );
    expect(enterpriseCheckbox).not.toBeNull();
    enterpriseCheckbox!.checked = true;
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "确认授权")
      ?.click();
    await Promise.resolve();
    expect(onApplyRobotIdentityGrants).toHaveBeenCalledWith({
      agentId: "main",
      agentScope: "owned",
      desired: [{ identityId: "id-1", allowedActions: ["create_issue", "comment"] }],
    });
    expect(onApplyRobotEnterpriseIdentities).toHaveBeenCalledWith({
      agentId: "main",
      desiredIdentityIds: ["ent-1"],
    });
  });

  it("renders the data space panel instead of workspace file browser (Phase 1)", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          settingsView: "system",
          systemSettingsTab: "security",
          connected: true,
          dataSpace: {
            mode: "local",
            displayRoot: "~/OpenBot",
            isConfigured: true,
          },
        }),
        createShellModel({
          primaryModule: "settings",
          selectedAssistantItem: null,
          selectedSpaceItem: null,
          headerTitle: "",
        }),
        createHomeModel(),
        false,
      )}`,
      container,
    );

    await Promise.resolve();

    expect(container.textContent).toContain("OpenBot 数据空间");
    expect(container.textContent).toContain("~/OpenBot");
    expect(container.textContent).not.toContain("工作区选择");
    expect(container.textContent).not.toContain("手动输入路径");
    expect(container.textContent).not.toContain("更改");
    expect(container.textContent).not.toContain("确认保存");
    expect(container.querySelector(".employee-workbench__workspace-picker-shell")).toBeNull();
    expect(container.querySelector(".employee-workbench__workspace-selector-panel")).toBeNull();
    expect(container.querySelector(".employee-workbench__settings-tabs")).not.toBeNull();
    expect(
      [...container.querySelectorAll("[data-system-settings-tab]")].map((node) =>
        node.getAttribute("data-system-settings-tab"),
      ),
    ).toEqual(["security", "devices", "robots", "groups", "models", "evolution"]);
    expect(
      container
        .querySelector("[data-system-settings-tab='security']")
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(container.querySelector("employee-evolution-perception-section")).toBeNull();
  });

  it("wires system authorization buttons to the stage handler", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onOpenSystemAuthorization = vi.fn();

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          settingsView: "system",
          systemSettingsTab: "security",
          onOpenSystemAuthorization,
        }),
        createShellModel({
          primaryModule: "settings",
          selectedAssistantItem: null,
          selectedSpaceItem: null,
          headerTitle: "",
        }),
        createHomeModel(),
        false,
      )}`,
      container,
    );

    await Promise.resolve();

    const authButtons = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter(
      (button) => button.textContent?.includes("去授权"),
    );
    expect(authButtons.length).toBeGreaterThan(0);

    authButtons[0]?.click();
    expect(onOpenSystemAuthorization).toHaveBeenCalledWith("fullDiskAccess");
  });

  it("renders a read-only group detail surface for members even without a settings draft", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          settingsView: "system",
          systemSettingsTab: "groups",
          connected: true,
          groupEntries: [
            {
              sessionKey: "space:research",
              title: "市场研究组",
              groupId: "research",
              memberCount: 4,
              activeHumanCount: 2,
              activeBotCount: 2,
              pendingHumanInviteCount: 1,
              pendingBotInviteCount: 0,
              role: "member",
              ownerLabel: "Chen Wei",
              coordinatorBotId: "bot-insight",
              coordinatorBotLabel: "Insight",
              visibilityScope: "organization",
              groupType: "research",
              lifecycleStatus: "active",
              purpose: "负责市场洞察与需求研究",
              currentMission: "完成新品机会扫描",
              collaborationMode: "discussion_driven",
              confidentialityTier: "restricted",
              currentOperatingPhase: "discover",
              finalDecisionPolicy: {
                mode: "human_required",
                defaultFinalDeciderRole: "owner",
                allowAgentPublishProposal: true,

                openDiscussionWithoutMention: true,

                maxVisibleBotRepliesPerRound: 5,
              },
              rulesSummary: ["关键结论需要人工确认"],
              successCriteria: ["形成机会清单"],
              adminUserIds: ["u8"],
              workspacePath: "/tmp/openbot/research",
            },
          ],
          selectedGroupEntry: {
            sessionKey: "space:research",
            title: "市场研究组",
            groupId: "research",
            memberCount: 4,
            activeHumanCount: 2,
            activeBotCount: 2,
            pendingHumanInviteCount: 1,
            pendingBotInviteCount: 0,
            role: "member",
            ownerLabel: "Chen Wei",
            coordinatorBotId: "bot-insight",
            coordinatorBotLabel: "Insight",
            visibilityScope: "organization",
            groupType: "research",
            lifecycleStatus: "active",
            purpose: "负责市场洞察与需求研究",
            currentMission: "完成新品机会扫描",
            collaborationMode: "discussion_driven",
            confidentialityTier: "restricted",
            currentOperatingPhase: "discover",
            finalDecisionPolicy: {
              mode: "human_required",
              defaultFinalDeciderRole: "owner",
              allowAgentPublishProposal: true,

              openDiscussionWithoutMention: true,

              maxVisibleBotRepliesPerRound: 5,
            },
            rulesSummary: ["关键结论需要人工确认"],
            successCriteria: ["形成机会清单"],
            adminUserIds: ["u8"],
            workspacePath: "/tmp/openbot/research",
          },
          selectedGroupDraft: null,
        }),
        createShellModel({
          primaryModule: "settings",
          selectedAssistantItem: null,
          selectedSpaceItem: null,
          headerTitle: "",
        }),
        createHomeModel(),
        false,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("市场研究组");
    expect(container.textContent).toContain("仅群主可编辑");
    expect(container.textContent).toContain("组织内");
    expect(container.textContent).toContain("基本信息");
    expect(container.textContent).toContain("成员");
    expect(container.textContent).toContain("群治理");
    expect(container.textContent).not.toContain("名称、身份与协调关系");
    expect(container.querySelector(".wb-groups__meta")).toBeNull();
    expect(
      Array.from(container.querySelectorAll<HTMLTextAreaElement>("textarea")).map(
        (node) => node.value,
      ),
    ).toEqual(
      expect.arrayContaining([
        "负责市场洞察与需求研究",
        "完成新品机会扫描",
        "形成机会清单",
        "关键结论需要人工确认",
      ]),
    );

    const inputs = Array.from(
      container.querySelectorAll<HTMLInputElement>(
        ".wb-groups__stage .employee-workbench__settings-input",
      ),
    );
    expect(inputs.some((input) => input.disabled)).toBe(true);
    expect(container.textContent).toContain("仅群主可编辑");
  });

  it("falls back to the first group detail when selection props are missing", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          settingsView: "system",
          systemSettingsTab: "groups",
          groupEntries: [
            {
              sessionKey: "space:product",
              title: "产品研发小组",
              groupId: "product",
              memberCount: 3,
              activeHumanCount: 2,
              activeBotCount: 1,
              role: "member",
              ownerLabel: "Alice Zhang",
              purpose: "负责产品协同",
              currentMission: "推进本季度研发排期",
              collaborationMode: "discussion_driven",
              confidentialityTier: "internal",
              visibilityScope: "group_only",
            },
          ],
          selectedGroupEntry: null,
          selectedGroupDraft: null,
        }),
        createShellModel({
          primaryModule: "settings",
          selectedAssistantItem: null,
          selectedSpaceItem: null,
          headerTitle: "",
        }),
        createHomeModel(),
        false,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("产品研发小组");
    expect(container.textContent).not.toContain("请选择一个协作小组查看完整治理详情。");
    expect(
      Array.from(container.querySelectorAll<HTMLTextAreaElement>("textarea")).map(
        (node) => node.value,
      ),
    ).toEqual(expect.arrayContaining(["负责产品协同", "推进本季度研发排期"]));
  });

  it("does not let a stale draft override the selected group entry", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          settingsView: "system",
          systemSettingsTab: "groups",
          groupEntries: [
            {
              sessionKey: "space:product",
              title: "产品研发小组",
              groupId: "product",
              memberCount: 3,
              activeHumanCount: 2,
              activeBotCount: 1,
              role: "member",
              currentMission: "研发目标",
              collaborationMode: "discussion_driven",
              confidentialityTier: "internal",
              visibilityScope: "group_only",
            },
            {
              sessionKey: "space:research",
              title: "市场研究组",
              groupId: "research",
              memberCount: 4,
              activeHumanCount: 2,
              activeBotCount: 2,
              role: "member",
              currentMission: "研究目标",
              collaborationMode: "review_driven",
              confidentialityTier: "restricted",
              visibilityScope: "tenant",
            },
          ],
          selectedGroupEntry: {
            sessionKey: "space:product",
            title: "产品研发小组",
            groupId: "product",
            memberCount: 3,
            activeHumanCount: 2,
            activeBotCount: 1,
            role: "member",
            currentMission: "研发目标",
            collaborationMode: "discussion_driven",
            confidentialityTier: "internal",
            visibilityScope: "group_only",
          },
          selectedGroupDraft: {
            groupId: "research",
            title: "市场研究组",
            avatar: "",
            purpose: "",
            currentMission: "研究目标",
            coordinatorBotId: "",
            collaborationMode: "review_driven",
            confidentialityTier: "restricted",
            visibilityScope: "tenant",
            successCriteriaText: "",
            rulesSummaryText: "",
            finalDecisionMode: "human_required",
            finalDecisionRole: "owner",
            allowAgentPublishProposal: true,

            openDiscussionWithoutMention: true,

            maxVisibleBotRepliesPerRound: 5,
            workspacePath: "/tmp/openbot/research",
          },
        }),
        createShellModel({
          primaryModule: "settings",
          selectedAssistantItem: null,
          selectedSpaceItem: null,
          headerTitle: "",
        }),
        createHomeModel(),
        false,
      )}`,
      container,
    );
    await Promise.resolve();

    const detailPanel = container.querySelector(".wb-groups__stage");
    expect(detailPanel?.textContent).toContain("产品研发小组");
    expect(detailPanel?.textContent).toContain("仅小组内");
    expect(detailPanel?.textContent).not.toContain("市场研究组");
    expect(
      Array.from(container.querySelectorAll<HTMLTextAreaElement>("textarea")).map(
        (node) => node.value,
      ),
    ).toEqual(expect.arrayContaining(["研发目标"]));
  });

  it("prefers the explicit selected group key over a stale selected group entry", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          settingsView: "system",
          systemSettingsTab: "groups",
          groupEntries: [
            {
              sessionKey: "space:product",
              title: "产品研发小组",
              groupId: "product",
              memberCount: 3,
              activeHumanCount: 2,
              activeBotCount: 1,
              role: "member",
              currentMission: "研发目标",
              collaborationMode: "discussion_driven",
              confidentialityTier: "internal",
              visibilityScope: "group_only",
            },
            {
              sessionKey: "space:research",
              title: "市场研究组",
              groupId: "research",
              memberCount: 4,
              activeHumanCount: 2,
              activeBotCount: 2,
              role: "member",
              currentMission: "研究目标",
              collaborationMode: "review_driven",
              confidentialityTier: "restricted",
              visibilityScope: "tenant",
            },
          ],
          selectedGroupKey: "research",
          selectedGroupEntry: {
            sessionKey: "space:product",
            title: "产品研发小组",
            groupId: "product",
            memberCount: 3,
            activeHumanCount: 2,
            activeBotCount: 1,
            role: "member",
            currentMission: "研发目标",
            collaborationMode: "discussion_driven",
            confidentialityTier: "internal",
            visibilityScope: "group_only",
          },
          selectedGroupDraft: {
            groupId: "research",
            title: "市场研究组",
            avatar: "",
            purpose: "",
            currentMission: "研究目标",
            coordinatorBotId: "",
            collaborationMode: "review_driven",
            confidentialityTier: "restricted",
            visibilityScope: "tenant",
            successCriteriaText: "",
            rulesSummaryText: "",
            finalDecisionMode: "human_required",
            finalDecisionRole: "owner",
            allowAgentPublishProposal: true,

            openDiscussionWithoutMention: true,

            maxVisibleBotRepliesPerRound: 5,
            workspacePath: "/tmp/openbot/research",
          },
        }),
        createShellModel({
          primaryModule: "settings",
          selectedAssistantItem: null,
          selectedSpaceItem: null,
          headerTitle: "",
        }),
        createHomeModel(),
        false,
      )}`,
      container,
    );
    await Promise.resolve();

    const detailPanel = container.querySelector(".wb-groups__stage");
    expect(detailPanel?.textContent).toContain("市场研究组");
    expect(detailPanel?.textContent).toContain("租户内");
    expect(detailPanel?.textContent).not.toContain("产品研发小组");
    expect(
      Array.from(container.querySelectorAll<HTMLTextAreaElement>("textarea")).map(
        (node) => node.value,
      ),
    ).toEqual(expect.arrayContaining(["研究目标"]));
  });

  it("rerenders the group detail panel after clicking a different system settings group", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const groupEntries = [
      {
        sessionKey: "space:product",
        title: "产品研发小组",
        groupId: "product",
        memberCount: 3,
        activeHumanCount: 1,
        activeBotCount: 2,
        role: "member" as const,
        currentMission: "产品目标",
        collaborationMode: "discussion_driven",
        confidentialityTier: "internal",
        visibilityScope: "group_only",
      },
      {
        sessionKey: "space:aegis",
        title: "Aegis产品开发",
        groupId: "aegis",
        memberCount: 2,
        activeHumanCount: 1,
        activeBotCount: 1,
        role: "member" as const,
        currentMission: "Aegis 目标",
        collaborationMode: "review_driven",
        confidentialityTier: "restricted",
        visibilityScope: "tenant",
      },
    ];
    let selectedKey = "product";
    const renderCurrent = () => {
      const selectedGroupEntry =
        groupEntries.find(
          (entry) => entry.groupId === selectedKey || entry.sessionKey === selectedKey,
        ) ?? groupEntries[0];
      render(
        html`${renderWorkbenchStage(
          createStageProps({
            settingsView: "system",
            systemSettingsTab: "groups",
            groupEntries,
            selectedGroupEntry,
            selectedGroupDraft: {
              groupId: selectedGroupEntry.groupId ?? selectedGroupEntry.sessionKey,
              title: selectedGroupEntry.title,
              avatar: "",
              purpose: "",
              currentMission: selectedGroupEntry.currentMission ?? "",
              coordinatorBotId: "",
              collaborationMode: selectedGroupEntry.collaborationMode ?? "discussion_driven",
              confidentialityTier: selectedGroupEntry.confidentialityTier ?? "internal",
              visibilityScope: selectedGroupEntry.visibilityScope ?? "group_only",
              successCriteriaText: "",
              rulesSummaryText: "",
              finalDecisionMode: "human_required",
              finalDecisionRole: "owner",
              allowAgentPublishProposal: true,

              openDiscussionWithoutMention: true,

              maxVisibleBotRepliesPerRound: 5,
              workspacePath: "/tmp/openbot/product",
            },
            onSystemSettingsGroupSelect: (groupId: string) => {
              selectedKey = groupId;
            },
          }),
          createShellModel({
            primaryModule: "settings",
            selectedAssistantItem: null,
            selectedSpaceItem: null,
            headerTitle: "",
          }),
          createHomeModel(),
          false,
        )}`,
        container,
      );
    };

    renderCurrent();
    await Promise.resolve();
    expect(container.querySelector(".wb-groups__stage")?.textContent).toContain("产品研发小组");

    Array.from(container.querySelectorAll<HTMLButtonElement>(".wb-groups__row"))
      .find((button) => button.textContent?.includes("Aegis产品开发"))
      ?.click();
    renderCurrent();
    await Promise.resolve();

    const detailText = container.querySelector(".wb-groups__stage")?.textContent ?? "";
    expect(selectedKey).toBe("aegis");
    expect(detailText).toContain("Aegis产品开发");
    expect(detailText).not.toContain("产品研发小组");
  });
});

describe("workbench growth stage chrome", () => {
  beforeEach(async () => {
    const { i18n } = await import("../../../../i18n/index.ts");
    await i18n.setLocale("zh-CN");
  });

  it("renders growth badge in conversation stage title", () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      html`${renderWorkbenchStage(
        createStageProps({
          activeSessionKey: "agent:market:main",
          activeGrowthStatus: {
            lifecycleState: "growing",
            dimensions: { identity: 40, capability: 20, knowledge: 0, habits: 0 },
            activationScore: 18,
            operationalScore: null,
            capabilityReadiness: false,
            isActivated: false,
            templateId: null,
          },
        }),
        createShellModel({
          primaryModule: "assistant",
          selectedAssistantItem: {
            title: "市场助手",
            rawTitle: "市场助手",
            selectionKey: "agent:market:main",
          },
          selectedSpaceItem: null,
          headerTitle: "市场助手",
        }),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    const badge = container.querySelector(".workbench-growth-badge");
    expect(badge?.textContent).toContain("成长中 18%");
    expect(badge?.getAttribute("data-growth-tone")).toBe("growing");
    container.remove();
  });

  it("hides group TO title when activeSessionKey is still main employee 1:1", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchStage(
        createStageProps({
          activeSessionKey: "agent:main:employee:alice",
        }),
        createShellModel({
          selectedSpaceItem: {
            title: "测试组",
            rawTitle: "测试组",
            selectionKey: "space:grp-test",
          },
        }),
        createHomeModel(),
        true,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(
      container.querySelector(".employee-workbench__stage-title")?.textContent?.trim() ?? "",
    ).toBe("");
    container.remove();
  });
});
