import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import {
  estimateContextTokens,
  estimateMessageTokens,
} from "../../../node_modules/@earendil-works/pi-ai/dist/utils/estimate.js";
import { wrapOutboundMessageEstimateGuard } from "../../agent-runtime/capabilities/index.js";
import { normalizeCompiledMessage, normalizeCompiledMessages } from "./normalize-outbound.js";

/**
 * `@earendil-works/pi-ai@0.84.4` `dist/utils/estimate.js` `estimateMessageTokens`.
 * streamSimple calls this from buildBaseOptions before HTTP, outside the stream
 * try/catch. Assistant string content is iterated as characters, so `block.name`
 * is undefined.
 */
const estimateMessage = estimateMessageTokens as (message: unknown) => number;
const estimateContext = estimateContextTokens as (context: unknown) => { tokens: number };

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function contentOf(message: AgentMessage): unknown[] {
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new Error("expected block content");
  }
  return content;
}

describe("pi-ai estimate guards for api-proxy-deepseek shapes", () => {
  it("stops the length throw on assistant string content plus reasoning_content", () => {
    const raw = {
      role: "assistant",
      content: "answer",
      reasoning_content: "think",
      provider: "api-proxy-deepseek",
      model: "deepseek-v4-flash",
      timestamp: 1,
    };
    expect(() => estimateMessage(raw)).toThrow(/reading 'length'/);

    const normalized = normalizeCompiledMessage(raw as unknown as AgentMessage);
    expect(() => estimateMessage(normalized)).not.toThrow();
    const blocks = contentOf(normalized);
    expect(blocks[0]).toMatchObject({
      type: "thinking",
      thinking: "think",
      thinkingSignature: "reasoning_content",
    });
    expect(blocks[1]).toMatchObject({ type: "text", text: "answer" });
    expect((normalized as { usage?: unknown }).usage).toMatchObject({ totalTokens: 0 });
  });

  it("stops the length throw on reasoning blocks and tool calls that only have function.name", () => {
    const reasoning = {
      role: "assistant",
      content: [
        { type: "reasoning", reasoning: "think" },
        { type: "text", text: "hi" },
      ],
      usage: ZERO_USAGE,
      timestamp: 1,
    };
    const reasoningContent = {
      role: "assistant",
      content: [{ type: "reasoning_content" }, { type: "text", text: "hi" }],
      usage: ZERO_USAGE,
      timestamp: 2,
    };
    const tool = {
      role: "assistant",
      content: [{ type: "toolCall", id: "call_1", function: { name: "browse" } }],
      usage: ZERO_USAGE,
      timestamp: 3,
    };
    for (const raw of [reasoning, reasoningContent, tool]) {
      expect(() => estimateMessage(raw)).toThrow(/reading 'length'/);
      expect(() =>
        estimateMessage(normalizeCompiledMessage(raw as unknown as AgentMessage)),
      ).not.toThrow();
    }
    const fixedTool = normalizeCompiledMessage(tool as unknown as AgentMessage);
    expect(contentOf(fixedTool)[0]).toMatchObject({ type: "toolCall", name: "browse" });
    expect(
      contentOf(normalizeCompiledMessage(reasoningContent as unknown as AgentMessage))[0],
    ).toMatchObject({
      type: "thinking",
      thinking: "",
      thinkingSignature: "reasoning_content",
    });
  });

  it("stops the length throw when a newer capsule forces a full estimate of string digests", () => {
    const capsule = {
      role: "user",
      content: "compiled-context\nactive_task:\n跟进试用",
      timestamp: Date.now(),
    };
    const digest = {
      role: "assistant",
      content: "[tool-digest] browser action=snapshot",
      timestamp: 1,
    };
    const turn = { role: "user", content: "你好", timestamp: 2 };
    const raw = [capsule, digest, turn];
    expect(() => estimateContext({ messages: raw })).toThrow(/reading 'length'/);

    const normalized = normalizeCompiledMessages(raw as unknown as AgentMessage[]);
    expect(normalized[0]).toBe(capsule);
    expect(normalized[2]).toBe(turn);
    expect(() =>
      estimateContext({ messages: normalized, systemPrompt: "secretary" }),
    ).not.toThrow();
    expect(contentOf(normalized[1])[0]).toMatchObject({
      type: "text",
      text: "[tool-digest] browser action=snapshot",
    });
  });

  it("does not replace the length crash with reading totalTokens", () => {
    const assistant = {
      role: "assistant",
      content: [{ type: "text", text: "你好，我是高级秘书" }],
      timestamp: 5,
    };
    expect(() => estimateContext({ messages: [assistant] })).toThrow(/reading 'totalTokens'/);
    const normalized = normalizeCompiledMessages([assistant] as unknown as AgentMessage[]);
    expect(() => estimateContext({ messages: normalized })).not.toThrow();
    expect(estimateContext({ messages: normalized }).tokens).toBeGreaterThan(0);
  });

  it("rewrites the provider context before the inner stream function", () => {
    const raw = {
      role: "assistant",
      content: "answer",
      reasoning_content: "think",
      timestamp: 1,
    };
    let seen: unknown;
    const wrapped = wrapOutboundMessageEstimateGuard((_model, context) => {
      seen = (context as { messages?: unknown }).messages;
      return { result: async () => ({}) } as never;
    });
    void wrapped(
      {} as never,
      { systemPrompt: "", messages: [raw], tools: [] } as never,
      {} as never,
    );
    expect(() => estimateMessage((seen as unknown[])[0])).not.toThrow();
  });
});
