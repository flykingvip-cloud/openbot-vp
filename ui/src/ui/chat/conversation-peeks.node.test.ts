import { describe, expect, it } from "vitest";
import {
  applyConversationPeekVisibility,
  buildConversationPeeks,
  CONVERSATION_PEEK_LIMIT,
  CONVERSATION_PEEK_WAVE_MAX,
  CONVERSATION_PEEK_WAVE_MIN,
  conversationPeekFitLimit,
  conversationPeekWaveLength,
  splitUserPeekCopy,
} from "./conversation-peeks.ts";

describe("splitUserPeekCopy", () => {
  it("uses the first line as title and the next lines as preview", () => {
    const copy = splitUserPeekCopy(
      [
        "请按 6efc8e811a 验收。",
        "6efc8e811a 暂不通过验收，存在一个 P1 祖母隔离问题。",
        "src/diagnosis/report.ts:91 允许一个报告同时包含多条结论。",
        "extra line that should be clipped",
      ].join("\n"),
    );
    expect(copy.title).toBe("请按 6efc8e811a 验收。");
    expect(copy.preview).toContain("暂不通过验收");
    expect(copy.preview).toContain("src/diagnosis/report.ts:91");
    expect(copy.preview).toContain("…");
    expect(copy.preview.split("\n")).toHaveLength(2);
  });

  it("splits a single-line message on the first sentence", () => {
    const copy = splitUserPeekCopy("请复检 P1。compose 只同步两层，第三层没有落盘。");
    expect(copy.title).toBe("请复检 P1。");
    expect(copy.preview).toBe("compose 只同步两层，第三层没有落盘。");
  });

  it("keeps a short single sentence as title only", () => {
    expect(splitUserPeekCopy("继续")).toEqual({ title: "继续", preview: "" });
  });
});

describe("buildConversationPeeks", () => {
  it("omits the latest user message and keeps earlier locatable turns", () => {
    const peeks = buildConversationPeeks([
      { id: "u1", role: "user", content: "第一轮\n细节 A" },
      { id: "a1", role: "assistant", content: "ok" },
      { id: "u2", role: "user", content: "第二轮\n细节 B" },
      { id: "u3", role: "user", content: "第三轮\n细节 C" },
      { id: "u4", role: "user", content: "第四轮\n细节 D" },
      { id: "u5", role: "user", content: "当前回合\n不应出现" },
    ]);
    expect(peeks.map((peek) => peek.messageId)).toEqual(["u1", "u2", "u3", "u4"]);
    expect(peeks.some((peek) => peek.title.includes("当前回合"))).toBe(false);
    expect(peeks.length).toBeLessThanOrEqual(CONVERSATION_PEEK_LIMIT);
  });

  it("makes the tick longest at the pointer and shorter farther away", () => {
    expect(conversationPeekWaveLength(0)).toBeCloseTo(CONVERSATION_PEEK_WAVE_MAX);
    expect(conversationPeekWaveLength(80)).toBeLessThan(conversationPeekWaveLength(20));
    expect(conversationPeekWaveLength(200)).toBeCloseTo(CONVERSATION_PEEK_WAVE_MIN, 0);
  });

  it("returns nothing when there are fewer than two locatable user messages", () => {
    expect(buildConversationPeeks([{ id: "only", role: "user", content: "单独一条" }])).toEqual([]);
    expect(buildConversationPeeks([{ role: "assistant", content: "hi", id: "a1" }])).toEqual([]);
  });

  it("skips user messages without an id or extractable text", () => {
    const peeks = buildConversationPeeks([
      { role: "user", content: "没有 id" },
      { id: "   ", role: "user", content: "空白 id" },
      { id: "empty", role: "user", content: "   " },
      { messageId: "kept", role: "User", content: [{ type: "text", text: "可跳转\n第二行" }] },
      { id: "latest", role: "user", content: "最新" },
    ]);
    expect(peeks).toEqual([
      {
        key: "peek:kept",
        messageId: "kept",
        title: "可跳转",
        preview: "第二行",
      },
    ]);
  });

  it("does not read assistant replies or invent summaries", () => {
    const peeks = buildConversationPeeks([
      { id: "u1", role: "user", content: "请复检 P1" },
      { id: "a1", role: "assistant", content: "AI 摘要不该出现" },
      { id: "u2", role: "user", content: "下一步执行 P3.8" },
    ]);
    expect(peeks).toHaveLength(1);
    expect(peeks[0]?.title).toBe("请复检 P1");
    expect(JSON.stringify(peeks)).not.toContain("AI 摘要");
  });

  it("keeps at most 35 prior turns and drops the oldest when over the cap", () => {
    const messages = Array.from({ length: 40 }, (_, index) => ({
      id: `u${index + 1}`,
      role: "user",
      content: `回合 ${index + 1}`,
    }));
    const peeks = buildConversationPeeks(messages);
    expect(peeks).toHaveLength(CONVERSATION_PEEK_LIMIT);
    expect(peeks[0]?.messageId).toBe("u5");
    expect(peeks.at(-1)?.messageId).toBe("u39");
    expect(peeks.some((peek) => peek.messageId === "u1" || peek.messageId === "u40")).toBe(false);
  });
});

describe("conversationPeekFitLimit", () => {
  it("caps at 35 even when the full reader could fit more", () => {
    expect(conversationPeekFitLimit(1200)).toBe(CONVERSATION_PEEK_LIMIT);
  });

  it("uses the lower half when the upper half is not enough", () => {
    expect(conversationPeekFitLimit(335)).toBe(29);
    expect(conversationPeekFitLimit(335)).toBeLessThan(CONVERSATION_PEEK_LIMIT);
    expect(conversationPeekFitLimit(335)).toBeGreaterThan(12);
  });

  it("does not flash the hard cap before the thread has a height", () => {
    expect(conversationPeekFitLimit(0)).toBe(0);
    expect(conversationPeekFitLimit(Number.NaN)).toBe(0);
    expect(conversationPeekFitLimit(-10)).toBe(0);
  });

  it("hides every row when the reader height is still unknown", () => {
    const items: Array<{ hidden: boolean | string }> = [{ hidden: false }, { hidden: false }];
    applyConversationPeekVisibility(items, conversationPeekFitLimit(0));
    expect(items.every((item) => item.hidden)).toBe(true);
  });

  it("hides the oldest rows first so growth stays downward", () => {
    const items: Array<{ hidden: boolean | string }> = Array.from({ length: 16 }, () => ({
      hidden: false,
    }));
    applyConversationPeekVisibility(items, 12);
    expect(items.filter((item) => item.hidden)).toHaveLength(4);
    expect(items.slice(0, 4).every((item) => item.hidden)).toBe(true);
    expect(items.slice(4).every((item) => !item.hidden)).toBe(true);
  });
});
