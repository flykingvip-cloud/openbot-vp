import { describe, expect, it } from "vitest";
import {
  isControlChannelOnlyText,
  stripControlChannelForDisplay,
  TOOL_DIGEST_CLOSE_SENTINEL,
  TOOL_DIGEST_OPEN_SENTINEL,
} from "./control-channel-visibility.js";

describe("control-channel display acceptance", () => {
  it("ordinary user-facing file links remain openable", () => {
    expect(stripControlChannelForDisplay("报告：[打开报告](/tmp/report.md)")).toBe(
      "报告：[打开报告](/tmp/report.md)",
    );
  });

  it("partial control tag remains hidden while streaming", () => {
    expect(stripControlChannelForDisplay('已完成。\n<<DELIVERABLE title="内部路径')).not.toContain(
      "<<DELIVERABLE",
    );
  });

  it("mixed digest and real reply is not entirely hidden when sentinel-bounded", () => {
    const mixed = [
      TOOL_DIGEST_OPEN_SENTINEL,
      "[tool-digest] exec ls",
      "工具结果",
      "",
      "digest second para",
      TOOL_DIGEST_CLOSE_SENTINEL,
      "最终答复：已经处理完成。",
    ].join("\n");
    expect(isControlChannelOnlyText(mixed)).toBe(false);
    expect(stripControlChannelForDisplay(mixed)).toBe("最终答复：已经处理完成。");
  });
});
