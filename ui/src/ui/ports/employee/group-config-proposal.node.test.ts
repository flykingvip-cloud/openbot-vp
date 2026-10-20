import { describe, expect, it } from "vitest";
import {
  applyProposalToSettingsDraft,
  buildGroupConfigProposalPrompt,
  buildStandingCoordinatorSuggestion,
  extractGroupConfigProposalFence,
  extractLatestGroupConfigProposalFromMessages,
  mapProposalRosterToGovernanceState,
  parseGroupConfigProposalJson,
  proposalMatchesSourceSession,
  syncPendingGroupConfigProposalFromChat,
  validateGroupConfigProposal,
  type GroupConfigProposal,
  type GroupConfigProposalCaptureState,
} from "./group-config-proposal.ts";
import type { WorkbenchSettingsGroupDraft } from "./views/workbench-types.ts";

const sampleProposal: GroupConfigProposal = {
  groupId: "group-alpha",
  summary: "优化分工与使命",
  settings: {
    purpose: "产品交付",
    currentMission: "本周完成评审",
    systemInstructions: ["协调者汇总结论", "人类拍板"],
  },
  roster: {
    humans: [{ userId: "u1", name: "Alice" }],
    bots: [{ agentId: "bot-1", name: "分析助手" }],
    invites: {
      humans: [{ userId: "u2", name: "Bob" }],
    },
  },
};

describe("group-config-proposal", () => {
  it("extracts the last group-config-proposal fence", () => {
    const text = [
      "建议如下",
      "```group-config-proposal",
      JSON.stringify({ groupId: "old", settings: { purpose: "A" } }),
      "```",
      "更新版：",
      "```group-config-proposal",
      JSON.stringify(sampleProposal),
      "```",
    ].join("\n");
    const fence = extractGroupConfigProposalFence(text);
    expect(fence).toBeTruthy();
    expect(parseGroupConfigProposalJson(fence!)).toMatchObject({
      groupId: "group-alpha",
      settings: { purpose: "产品交付" },
    });
  });

  it("rejects proposals without groupId or writable sections", () => {
    expect(validateGroupConfigProposal({})).toBeNull();
    expect(validateGroupConfigProposal({ groupId: "g1" })).toBeNull();
    expect(
      validateGroupConfigProposal({
        groupId: "g1",
        settings: { purpose: "x" },
      }),
    ).toMatchObject({ groupId: "g1" });
  });

  it("matches source session keys for space aliases", () => {
    expect(proposalMatchesSourceSession(sampleProposal, "space:group-alpha")).toBe(true);
    expect(proposalMatchesSourceSession(sampleProposal, "agent:main:space:group-alpha")).toBe(true);
    expect(proposalMatchesSourceSession(sampleProposal, "space:other")).toBe(false);
    expect(proposalMatchesSourceSession(sampleProposal, null)).toBe(false);
  });

  it("maps proposal settings onto an existing draft", () => {
    const baseline: WorkbenchSettingsGroupDraft = {
      groupId: "group-alpha",
      title: "产品组",
      avatar: "",
      purpose: "旧目标",
      currentMission: "旧使命",
      coordinatorBotId: "bot-coord",
      collaborationMode: "discussion_driven",
      confidentialityTier: "internal",
      visibilityScope: "group_only",
      successCriteriaText: "",
      rulesSummaryText: "旧指令",
      finalDecisionMode: "human_required",
      finalDecisionRole: "owner",
      allowAgentPublishProposal: true,
      openDiscussionWithoutMention: true,
      maxVisibleBotRepliesPerRound: 5,
      workspacePath: "",
    };
    const next = applyProposalToSettingsDraft(baseline, sampleProposal);
    expect(next.purpose).toBe("产品交付");
    expect(next.currentMission).toBe("本周完成评审");
    expect(next.rulesSummaryText).toContain("协调者汇总结论");
    expect(next.title).toBe("产品组");
    expect(next.coordinatorBotId).toBe("bot-coord");
  });

  it("maps roster to governance state shapes", () => {
    const mapped = mapProposalRosterToGovernanceState(sampleProposal.roster!);
    expect(mapped.humans).toEqual([{ id: "u1", label: "Alice", kind: "human" }]);
    expect(mapped.bots).toEqual([{ id: "bot-1", label: "分析助手", kind: "bot" }]);
    expect(mapped.pendingHumanInvites[0]).toMatchObject({
      intentId: "invite:u2",
      label: "Bob",
    });
  });

  it("extracts proposals from assistant chat messages", () => {
    const parsed = extractLatestGroupConfigProposalFromMessages([
      { role: "user", content: "请整理" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "好的\n```group-config-proposal\n" },
          { type: "text", text: `${JSON.stringify(sampleProposal)}\n` },
          { type: "text", text: "```" },
        ],
      },
    ]);
    expect(parsed?.proposal.groupId).toBe("group-alpha");
    expect(parsed?.summaryLines.length).toBeGreaterThan(0);
  });

  it("syncs pending proposal state when source matches", () => {
    const state: GroupConfigProposalCaptureState = {
      chatMessages: [
        {
          role: "assistant",
          content: `建议\n\`\`\`group-config-proposal\n${JSON.stringify(sampleProposal)}\n\`\`\``,
        },
      ],
      daibaiSourceSessionKey: "space:group-alpha",
      workbenchPendingGroupConfigProposal: null,
      workbenchGroupConfigProposalDismissedFingerprint: null,
    };
    expect(syncPendingGroupConfigProposalFromChat(state)).toBe(true);
    expect(state.workbenchPendingGroupConfigProposal?.groupId).toBe("group-alpha");
    expect(syncPendingGroupConfigProposalFromChat(state)).toBe(false);
    state.workbenchGroupConfigProposalDismissedFingerprint =
      state.workbenchPendingGroupConfigProposal!.fingerprint;
    state.workbenchPendingGroupConfigProposal = null;
    expect(syncPendingGroupConfigProposalFromChat(state)).toBe(false);
  });

  it("builds a prompt that requires the proposal fence and groupId", () => {
    const prompt = buildGroupConfigProposalPrompt({
      groupId: "group-alpha",
      title: "产品研发小组",
      purpose: "交付",
      currentMission: "评审",
      coordinatorBotId: "bot-1",
      collaborationMode: "discussion_driven",
      confidentialityTier: "internal",
      systemInstructions: ["保持简洁"],
      humans: ["Alice"],
      bots: ["分析助手"],
      humanInvites: [],
      botInvites: [],
      instruction: "请优化分工",
    });
    expect(prompt).toContain("groupId：group-alpha");
    expect(prompt).toContain("```group-config-proposal");
    expect(prompt).toContain("请优化分工");
  });

  it("builds a standing-coordinator suggestion without applying it", () => {
    const proposal = buildStandingCoordinatorSuggestion({
      groupId: "group-alpha",
      coordinatorBotId: "bot-writer",
      coordinatorLabel: "撰稿",
    });
    expect(proposal.settings?.coordinatorBotId).toBe("bot-writer");
    expect(proposal.summary).toContain("主负责人");
    expect(proposal.summary).toContain("常设身份");
  });
});
