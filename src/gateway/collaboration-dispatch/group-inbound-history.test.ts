import { describe, expect, test } from "vitest";
import {
  buildCollaborationGroupInboundHistory,
  isIntroductionFollowUpMessage,
  resolveBotsAlreadyIntroducedInThread,
} from "./group-inbound-history.js";
import type { CollaborationBotTarget } from "./types.js";

const bots: CollaborationBotTarget[] = [
  { agentId: "main", name: "大白管家", sessionKey: "a", updatedAt: 1 },
  { agentId: "bot-skill", name: "Skill孵化", sessionKey: "b", updatedAt: 1 },
  { agentId: "bot", name: "高级秘书", sessionKey: "c", updatedAt: 1 },
  { agentId: "bot-2", name: "市场助手", sessionKey: "d", updatedAt: 1 },
];

describe("collaboration group inbound history", () => {
  test("treats a missing transcript as no history", () => {
    expect(buildCollaborationGroupInboundHistory({ messages: undefined })).toEqual([]);
  });

  test("keeps visible text that sits beside tool, thinking, and hole blocks", () => {
    const history = buildCollaborationGroupInboundHistory({
      messages: [
        {
          role: "assistant",
          senderLabel: "协作成员",
          timestamp: 5,
          content: [
            { type: "thinking", thinking: "draft" },
            null,
            { type: "text", text: "这一轮的可见回复已经写好。" },
            { type: "toolCall", name: "search" },
          ],
        },
      ],
    });
    expect(history.map((entry) => entry.body)).toEqual(["这一轮的可见回复已经写好。"]);
  });

  test("builds inbound history with sender labels", () => {
    const history = buildCollaborationGroupInboundHistory({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "各位介绍一下自己" }],
          timestamp: 1,
          senderLabel: "Daniel",
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "我是 Skill孵化" }],
          timestamp: 2,
          senderLabel: "Skill孵化",
        },
      ],
    });
    expect(history).toEqual([
      { sender: "Daniel", body: "各位介绍一下自己", timestamp: 1 },
      { sender: "Skill孵化", body: "我是 Skill孵化", timestamp: 2 },
    ]);
  });

  test("skips tool dumps and infra failures from injected history", () => {
    const history = buildCollaborationGroupInboundHistory({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "下午好" }],
          timestamp: 1,
          senderLabel: "CEO",
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "NO_REPLY" }],
          timestamp: 2,
        },
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: '400: {"message":"Requested model Qwen3.6-35B-A3B not supported"}',
            },
          ],
          timestamp: 3,
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "Good afternoon. I'm the Market Assistant." }],
          timestamp: 4,
          senderLabel: "市场助手",
        },
      ],
    });
    expect(history.map((entry) => entry.body)).toEqual([
      "下午好",
      "Good afternoon. I'm the Market Assistant.",
    ]);
  });

  test("detects introduction follow-up prompts", () => {
    expect(isIntroductionFollowUpMessage("其他人也介绍一下自己")).toBe(true);
    expect(isIntroductionFollowUpMessage("各位介绍一下自己")).toBe(false);
  });

  test("tracks bots who already introduced in the thread", () => {
    const already = resolveBotsAlreadyIntroducedInThread({
      userMessage: "其他人也介绍一下自己",
      bots,
      messages: [
        { role: "user", content: [{ type: "text", text: "各位介绍一下自己" }], timestamp: 1 },
        {
          role: "assistant",
          content: [{ type: "text", text: "大家好，我是 Skill孵化，负责技能孵化。" }],
          timestamp: 2,
          senderLabel: "Skill孵化",
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "大家好，我是高级秘书，负责行政协调。" }],
          timestamp: 3,
          senderLabel: "高级秘书",
        },
        { role: "user", content: [{ type: "text", text: "其他人也介绍一下自己" }], timestamp: 4 },
      ],
    });
    expect([...already].toSorted()).toEqual(["bot", "bot-skill"]);
  });
});

test("excludes the triggering identity while retaining later human interjections", () => {
  const history = buildCollaborationGroupInboundHistory({
    messages: [
      { id: "trigger", role: "user", content: "原始问题", timestamp: 1 },
      { id: "update", role: "user", content: "补充限制", timestamp: 2 },
    ],
    excludeMessageId: "trigger",
  });
  expect(history.map((entry) => entry.body)).toEqual(["补充限制"]);
});
