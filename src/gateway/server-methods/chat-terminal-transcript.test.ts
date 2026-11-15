import { describe, expect, it } from "vitest";
import {
  assistantTextForAbortPartial,
  BLANK_ABORT_ASSISTANT_TEXT,
  buildWebchatInteractionIngress,
  EMPTY_FINAL_ASSISTANT_TEXT,
  planDirectChatFallbackPersist,
  transcriptHasVisibleAssistantAfterUser,
  visibleAssistantTextAfterUser,
} from "./chat-terminal-transcript.js";

describe("terminal transcript visibility", () => {
  it("replaces a blank abort partial with a durable failure bubble", () => {
    expect(assistantTextForAbortPartial("  \n\t")).toBe(BLANK_ABORT_ASSISTANT_TEXT);
    expect(assistantTextForAbortPartial(undefined)).toBe(BLANK_ABORT_ASSISTANT_TEXT);
    expect(assistantTextForAbortPartial("partial answer")).toBe("partial answer");
  });

  it("treats an empty final as missing until an assistant bubble follows the user turn", () => {
    const userKey = "run-msg3";
    const beforeReply = [
      { role: "user", idempotencyKey: userKey, content: [{ type: "text", text: "制作清单" }] },
    ];
    expect(transcriptHasVisibleAssistantAfterUser(beforeReply, userKey)).toBe(false);
    expect(visibleAssistantTextAfterUser(beforeReply, userKey)).toBe("");
    expect(EMPTY_FINAL_ASSISTANT_TEXT.length).toBeGreaterThan(0);

    const afterReply = [
      ...beforeReply,
      {
        role: "assistant",
        content: [{ type: "text", text: "清单已写好" }],
      },
    ];
    expect(transcriptHasVisibleAssistantAfterUser(afterReply, userKey)).toBe(true);
    expect(visibleAssistantTextAfterUser(afterReply, userKey)).toBe("清单已写好");
    expect(
      transcriptHasVisibleAssistantAfterUser(
        [...beforeReply, { role: "assistant", content: [{ type: "text", text: "   " }] }],
        userKey,
      ),
    ).toBe(false);
  });

  it("opens persistOwnTranscript for ordinary webchat and skips growth or system turns", () => {
    expect(buildWebchatInteractionIngress({ clientRunId: "run-1" })).toEqual({
      interactionIngress: { userMessageId: "run-1", persistOwnTranscript: true },
    });
    expect(
      buildWebchatInteractionIngress({
        clientRunId: "run-2",
        growthBirthTurn: true,
      }),
    ).toEqual({});
    expect(
      buildWebchatInteractionIngress({
        clientRunId: "run-3",
        systemInputProvenance: { kind: "system" },
      }),
    ).toEqual({});
  });

  it("reuses an already persisted assistant bubble instead of appending a second one", () => {
    expect(
      planDirectChatFallbackPersist({
        combinedReply: "你好，我在。",
        transcriptHasVisibleAssistant: true,
        existingAssistantText: "你好，我在。",
      }),
    ).toEqual({ kind: "reuse", text: "你好，我在。" });
  });

  it("appends the collected reply when the transcript does not yet have an assistant bubble", () => {
    expect(
      planDirectChatFallbackPersist({
        combinedReply: "你好，我在。",
        transcriptHasVisibleAssistant: false,
      }),
    ).toEqual({ kind: "append-reply", text: "你好，我在。" });
  });

  it("persists the empty-final notice when no executor started and no reply was collected", () => {
    expect(
      planDirectChatFallbackPersist({
        combinedReply: "   ",
        transcriptHasVisibleAssistant: false,
      }),
    ).toEqual({ kind: "append-empty-final", text: EMPTY_FINAL_ASSISTANT_TEXT });
  });
});
