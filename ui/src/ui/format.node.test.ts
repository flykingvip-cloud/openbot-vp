import { describe, expect, it } from "vitest";
import { formatIsoTimestamp, stripThinkingTags } from "./format.ts";

describe("formatIsoTimestamp", () => {
  it("formats ISO timestamps as absolute local datetime", () => {
    const formatted = formatIsoTimestamp("2026-06-20T07:07:20.452Z", "zh-CN", "未知");
    expect(formatted).not.toBe("未知");
    expect(formatted).toMatch(/2026/);
    expect(formatted).toMatch(/07/);
  });
});

describe("stripThinkingTags", () => {
  it("strips DeepSeek double-pipe DSML from chat bubbles", () => {
    const leaked = [
      "我重新完整执行一遍盘点。",
      "<｜｜DSML｜｜tool_calls>",
      '<｜｜DSML｜｜invoke name="exec">',
      '<｜｜DSML｜｜parameter name="command" string="true">ls</｜｜DSML｜｜parameter>',
      "</｜｜DSML｜｜invoke>",
      "</｜｜DSML｜｜tool_calls>",
    ].join("\n");
    expect(stripThinkingTags(leaked)).toBe("我重新完整执行一遍盘点。");
    expect(stripThinkingTags(leaked)).not.toMatch(/DSML|tool_calls|invoke/i);
  });
});

describe("formatIsoTimestamp", () => {
  it("formats ISO timestamps as absolute local datetime", () => {
    const formatted = formatIsoTimestamp("2026-06-20T07:07:20.452Z", "zh-CN", "未知");
    expect(formatted).not.toBe("未知");
    expect(formatted).toMatch(/2026/);
    expect(formatted).toMatch(/07/);
  });
});
