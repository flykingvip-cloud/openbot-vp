import { describe, expect, it } from "vitest";
import { classifyDiscussToTaskIntent } from "./discuss-to-task-classify.js";

describe("discuss-to-task-classify (pure)", () => {
  it("ordinary discussion does not build a task", () => {
    const c = classifyDiscussToTaskIntent("今天天气不错，大家随便聊聊进度。");
    expect(c.kind).toBe("discussion");
  });

  it("explicit team task with acceptance → explicit_delegation", () => {
    const c = classifyDiscussToTaskIntent(
      "请两名成员协作完成能源材料研究提纲\n验收标准：\n- 各写一段有来源摘要\n- 汇总为短 Markdown",
    );
    expect(c.kind).toBe("explicit_delegation");
    if (c.kind === "explicit_delegation") {
      expect(c.acceptanceHints.length).toBeGreaterThan(0);
    }
  });

  it("ambiguous / missing acceptance → needs_clarification", () => {
    const missing = classifyDiscussToTaskIntent("请团队成员正式开展一项研究任务");
    expect(missing.kind).toBe("needs_clarification");
    const vague = classifyDiscussToTaskIntent("帮我想想怎么做比较好");
    expect(vague.kind).toBe("discussion");
  });
});
