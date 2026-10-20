import { describe, expect, it } from "vitest";
import { boundChatHistoryMessages, buildUserTranscriptContentBlocks } from "./chat.js";

const OVERSIZED_PLACEHOLDER = "[chat.history omitted: message too large]";

function historyOf(messages: unknown[]) {
  return boundChatHistoryMessages({
    rawMessages: messages,
    limit: 50,
    includeTools: true,
    historyCursorEnabled: false,
  });
}

describe("chat.history source.data image omit", () => {
  it("keeps the caption and an omission marker for a buildUserTranscriptContentBlocks image over 128KiB", () => {
    const imageData = "A".repeat(140 * 1024);
    const content = buildUserTranscriptContentBlocks({
      message: "看这张截图里的报价",
      attachments: [
        {
          mimeType: "image/png",
          fileName: "报价截图.png",
          assetId: "asset-42",
          content: imageData,
        },
      ],
    });
    const raw = [{ role: "user", content, timestamp: 1 }];
    const before = JSON.stringify(raw);
    const bounded = historyOf(raw);
    expect(JSON.stringify(raw)).toBe(before);

    const serialized = JSON.stringify(bounded.messages);
    expect(bounded.messages).toHaveLength(1);
    expect(serialized).toContain("看这张截图里的报价");
    expect(serialized).toContain("[image omitted:");
    expect(serialized).toContain("报价截图.png");
    expect(serialized).toContain("image/png");
    expect(serialized).toContain("asset-42");
    expect(serialized).toContain(`bytes=${Buffer.byteLength(imageData, "utf8")}`);
    expect(serialized).not.toContain(OVERSIZED_PLACEHOLDER);
    expect(serialized.includes(imageData.slice(0, 80))).toBe(false);
  });

  it("strips a top-level data image and keeps sibling text", () => {
    const imageData = "B".repeat(140 * 1024);
    const bounded = historyOf([
      {
        role: "user",
        timestamp: 1,
        content: [
          { type: "text", text: "说明文字还在" },
          {
            type: "image",
            data: imageData,
            mimeType: "image/jpeg",
            fileName: "top.jpg",
          },
        ],
      },
    ]);
    const serialized = JSON.stringify(bounded.messages);
    expect(serialized).toContain("说明文字还在");
    expect(serialized).toContain("[image omitted:");
    expect(serialized).toContain("top.jpg");
    expect(serialized).not.toContain(OVERSIZED_PLACEHOLDER);
    expect(serialized.includes(imageData.slice(0, 80))).toBe(false);
  });

  it("truncates a long text message instead of replacing it", () => {
    const text = `长文${"字".repeat(20_000)}`;
    const bounded = historyOf([
      {
        role: "user",
        timestamp: 1,
        content: [{ type: "text", text }],
      },
    ]);
    const serialized = JSON.stringify(bounded.messages);
    expect(bounded.messages).toHaveLength(1);
    expect(serialized).toContain("...(truncated)...");
    expect(serialized).toContain("长文");
    expect(serialized).not.toContain(OVERSIZED_PLACEHOLDER);
  });

  it("still replaces an oversized nested tool payload that has no retainable text", () => {
    const hugeNestedText = "n".repeat(140_000);
    const bounded = historyOf([
      {
        role: "assistant",
        timestamp: 1,
        content: [
          {
            type: "tool_result",
            toolUseId: "tool-1",
            output: { nested: { payload: hugeNestedText } },
          },
        ],
      },
    ]);
    const serialized = JSON.stringify(bounded.messages);
    expect(serialized).toContain(OVERSIZED_PLACEHOLDER);
    expect(serialized.includes(hugeNestedText.slice(0, 64))).toBe(false);
  });
});
