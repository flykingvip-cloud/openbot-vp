import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  COLLAB_GROUP_MAX_RECENT_TURNS,
  isCollaborationCollabCompileStrategyEnabled,
  projectUnitMessagesRetainMemberConclusions,
  resolveCollabGroupMaxRecentTurns,
  shouldApplyCollabCompileStrategy,
} from "./collab-compile-strategy.js";

function user(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: Date.now() } as AgentMessage;
}

function assistant(text: string): AgentMessage {
  return { role: "assistant", content: text, timestamp: Date.now() } as unknown as AgentMessage;
}

function texts(messages: AgentMessage[]): string[] {
  return messages.map((m) => {
    const content = (m as { content?: unknown }).content;
    return typeof content === "string" ? content : JSON.stringify(content ?? "");
  });
}

describe("collab compile strategy flag", () => {
  afterEach(() => {
    delete process.env.OPENBOT_COLLAB_COMPILE_STRATEGY;
  });

  it("defaults off", () => {
    expect(isCollaborationCollabCompileStrategyEnabled()).toBe(false);
    expect(shouldApplyCollabCompileStrategy({ sessionKey: "space:grp-1", cfg: {} })).toBe(false);
  });

  it("enables via config or env only for group sessions", () => {
    expect(
      shouldApplyCollabCompileStrategy({
        sessionKey: "space:grp-1",
        cfg: { collaboration: { collabCompileStrategy: true } },
      }),
    ).toBe(true);
    expect(
      shouldApplyCollabCompileStrategy({
        sessionKey: "agent:main:main",
        cfg: { collaboration: { collabCompileStrategy: true } },
      }),
    ).toBe(false);
    process.env.OPENBOT_COLLAB_COMPILE_STRATEGY = "1";
    expect(shouldApplyCollabCompileStrategy({ sessionKey: "space:grp-x" })).toBe(true);
  });

  it("uses modest group windows (not global double)", () => {
    expect(resolveCollabGroupMaxRecentTurns("chat")).toBe(14);
    expect(resolveCollabGroupMaxRecentTurns("retrieve")).toBe(16);
    expect(resolveCollabGroupMaxRecentTurns("act")).toBe(18);
    expect(COLLAB_GROUP_MAX_RECENT_TURNS.act).toBeLessThan(24);
  });
});

describe("projectUnitMessagesRetainMemberConclusions", () => {
  it("keeps final reply plus earlier disagreement / conclusion", () => {
    const projected = projectUnitMessagesRetainMemberConclusions([
      user("请评审方案"),
      assistant("主答：方案可行，按 A 推进。"),
      assistant("但是我认为风险偏高，建议先做小范围试点再铺开。"),
      assistant("收束：采纳试点路径。"),
    ]);
    const body = texts(projected).join("\n");
    expect(body).toContain("请评审方案");
    expect(body).toContain("风险偏高");
    expect(body).toContain("采纳试点路径");
  });

  it("does not invent assistants when only one reply exists", () => {
    const projected = projectUnitMessagesRetainMemberConclusions([
      user("你好"),
      assistant("你好，有什么可以帮忙？"),
    ]);
    expect(projected).toHaveLength(2);
  });
});
