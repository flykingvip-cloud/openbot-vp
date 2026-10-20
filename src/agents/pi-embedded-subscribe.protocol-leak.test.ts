import type { AssistantMessage } from "@earendil-works/pi-ai/compat";
import { describe, expect, it, vi } from "vitest";
import { PROTOCOL_FAILURE_USER_TEXT } from "./model-output-boundary.js";
import {
  createStubSessionHarness,
  emitAssistantTextDelta,
  extractAgentEventPayloads,
} from "./pi-embedded-subscribe.e2e-harness.js";
import { subscribeEmbeddedPiSession } from "./pi-embedded-subscribe.js";

const SCREENSHOT_DSML = [
  "好的老大，下一步我来抓取。",
  "<|DSML| | tool_calls>",
  '<|DSML| | invoke name="browser">',
  '<|DSML| | parameter name="action" string="true">launch</|DSML| | parameter>',
  "</|DSML| | invoke>",
  "</|DSML| | tool_calls>",
].join("\n");

const PROTOCOL_ONLY = [
  "<|DSML| | tool_calls>",
  '<|DSML| | invoke name="browser">',
  "</|DSML| | invoke>",
  "</|DSML| | tool_calls>",
].join("\n");

describe("subscribeEmbeddedPiSession protocol leak gate", () => {
  it("does not stream DSML protocol text into assistant events or stored content", () => {
    const { session, emit } = createStubSessionHarness();
    const onAgentEvent = vi.fn();
    subscribeEmbeddedPiSession({
      session,
      runId: "run",
      onAgentEvent,
    });

    emit({ type: "message_start", message: { role: "assistant" } });
    emitAssistantTextDelta({ emit, delta: "好的老大，下一步我来抓取。\n" });
    emitAssistantTextDelta({ emit, delta: "<|DSML| | tool_calls>\n" });
    emitAssistantTextDelta({ emit, delta: '<|DSML| | invoke name="browser">\n' });
    emitAssistantTextDelta({
      emit,
      delta: "</|DSML| | invoke>\n</|DSML| | tool_calls>",
    });

    const assistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: SCREENSHOT_DSML }],
    } as AssistantMessage;
    emit({ type: "message_end", message: assistantMessage });

    const payloads = extractAgentEventPayloads(onAgentEvent.mock.calls);
    const assistantTexts = payloads
      .filter((payload) => typeof payload.text === "string")
      .map((payload) => String(payload.text));
    expect(assistantTexts.length).toBeGreaterThan(0);
    for (const text of assistantTexts) {
      expect(text).not.toMatch(/DSML/i);
      expect(text).not.toContain("tool_calls");
      expect(text).not.toContain("<|");
    }
    expect(JSON.stringify(assistantMessage.content)).not.toContain("DSML");
    expect(assistantMessage.content).toEqual([
      { type: "text", text: "好的老大，下一步我来抓取。" },
    ]);
    expect(
      payloads.some(
        (payload) => payload.event === "protocol_text_detected" && payload.hiddenFromUser === true,
      ),
    ).toBe(true);
  });

  it("does not stream DeepSeek double-pipe DSML into assistant events", () => {
    const leaked = [
      "我重新完整执行一遍盘点。",
      "<｜｜DSML｜｜tool_calls>",
      '<｜｜DSML｜｜invoke name="exec">',
      '<｜｜DSML｜｜parameter name="command" string="true">ls -1 ~/.openbot/skills/</｜｜DSML｜｜parameter>',
      "</｜｜DSML｜｜invoke>",
      "</｜｜DSML｜｜tool_calls>",
    ].join("\n");
    const { session, emit } = createStubSessionHarness();
    const onAgentEvent = vi.fn();
    subscribeEmbeddedPiSession({
      session,
      runId: "run",
      onAgentEvent,
    });

    emit({ type: "message_start", message: { role: "assistant" } });
    emitAssistantTextDelta({ emit, delta: leaked });
    const assistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: leaked }],
    } as AssistantMessage;
    emit({ type: "message_end", message: assistantMessage });

    const payloads = extractAgentEventPayloads(onAgentEvent.mock.calls);
    const assistantTexts = payloads
      .filter((payload) => typeof payload.text === "string")
      .map((payload) => String(payload.text));
    expect(assistantTexts.length).toBeGreaterThan(0);
    for (const text of assistantTexts) {
      expect(text).not.toMatch(/DSML/i);
      expect(text).not.toContain("tool_calls");
    }
    expect(JSON.stringify(assistantMessage.content)).not.toContain("DSML");
    expect(assistantMessage.content).toEqual([{ type: "text", text: "我重新完整执行一遍盘点。" }]);
  });

  it("holds a split <| opener so incomplete protocol never reaches the stream", () => {
    const { session, emit } = createStubSessionHarness();
    const onAgentEvent = vi.fn();
    subscribeEmbeddedPiSession({
      session,
      runId: "run",
      onAgentEvent,
    });

    emit({ type: "message_start", message: { role: "assistant" } });
    emitAssistantTextDelta({ emit, delta: "好的老大，我来检查\n<|" });

    const payloads = extractAgentEventPayloads(onAgentEvent.mock.calls);
    const assistantTexts = payloads
      .filter((payload) => typeof payload.text === "string")
      .map((payload) => String(payload.text));
    expect(assistantTexts.at(-1)).toBe("好的老大，我来检查");
    for (const text of assistantTexts) {
      expect(text).not.toContain("<|");
      expect(text).not.toMatch(/DSML/i);
    }
  });

  it("replaces protocol-only assistant content with the user-visible failure copy", () => {
    const { session, emit } = createStubSessionHarness();
    const onAgentEvent = vi.fn();
    subscribeEmbeddedPiSession({
      session,
      runId: "run",
      onAgentEvent,
    });

    const assistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: PROTOCOL_ONLY }],
    } as AssistantMessage;
    emit({ type: "message_end", message: assistantMessage });

    expect(assistantMessage.content).toEqual([{ type: "text", text: PROTOCOL_FAILURE_USER_TEXT }]);
    const payloads = extractAgentEventPayloads(onAgentEvent.mock.calls);
    expect(payloads.some((payload) => payload.text === PROTOCOL_FAILURE_USER_TEXT)).toBe(true);
    expect(JSON.stringify(assistantMessage.content)).not.toContain("DSML");
  });
});
