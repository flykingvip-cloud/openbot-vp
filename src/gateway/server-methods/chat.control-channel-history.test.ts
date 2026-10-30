import { describe, expect, it } from "vitest";
import {
  TOOL_DIGEST_CLOSE_SENTINEL,
  TOOL_DIGEST_OPEN_SENTINEL,
} from "../../shared/text/control-channel-visibility.js";
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

  it("keeps real answer units when mixed with a sentinel-bounded digest block", () => {
    const result = sanitizeChatHistoryMessagesForTest([
      {
        role: "assistant",
        content: [
          TOOL_DIGEST_OPEN_SENTINEL,
          "[tool-digest] exec ls",
          "工具结果",
          "",
          'digest second para JSON {"a":1}',
          TOOL_DIGEST_CLOSE_SENTINEL,
          "最终答复：已经处理完成。",
        ].join("\n"),
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("工具结果");
    expect(JSON.stringify(result)).not.toContain("[tool-digest]");
    expect(JSON.stringify(result)).not.toContain("digest second para");
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

  it("multi-paragraph EN/CN/JSON/Markdown digest preview never leaks", () => {
    const cases = [
      "[tool-digest] exec cat\nfirst para\n\nPRIVATE_EN_SECOND",
      "[tool-digest] exec cat\n第一段\n\nPRIVATE_CN_第二段",
      '[tool-digest] exec cat\n{"ok":true}\n\nPRIVATE_JSON_TAIL',
      "[tool-digest] exec cat\n# Title\n\n- item\n\nPRIVATE_MD_TAIL",
      [
        TOOL_DIGEST_OPEN_SENTINEL,
        "[tool-digest] exec cat",
        "preview line",
        "",
        "PRIVATE_WRAPPED_SECOND",
        TOOL_DIGEST_CLOSE_SENTINEL,
      ].join("\n"),
    ];
    for (const content of cases) {
      const result = sanitizeChatHistoryMessagesForTest([{ role: "assistant", content }]);
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE_/);
      expect(result).toEqual([]);
    }
  });

  it("drops provenance-marked digest messages even with blank lines", () => {
    const result = sanitizeChatHistoryMessagesForTest([
      {
        role: "assistant",
        openbotControlChannel: "tool-digest",
        content:
          "[tool-digest] exec command=cat\n工具输出第一段\n\n内部工具第二段：PRIVATE_SECOND_PARAGRAPH",
      },
    ]);
    expect(result).toEqual([]);
  });
});
