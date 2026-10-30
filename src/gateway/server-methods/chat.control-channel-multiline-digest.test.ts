import { describe, expect, it } from "vitest";
import { sanitizeChatHistoryMessagesForTest } from "./chat.js";

describe("chat.history multi-paragraph tool-digest", () => {
  it("multi-paragraph tool result digest never leaks preview paragraphs", () => {
    const result = sanitizeChatHistoryMessagesForTest([
      {
        role: "assistant",
        content:
          "[tool-digest] exec command=cat\n工具输出第一段\n\n内部工具第二段：PRIVATE_SECOND_PARAGRAPH",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SECOND_PARAGRAPH");
    expect(result).toEqual([]);
  });

  it("content-block multi-paragraph digest never leaks", () => {
    const result = sanitizeChatHistoryMessagesForTest([
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "[tool-digest] browser action=snapshot\nline1\n\nPRIVATE_BLOCK_SECOND",
          },
        ],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_BLOCK_SECOND");
    expect(result).toEqual([]);
  });
});
