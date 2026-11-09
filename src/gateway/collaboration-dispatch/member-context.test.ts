import { describe, expect, test } from "vitest";
import { assertMemberContextFitsModel } from "./member-context.js";
import {
  CollaborationMemberContextBudgetError,
  COLLABORATION_MEMBER_CONTEXT_MAX_CHARS,
  readCollaborationMemberContext,
} from "./member-context.js";
import { formatSameRoundContextForPrompt } from "./same-round-context.js";

describe("per-member public context preparation", () => {
  test("refreshes interjections and completed replies without removing the last message", () => {
    const messages = [{ id: "trigger", role: "user", content: "原始问题", timestamp: 1 }];
    const replies = [{ agentId: "a", agentName: "A", contributionRole: "lead", text: "成员建议" }];
    const first = readCollaborationMemberContext({
      readMessages: () => messages,
      triggeringMessageId: "trigger",
      completedReplies: [],
    });
    expect(first.groupInboundHistory).toEqual([]);
    messages.push({
      id: "human-update",
      role: "user",
      content: "补充：只做调查，不发布",
      timestamp: 2,
    });
    const second = readCollaborationMemberContext({
      readMessages: () => messages,
      triggeringMessageId: "trigger",
      completedReplies: replies,
    });
    expect(second.groupInboundHistory.map((entry) => entry.body)).toEqual([
      "补充：只做调查，不发布",
    ]);
    expect(formatSameRoundContextForPrompt(second.sameRoundContext!)).toContain("成员建议");
    expect(first.sameRoundContext).toBeUndefined();
  });

  test("does not inject private tool or system entries from a public transcript", () => {
    const context = readCollaborationMemberContext({
      readMessages: () => [
        { role: "system", content: "internal system details" },
        { role: "toolResult", content: "secret tool value" },
        { role: "assistant", content: "公开结论", timestamp: 3 },
      ],
      triggeringMessageId: "trigger",
      completedReplies: [],
    });
    expect(context.groupInboundHistory.map((entry) => entry.body)).toEqual(["公开结论"]);
  });

  test.each(["history", "reply"] as const)(
    "refuses oversized %s without silently cutting constraints",
    (source) => {
      const text = "x".repeat(COLLABORATION_MEMBER_CONTEXT_MAX_CHARS) + "禁止发布";
      expect(() =>
        readCollaborationMemberContext({
          readMessages: () => (source === "history" ? [{ role: "user", content: text }] : []),
          triggeringMessageId: "trigger",
          completedReplies:
            source === "reply"
              ? [{ agentId: "a", agentName: "A", contributionRole: "lead", text }]
              : [],
        }),
      ).toThrow(CollaborationMemberContextBudgetError);
    },
  );

  test("propagates transcript read errors rather than running with a stale fallback", () => {
    expect(() =>
      readCollaborationMemberContext({
        readMessages: () => {
          throw new Error("read failed");
        },
        triggeringMessageId: "trigger",
        completedReplies: [],
      }),
    ).toThrow("read failed");
  });
});

test("selected model window changes admission without dropping Chinese constraints", () => {
  const history = [{ body: "中文限制禁止发布".repeat(100) }];
  expect(() => assertMemberContextFitsModel({ contextWindowTokens: 1024, history })).toThrow(
    "尚未启动",
  );
  expect(assertMemberContextFitsModel({ contextWindowTokens: 32000, history }).budgetTokens).toBe(
    8000,
  );
  expect(() => assertMemberContextFitsModel({ contextWindowTokens: NaN, history })).toThrow(
    "窗口未知",
  );
});
