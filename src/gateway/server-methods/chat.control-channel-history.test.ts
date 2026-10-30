import { describe, expect, it } from "vitest";
import { sanitizeChatHistoryMessagesForTest } from "./chat.js";

describe("chat.history control-channel sanitize", () => {
  it("hides pure tool-digest preview body from server history", () => {
    const result = sanitizeChatHistoryMessagesForTest([
      {
        role: "assistant",
        content: "[tool-digest] exec command=ls\n内部工具返回：PRIVATE_DIGEST_OUTPUT",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_DIGEST_OUTPUT");
    expect(JSON.stringify(result)).not.toContain("[tool-digest]");
    // Pure digest messages are dropped entirely (not left as empty bubbles).
    expect(result).toEqual([]);
  });

  it("keeps real answer units when mixed with a digest block", () => {
    const result = sanitizeChatHistoryMessagesForTest([
      {
        role: "assistant",
        content: "[tool-digest] exec ls\n工具结果\n\n最终答复：已经处理完成。",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("工具结果");
    expect(JSON.stringify(result)).not.toContain("[tool-digest]");
    expect(JSON.stringify(result)).toContain("最终答复：已经处理完成。");
    expect(result).toHaveLength(1);
  });

  it("sanitizes digest inside content block arrays", () => {
    const result = sanitizeChatHistoryMessagesForTest([
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "[tool-digest] exec command=ls\n内部工具返回：PRIVATE_DIGEST_OUTPUT",
          },
        ],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_DIGEST_OUTPUT");
    expect(result).toEqual([]);
  });
});
