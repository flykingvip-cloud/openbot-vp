import { describe, expect, test } from "vitest";
import {
  classifyNumberedDecisionReply,
  isLastSpeakerFollowUpMessage,
  isRecentFollowUpMessage,
  resolveDirectedDecisionTargetBot,
  resolveLastSpeakerFollowUpBot,
  resolveRecentFollowUpBot,
} from "./directed-decision-reply.js";
import type { CollaborationBotTarget } from "./types.js";

function createBot(agentId: string, name: string): CollaborationBotTarget {
  return {
    agentId,
    name,
    sessionKey: `agent:${agentId}:main:space:alpha`,
    updatedAt: 1,
  };
}

describe("directed decision reply", () => {
  test("classifies numbered human decision replies", () => {
    expect(classifyNumberedDecisionReply('1. festival-knowledge 2.先只做"端午" 3.不需要')).toBe(
      true,
    );
    expect(classifyNumberedDecisionReply("好的，收到")).toBe(false);
    expect(classifyNumberedDecisionReply("@Skill孵化 1. a 2. b")).toBe(false);
  });

  test("routes numbered replies to the bot who asked the questionnaire", () => {
    const bots = [
      createBot("main", "大白管家"),
      createBot("bot-skill", "Skill孵化"),
      createBot("bot", "高级秘书"),
    ];
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

    const target = resolveDirectedDecisionTargetBot({
      message: '1. festival-knowledge 2.先只做"端午" 3.不需要',
      recentGroupMessages,
      bots,
    });

    expect(target?.agentId).toBe("bot-skill");
  });

  test("routes language follow-up to the last visible speaker", () => {
    expect(isLastSpeakerFollowUpMessage("请输出中文")).toBe(true);
    expect(isLastSpeakerFollowUpMessage("请用中文回复")).toBe(true);
    expect(isLastSpeakerFollowUpMessage("@市场助手 请输出中文")).toBe(false);

    const bots = [createBot("bot-2", "市场助手"), createBot("main", "大白管家")];
    const target = resolveLastSpeakerFollowUpBot({
      message: "请输出中文",
      recentGroupMessages: [
        {
          role: "assistant",
          senderLabel: "市场助手",
          content: [{ type: "text", text: "Good afternoon. I'm the Market Assistant." }],
          timestamp: 1,
        },
      ],
      bots,
    });
    expect(target?.agentId).toBe("bot-2");
  });

  test("recognizes short corrections / clarifications, not new tasks", () => {
    expect(isRecentFollowUpMessage("我并没有将任务派发给大白管家，大白管家也不在这个群里")).toBe(
      true,
    );
    expect(isRecentFollowUpMessage("不对，我要的是国内市场")).toBe(true);
    expect(isRecentFollowUpMessage("你理解错了，范围只看 B 端")).toBe(true);
    expect(isRecentFollowUpMessage("为什么不能直接派任务？")).toBe(true);
    expect(isRecentFollowUpMessage("请分析一下AI办公软件的定价策略")).toBe(false);
    expect(isRecentFollowUpMessage("那我们开始新任务：做竞品分析")).toBe(false);
    expect(isRecentFollowUpMessage("@熊猫学习 不对")).toBe(false);
    expect(isRecentFollowUpMessage(`不对，${"很长的补充说明".repeat(20)}`)).toBe(false);
  });

  test("follow-up resolves to the previous round's primary, not a later supplement", () => {
    const bots = [createBot("panda", "熊猫学习"), createBot("bot-2", "市场助手")];
    const messages = [
      { role: "user", content: "@熊猫学习 做调研", timestamp: 1_000, senderLabel: "CEO" },
      {
        role: "assistant",
        content: [{ type: "text", text: "主答：分工如下" }],
        timestamp: 2_000,
        senderLabel: "熊猫学习",
        collaborationRoundId: "r1",
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "补充：市场数据" }],
        timestamp: 3_000,
        senderLabel: "市场助手",
        collaborationRoundId: "r1",
      },
    ];
    expect(
      resolveRecentFollowUpBot({
        message: "不对，我说的是国内",
        recentGroupMessages: messages,
        bots,
        nowMs: 60_000,
        senderLabel: "CEO",
      })?.agentId,
    ).toBe("panda");
    // Previous human turn got no bot reply → no follow-up stickiness.
    expect(
      resolveRecentFollowUpBot({
        message: "不对，我说的是国内",
        recentGroupMessages: [...messages, { role: "user", content: "还有人吗", timestamp: 4_000 }],
        bots,
        nowMs: 60_000,
      }),
    ).toBeNull();
    // Missing timestamps are rejected (conservative).
    expect(
      resolveRecentFollowUpBot({
        message: "不对，我说的是国内",
        recentGroupMessages: messages.map(({ timestamp: _ts, ...rest }) => rest),
        bots,
        nowMs: 60_000,
      }),
    ).toBeNull();
  });
});
