// @vitest-environment jsdom
import { html, render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkbenchHomeModel } from "./workbench-home-model.ts";
import type { WorkbenchShellModel } from "./workbench-shell-model.ts";
import {
  renderCollaborationStatusTools,
  renderCollaborationReasonDrawer,
  renderCollaborationStatusCapsule,
} from "./workbench-stage-collaboration.ts";
import type { WorkbenchCollaborationStageContract } from "./workbench-stage-contracts.ts";
import type { WorkbenchCollaborationSpacesSnapshot } from "./workbench-types.ts";

afterEach(() => {
  document.body.innerHTML = "";
});

function createCollaborationContract(
  overrides: Partial<WorkbenchCollaborationStageContract> = {},
): WorkbenchCollaborationStageContract {
  return {
    activeSessionKey: "space:alpha",
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
    ...overrides,
  };
}

describe("workbench collaboration reason drawer (AC-6)", () => {
  it("renders round plan participant reasons when drawer is open", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    const contract = createCollaborationContract({
      collaborationReasonDrawerOpen: true,
      collaborationRoundPlan: {
        roundId: "round-1",
        sessionKey: "space:alpha",
        responseMode: "single_owner",
        summaryText: "本轮参与 2 人",
        participants: [
          {
            agentId: "bot-a",
            displayName: "市场助手",
            tier: "duty",
            contributionRole: "supplement",
            reasonText: "职责范围内需要跟进本轮话题",
          },
        ],
      },
    });

    render(html`${renderCollaborationReasonDrawer(contract)}`, container);
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__collaboration-drawer")).not.toBeNull();
    expect(container.textContent).toContain("为什么这些成员参与");
    expect(container.textContent).toContain("市场助手");
    expect(container.textContent).toContain("职责范围内需要跟进本轮话题");
  });

  it("returns nothing when drawer is closed", () => {
    const container = document.createElement("div");
    const contract = createCollaborationContract({
      collaborationReasonDrawerOpen: false,
      collaborationRoundPlan: {
        roundId: "round-1",
        sessionKey: "space:alpha",
        responseMode: "single_owner",
        summaryText: "本轮参与 2 人",
        participants: [],
      },
    });
    render(html`${renderCollaborationReasonDrawer(contract)}`, container);
    expect(container.querySelector(".employee-workbench__collaboration-drawer")).toBeNull();
  });

  it("renders optional suggestion chips and mission advance button", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const contract = createCollaborationContract({
      collaborationRoundPlan: {
        roundId: "round-1",
        sessionKey: "space:alpha",
        responseMode: "single_owner",
        summaryText: "协调者 + 执行者",
        participants: [],
        alerts: [
          {
            kind: "onboarding_mission_stale",
            message: "群使命仍停留在介绍阶段，建议切换为工作使命",
          },
        ],
      },
      collaborationOptionalSuggestions: [
        {
          id: "round-1:bot-market:1",
          roundId: "round-1",
          sessionKey: "space:alpha",
          agentId: "bot-market",
          agentName: "市场助手",
          title: "如需渠道策略",
          body: "我可以协助整理竞品对比。",
          recordedAtMs: 1,
        },
      ],
    });
    const shellModel = { sessions: [], presence: [] } as unknown as WorkbenchShellModel;
    const homeModel = {} as WorkbenchHomeModel;

    render(
      html`${renderCollaborationStatusCapsule(shellModel, homeModel, { spaces: [] }, contract)}`,
      container,
    );
    await Promise.resolve();

    expect(
      container.querySelector(".employee-workbench__collaboration-optional-suggestion"),
    ).not.toBeNull();
    expect(container.textContent).toContain("如需渠道策略");
    expect(container.textContent).toContain("升级群使命");
  });

  it("renders only member and file tools in collaboration header", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const contract = createCollaborationContract({
      groupMembers: [
        { id: "u1", kind: "human", name: "Alice" },
        { id: "bot-main", kind: "bot", name: "Aegis" },
      ],
      pendingBotApprovalCount: 0,
    });
    const shellModel = {
      selectedSpaceItem: { selectionKey: "space:alpha" },
    } as WorkbenchShellModel;
    const homeModel = {} as WorkbenchHomeModel;
    const spaces: WorkbenchCollaborationSpacesSnapshot = {
      spaces: [
        {
          id: "space:alpha",
          groupId: "grp_alpha",
          title: "AI智库",
          members: {
            humans: [{ userId: "u1", name: "Alice", handle: null, status: null }],
            bots: [{ agentId: "bot-main", name: "Aegis", status: null }],
          },
          invites: { humans: [], bots: [] },
        },
      ],
    };

    render(
      html`${renderCollaborationStatusTools(shellModel, homeModel, spaces, contract)}`,
      container,
    );
    await Promise.resolve();

    const buttons = container.querySelectorAll(".employee-workbench__stage-collaboration-tool");
    expect(buttons).toHaveLength(2);
  });
});

describe("collaboration speaker status in members capsule", () => {
  it("does not render speaker-status or mention-hint in the capsule", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const contract = createCollaborationContract({
      collaborationRoundPlan: {
        roundId: "round-1",
        sessionKey: "space:alpha",
        responseMode: "lead_plus_supplement",
        summaryText: "本轮参与 1 人",
        mentionMode: "none",
        participants: [
          {
            agentId: "bot-main",
            displayName: "Aegis",
            tier: "duty",
            contributionRole: "lead",
            reasonText: "职责",
          },
        ],
      },
      groupMembers: [{ id: "bot-main", kind: "bot", name: "Aegis" }],
    });
    const shellModel = {
      selectedSpaceItem: { selectionKey: "space:alpha" },
    } as WorkbenchShellModel;
    const homeModel = {} as WorkbenchHomeModel;
    const spaces: WorkbenchCollaborationSpacesSnapshot = {
      spaces: [
        {
          id: "space:alpha",
          groupId: "grp_alpha",
          title: "AI智库",
          members: {
            humans: [],
            bots: [{ agentId: "bot-main", name: "Aegis", status: null }],
          },
          invites: { humans: [], bots: [] },
        },
      ],
    };

    render(
      html`${renderCollaborationStatusCapsule(shellModel, homeModel, spaces, contract)}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__collaboration-capsule")).not.toBeNull();
    expect(container.querySelector("[data-testid=collaboration-speaker-status]")).toBeNull();
    expect(container.querySelector("[data-testid=collaboration-mention-hint]")).toBeNull();
    expect(container.textContent).not.toMatch(/本轮主讲|Speaking this turn/);
    expect(container.textContent).not.toMatch(/不 @ 任何人|Without an @/);
  });

  it("marks the speaking bot with a top-right green dot, not a selected ring", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const contract = createCollaborationContract({
      collaborationSpeakingAgentId: "bot-market",
      collaborationRoundPlan: {
        roundId: "round-1",
        sessionKey: "space:alpha",
        responseMode: "lead_plus_supplement",
        summaryText: "本轮参与 2 人",
        mentionMode: "none",
        participants: [
          {
            agentId: "bot-market",
            displayName: "市场助手",
            tier: "duty",
            contributionRole: "lead",
            reasonText: "职责",
          },
          {
            agentId: "bot-skill",
            displayName: "Skill孵化",
            tier: "duty",
            contributionRole: "supplement",
            reasonText: "备选",
          },
        ],
      },
      groupMembers: [
        { id: "bot-market", kind: "bot", name: "市场助手" },
        { id: "bot-skill", kind: "bot", name: "Skill孵化" },
      ],
    });
    const shellModel = {
      selectedSpaceItem: { selectionKey: "space:alpha" },
    } as WorkbenchShellModel;
    const spaces: WorkbenchCollaborationSpacesSnapshot = {
      spaces: [
        {
          id: "space:alpha",
          groupId: "grp_alpha",
          title: "数字人战队",
          members: {
            humans: [],
            bots: [
              { agentId: "bot-market", name: "市场助手", status: "active" },
              { agentId: "bot-skill", name: "Skill孵化", status: "active" },
            ],
          },
          invites: { humans: [], bots: [] },
        },
      ],
    };

    render(
      html`${renderCollaborationStatusCapsule(
        shellModel,
        {} as WorkbenchHomeModel,
        spaces,
        contract,
      )}`,
      container,
    );
    await Promise.resolve();

    const members = Array.from(
      container.querySelectorAll<HTMLElement>(".employee-workbench__collaboration-capsule-member"),
    );
    const speaking = members.find((node) => node.classList.contains("is-speaking-this-round"));
    expect(
      speaking?.querySelector(".employee-workbench__collaboration-capsule-speaking-dot"),
    ).not.toBeNull();
    expect(
      members.filter((node) =>
        Boolean(node.querySelector(".employee-workbench__collaboration-capsule-speaking-dot")),
      ).length,
    ).toBe(1);
    expect(members.filter((node) => node.classList.contains("is-selected-this-round")).length).toBe(
      0,
    );
    expect(members.filter((node) => node.classList.contains("is-wrap-this-round")).length).toBe(0);
  });

  it("does not render an in-progress speaker status line", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const contract = createCollaborationContract({
      collaborationSpeakingAgentId: "bot-main",
      collaborationRoundPlan: {
        roundId: "round-1",
        sessionKey: "space:alpha",
        responseMode: "lead_plus_supplement",
        summaryText: "本轮参与 1 人",
        mentionMode: "none",
        participants: [
          {
            agentId: "bot-main",
            displayName: "Aegis",
            tier: "duty",
            contributionRole: "lead",
            reasonText: "职责",
          },
        ],
      },
      groupMembers: [{ id: "bot-main", kind: "bot", name: "Aegis" }],
    });
    const shellModel = {
      selectedSpaceItem: { selectionKey: "space:alpha" },
    } as WorkbenchShellModel;

    render(
      html`${renderCollaborationStatusCapsule(
        shellModel,
        {} as WorkbenchHomeModel,
        { spaces: [] },
        contract,
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector("[data-testid=collaboration-speaker-status]")).toBeNull();
    expect(container.querySelector("[data-testid=collaboration-mention-hint]")).toBeNull();
    expect(container.textContent).not.toMatch(/正在回复：Aegis|Replying now: Aegis/);
  });
});
