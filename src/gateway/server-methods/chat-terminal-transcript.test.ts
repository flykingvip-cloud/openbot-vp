import { describe, expect, it } from "vitest";
import {
  assistantTextForAbortPartial,
  BLANK_ABORT_ASSISTANT_TEXT,
  EMPTY_FINAL_ASSISTANT_TEXT,
  transcriptHasVisibleAssistantAfterUser,
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
    expect(EMPTY_FINAL_ASSISTANT_TEXT.length).toBeGreaterThan(0);

    const afterReply = [
      ...beforeReply,
      {
        role: "assistant",
        content: [{ type: "text", text: "清单已写好" }],
      },
    ];
    expect(transcriptHasVisibleAssistantAfterUser(afterReply, userKey)).toBe(true);
    expect(
      transcriptHasVisibleAssistantAfterUser(
        [...beforeReply, { role: "assistant", content: [{ type: "text", text: "   " }] }],
        userKey,
      ),
    ).toBe(false);
  });
});
