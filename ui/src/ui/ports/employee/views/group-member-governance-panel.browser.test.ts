/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { zh_CN } from "../../../../i18n/locales/zh-CN.ts";
import { renderGroupMemberGovernancePanel } from "./group-member-governance-panel.ts";

describe("group-member-governance-panel", () => {
  beforeAll(async () => {
    i18n.registerTranslation("zh-CN", zh_CN);
    await i18n.setLocale("zh-CN");
  });

  it("renders in-place panel with group context and member-first layout", () => {
    const container = document.createElement("div");
    render(
      renderGroupMemberGovernancePanel({
        open: true,
        presentation: "inline",
        groupTitle: "市场研究组",
        prompt: "请帮我调整成员",
        busy: false,
        error: null,
        result: null,
        currentHumans: [{ id: "u1", label: "Alice", kind: "human" }],
        currentBots: [],
        candidateHumans: [],
        candidateBots: [],
        selectedHumanCandidates: [],
        selectedBotCandidates: [],
        selectorKind: null,
        search: "",
        onClose: vi.fn(),
        onPromptChange: vi.fn(),
        onParse: vi.fn(),
        onOpenSelector: vi.fn(),
        onSearchChange: vi.fn(),
        onToggleHumanSelection: vi.fn(),
        onToggleBotSelection: vi.fn(),
        onCommitSelection: vi.fn(),
        onRemoveMember: vi.fn(),
      }),
      container,
    );

    expect(
      container.querySelector(".employee-workbench__member-governance-panel--inline"),
    ).not.toBeNull();
    expect(container.textContent).toContain("成员管理——市场研究组");
    expect(container.textContent).toContain("1 位成员");
    expect(container.querySelector(".employee-workbench__member-governance-panel-back")).toBeNull();
    expect(
      container.querySelector(".employee-workbench__member-governance-roster-hint"),
    ).toBeNull();
    expect(container.querySelector(".employee-workbench__member-governance-chips")).not.toBeNull();
    expect(container.querySelector(".employee-workbench__member-governance-assist")).not.toBeNull();
    expect(
      container.querySelector(".employee-workbench__member-governance-selector-overlay"),
    ).toBeNull();
  });

  it("does not render speaker-status or mention-hint in the Members roster", () => {
    const container = document.createElement("div");
    render(
      renderGroupMemberGovernancePanel({
        open: true,
        presentation: "docked",
        groupTitle: "市场研究组",
        prompt: "",
        busy: false,
        error: null,
        result: null,
        currentHumans: [{ id: "u1", label: "Alice", kind: "human" }],
        currentBots: [{ id: "bot-1", label: "市场助手", kind: "bot" }],
        candidateHumans: [],
        candidateBots: [],
        selectedHumanCandidates: [],
        selectedBotCandidates: [],
        selectorKind: null,
        search: "",
        onClose: vi.fn(),
        onPromptChange: vi.fn(),
        onParse: vi.fn(),
        onOpenSelector: vi.fn(),
        onSearchChange: vi.fn(),
        onToggleHumanSelection: vi.fn(),
        onToggleBotSelection: vi.fn(),
        onCommitSelection: vi.fn(),
        onRemoveMember: vi.fn(),
      }),
      container,
    );

    expect(container.querySelector("[data-testid=collaboration-speaker-status]")).toBeNull();
    expect(container.querySelector("[data-testid=collaboration-mention-hint]")).toBeNull();
    expect(container.textContent).not.toContain("本轮主讲");
    expect(container.textContent).not.toContain("不 @ 任何人");
    expect(container.textContent).toContain("市场助手");
  });

  it("renders inline human selector inside roster block without overlay", () => {
    const container = document.createElement("div");
    render(
      renderGroupMemberGovernancePanel({
        open: true,
        presentation: "docked",
        groupTitle: "市场组",
        prompt: "",
        busy: false,
        error: null,
        result: null,
        currentHumans: [{ id: "u1", label: "CEO", kind: "human" }],
        currentBots: [],
        candidateHumans: [{ id: "u2", label: "Alice", kind: "human", actionMode: "add" }],
        candidateBots: [],
        selectedHumanCandidates: [],
        selectedBotCandidates: [],
        selectorKind: "human",
        search: "",
        onClose: vi.fn(),
        onPromptChange: vi.fn(),
        onParse: vi.fn(),
        onOpenSelector: vi.fn(),
        onSearchChange: vi.fn(),
        onToggleHumanSelection: vi.fn(),
        onToggleBotSelection: vi.fn(),
        onCommitSelection: vi.fn(),
        onRemoveMember: vi.fn(),
      }),
      container,
    );

    expect(
      container.querySelector(".employee-workbench__member-governance-selector-overlay"),
    ).toBeNull();
    expect(
      container.querySelector(".employee-workbench__member-governance-inline-selector"),
    ).not.toBeNull();
    expect(container.textContent).toContain("Alice");
    expect(
      container.querySelector(".employee-workbench__member-governance-roster-block--selector-open"),
    ).not.toBeNull();
  });

  it("invites a human from the candidate row without a duplicate confirm action", () => {
    const container = document.createElement("div");
    const onInviteHumanCandidate = vi.fn();
    render(
      renderGroupMemberGovernancePanel({
        open: true,
        presentation: "docked",
        groupTitle: "市场组",
        prompt: "",
        busy: false,
        invitingHumanId: null,
        error: null,
        result: null,
        currentHumans: [],
        currentBots: [],
        candidateHumans: [
          { id: "alice@example.com", label: "Alice", kind: "human", actionMode: "invite" },
        ],
        candidateBots: [],
        selectedHumanCandidates: [],
        selectedBotCandidates: [],
        selectorKind: "human",
        search: "",
        onClose: vi.fn(),
        onPromptChange: vi.fn(),
        onParse: vi.fn(),
        onOpenSelector: vi.fn(),
        onSearchChange: vi.fn(),
        onToggleHumanSelection: vi.fn(),
        onToggleBotSelection: vi.fn(),
        onCommitSelection: vi.fn(),
        onInviteHumanCandidate,
        onRemoveMember: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).not.toContain("确认加入");
    const inviteButton = container.querySelector<HTMLButtonElement>(
      ".employee-workbench__member-governance-candidate-invite",
    );
    expect(inviteButton?.textContent).toContain("邀请加入");
    inviteButton?.click();
    expect(onInviteHumanCandidate).toHaveBeenCalledWith("alice@example.com");
  });

  it("invites a bot from the candidate row and shows pending receipt copy", () => {
    const container = document.createElement("div");
    const onInviteBotCandidate = vi.fn();
    render(
      renderGroupMemberGovernancePanel({
        open: true,
        presentation: "docked",
        groupTitle: "市场组",
        prompt: "",
        busy: false,
        invitingBotId: null,
        error: null,
        result: "已邀请 市场分析助手，待对方加入。",
        currentHumans: [],
        currentBots: [],
        candidateHumans: [],
        candidateBots: [
          {
            id: "peer-bot",
            label: "市场分析助手",
            kind: "bot",
            actionMode: "invite",
            orgSegments: ["Alice 的机器人"],
          },
          {
            id: "peer-bot-pending",
            label: "已邀机器人",
            kind: "bot",
            actionMode: "invite",
            disabled: true,
            orgSegments: ["Bob 的机器人"],
          },
        ],
        selectedHumanCandidates: [],
        selectedBotCandidates: [],
        selectorKind: "bot",
        search: "",
        onClose: vi.fn(),
        onPromptChange: vi.fn(),
        onParse: vi.fn(),
        onOpenSelector: vi.fn(),
        onSearchChange: vi.fn(),
        onToggleHumanSelection: vi.fn(),
        onToggleBotSelection: vi.fn(),
        onCommitSelection: vi.fn(),
        onInviteBotCandidate,
        onRemoveMember: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toContain("已邀请，待对方加入");
    expect(container.textContent).toContain("已邀请 市场分析助手，待对方加入。");
    expect(container.textContent).not.toContain("发送邀请");
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(
      container.querySelector(".employee-workbench__member-governance-inline-actions"),
    ).toBeNull();
    const botRow = container.querySelector(".employee-workbench__member-governance-candidate--bot");
    expect(botRow?.className).toContain("employee-workbench__member-governance-candidate--compact");
    // Full bot name must remain in the label node (not truncated in markup).
    expect(
      botRow
        ?.querySelector(".employee-workbench__member-governance-candidate-label")
        ?.textContent?.trim(),
    ).toBe("市场分析助手");
    // First child is identity copy; invite control trails — no checkbox column.
    expect(
      botRow?.children[0]?.classList.contains(
        "employee-workbench__member-governance-candidate-copy",
      ),
    ).toBe(true);
    const inviteButton = container.querySelector<HTMLButtonElement>(
      ".employee-workbench__member-governance-candidate-invite",
    );
    expect(inviteButton?.textContent).toContain("邀请加入");
    inviteButton?.click();
    expect(onInviteBotCandidate).toHaveBeenCalledWith("peer-bot");
  });

  it("shows invite in-flight state only on the inviting human row", () => {
    const container = document.createElement("div");
    render(
      renderGroupMemberGovernancePanel({
        open: true,
        presentation: "docked",
        groupTitle: "市场组",
        prompt: "",
        busy: true,
        invitingHumanId: "alice@example.com",
        error: null,
        result: null,
        currentHumans: [],
        currentBots: [],
        candidateHumans: [
          { id: "alice@example.com", label: "Alice", kind: "human", actionMode: "invite" },
          { id: "bob@example.com", label: "Bob", kind: "human", actionMode: "invite" },
        ],
        candidateBots: [],
        selectedHumanCandidates: [],
        selectedBotCandidates: [],
        selectorKind: "human",
        search: "",
        onClose: vi.fn(),
        onPromptChange: vi.fn(),
        onParse: vi.fn(),
        onOpenSelector: vi.fn(),
        onSearchChange: vi.fn(),
        onToggleHumanSelection: vi.fn(),
        onToggleBotSelection: vi.fn(),
        onCommitSelection: vi.fn(),
        onInviteHumanCandidate: vi.fn(),
        onRemoveMember: vi.fn(),
      }),
      container,
    );

    const inviteButtons = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".employee-workbench__member-governance-candidate-invite",
      ),
    ];
    expect(inviteButtons).toHaveLength(2);
    expect(inviteButtons[0]?.textContent).toContain("邀请中");
    expect(inviteButtons[0]?.disabled).toBe(true);
    expect(inviteButtons[0]?.getAttribute("aria-busy")).toBe("true");
    expect(inviteButtons[1]?.textContent).toContain("邀请加入");
    expect(inviteButtons[1]?.disabled).toBe(false);
    expect(inviteButtons[1]?.getAttribute("aria-busy")).toBe("false");
  });

  it("shows invite in-flight state only on the inviting bot row", () => {
    const container = document.createElement("div");
    render(
      renderGroupMemberGovernancePanel({
        open: true,
        presentation: "docked",
        groupTitle: "产品测试组",
        prompt: "",
        busy: true,
        invitingBotId: "culture-director",
        error: null,
        result: "已邀请 文化总监，待对方加入。",
        currentHumans: [],
        currentBots: [],
        candidateHumans: [],
        candidateBots: [
          {
            id: "fengshui-bot",
            label: "风水文化顾问",
            kind: "bot",
            actionMode: "invite",
            orgSegments: ["王军 的机器人"],
          },
          {
            id: "culture-director",
            label: "文化总监",
            kind: "bot",
            actionMode: "invite",
            orgSegments: ["王军 的机器人"],
          },
        ],
        selectedHumanCandidates: [],
        selectedBotCandidates: [],
        selectorKind: "bot",
        search: "",
        onClose: vi.fn(),
        onPromptChange: vi.fn(),
        onParse: vi.fn(),
        onOpenSelector: vi.fn(),
        onSearchChange: vi.fn(),
        onToggleHumanSelection: vi.fn(),
        onToggleBotSelection: vi.fn(),
        onCommitSelection: vi.fn(),
        onInviteBotCandidate: vi.fn(),
        onRemoveMember: vi.fn(),
      }),
      container,
    );

    const inviteButtons = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".employee-workbench__member-governance-candidate-invite",
      ),
    ];
    expect(inviteButtons).toHaveLength(2);
    expect(inviteButtons[0]?.textContent).toContain("邀请加入");
    expect(inviteButtons[0]?.disabled).toBe(false);
    expect(inviteButtons[1]?.textContent).toContain("邀请中");
    expect(inviteButtons[1]?.disabled).toBe(true);
    expect(container.textContent).toContain("已邀请 文化总监，待对方加入。");
    expect(
      container.querySelector(".employee-workbench__member-governance-banner.is-success"),
    ).not.toBeNull();
  });

  it("shows a single add-human control when the human roster is empty", () => {
    const container = document.createElement("div");
    const onOpenSelector = vi.fn();
    render(
      renderGroupMemberGovernancePanel({
        open: true,
        presentation: "docked",
        groupTitle: "openbot市场部",
        prompt: "",
        busy: false,
        error: null,
        result: null,
        currentHumans: [],
        currentBots: [{ id: "main", label: "高密度分析", kind: "bot" }],
        candidateHumans: [],
        candidateBots: [],
        selectedHumanCandidates: [],
        selectedBotCandidates: [],
        selectorKind: null,
        search: "",
        onClose: vi.fn(),
        onPromptChange: vi.fn(),
        onParse: vi.fn(),
        onOpenSelector,
        onSearchChange: vi.fn(),
        onToggleHumanSelection: vi.fn(),
        onToggleBotSelection: vi.fn(),
        onCommitSelection: vi.fn(),
        onRemoveMember: vi.fn(),
      }),
      container,
    );

    const addHumanButtons = Array.from(container.querySelectorAll("button")).filter((button) =>
      (button.textContent ?? "").includes("添加成员"),
    );
    expect(addHumanButtons).toHaveLength(1);
    expect(
      container.querySelector(".employee-workbench__member-governance-roster-add"),
    ).not.toBeNull();
    expect(container.querySelector(".employee-workbench__member-governance-empty")).not.toBeNull();
    expect(container.textContent).toContain("当前还没有成员");
  });

  it("hides manage actions in read-only member mode and shows leave action", () => {
    const container = document.createElement("div");
    render(
      renderGroupMemberGovernancePanel({
        open: true,
        presentation: "overlay",
        groupTitle: "AI智库",
        readOnly: true,
        showLeaveAction: true,
        currentOwnerUserId: "elledecke204@gmail.com",
        prompt: "",
        busy: false,
        error: null,
        result: null,
        currentHumans: [
          { id: "daniel.hhd@gmail.com", label: "CEO", kind: "human" },
          { id: "elledecke204@gmail.com", label: "elle", kind: "human" },
        ],
        currentBots: [{ id: "main", label: "大白管家", kind: "bot" }],
        candidateHumans: [],
        candidateBots: [],
        selectedHumanCandidates: [],
        selectedBotCandidates: [],
        selectorKind: null,
        search: "",
        onClose: vi.fn(),
        onPromptChange: vi.fn(),
        onParse: vi.fn(),
        onOpenSelector: vi.fn(),
        onSearchChange: vi.fn(),
        onToggleHumanSelection: vi.fn(),
        onToggleBotSelection: vi.fn(),
        onCommitSelection: vi.fn(),
        onRemoveMember: vi.fn(),
        onLeaveGroup: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toContain("只读成员");
    expect(container.textContent).toContain("退出协作小组");
    expect(container.textContent).toContain("群主");
    expect(
      container.querySelector(".employee-workbench__member-governance-panel-foot"),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("添加成员");
    expect(container.textContent).not.toContain("添加机器人");
    expect(container.textContent).not.toContain("移除");
    expect(container.textContent).not.toContain("移交管理权");
  });

  it("shows transfer ownership for owners on non-owner humans", () => {
    const container = document.createElement("div");
    const onTransferOwnershipToHuman = vi.fn();
    render(
      renderGroupMemberGovernancePanel({
        open: true,
        presentation: "overlay",
        groupTitle: "测试组",
        readOnly: false,
        currentOwnerUserId: "owner-1",
        prompt: "",
        busy: false,
        error: null,
        result: null,
        currentHumans: [
          { id: "owner-1", label: "群主", kind: "human" },
          { id: "member-2", label: "CEO", kind: "human" },
        ],
        currentBots: [],
        candidateHumans: [],
        candidateBots: [],
        selectedHumanCandidates: [],
        selectedBotCandidates: [],
        selectorKind: null,
        search: "",
        onClose: vi.fn(),
        onPromptChange: vi.fn(),
        onParse: vi.fn(),
        onOpenSelector: vi.fn(),
        onSearchChange: vi.fn(),
        onToggleHumanSelection: vi.fn(),
        onToggleBotSelection: vi.fn(),
        onCommitSelection: vi.fn(),
        onRemoveMember: vi.fn(),
        onTransferOwnershipToHuman,
      }),
      container,
    );

    const transferButton = Array.from(container.querySelectorAll("button")).find((button) =>
      (button.textContent ?? "").includes("移交管理权"),
    );
    expect(transferButton).toBeTruthy();
    transferButton?.click();
    expect(onTransferOwnershipToHuman).toHaveBeenCalledWith("member-2");
  });

  it("lets bot owners approve pending invites even in read-only group role", () => {
    const container = document.createElement("div");
    const onApproveBotInvite = vi.fn();
    const onRejectBotInvite = vi.fn();
    render(
      renderGroupMemberGovernancePanel({
        open: true,
        presentation: "overlay",
        groupTitle: "测试组",
        readOnly: true,
        showLeaveAction: true,
        currentOwnerUserId: "owner-1",
        prompt: "",
        busy: false,
        error: null,
        result: null,
        currentHumans: [{ id: "member-2", label: "CEO", kind: "human" }],
        currentBots: [],
        pendingBotInvites: [
          {
            agentId: "bot-dense",
            label: "高密度分析",
            ownerName: "CEO",
            canApprove: true,
          },
        ],
        candidateHumans: [],
        candidateBots: [],
        selectedHumanCandidates: [],
        selectedBotCandidates: [],
        selectorKind: null,
        search: "",
        onClose: vi.fn(),
        onPromptChange: vi.fn(),
        onParse: vi.fn(),
        onOpenSelector: vi.fn(),
        onSearchChange: vi.fn(),
        onToggleHumanSelection: vi.fn(),
        onToggleBotSelection: vi.fn(),
        onCommitSelection: vi.fn(),
        onRemoveMember: vi.fn(),
        onApproveBotInvite,
        onRejectBotInvite,
        onLeaveGroup: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).not.toContain("待主人确认");
    const approveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      (button.textContent ?? "").includes("同意"),
    );
    const rejectButton = Array.from(container.querySelectorAll("button")).find((button) =>
      (button.textContent ?? "").includes("拒绝"),
    );
    expect(approveButton).toBeTruthy();
    expect(rejectButton).toBeTruthy();
    approveButton?.click();
    expect(onApproveBotInvite).toHaveBeenCalledWith("bot-dense");
  });

  it("renders docked panel without list bullets", () => {
    const container = document.createElement("div");
    render(
      renderGroupMemberGovernancePanel({
        open: true,
        presentation: "docked",
        groupTitle: "数字人战队",
        prompt: "",
        busy: false,
        error: null,
        result: null,
        currentHumans: [{ id: "ceo", label: "CEO", kind: "human" }],
        currentBots: [{ id: "main", label: "大白管家", kind: "bot" }],
        candidateHumans: [],
        candidateBots: [],
        selectedHumanCandidates: [],
        selectedBotCandidates: [],
        selectorKind: null,
        search: "",
        onClose: vi.fn(),
        onPromptChange: vi.fn(),
        onParse: vi.fn(),
        onOpenSelector: vi.fn(),
        onSearchChange: vi.fn(),
        onToggleHumanSelection: vi.fn(),
        onToggleBotSelection: vi.fn(),
        onCommitSelection: vi.fn(),
        onRemoveMember: vi.fn(),
      }),
      container,
    );

    const list = container.querySelector(".employee-workbench__member-governance-roster-list");
    expect(
      container.querySelector(".employee-workbench__member-governance-panel--docked"),
    ).not.toBeNull();
    expect(container.textContent).toContain("成员管理——数字人战队");
    expect(container.querySelector(".employee-workbench__member-governance-panel-back")).toBeNull();
    expect(list).not.toBeNull();
    expect(list?.className).toContain("employee-workbench__member-governance-roster-list");
    expect(
      container.querySelectorAll(".employee-workbench__member-governance-member-avatar").length,
    ).toBe(2);
  });

  it("shows an online presence dot only for humans marked online", () => {
    const container = document.createElement("div");
    render(
      renderGroupMemberGovernancePanel({
        open: true,
        presentation: "inline",
        groupTitle: "产品体验官",
        prompt: "",
        busy: false,
        error: null,
        result: null,
        currentHumans: [
          { id: "u1", label: "CEO", kind: "human", presenceStatus: "online" },
          { id: "u2", label: "XUN", kind: "human", presenceStatus: "offline" },
        ],
        currentBots: [{ id: "main", label: "大白管家", kind: "bot" }],
        candidateHumans: [],
        candidateBots: [],
        selectedHumanCandidates: [],
        selectedBotCandidates: [],
        selectorKind: null,
        search: "",
        onClose: vi.fn(),
        onPromptChange: vi.fn(),
        onParse: vi.fn(),
        onOpenSelector: vi.fn(),
        onSearchChange: vi.fn(),
        onToggleHumanSelection: vi.fn(),
        onToggleBotSelection: vi.fn(),
        onCommitSelection: vi.fn(),
        onRemoveMember: vi.fn(),
      }),
      container,
    );

    const dots = container.querySelectorAll(".employee-workbench__member-governance-presence-dot");
    expect(dots).toHaveLength(1);
    expect(dots[0]?.getAttribute("aria-label")).toBe("在线");
  });

  it("renders accept and reject actions when the signed-in user is the invitee", () => {
    const container = document.createElement("div");
    const onAcceptSelfInvite = vi.fn();
    const onRejectSelfInvite = vi.fn();
    render(
      renderGroupMemberGovernancePanel({
        open: true,
        presentation: "inline",
        groupTitle: "市场研究组",
        prompt: "",
        busy: false,
        error: null,
        result: null,
        currentHumans: [{ id: "u1", label: "Alice", kind: "human" }],
        currentBots: [],
        candidateHumans: [],
        candidateBots: [],
        pendingHumanInvites: [{ intentId: "invite:u2", label: "Bob" }],
        selfPendingInvite: { intentId: "invite:u2", label: "Bob" },
        selectedHumanCandidates: [],
        selectedBotCandidates: [],
        selectorKind: null,
        search: "",
        onClose: vi.fn(),
        onPromptChange: vi.fn(),
        onParse: vi.fn(),
        onOpenSelector: vi.fn(),
        onSearchChange: vi.fn(),
        onToggleHumanSelection: vi.fn(),
        onToggleBotSelection: vi.fn(),
        onCommitSelection: vi.fn(),
        onRemoveMember: vi.fn(),
        onAcceptSelfInvite,
        onRejectSelfInvite,
      }),
      container,
    );

    expect(container.textContent).toContain("待你确认的邀请");
    expect(container.textContent).toContain("接受后即可加入「市场研究组」并参与协作。");
    const accept = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("接受邀请"),
    );
    const reject = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("拒绝"),
    );
    expect(accept).toBeTruthy();
    expect(reject).toBeTruthy();
    accept?.click();
    reject?.click();
    expect(onAcceptSelfInvite).toHaveBeenCalledTimes(1);
    expect(onRejectSelfInvite).toHaveBeenCalledTimes(1);
  });
});
