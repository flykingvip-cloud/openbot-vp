import { describe, expect, it } from "vitest";
import {
  isControlChannelOnlyText,
  stripControlChannelForDisplay,
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

  it("mixed digest and real reply is not entirely hidden", () => {
    expect(
      isControlChannelOnlyText("[tool-digest] exec ls\n工具结果\n\n最终答复：已经处理完成。"),
    ).toBe(false);
  });
});
