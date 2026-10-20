import { describe, expect, test } from "vitest";
import {
  createDigitalTeamScope,
  DIGITAL_TEAM_BOTS,
  ORCHESTRATION_ROUND,
} from "./__fixtures__/digital-team-real-rounds.js";
import { parseCollabEdgesFromText, createCollabEdgeTargetResolver } from "./collab-edge.js";
import {
  buildCollaborationDiscussionTurnPrompt,
  buildCollaborationGroupMembersLabel,
} from "./discussion-turn-prompt.js";
import type {
  CollaborationBotTarget,
  CollaborationDispatchScope,
  ParticipationDecision,
} from "./types.js";

function createBot(agentId: string, name: string): CollaborationBotTarget {
  return {
    agentId,
    name,
    sessionKey: `agent:${agentId}:main:space:alpha`,
    updatedAt: 1,
  };
}

describe("collaboration discussion turn prompt", () => {
  test("instructs supplement bots to add incremental value or stay silent", () => {
    const scope: CollaborationDispatchScope = {
      groupId: "alpha",
      rawSessionKey: "space:alpha",
      title: "数字人战队",
      bots: [createBot("main", "大白管家"), createBot("bot-skill", "Skill孵化")],
      members: {
        humans: [],
        bots: [
          { agentId: "main", name: "大白管家", status: "active" },
          { agentId: "bot-skill", name: "Skill孵化", status: "active" },
        ],
      },
    };
    const decision = {
      roundId: "round-1",
      responseMode: "lead_plus_supplement" as const,
      tier0: [],
      tier1: [createBot("main", "大白管家"), createBot("bot-skill", "Skill孵化")],
      tier2: [],
      executionBots: [createBot("main", "大白管家"), createBot("bot-skill", "Skill孵化")],
      roundPlan: {
        roundId: "round-1",
        sessionKey: "space:alpha",
        responseMode: "lead_plus_supplement" as const,
        summaryText: "本轮参与 2 人",
        participants: [
          {
            agentId: "main",
            displayName: "大白管家",
            tier: "duty" as const,
            contributionRole: "lead" as const,
            reasonText: "职责",
          },
          {
            agentId: "bot-skill",
            displayName: "Skill孵化",
            tier: "relevance" as const,
            contributionRole: "supplement" as const,
            reasonText: "职责",
          },
        ],
      },
      lowSignalLimited: false,
      mentionUnmatched: false,
      primaryMode: "single" as const,
      mentionMode: "none" as const,
      primaryQueue: ["bot-c"],
    };
    const prompt = buildCollaborationDiscussionTurnPrompt({
      scope,
      bot: createBot("bot-skill", "Skill孵化"),
      decision,
      participationTier: "relevance",
      contributionRole: "supplement",
      userMessage: "王老师今天给你们布置新任务了吗",
      replyLanguage: "zh",
    });
    expect(prompt).toContain("Skill孵化");
    expect(prompt).toContain("大白管家");
    expect(prompt).toContain("NO_REPLY");
    expect(prompt).toContain("增量贡献");
    expect(prompt).toContain("区分他们");
    expect(prompt).toContain('to:"dm"');
    expect(prompt).toContain("需要你确认的选项我发到私聊了；定下来我再把结果贴回这里。");
    expect(prompt).not.toContain("选项一");
    expect(prompt).toContain("本轮用户语种：中文");
    expect(prompt).toContain("不要写推理、草稿或过程旁白");
    expect(prompt).not.toContain("禁止调用任何工具");
    expect(prompt).toContain("工具是否可用由本轮注册表与群技能策略决定");
    expect(prompt).toContain("不要输出英文思考");
    expect(prompt).toContain("3 句以内收口");
  });

  test("mention and executor turns allow silence and forbid room claims", () => {
    const scope: CollaborationDispatchScope = {
      groupId: "alpha",
      rawSessionKey: "space:alpha",
      title: "数字人战队",
      bots: [createBot("bot-skill", "Skill孵化")],
    };
    const decision = {
      roundId: "round-1",
      responseMode: "decision_to_executor" as const,
      tier0: [createBot("bot-skill", "Skill孵化")],
      tier1: [],
      tier2: [],
      executionBots: [createBot("bot-skill", "Skill孵化")],
      roundPlan: {
        roundId: "round-1",
        sessionKey: "space:alpha",
        responseMode: "decision_to_executor" as const,
        summaryText: "本轮参与 1 人",
        participants: [
          {
            agentId: "bot-skill",
            displayName: "Skill孵化",
            tier: "mention" as const,
            contributionRole: "executor" as const,
            reasonText: "执行",
          },
        ],
      },
      lowSignalLimited: false,
      mentionUnmatched: false,
      primaryMode: "single" as const,
      mentionMode: "single_primary" as const,
      primaryQueue: ["bot-skill"],
    };
    const executor = buildCollaborationDiscussionTurnPrompt({
      scope,
      bot: createBot("bot-skill", "Skill孵化"),
      decision,
      participationTier: "mention",
      contributionRole: "executor",
    });
    expect(executor).toContain("NO_REPLY");
    expect(executor).not.toContain("已认领：");
    const lead = buildCollaborationDiscussionTurnPrompt({
      scope,
      bot: createBot("bot-skill", "Skill孵化"),
      decision: {
        ...decision,
        responseMode: "lead_plus_supplement",
        roundPlan: {
          ...decision.roundPlan,
          responseMode: "lead_plus_supplement",
          participants: [
            {
              ...decision.roundPlan.participants[0],
              contributionRole: "lead",
            },
          ],
        },
      },
      participationTier: "mention",
      contributionRole: "lead",
    });
    expect(lead).toContain("返回 NO_REPLY");
  });

  test("L2 mention-must-respond forbids NO_REPLY on the named lead", () => {
    const scope: CollaborationDispatchScope = {
      groupId: "alpha",
      rawSessionKey: "space:alpha",
      title: "数字人战队",
      bots: [createBot("bot-skill", "Skill孵化")],
      operatingState: {
        groupId: "alpha",
        groupProfile: { displayName: "Alpha", expectedOutputs: [], successCriteria: [] },
        governance: { adminUserIds: [] },
        collaborationPolicy: {
          humanStartsNewRound: true,
          mentionBotMustRespond: true,
          mentionHumanNotifiesOnly: true,
          openDiscussionWithoutMention: false,
          maxVisibleBotRepliesPerRound: 5,
          botMaySelfAdvanceWithoutHuman: false,
          entersWaitingForHumanAfterVisibleTurnsExhausted: true,
        },
        memberRoleMap: [],
        activeContext: {
          currentOperatingPhase: "explore",
          waitingForHuman: false,
          summary: "test",
          updatedAtMs: 1,
        },
        onboardingStatus: { initialized: true },
        groupMemoryRefs: { latestCapsuleIds: [] },
        updatedAtMs: 1,
      },
    };
    const prompt = buildCollaborationDiscussionTurnPrompt({
      scope,
      bot: createBot("bot-skill", "Skill孵化"),
      decision: {
        roundId: "round-1",
        responseMode: "single_owner",
        tier0: [createBot("bot-skill", "Skill孵化")],
        tier1: [],
        tier2: [],
        executionBots: [createBot("bot-skill", "Skill孵化")],
        roundPlan: {
          roundId: "round-1",
          sessionKey: "space:alpha",
          responseMode: "single_owner",
          summaryText: "本轮参与 1 人",
          participants: [
            {
              agentId: "bot-skill",
              displayName: "Skill孵化",
              tier: "mention",
              contributionRole: "lead",
              reasonText: "点名",
            },
          ],
        },
        lowSignalLimited: false,
        mentionUnmatched: false,
        primaryMode: "single",
        mentionMode: "single_primary",
        primaryQueue: ["bot-skill"],
      },
      participationTier: "mention",
      contributionRole: "lead",
    });
    expect(prompt).toContain("不要只返回 NO_REPLY");
    expect(prompt).not.toContain("若没有明显增量，返回 NO_REPLY");
  });

  test("lists humans and bots separately in GroupMembers label", () => {
    const label = buildCollaborationGroupMembersLabel({
      groupId: "quanbian",
      rawSessionKey: "space:quanbian",
      title: "权变方案组",
      bots: [createBot("salary-bot", "薪酬专业经理")],
      members: {
        humans: [
          { userId: "ceo-1", name: "CEO", status: "active" },
          { userId: "ops-1", name: "运营", status: "active" },
          { userId: "left-1", name: "已退出", status: "left" },
        ],
        bots: [{ agentId: "salary-bot", name: "薪酬专业经理", status: "active" }],
      },
    });
    expect(label).toContain("CEO（真人）");
    expect(label).toContain("运营（真人）");
    expect(label).toContain("薪酬专业经理（机器人）");
    expect(label).not.toContain("已退出");
  });

  test("a greeting lead must answer, while a supplement may stay silent", () => {
    const scope: CollaborationDispatchScope = {
      groupId: "alpha",
      rawSessionKey: "space:alpha",
      title: "数字人战队",
      bots: [createBot("panda", "熊猫学习"), createBot("bot-skill", "Skill孵化")],
    };
    const decision = {
      roundId: "round-1",
      responseMode: "debate_or_brainstorm" as const,
      tier0: [],
      tier1: [createBot("panda", "熊猫学习")],
      tier2: [],
      executionBots: [],
      roundPlan: {
        roundId: "round-1",
        sessionKey: "space:alpha",
        responseMode: "debate_or_brainstorm" as const,
        summaryText: "本轮参与 2 人",
        participants: [
          {
            agentId: "panda",
            displayName: "熊猫学习",
            tier: "duty" as const,
            contributionRole: "lead" as const,
            reasonText: "主答",
          },
          {
            agentId: "bot-skill",
            displayName: "Skill孵化",
            tier: "duty" as const,
            contributionRole: "supplement" as const,
            reasonText: "补充",
          },
        ],
      },
      lowSignalLimited: false,
      mentionUnmatched: false,
      primaryMode: "single" as const,
      mentionMode: "none" as const,
      primaryQueue: ["panda"],
    };
    const lead = buildCollaborationDiscussionTurnPrompt({
      scope,
      bot: createBot("panda", "熊猫学习"),
      decision,
      participationTier: "duty",
      contributionRole: "lead",
      userMessage: "大家好",
      dispatchRole: "primary",
    });
    expect(lead).toContain("必须用一两句中文直接回答");
    expect(lead).not.toContain("请直接返回 NO_REPLY");
    expect(lead).not.toContain("若没有明显增量，返回 NO_REPLY");
    const supplement = buildCollaborationDiscussionTurnPrompt({
      scope,
      bot: createBot("bot-skill", "Skill孵化"),
      decision,
      participationTier: "duty",
      contributionRole: "supplement",
      userMessage: "大家好",
      dispatchRole: "supplement",
    });
    expect(supplement).toContain("请直接返回 NO_REPLY");
    const fallback = buildCollaborationDiscussionTurnPrompt({
      scope,
      bot: createBot("bot-skill", "Skill孵化"),
      decision,
      participationTier: "duty",
      contributionRole: "supplement",
      userMessage: "你们大家现在还是不能接任务吗",
      dispatchRole: "fallback",
    });
    expect(fallback).toContain("必须用一两句中文直接回答");
    expect(fallback).not.toContain("请直接返回 NO_REPLY");
  });

  describe("no-coordinator orchestration (round 3cc87151)", () => {
    const panda = DIGITAL_TEAM_BOTS.panda;
    const decision: ParticipationDecision = {
      roundId: ORCHESTRATION_ROUND.roundId,
      responseMode: "lead_plus_supplement",
      tier0: [panda],
      tier1: [],
      tier2: [],
      executionBots: [panda],
      roundPlan: {
        roundId: ORCHESTRATION_ROUND.roundId,
        sessionKey: "space:grp-daniel-hhd-gmail-com-upbeyond",
        responseMode: "lead_plus_supplement",
        summaryText: "本轮参与 1 人",
        participants: [
          {
            agentId: "panda",
            displayName: "熊猫学习",
            tier: "mention",
            contributionRole: "lead",
            reasonText: "熊猫学习 已被点名",
          },
        ],
      },
      lowSignalLimited: false,
      mentionUnmatched: false,
      primaryMode: "single",
      mentionMode: "single_primary",
      primaryQueue: ["panda"],
    };

    test("@mentioned primary gets an agentId roster and the round-scoped edge path", () => {
      const prompt = buildCollaborationDiscussionTurnPrompt({
        scope: createDigitalTeamScope(),
        bot: panda,
        decision,
        participationTier: "mention",
        contributionRole: "lead",
        userMessage: ORCHESTRATION_ROUND.userMessage,
        replyLanguage: "zh",
      });
      expect(prompt).toContain("市场助手=bot-2");
      expect(prompt).toContain("高密度分析=bot--agent");
      expect(prompt).not.toContain("熊猫学习=panda");
      expect(prompt).toContain("本群未设协调者");
      expect(prompt).toContain("临时编排者");
      expect(prompt).toContain("不要调用 organization_tasks");
      expect(prompt).toContain("[[collab_edge:handoff|to=agentId");
    });

    test("groups with a coordinator do not get the delegate instructions", () => {
      const prompt = buildCollaborationDiscussionTurnPrompt({
        scope: createDigitalTeamScope({ coordinatorBotId: "bot" }),
        bot: panda,
        decision,
        participationTier: "mention",
        contributionRole: "lead",
        userMessage: ORCHESTRATION_ROUND.userMessage,
        replyLanguage: "zh",
      });
      expect(prompt).not.toContain("本群未设协调者");
      expect(prompt).toContain("[[collab_edge:");
    });

    test("edge targets are told what was handed off and must not go silent", () => {
      const [edge] = parseCollabEdgesFromText({
        text: ORCHESTRATION_ROUND.edgeReply,
        fromAgentId: "panda",
        resolveTargetAgentId: createCollabEdgeTargetResolver(createDigitalTeamScope().bots),
      }).edges;
      expect(edge?.toAgentId).toBe("bot-2");
      const prompt = buildCollaborationDiscussionTurnPrompt({
        scope: createDigitalTeamScope(),
        bot: DIGITAL_TEAM_BOTS.market,
        decision,
        participationTier: "duty",
        contributionRole: "supplement",
        userMessage: ORCHESTRATION_ROUND.userMessage,
        replyLanguage: "zh",
        dispatchRole: "supplement",
        collabEdge: edge,
      });
      expect(prompt).toContain("本轮主答 熊猫学习 把子任务交给你：AI办公软件市场规模与竞品格局");
      expect(prompt).toContain("需要你完成：市场规模/竞争格局/定价/采购要素");
      expect(prompt).toContain("验收标准：给出数据来源");
      expect(prompt).not.toContain("请直接返回 NO_REPLY");
      expect(prompt).toContain("不要再发起新的 collab_edge");
      // Edge targets are depth-1 leaves: no edge-authoring instructions.
      expect(prompt).not.toContain("[[collab_edge:peer_ask|to=agentId");
    });
  });

  test("sharedDocCard appears when provided", () => {
    const scope: CollaborationDispatchScope = {
      groupId: "alpha",
      rawSessionKey: "space:alpha",
      title: "数字人战队",
      bots: [createBot("bot", "高级秘书")],
    };
    const decision = {
      roundId: "round-shared-doc",
      responseMode: "lead_plus_supplement" as const,
      tier0: [],
      tier1: [createBot("bot", "高级秘书")],
      tier2: [],
      executionBots: [createBot("bot", "高级秘书")],
      roundPlan: {
        roundId: "round-shared-doc",
        participants: [
          {
            agentId: "bot",
            displayName: "高级秘书",
            tier: "mention" as const,
            contributionRole: "lead" as const,
            reasonText: "primary",
          },
        ],
      },
    };
    const prompt = buildCollaborationDiscussionTurnPrompt({
      scope,
      bot: createBot("bot", "高级秘书"),
      decision: decision as ParticipationDecision,
      participationTier: "mention",
      contributionRole: "lead",
      sharedDocCard: "[共享文档]\n路径：deliverables/report.md\n标题：Report",
      sharedDocWorkspaceRoot: "/tmp/does-not-exist-shared-doc",
    });
    expect(prompt).toContain("[共享文档]");
    expect(prompt).toContain("deliverables/report.md");
  });
});
