import { describe, expect, it } from "vitest";
import { asMessageList, extractMessageVisibleText, readTextBlock } from "./visible-message-text.js";

const essay = "这一轮的可见回复已经写好。";

describe("asMessageList", () => {
  it("treats a missing transcript as an empty list", () => {
    expect(asMessageList(undefined).length).toBe(0);
    expect(asMessageList(null).length).toBe(0);
    expect(asMessageList({ role: "assistant" }).length).toBe(0);
    expect(asMessageList([{ role: "user" }])).toHaveLength(1);
  });
});

describe("readTextBlock", () => {
  it("reads text blocks and skips holes and non-text parts", () => {
    expect(readTextBlock(null)).toBeUndefined();
    expect(readTextBlock({ type: "toolCall", name: "search" })).toBeUndefined();
    expect(readTextBlock({ type: "thinking", thinking: "draft" })).toBeUndefined();
    expect(readTextBlock({ type: "text", text: essay })).toBe(essay);
  });
});

describe("extractMessageVisibleText", () => {
  it("keeps sibling text when the content array mixes tools, thinking, and holes", () => {
    expect(
      extractMessageVisibleText(
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "plan the answer" },
            null,
            { type: "text", text: essay },
            { type: "toolCall", name: "search" },
            { type: "image", url: "https://example.invalid/a.png" },
          ],
        },
        { role: "assistant" },
      ),
    ).toBe(essay);
  });

  it("accepts string text and string content on any role when unfiltered", () => {
    expect(extractMessageVisibleText({ role: "user", text: essay })).toBe(essay);
    expect(extractMessageVisibleText({ role: "assistant", content: essay })).toBe(essay);
  });

  it("ignores other roles when a role is required", () => {
    expect(
      extractMessageVisibleText(
        { role: "user", content: [{ type: "text", text: essay }] },
        {
          role: "assistant",
        },
      ),
    ).toBeUndefined();
  });

  it("is empty when no text block remains", () => {
    expect(
      extractMessageVisibleText({
        role: "assistant",
        content: [null, { type: "toolCall", name: "search" }, { type: "thinking", thinking: "x" }],
      }),
    ).toBeUndefined();
    expect(
      extractMessageVisibleText({
        role: "assistant",
        content: [{ type: "text", text: "   " }],
      })?.trim(),
    ).toBe("");
  });

  it("keeps a text-only silent token so callers can still classify it", () => {
    expect(
      extractMessageVisibleText({
        role: "assistant",
        content: [{ type: "text", text: "NO_REPLY" }],
      }),
    ).toBe("NO_REPLY");
  });
});
