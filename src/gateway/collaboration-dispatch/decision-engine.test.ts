import { describe, expect, test } from "vitest";
import { BUILTIN_STEWARD_AGENT_ID } from "../../agents/builtin-steward/identity.js";
import { decideParticipantsForTest } from "./__fixtures__/runtime-authority-test-utils.js";
import { selectGroupDiscussionBotsForScope } from "./decision-engine.js";
import { collectMentionTokens } from "./mention-utils.js";
import type { CollaborationBotTarget, CollaborationDispatchScope } from "./types.js";

function createBot(params: {
  agentId: string;
  name: string;
  updatedAt: number;
}): CollaborationBotTarget {
  return {
    agentId: params.agentId,
    name: params.name,
    sessionKey: `agent:${params.agentId}:main:space:alpha`,
    updatedAt: params.updatedAt,
  };
}

function createScope(
  phase: NonNullable<
    CollaborationDispatchScope["operatingState"]
  >["activeContext"]["currentOperatingPhase"],
): CollaborationDispatchScope {
  return {
    groupId: "alpha",
    rawSessionKey: "space:alpha",
    title: "Alpha Group",
    members: {
      humans: [
        {
          userId: "user-1",
          name: "UPBEYOND",
          status: "active",
        },
      ],
      bots: [
        { agentId: "bot-a", name: "Bot A", status: "active" },
        { agentId: "bot-b", name: "Bot B", status: "active" },
        { agentId: "bot-c", name: "Bot C", status: "active" },
        { agentId: "bot-d", name: "Bot D", status: "active" },
      ],
    },
    operatingState: {
      groupId: "alpha",
      groupProfile: {
        displayName: "Alpha Group",
        expectedOutputs: ["task", "review", "decision", "deliverable", "capsule"],
        successCriteria: [],
      },
      governance: {
        ownerUserId: "user-1",
        adminUserIds: [],
        coordinatorBotId: "bot-c",
      },
      collaborationPolicy: {
        humanStartsNewRound: true,
        mentionBotMustRespond: true,
        mentionHumanNotifiesOnly: true,
        openDiscussionWithoutMention: true,
        maxVisibleBotRepliesPerRound: 3,
        botMaySelfAdvanceWithoutHuman: false,
        entersWaitingForHumanAfterVisibleTurnsExhausted: true,
      },
      memberRoleMap: [
        {
          memberId: "human:user-1",
          memberKind: "human",
          label: "UPBEYOND",
          governanceRole: "owner",
          status: "active",
        },
        {
          memberId: "bot:bot-a",
          memberKind: "bot",
          label: "Bot A",
          governanceRole: "member",
          collaborationRole: "final_decider",
          status: "active",
        },
        {
          memberId: "bot:bot-b",
          memberKind: "bot",
          label: "Bot B",
          governanceRole: "member",
          collaborationRole: "reviewer",
          status: "active",
        },
        {
          memberId: "bot:bot-c",
          memberKind: "bot",
          label: "Bot C",
          governanceRole: "member",
          collaborationRole: "coordinator",
          status: "active",
        },
        {
          memberId: "bot:bot-d",
          memberKind: "bot",
          label: "Bot D",
          governanceRole: "member",
          collaborationRole: "contributor",
          status: "active",
        },
      ],
      activeContext: {
        currentOperatingPhase: phase,
        waitingForHuman: true,
        summary: "test",
        updatedAtMs: 1,
      },
      onboardingStatus: {
        initialized: true,
      },
      groupMemoryRefs: {
        latestCapsuleIds: [],
      },
      updatedAtMs: 1,
    },
    bots: [
      createBot({ agentId: "bot-a", name: "Bot A", updatedAt: 10 }),
      createBot({ agentId: "bot-b", name: "Bot B", updatedAt: 20 }),
      createBot({ agentId: "bot-c", name: "Bot C", updatedAt: 30 }),
      createBot({ agentId: "bot-d", name: "Bot D", updatedAt: 40 }),
    ],
  };
}

function allowUnmentionedOpenDiscussion(
  scope: CollaborationDispatchScope,
): CollaborationDispatchScope {
  if (scope.operatingState) {
    scope.operatingState.collaborationPolicy.mentionBotMustRespond = false;
    scope.operatingState.collaborationPolicy.openDiscussionWithoutMention = true;
  }
  return scope;
}

function withSkillIncubatorBot(scope: CollaborationDispatchScope): CollaborationDispatchScope {
  return {
    ...scope,
    members: {
      humans: scope.members?.humans ?? [],
      bots: [
        ...(scope.members?.bots ?? []),
        { agentId: "bot-skill", name: "Skill孵化", status: "active" },
      ],
    },
    operatingState: scope.operatingState
      ? {
          ...scope.operatingState,
          memberRoleMap: [
            ...scope.operatingState.memberRoleMap,
            {
              memberId: "bot:bot-skill",
              memberKind: "bot",
              label: "Skill孵化",
              governanceRole: "member",
              collaborationRole: "contributor",
              status: "active",
            },
          ],
        }
      : scope.operatingState,
    bots: [...scope.bots, createBot({ agentId: "bot-skill", name: "Skill孵化", updatedAt: 50 })],
  };
}

describe("collaboration dispatch decision engine", () => {
  test("decide-phase analysis keeps two specialists and skips the unmentioned coordinator", () => {
    const selected = selectGroupDiscussionBotsForScope({
      message: "请大家收敛一下决策建议",
      scope: allowUnmentionedOpenDiscussion(createScope("decide")),
    });

    expect(selected.map((bot) => bot.agentId)).toEqual(["bot-a", "bot-b"]);
  });

  test("debate phase reserves visible slots for reviewer, decision advisor, and coordinator", () => {
    const scope = createScope("debate");
    scope.operatingState?.memberRoleMap.splice(3, 0, {
      memberId: "bot:bot-e",
      memberKind: "bot",
      label: "Bot E",
      governanceRole: "member",
      collaborationRole: "decision_advisor",
      status: "active",
    });
    scope.members?.bots.push({ agentId: "bot-e", name: "Bot E", status: "active" });
    scope.bots.unshift(createBot({ agentId: "bot-e", name: "Bot E", updatedAt: 5 }));

    const selected = selectGroupDiscussionBotsForScope({
      message: "请大家批判一下现有方案",
      scope: allowUnmentionedOpenDiscussion(scope),
    });

    expect(selected.map((bot) => bot.agentId)).toEqual(["bot-b", "bot-e", "bot-c"]);
  });

  test("@human suppresses bot replies even when operating state exists", () => {
    const selected = selectGroupDiscussionBotsForScope({
      message: "@UPBEYOND 你来拍板",
      scope: createScope("decide"),
    });

    expect(selected).toEqual([]);
  });

  test("@human handle/email does not let bots speak for that person", () => {
    const scope = createScope("decide");
    const human = scope.members?.humans[0];
    if (human) {
      // Snapshot type on trunk has no handle/email yet; mention-resolution
      // still reads those identities at runtime via MentionHuman.
      Object.assign(human, { handle: "upbeyond", email: "ceo@example.com" });
    }
    const byHandle = decideParticipantsForTest({
      message: "@upbeyond 你来拍板",
      scope,
      roundId: "round-human-handle",
    });
    expect(byHandle.executionBots).toEqual([]);
    expect(byHandle.mentionUnmatched).toBe(false);

    const byEmail = decideParticipantsForTest({
      message: "你来拍板",
      explicitMentions: ["ceo@example.com"],
      scope,
      roundId: "round-human-email",
    });
    expect(byEmail.executionBots).toEqual([]);
    expect(byEmail.mentionUnmatched).toBe(false);
  });

  test("open discussion deprioritizes bots that replied most recently", () => {
    const scope = allowUnmentionedOpenDiscussion(createScope("explore"));
    if (scope.operatingState) {
      scope.operatingState.governance.coordinatorBotId = null;
      scope.operatingState.memberRoleMap = scope.operatingState.memberRoleMap.filter(
        (entry) => entry.memberKind !== "bot",
      );
    }
    scope.recentAssistantBotIds = ["bot-d", "bot-c"];

    const selected = selectGroupDiscussionBotsForScope({
      message: "继续开放讨论",
      scope,
    });

    expect(selected.map((bot) => bot.agentId)).toEqual(["bot-b", "bot-a"]);
  });

  test("unmentioned default falls back to the first eligible member when no coordinator matches", () => {
    const scope = createScope("explore");
    if (scope.operatingState) {
      scope.operatingState.governance.coordinatorBotId = null;
      scope.operatingState.collaborationPolicy.openDiscussionWithoutMention = false;
      scope.operatingState.memberRoleMap = scope.operatingState.memberRoleMap.filter(
        (entry) => entry.memberKind !== "bot",
      );
    }
    scope.coordinatorBotId = null;
    const decision = decideParticipantsForTest({
      message: "zzzz not a matching brief",
      scope,
      roundId: "round-fallback-speaker",
    });

    expect(decision.executionBots).toHaveLength(1);
    expect(decision.roundPlan.alerts?.some((alert) => alert.kind === "fallback_speaker")).toBe(
      true,
    );
  });

  test("unmentioned fallback never nominates the builtin steward", () => {
    const scope = createScope("explore");
    if (scope.operatingState) {
      scope.operatingState.governance.coordinatorBotId = null;
      scope.operatingState.collaborationPolicy.openDiscussionWithoutMention = false;
      scope.operatingState.memberRoleMap = [];
    }
    scope.coordinatorBotId = null;
    scope.recentAssistantBotIds = [BUILTIN_STEWARD_AGENT_ID];
    scope.bots.unshift(
      createBot({ agentId: BUILTIN_STEWARD_AGENT_ID, name: "大白管家", updatedAt: 99 }),
    );

    const decision = decideParticipantsForTest({
      message: "zzzz not a matching brief",
      scope,
      roundId: "round-no-steward-fallback",
    });

    expect(decision.executionBots.map((bot) => bot.agentId)).not.toContain(
      BUILTIN_STEWARD_AGENT_ID,
    );
    expect(decision.executionBots).toHaveLength(1);
  });

  test("unmentioned default without open discussion wakes only the standing coordinator", () => {
    const scope = createScope("explore");
    if (scope.operatingState) {
      scope.operatingState.collaborationPolicy.openDiscussionWithoutMention = false;
    }
    const decision = decideParticipantsForTest({
      message: "你们需要分析一下 openbot 的记忆系统的主要特征",
      scope,
      roundId: "round-default-single",
    });

    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(["bot-c"]);
    expect(decision.roundPlan.alerts?.some((alert) => alert.kind === "standing_coordinator")).toBe(
      true,
    );
  });

  test("blocked agent ids are excluded from the unmentioned speaker set", () => {
    const scope = createScope("explore");
    scope.blockedAgentIds = ["bot-c"];
    const decision = decideParticipantsForTest({
      message: "请分析一下记忆系统",
      scope,
      roundId: "round-blocked",
    });

    expect(decision.executionBots.map((bot) => bot.agentId)).not.toContain("bot-c");
    expect(decision.roundPlan.alerts?.some((alert) => alert.kind === "blocked_on")).toBe(true);
  });

  test("low-signal acknowledgement rounds only schedule one visible bot reply", () => {
    const decision = decideParticipantsForTest({
      message: "OK，非常好。现在大家都彼此算是认识了。",
      scope: allowUnmentionedOpenDiscussion(createScope("explore")),
      roundId: "round-1",
    });

    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(["bot-c"]);
    expect(decision.roundPlan.alerts?.some((alert) => alert.kind === "low_signal_limited")).toBe(
      true,
    );
  });

  test("introduction follow-up skips bots who already spoke in thread", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "各位介绍一下自己" }], timestamp: 1 },
      {
        role: "assistant",
        content: [{ type: "text", text: "大家好，我是 Bot A，负责最终决策支持。" }],
        timestamp: 2,
        senderLabel: "Bot A",
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "大家好，我是 Bot B，负责评审与批判。" }],
        timestamp: 3,
        senderLabel: "Bot B",
      },
    ];
    const decision = decideParticipantsForTest({
      message: "其他人也介绍一下自己",
      scope: allowUnmentionedOpenDiscussion(createScope("explore")),
      roundId: "round-follow-up",
      recentGroupMessages: messages,
    });

    expect(decision.executionBots.map((bot) => bot.agentId)).not.toContain("bot-a");
    expect(decision.executionBots.map((bot) => bot.agentId)).not.toContain("bot-b");
    expect(
      decision.roundPlan.alerts?.some((alert) => alert.kind === "introduction_follow_up"),
    ).toBe(true);
  });

  test("language follow-up routes to the last visible speaker", () => {
    const decision = decideParticipantsForTest({
      message: "请输出中文",
      scope: createScope("explore"),
      roundId: "round-zh",
      recentGroupMessages: [
        {
          role: "assistant",
          senderLabel: "Bot A",
          content: [{ type: "text", text: "Good afternoon. I'm Bot A." }],
          timestamp: 1,
        },
      ],
    });

    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(["bot-a"]);
    expect(
      decision.roundPlan.alerts?.some((alert) => alert.kind === "last_speaker_follow_up"),
    ).toBe(true);
  });

  test("empty greetings dispatch coordinator with non-empty primaryQueue", () => {
    const decision = decideParticipantsForTest({
      message: "大家好",
      scope: createScope("explore"),
      roundId: "round-greeting",
    });

    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(["bot-c"]);
    expect(decision.primaryQueue).toEqual(["bot-c"]);
    expect(decision.roundPlan.participants.map((p) => p.agentId)).toEqual(["bot-c"]);
    expect(decision.roundPlan.summaryText).not.toContain("本轮暂无机器人参与");
    expect(decision.roundPlan.alerts ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "group_broadcast_expanded" })]),
    );
  });

  test("presence check fans out even when open discussion is closed", () => {
    const scope = createScope("explore");
    if (scope.operatingState) {
      scope.operatingState.collaborationPolicy.openDiscussionWithoutMention = false;
    }
    const decision = decideParticipantsForTest({
      message: "其他人在吗",
      scope,
      roundId: "round-presence",
    });

    expect(decision.executionBots.length).toBeGreaterThan(1);
    expect(decision.roundPlan.responseMode).toBe("debate_or_brainstorm");
    expect(
      decision.roundPlan.alerts?.some((alert) => alert.kind === "group_broadcast_expanded"),
    ).toBe(true);
  });

  test("introduction request fans out even when open discussion is closed", () => {
    const scope = createScope("explore");
    if (scope.operatingState) {
      scope.operatingState.collaborationPolicy.openDiscussionWithoutMention = false;
    }
    const decision = decideParticipantsForTest({
      message: "各位介绍一下自己",
      scope,
      roundId: "round-intro-closed",
    });

    expect(decision.executionBots.length).toBeGreaterThan(1);
    expect(
      decision.roundPlan.alerts?.some((alert) => alert.kind === "group_broadcast_expanded"),
    ).toBe(true);
  });

  test("room greeting on intro mission broadcasts without opening unmentioned discussion", () => {
    const scope = createScope("explore");
    if (scope.operatingState) {
      scope.operatingState.collaborationPolicy.openDiscussionWithoutMention = false;
      scope.operatingState.activeContext.currentMission = "完成成员介绍并建立协作上下文";
    }
    const decision = decideParticipantsForTest({
      message: "大家好",
      scope,
      roundId: "round-intro-hello",
    });

    expect(decision.executionBots.length).toBeGreaterThan(1);
    expect(
      decision.roundPlan.alerts?.some((alert) => alert.kind === "group_broadcast_expanded"),
    ).toBe(true);
  });

  test("idle greeting without coordinator rotates instead of always picking the first bot", () => {
    const scope = createScope("explore");
    if (scope.operatingState) {
      scope.operatingState.governance.coordinatorBotId = null;
      scope.operatingState.memberRoleMap = scope.operatingState.memberRoleMap.filter(
        (entry) => entry.memberKind !== "bot",
      );
    }
    scope.coordinatorBotId = null;
    const speakers = new Set<string>();
    for (let index = 0; index < 12; index += 1) {
      const decision = decideParticipantsForTest({
        message: "下午好",
        scope,
        roundId: `round-rotate-${index}`,
      });
      expect(decision.executionBots).toHaveLength(1);
      speakers.add(decision.executionBots[0]?.agentId ?? "");
    }
    expect(speakers.size).toBeGreaterThan(1);
  });

  test("introduction still expands beyond focused policy ceiling", () => {
    const decision = decideParticipantsForTest({
      message: "各位介绍一下自己",
      scope: allowUnmentionedOpenDiscussion(createScope("explore")),
      roundId: "round-intro",
    });

    expect(decision.executionBots.length).toBe(4);
    expect(
      decision.roundPlan.alerts?.some((alert) => alert.kind === "group_broadcast_expanded"),
    ).toBe(true);
  });

  test("@specific bot only schedules that bot", () => {
    const decision = decideParticipantsForTest({
      message: "@bot-a 请分析市场",
      scope: createScope("explore"),
      roundId: "round-specific-bot",
    });

    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(["bot-a"]);
    expect(decision.mentionUnmatched).toBe(false);
  });

  test("open discussion does not schedule a coordinator wrap by default", () => {
    const decision = decideParticipantsForTest({
      message: "分析一下记忆系统的主要特征",
      scope: allowUnmentionedOpenDiscussion(createScope("explore")),
      roundId: "round-no-wrap",
    });

    expect(
      decision.roundPlan.participants.filter(
        (participant) => participant.contributionRole === "wrap",
      ),
    ).toEqual([]);
  });

  test("wrap is skipped when the coordinator is already in tier0", () => {
    const scope = createScope("explore");
    if (scope.operatingState) {
      (
        scope.operatingState.collaborationPolicy as {
          coordinatorSummarizeAfterRound?: boolean;
        }
      ).coordinatorSummarizeAfterRound = true;
    }
    const decision = decideParticipantsForTest({
      message: "@bot-c @bot-a 请分别分析",
      scope,
      roundId: "round-wrap-skip",
    });

    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(["bot-c", "bot-a"]);
    expect(
      decision.roundPlan.participants.filter(
        (participant) => participant.contributionRole === "wrap",
      ),
    ).toEqual([]);
  });

  test("open discussion without @ does not return coordinator only", () => {
    const selected = selectGroupDiscussionBotsForScope({
      message: "各位介绍一下自己",
      scope: allowUnmentionedOpenDiscussion(createScope("explore")),
    });

    expect(selected.length).toBeGreaterThan(1);
    expect(selected.some((bot) => bot.agentId === "bot-c")).toBe(true);
  });

  test("parses glued Chinese mention tokens", () => {
    const tokens = collectMentionTokens("@Skill孵化你在吗");
    expect(tokens.has("skill孵化")).toBe(true);
  });

  test("matches glued mention to bot display name", () => {
    const decision = decideParticipantsForTest({
      message: "@Skill孵化你在吗",
      scope: withSkillIncubatorBot(createScope("explore")),
      roundId: "round-mention",
    });

    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(["bot-skill"]);
    expect(decision.mentionUnmatched).toBe(false);
  });

  test("matches glued approval mention without space after display name", () => {
    const decision = decideParticipantsForTest({
      message: "@Skill孵化我同意你的建议",
      scope: withSkillIncubatorBot(createScope("explore")),
      roundId: "round-mention-approval",
    });

    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(["bot-skill"]);
    expect(decision.mentionUnmatched).toBe(false);
    expect(decision.executionBots.length).toBe(1);
  });

  test("treats @所有人 as broadcast and falls through to unmentioned selection", () => {
    const broadcast = decideParticipantsForTest({
      message: "@所有人看一下",
      scope: createScope("explore"),
      roundId: "round-everyone",
    });

    expect(broadcast.roundPlan.mentionAll).toBe(true);
    expect(broadcast.mentionUnmatched).toBe(false);
    expect(broadcast.primaryMode).toBe("single");
    expect(broadcast.executionBots.length).toBeGreaterThan(0);
    expect(broadcast.primaryQueue).toHaveLength(1);
  });

  test("owner alias stays unmatched and does not dispatch", () => {
    const decision = decideParticipantsForTest({
      message: "@所有者 每个人做一份总结",
      scope: createScope("explore"),
      roundId: "round-owner-alias",
    });

    expect(decision.roundPlan.mentionAll).toBeUndefined();
    expect(decision.mentionUnmatched).toBe(true);
    expect(decision.executionBots).toEqual([]);
    expect(decision.primaryQueue).toEqual([]);
  });

  test("mention_unmatched does not fall back to coordinator", () => {
    const decision = decideParticipantsForTest({
      message: "@不存在机器人你在吗",
      scope: createScope("explore"),
      roundId: "round-unmatched",
    });

    expect(decision.mentionUnmatched).toBe(true);
    expect(decision.executionBots).toEqual([]);
    expect(decision.primaryQueue).toEqual([]);
    expect(decision.roundPlan.alerts?.some((alert) => alert.kind === "mention_unmatched")).toBe(
      true,
    );
  });

  test("@所有人 plus a valid bot mention keeps broadcast and selects only the bot in tier0", () => {
    const decision = decideParticipantsForTest({
      message: "@所有人 @bot-a 请先看",
      scope: createScope("explore"),
      roundId: "round-everyone-plus-bot",
    });

    expect(decision.roundPlan.mentionAll).toBe(true);
    expect(decision.mentionUnmatched).toBe(false);
    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(["bot-a"]);
    expect(decision.primaryQueue).toEqual(["bot-a"]);
  });

  test("partial multi-mention does not dispatch matched bots when one token is unmatched", () => {
    const decision = decideParticipantsForTest({
      message: "@bot-a @ghost-bot 请协作",
      scope: createScope("explore"),
      roundId: "round-partial-multi",
    });

    expect(decision.mentionUnmatched).toBe(true);
    expect(decision.executionBots).toEqual([]);
    expect(decision.primaryQueue).toEqual([]);
    expect(decision.roundPlan.alerts?.some((alert) => alert.kind === "mention_unmatched")).toBe(
      true,
    );
  });

  test("human mention with bot mention dispatches only the bot", () => {
    const decision = decideParticipantsForTest({
      message: "@upbeyond @bot-a 请分工",
      scope: createScope("explore"),
      roundId: "round-human-plus-bot",
    });

    expect(decision.mentionUnmatched).toBe(false);
    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(["bot-a"]);
    expect(decision.primaryQueue).toEqual(["bot-a"]);
  });

  test("structured __all__ explicit mention follows broadcast path", () => {
    const decision = decideParticipantsForTest({
      message: "请看",
      explicitMentions: ["__all__"],
      scope: allowUnmentionedOpenDiscussion(createScope("explore")),
      roundId: "round-explicit-all",
    });

    expect(decision.roundPlan.mentionAll).toBe(true);
    expect(decision.mentionUnmatched).toBe(false);
    expect(decision.executionBots.length).toBeGreaterThan(0);
  });

  test("multiple valid mentions become an explicit_multi primary queue", () => {
    const decision = decideParticipantsForTest({
      message: "@bot-a @bot-b 请分别分析这个问题",
      scope: createScope("explore"),
      roundId: "round-explicit-multi",
    });

    expect(decision.mentionUnmatched).toBe(false);
    expect(decision.primaryMode).toBe("explicit_multi");
    expect(decision.mentionMode).toBe("explicit_multi");
    expect(decision.primaryQueue).toEqual(["bot-a", "bot-b"]);
    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(["bot-a", "bot-b"]);
  });

  test("simple knowledge questions use single_owner response mode", () => {
    const decision = decideParticipantsForTest({
      message: "谁知道端午节的由来？",
      scope: allowUnmentionedOpenDiscussion(createScope("explore")),
      roundId: "round-knowledge",
    });

    expect(decision.responseMode).toBe("single_owner");
    expect(decision.executionBots.length).toBeLessThanOrEqual(2);
    expect(decision.executionBots.map((bot) => bot.agentId)).not.toContain("bot-c");
    expect(decision.roundPlan.alerts?.some((alert) => alert.kind === "single_owner_mode")).toBe(
      true,
    );
  });

  test("numbered decision replies route to the bot who asked the questionnaire", () => {
    const scope = withSkillIncubatorBot(createScope("explore"));
    const recentGroupMessages = [
      {
        role: "assistant",
        senderLabel: "Skill孵化",
        content: [
          {
            type: "text",
            text: "动工前确认几个事：\n1. Skill 名字叫什么？\n2. 范围先做哪个节日？\n3. 是否需要脚本？",
          },
        ],
        timestamp: 1,
      },
    ];
    const decision = decideParticipantsForTest({
      message: '1. festival-knowledge 2.先只做"端午" 3.不需要',
      scope,
      roundId: "round-decision",
      recentGroupMessages,
    });

    expect(decision.responseMode).toBe("decision_to_executor");
    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(["bot-c", "bot-skill"]);
    expect(decision.executionBots.length).toBe(2);
    expect(
      decision.roundPlan.participants.find((entry) => entry.agentId === "bot-c")?.contributionRole,
    ).toBe("confirm");
    expect(
      decision.roundPlan.participants.find((entry) => entry.agentId === "bot-skill")
        ?.contributionRole,
    ).toBe("executor");
    expect(
      decision.roundPlan.alerts?.some((alert) => alert.kind === "directed_decision_reply"),
    ).toBe(true);
    expect(
      decision.roundPlan.alerts?.some((alert) => alert.kind === "decision_to_executor_mode"),
    ).toBe(true);
  });

  test("unmentioned analysis rounds skip the coordinator and cap at two specialists", () => {
    const decision = decideParticipantsForTest({
      message: "你们需要分析一下 openbot 的记忆系统的主要特征",
      scope: allowUnmentionedOpenDiscussion(createScope("explore")),
      roundId: "round-analysis",
    });

    expect(decision.responseMode).toBe("lead_plus_supplement");
    expect(decision.executionBots).toHaveLength(2);
    expect(decision.executionBots.map((bot) => bot.agentId)).not.toContain("bot-c");
  });

  test("greeting 你好 dispatches coordinator only — not specialist bot-2", () => {
    const scope = createScope("explore");
    scope.bots.push(createBot({ agentId: "bot-2", name: "市场助手", updatedAt: 60 }));
    scope.members?.bots.push({ agentId: "bot-2", name: "市场助手", status: "active" });

    const decision = decideParticipantsForTest({
      message: "你好",
      scope,
      roundId: "round-hello",
    });

    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(["bot-c"]);
    expect(decision.primaryQueue).toEqual(["bot-c"]);
    expect(decision.tier1.map((bot) => bot.agentId)).not.toContain("bot-2");
    expect(decision.executionBots.map((bot) => bot.agentId)).not.toContain("bot-2");
    expect(decision.roundPlan.participants).toHaveLength(1);
  });

  test("@mention still selects bot-2 when the message also greets", () => {
    const scope = createScope("explore");
    scope.bots.push(createBot({ agentId: "bot-2", name: "市场助手", updatedAt: 60 }));
    scope.members?.bots.push({ agentId: "bot-2", name: "市场助手", status: "active" });

    const decision = decideParticipantsForTest({
      message: "@市场助手 请分析一下市场",
      scope,
      roundId: "round-mention-bot-2",
    });

    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(["bot-2"]);
    expect(decision.mentionUnmatched).toBe(false);
  });

  test("unmentioned analysis does not fan out bot-2 when charter requires 被 @", () => {
    const scope = createScope("explore");
    scope.bots.push(createBot({ agentId: "bot-2", name: "市场助手", updatedAt: 60 }));
    scope.members?.bots.push({ agentId: "bot-2", name: "市场助手", status: "active" });
    // Closed discussion is the live control; generated charter no longer
    // treats mention-must-respond as "未点名时不要全员开口".
    if (scope.operatingState) {
      scope.operatingState.groupProfile.purpose = "市场研究协作";
      scope.operatingState.activeContext.currentMission = "分析市场";
      scope.operatingState.collaborationPolicy.openDiscussionWithoutMention = false;
      scope.operatingState.collaborationPolicy.mentionBotMustRespond = true;
    }

    const decision = decideParticipantsForTest({
      message: "请分析一下市场",
      scope,
      roundId: "round-analysis-no-mention",
    });

    expect(decision.executionBots.map((bot) => bot.agentId)).not.toContain("bot-2");
    expect(decision.tier1.map((bot) => bot.agentId)).not.toContain("bot-2");
    const participantIds = decision.roundPlan.participants.map((entry) => entry.agentId);
    expect(participantIds).not.toContain("bot-2");
    expect(participantIds.every((id) => id === "bot-c")).toBe(true);
  });

  test("mentioned analysis still selects bot-2 under the same 被 @ charter", () => {
    const scope = createScope("explore");
    scope.bots.push(createBot({ agentId: "bot-2", name: "市场助手", updatedAt: 60 }));
    scope.members?.bots.push({ agentId: "bot-2", name: "市场助手", status: "active" });
    if (scope.operatingState) {
      scope.operatingState.groupProfile.purpose = "市场研究协作";
      scope.operatingState.activeContext.currentMission = "分析市场";
      scope.operatingState.collaborationPolicy.openDiscussionWithoutMention = true;
      scope.operatingState.collaborationPolicy.mentionBotMustRespond = true;
    }

    const decision = decideParticipantsForTest({
      message: "@市场助手 请分析一下市场",
      scope,
      roundId: "round-analysis-mention-bot-2",
    });

    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(["bot-2"]);
    expect(decision.mentionUnmatched).toBe(false);
  });

  test("review_driven keeps conflict open instead of collapsing knowledge questions", () => {
    const scope = allowUnmentionedOpenDiscussion(createScope("debate"));
    if (scope.operatingState) {
      scope.operatingState.groupProfile.collaborationMode = "review_driven";
    }

    const decision = decideParticipantsForTest({
      message: "谁知道端午节的由来？",
      scope,
      roundId: "round-review-knowledge",
    });

    expect(decision.responseMode).toBe("debate_or_brainstorm");
    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(["bot-b", "bot-c"]);
    expect(decision.roundPlan.alerts?.some((alert) => alert.kind === "strategy_constrained")).toBe(
      true,
    );
  });

  test("task_driven unmentioned analysis prefers the owner instead of open fanout", () => {
    const scope = allowUnmentionedOpenDiscussion(createScope("deliver"));
    if (scope.operatingState) {
      scope.operatingState.groupProfile.collaborationMode = "task_driven";
    }

    const decision = decideParticipantsForTest({
      message: "你们需要分析一下 openbot 的记忆系统的主要特征",
      scope,
      roundId: "round-task-analysis",
    });

    expect(decision.executionBots.map((bot) => bot.agentId)).toContain("bot-d");
    expect(decision.executionBots.map((bot) => bot.agentId)).not.toContain("bot-b");
    expect(decision.roundPlan.alerts?.some((alert) => alert.kind === "strategy_on_demand")).toBe(
      true,
    );
  });

  test("explicit @ chip uuid does not stop the round or retarget the robot", () => {
    const scope = createScope("explore");
    scope.bots = [
      createBot({ agentId: "bot--gaomidu", name: "高密度分析", updatedAt: 1 }),
      createBot({ agentId: "bot-data", name: "数据助手", updatedAt: 2 }),
    ];
    const mentionId = "6f1c0c3e-6a1a-4b1e-9c2d-0a0b1c2d3e4f";
    const decision = decideParticipantsForTest({
      message: "@高密度分析 请分析",
      scope,
      roundId: "round-chip",
      explicitMentions: ["高密度分析", mentionId, "bot--gaomidu"],
      explicitMentionRefs: [
        {
          mentionId,
          agentId: "bot--gaomidu",
          displayName: "高密度分析",
          targetKind: "agent",
          targetId: "bot--gaomidu",
        },
      ],
    });
    expect(decision.mentionUnmatched).toBe(false);
    expect(decision.mentionConfirm).toBeNull();
    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(["bot--gaomidu"]);
    expect(decision.primaryQueue).toEqual(["bot--gaomidu"]);
  });

  test("spoken robot name dispatches that robot", () => {
    const scope = createScope("explore");
    scope.bots = [
      createBot({ agentId: "bot-market", name: "市场助手", updatedAt: 1 }),
      createBot({ agentId: "bot-data", name: "数据助手", updatedAt: 2 }),
    ];
    const decision = decideParticipantsForTest({
      message: "请市场助手看一下竞品",
      scope,
      roundId: "round-spoken",
    });
    expect(decision.mentionUnmatched).toBe(false);
    expect(decision.mentionConfirm).toBeNull();
    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(["bot-market"]);
  });

  test("misspelled robot name asks once and a confirm reply dispatches", () => {
    const scope = createScope("explore");
    scope.bots = [
      createBot({ agentId: "bot-market", name: "市场助手", updatedAt: 1 }),
      createBot({ agentId: "bot-data", name: "数据助手", updatedAt: 2 }),
    ];
    const asked = decideParticipantsForTest({
      message: "@市场助首 看一下",
      scope,
      roundId: "round-typo",
    });
    expect(asked.mentionUnmatched).toBe(false);
    expect(asked.executionBots).toEqual([]);
    expect(asked.primaryQueue).toEqual([]);
    expect(asked.mentionConfirm?.candidates.map((candidate) => candidate.agentId)).toEqual([
      "bot-market",
    ]);
    expect(asked.roundPlan.alerts?.some((alert) => alert.kind === "mention_confirm")).toBe(true);
    expect(asked.roundPlan.summaryText).toContain("市场助手");

    const confirmed = decideParticipantsForTest({
      message: "确认",
      scope,
      roundId: "round-typo-yes",
      recentGroupMessages: [
        {
          role: "assistant",
          senderLabel: "协作调度",
          content: [{ type: "text", text: asked.mentionConfirm?.question ?? "" }],
        },
      ],
    });
    expect(confirmed.mentionUnmatched).toBe(false);
    expect(confirmed.mentionConfirm).toBeNull();
    expect(confirmed.executionBots.map((bot) => bot.agentId)).toEqual(["bot-market"]);
  });
});

describe("PPT / deliverable intent vs last_speaker sticky", () => {
  test("explicit PPT ask prefers bot-skill over sticky last speaker (市场助手)", () => {
    const scope = withSkillIncubatorBot(createScope("deliver"));
    scope.bots.push(createBot({ agentId: "bot-2", name: "市场助手", updatedAt: 60 }));
    scope.members?.bots.push({ agentId: "bot-2", name: "市场助手", status: "active" });
    if (scope.operatingState) {
      scope.operatingState.collaborationPolicy.openDiscussionWithoutMention = false;
      scope.operatingState.governance.coordinatorBotId = null;
    }
    scope.coordinatorBotId = null;
    scope.recentAssistantBotIds = ["bot-2"];

    const decision = decideParticipantsForTest({
      message: "请做一份路演 PPTX 演示文稿",
      scope,
      roundId: "round-ppt-no-sticky",
    });

    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(["bot-skill"]);
    expect(
      decision.roundPlan.alerts?.some((alert) => alert.kind === "last_speaker_follow_up"),
    ).toBeFalsy();
  });

  test("isExplicitPptOrDeliverableIntent recognizes PPT triggers", async () => {
    const { isExplicitPptOrDeliverableIntent } = await import("./decision-engine.js");
    expect(isExplicitPptOrDeliverableIntent("请做一份路演 PPTX")).toBe(true);
    expect(isExplicitPptOrDeliverableIntent("生成演示文稿")).toBe(true);
    expect(isExplicitPptOrDeliverableIntent("请分析一下市场")).toBe(false);
  });
});

describe("missing/empty agentId selection (preferSkill path)", () => {
  test("empty agentId bots do not throw and do not match skill by id", () => {
    const scope = withSkillIncubatorBot(createScope("deliver"));
    // Whitespace / empty ids normalize to null; (id ?? "").includes("skill") must not throw.
    scope.bots.unshift(createBot({ agentId: "", name: "无名号", updatedAt: 1 }));
    scope.bots.unshift(createBot({ agentId: "   ", name: "空白号", updatedAt: 2 }));
    scope.members?.bots.push(
      { agentId: "", name: "无名号", status: "active" },
      { agentId: "   ", name: "空白号", status: "active" },
    );
    if (scope.operatingState) {
      scope.operatingState.collaborationPolicy.openDiscussionWithoutMention = false;
      scope.operatingState.governance.coordinatorBotId = null;
    }
    scope.coordinatorBotId = null;

    expect(() =>
      decideParticipantsForTest({
        message: "请做一份路演 PPTX 演示文稿",
        scope,
        roundId: "round-empty-agentid-ppt",
      }),
    ).not.toThrow();

    const decision = decideParticipantsForTest({
      message: "请做一份路演 PPTX 演示文稿",
      scope,
      roundId: "round-empty-agentid-ppt-2",
    });
    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(["bot-skill"]);
    expect(decision.primaryQueue).toEqual(["bot-skill"]);
  });

  test("missing agentId does not crash unmentioned greet selection", () => {
    const scope = createScope("explore");
    scope.bots.unshift(createBot({ agentId: "", name: "幽灵", updatedAt: 1 }));
    scope.members?.bots.push({ agentId: "", name: "幽灵", status: "active" });

    expect(() =>
      decideParticipantsForTest({
        message: "大家好",
        scope,
        roundId: "round-empty-agentid-greet",
      }),
    ).not.toThrow();

    const decision = decideParticipantsForTest({
      message: "大家好",
      scope,
      roundId: "round-empty-agentid-greet-2",
    });
    expect(decision.executionBots.length).toBeGreaterThan(0);
    expect(decision.executionBots.every((bot) => Boolean(bot.agentId?.trim()))).toBe(true);
  });
});
