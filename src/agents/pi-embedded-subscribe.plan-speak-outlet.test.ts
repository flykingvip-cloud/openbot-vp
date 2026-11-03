import type { AssistantMessage } from "@earendil-works/pi-ai/compat";
import { describe, expect, it, vi } from "vitest";
import { PLAN_SPEAK_PAUSE_CTA } from "../shared/text/plan-speak-final.js";
import {
  createStubSessionHarness,
  createTextEndBlockReplyHarness,
  emitAssistantTextDelta,
  emitAssistantTextEnd,
} from "./pi-embedded-subscribe.e2e-harness.js";
import { subscribeEmbeddedPiSession } from "./pi-embedded-subscribe.js";

/**
 * Outlet regression for slice1: partial / block must express source text
 * (progress or real ask) without inventing a pause CTA.
 *
 * Paths differ:
 * - partial: parseReplyDirectives (includes rewritePlanSpeakFinal identity)
 * - block chunk: streaming-directives parseChunk (no rewritePlanSpeakFinal)
 */
const waitForAsyncBlockCallbacks = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("subscribeEmbeddedPiSession plan-speak outlets", () => {
  const progress =
    "目前看到 ¥699 / ¥727。要确认全平台最低价，我需要把列表按价格排序，这一步正在做，随后我会打开详情页。";
  const realAsk = "两家都有 39 码，¥699 和 ¥727，你要下哪一单？";
  const holding = "正在收尾排版，稍等片刻。";

  function lastPartialText(onPartialReply: ReturnType<typeof vi.fn>): string | undefined {
    return onPartialReply.mock.calls.at(-1)?.[0]?.text as string | undefined;
  }

  it("partial: progress plan-speak passes through without inventing pause CTA", () => {
    const { session, emit } = createStubSessionHarness();
    const onPartialReply = vi.fn();
    Object.assign(session, {
      messages: [{ role: "user", content: "帮我比价买鞋" }],
    });
    subscribeEmbeddedPiSession({ session, runId: "run-partial-progress", onPartialReply });

    emit({ type: "message_start", message: { role: "assistant" } });
    emitAssistantTextDelta({ emit, delta: progress });
    emitAssistantTextEnd({ emit });

    const text = lastPartialText(onPartialReply);
    expect(text).toBe(progress);
    expect(text).not.toContain("请确认下一步");
    expect(text).not.toBe(PLAN_SPEAK_PAUSE_CTA);
  });

  it("partial: real owner ask passes through unchanged", () => {
    const { session, emit } = createStubSessionHarness();
    const onPartialReply = vi.fn();
    subscribeEmbeddedPiSession({ session, runId: "run-partial-ask", onPartialReply });

    emit({ type: "message_start", message: { role: "assistant" } });
    emitAssistantTextDelta({ emit, delta: realAsk });
    emitAssistantTextEnd({ emit });

    expect(lastPartialText(onPartialReply)).toBe(realAsk);
  });

  it("block: progress plan-speak passes through on text_end without pause CTA", async () => {
    const onBlockReply = vi.fn();
    const { emit } = createTextEndBlockReplyHarness({ onBlockReply });

    emitAssistantTextDelta({ emit, delta: progress });
    emitAssistantTextEnd({ emit });
    await waitForAsyncBlockCallbacks();

    expect(onBlockReply).toHaveBeenCalledTimes(1);
    expect(onBlockReply.mock.calls[0]?.[0]?.text).toBe(progress);
    expect(onBlockReply.mock.calls[0]?.[0]?.text).not.toContain("请确认下一步");
    expect(onBlockReply.mock.calls[0]?.[0]?.text).not.toBe(PLAN_SPEAK_PAUSE_CTA);
  });

  it("block: holding/progress line passes through on text_end", async () => {
    const onBlockReply = vi.fn();
    const { emit } = createTextEndBlockReplyHarness({ onBlockReply });

    emitAssistantTextDelta({ emit, delta: holding });
    emitAssistantTextEnd({ emit });
    await waitForAsyncBlockCallbacks();

    expect(onBlockReply).toHaveBeenCalledTimes(1);
    expect(onBlockReply.mock.calls[0]?.[0]?.text).toBe(holding);
  });

  it("block: real owner ask passes through on text_end", async () => {
    const onBlockReply = vi.fn();
    const { emit } = createTextEndBlockReplyHarness({ onBlockReply });

    emitAssistantTextDelta({ emit, delta: realAsk });
    emitAssistantTextEnd({ emit });
    const assistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: realAsk }],
    } as AssistantMessage;
    emit({ type: "message_end", message: assistantMessage });
    await waitForAsyncBlockCallbacks();

    expect(onBlockReply).toHaveBeenCalledTimes(1);
    expect(onBlockReply.mock.calls[0]?.[0]?.text).toBe(realAsk);
  });
});
