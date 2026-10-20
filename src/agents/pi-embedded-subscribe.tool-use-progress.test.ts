import type { AssistantMessage } from "@earendil-works/pi-ai/compat";
import { describe, expect, it, vi } from "vitest";
import { createStubSessionHarness } from "./pi-embedded-subscribe.e2e-harness.js";
import { subscribeEmbeddedPiSession } from "./pi-embedded-subscribe.js";

describe("subscribeEmbeddedPiSession toolUse narration", () => {
  it("does not keep toolUse prose in assistantTexts or block replies", async () => {
    const onBlockReply = vi.fn();
    const onBlockReplyDiscard = vi.fn();
    const { session, emit } = createStubSessionHarness();
    const subscription = subscribeEmbeddedPiSession({
      session,
      runId: "7fd20883",
      onBlockReply,
      onBlockReplyDiscard,
    });

    const narration = {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        { type: "text", text: "好，那我先打开云电脑浏览器看看有什么待支付的订单。" },
        { type: "toolCall", name: "browser", arguments: { action: "status" } },
      ],
    } as AssistantMessage;
    emit({ type: "message_end", message: narration });
    await Promise.resolve();

    expect(subscription.assistantTexts).toEqual([]);
    expect(onBlockReply).not.toHaveBeenCalled();
    expect(onBlockReplyDiscard).toHaveBeenCalledTimes(1);

    const reply = {
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: "浏览器环境已就绪。不过我还需要知道具体买什么。" }],
    } as AssistantMessage;
    emit({ type: "message_end", message: reply });

    expect(subscription.assistantTexts).toEqual(["浏览器环境已就绪。不过我还需要知道具体买什么。"]);
  });
});
