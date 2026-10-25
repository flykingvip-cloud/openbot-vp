import type { AssistantMessage } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import {
  applyUserVisibleOutputGate,
  mergeAssistantVisibleText,
  PROTOCOL_FAILURE_USER_TEXT,
  stripProtocolTextFromAssistantMessages,
} from "./model-output-boundary.js";
import { extractAssistantText } from "./pi-embedded-utils.js";

const OFFICIAL_DSML = [
  "好的老大，我现在开始检查 spy-competitor-ads。",
  "<｜DSML｜tool_calls>",
  '<｜DSML｜invoke name="browser">',
  '<｜DSML｜parameter name="action" string="true">launch</｜DSML｜parameter>',
  '<｜DSML｜parameter name="profile" string="true">openclaw</｜DSML｜parameter>',
  "</｜DSML｜invoke>",
  "</｜DSML｜tool_calls>",
].join("\n");

const SCREENSHOT_DSML = [
  "好的老大，下一步我来抓取。",
  "<|DSML| | tool_calls>",
  '<|DSML| | invoke name="browser">',
  '<|DSML| | parameter name="action" string="true">launch</|DSML| | parameter>',
  "</|DSML| | invoke>",
  "</|DSML| | tool_calls>",
].join("\n");

function makeAssistant(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "openai",
    model: "deepseek-v4-flash",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

describe("model output boundary", () => {
  it("does not treat DSML protocol text as user-visible content", () => {
    const gated = applyUserVisibleOutputGate(OFFICIAL_DSML);
    expect(gated.detected).toBe(true);
    expect(gated.protocol).toBe("dsml");
    expect(gated.visibleText).toBe("好的老大，我现在开始检查 spy-competitor-ads。");
    expect(gated.visibleText).not.toContain("DSML");
    expect(gated.visibleText).not.toContain("tool_calls");
    expect(gated.recoveredCalls).toEqual([
      expect.objectContaining({
        toolName: "browser",
        source: "adapter",
        arguments: {},
      }),
    ]);
  });

  it("strips the ASCII/spaced screenshot leak without executing it as a tool call", () => {
    const gated = applyUserVisibleOutputGate(SCREENSHOT_DSML);
    expect(gated.detected).toBe(true);
    expect(gated.visibleText).toBe("好的老大，下一步我来抓取。");
    expect(gated.visibleText).not.toMatch(/<\|DSML\|/);
  });

  it("holds incomplete streamed DSML so later chunks cannot leak", () => {
    const prefix = applyUserVisibleOutputGate("好的老大，我来检查\n<|DSML|");
    expect(prefix.detected).toBe(true);
    expect(prefix.incomplete).toBe(true);
    expect(prefix.visibleText).toBe("好的老大，我来检查");
    expect(prefix.visibleText).not.toContain("DSML");
    expect(
      applyUserVisibleOutputGate("好的老大，我来检查\n<", { streaming: true }).visibleText,
    ).toBe("好的老大，我来检查");

    const doublePipe = applyUserVisibleOutputGate("我继续盘点\n<｜｜DSML", { streaming: true });
    expect(doublePipe.detected).toBe(true);
    expect(doublePipe.incomplete).toBe(true);
    expect(doublePipe.visibleText).toBe("我继续盘点");
    expect(doublePipe.visibleText).not.toContain("DSML");
  });

  it("holds a split <| opener while streaming without treating math comparisons as protocol", () => {
    const midTag = applyUserVisibleOutputGate("好的老大，我来检查\n<|", { streaming: true });
    expect(midTag.detected).toBe(true);
    expect(midTag.incomplete).toBe(true);
    expect(midTag.visibleText).toBe("好的老大，我来检查");
    expect(midTag.visibleText).not.toContain("<|");

    const bareLt = applyUserVisibleOutputGate("好的老大\n<", { streaming: true });
    expect(bareLt.incomplete).toBe(true);
    expect(bareLt.visibleText).toBe("好的老大");

    const comparison = applyUserVisibleOutputGate("threshold is 3 < 5");
    expect(comparison.detected).toBe(false);
    expect(comparison.visibleText).toBe("threshold is 3 < 5");

    const trailingLt = applyUserVisibleOutputGate("threshold is 3 <");
    expect(trailingLt.detected).toBe(false);
    expect(trailingLt.visibleText).toBe("threshold is 3 <");
  });

  it("does not rewrite ordinary assistant text that mentions tools", () => {
    const text = "我可以用 browser 工具打开页面，但现在先说明步骤。";
    const gated = applyUserVisibleOutputGate(text);
    expect(gated.detected).toBe(false);
    expect(gated.visibleText).toBe(text);
  });

  it("strips protocol-only output before extractAssistantText", () => {
    expect(extractAssistantText(makeAssistant(SCREENSHOT_DSML))).toBe("好的老大，下一步我来抓取。");
    expect(extractAssistantText(makeAssistant(OFFICIAL_DSML))).not.toContain("DSML");
  });

  it("removes DSML from assistant history so the next model turn cannot learn it", () => {
    const messages = stripProtocolTextFromAssistantMessages([
      { role: "user", content: "继续" },
      { role: "assistant", content: [{ type: "text", text: OFFICIAL_DSML }] },
    ]);
    const assistant = messages[1]?.content as Array<{ text?: string }>;
    expect(JSON.stringify(assistant)).not.toContain("DSML");
    expect(assistant[0]?.text).toBe("好的老大，我现在开始检查 spy-competitor-ads。");
  });

  it("keeps the failure copy available when nothing user-visible remains", () => {
    const gated = applyUserVisibleOutputGate(
      '<｜DSML｜tool_calls><｜DSML｜invoke name="browser"></｜DSML｜invoke></｜DSML｜tool_calls>',
    );
    expect(gated.visibleText).toBe("");
    expect(gated.detected).toBe(true);
    expect(PROTOCOL_FAILURE_USER_TEXT).toContain("本步工具调用未能执行");
  });

  it("lets chat merge shrink after protocol text is stripped", () => {
    const leaked = SCREENSHOT_DSML;
    const merged = mergeAssistantVisibleText({
      previousText: leaked,
      nextText: "好的老大，下一步我来抓取。",
      nextDelta: "",
    });
    expect(merged).toBe("好的老大，下一步我来抓取。");
    expect(merged).not.toContain("DSML");
  });

  it("strips DeepSeek double-fullwidth-pipe DSML and detects tool name without executable args", () => {
    const leaked = [
      "老大，我先把之前的 skill 盘点成果接上。",
      "<｜｜DSML｜｜tool_calls>",
      '<｜｜DSML｜｜invoke name="exec">',
      '<｜｜DSML｜｜parameter name="command" string="true">ls -1 ~/.openbot/skills/</｜｜DSML｜｜parameter>',
      "</｜｜DSML｜｜invoke>",
      "</｜｜DSML｜｜tool_calls>",
    ].join("\n");
    const gated = applyUserVisibleOutputGate(leaked);
    expect(gated.detected).toBe(true);
    expect(gated.protocol).toBe("dsml");
    expect(gated.incomplete).toBe(false);
    expect(gated.visibleText).toBe("老大，我先把之前的 skill 盘点成果接上。");
    expect(gated.visibleText).not.toMatch(/DSML|tool_calls|invoke/i);
    expect(gated.recoveredCalls).toEqual([
      expect.objectContaining({
        toolName: "exec",
        source: "adapter",
        arguments: {},
      }),
    ]);
  });

  it("does not strip DSML examples inside fenced code", () => {
    const fenced = ["说明：", "```xml", "<|DSML| | tool_calls>", "```"].join("\n");
    const gated = applyUserVisibleOutputGate(fenced);
    expect(gated.detected).toBe(false);
    expect(gated.visibleText).toContain("tool_calls");
  });

  it("strips English CoT scratchpad from assistant history for next-turn context", () => {
    const messages = stripProtocolTextFromAssistantMessages([
      { role: "user", content: "继续" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me inspect the sandbox path." },
          {
            type: "text",
            text: [
              "The skill is outside my sandbox. Let me try exec.",
              "",
              "请点本机只读授权后继续。",
            ].join("\n"),
          },
        ],
      },
    ]);
    const assistant = messages[1]?.content as Array<{
      type?: string;
      text?: string;
      thinking?: string;
    }>;
    const text = assistant.find((b) => b.type === "text");
    const thinking = assistant.find((b) => b.type === "thinking");
    expect(text?.text).toContain("请点本机只读授权");
    expect(text?.text).not.toMatch(/sandbox/i);
    expect(text?.text).not.toMatch(/Let me/i);
    // Process channel stays structurally present; dropThinkingBlocks decides model feed.
    expect(thinking?.thinking).toContain("sandbox path");
  });
});

describe("MiniMax marked protocol in applyUserVisibleOutputGate", () => {
  const MINIMAX = [
    "我来读取。",
    "<minimax:tool_call>",
    '<invoke name="browser">',
    '<parameter name="action">launch</parameter>',
    "</invoke>",
    "</minimax:tool_call>",
  ].join("\n");

  it("detects pure MiniMax body and strips markers", () => {
    const gated = applyUserVisibleOutputGate(MINIMAX);
    expect(gated.detected).toBe(true);
    expect(gated.protocol).toBe("minimax");
    expect(gated.visibleText).toBe("我来读取。");
    expect(gated.recoveredCalls[0]?.toolName).toBe("browser");
    expect(gated.visibleText).not.toContain("minimax");
  });

  it("keeps fenced MiniMax examples non-detected", () => {
    const fenced = ["示例", "```", "<minimax:tool_call>", "```"].join("\n");
    expect(applyUserVisibleOutputGate(fenced).detected).toBe(false);
  });

  it("does not treat bare XML invoke as MiniMax", () => {
    expect(
      applyUserVisibleOutputGate('<invoke name="read"><parameter>x</parameter></invoke>').detected,
    ).toBe(false);
  });

  it("marks truncated MiniMax as incomplete", () => {
    const gated = applyUserVisibleOutputGate('prefix\n<minimax:tool_call>\n<invoke name="read">');
    expect(gated.detected).toBe(true);
    expect(gated.incomplete).toBe(true);
    expect(gated.protocol).toBe("minimax");
  });
});
