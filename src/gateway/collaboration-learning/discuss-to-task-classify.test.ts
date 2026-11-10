import { describe, expect, it } from "vitest";
import {
  classifyDiscussToTaskIntent,
  formatDiscussToTaskClarificationMessage,
} from "./discuss-to-task-classify.js";

const PACK5 =
  "请协作完成一份季度经营复盘。安排数据分析、内容撰写和成果审核职责，使用附件数据，不访问外部网站。交付：一份报告、一份计算结果 CSV，以及六页 PPT。PPT 包括封面、收入趋势、成本趋势、利润分析、风险和行动建议。必须由非作者完成审核后再交付组终稿。所有数字使用附件单位，不要自行解释为万元。";

const GENERIC_REFUSAL = "委托意图尚不明确或缺少验收条件，请补充后再建立正式任务。";

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
      expect(c.acceptanceHints).toEqual(
        expect.arrayContaining(["各写一段有来源摘要", "汇总为短 Markdown"]),
      );
      expect(c.goalHint).toContain("能源材料研究提纲");
    }
  });

  it("ambiguous / missing acceptance → needs_clarification", () => {
    const missing = classifyDiscussToTaskIntent("请团队成员正式开展一项研究任务");
    expect(missing.kind).toBe("needs_clarification");
    const vague = classifyDiscussToTaskIntent("帮我想想怎么做比较好");
    expect(vague.kind).toBe("discussion");
  });

  it("Pack5 verbatim natural-language delegation is admitted to the formal task path", () => {
    const c = classifyDiscussToTaskIntent(PACK5);
    expect(c.kind).toBe("explicit_delegation");
    if (c.kind === "explicit_delegation") {
      expect(c.reason).toBe("explicit_team_task");
      expect(c.goalHint).toContain("季度经营复盘");
      expect(c.acceptanceHints.join(" ")).toMatch(/报告/);
      expect(c.acceptanceHints.join(" ")).toMatch(/CSV/);
      expect(c.acceptanceHints.join(" ")).toMatch(/PPT/);
      expect(c.acceptanceHints.join(" ")).toMatch(/非作者/);
    }
  });

  it("complete natural-language delegation without official acceptance markers is not format-vetoed", () => {
    const c = classifyDiscussToTaskIntent(
      "请协作完成一份季度经营复盘。需要一份报告、一份计算结果 CSV，以及六页 PPT。必须由非作者完成审核后再交付组终稿。",
    );
    expect(c.kind).toBe("explicit_delegation");
    if (c.kind === "explicit_delegation") {
      expect(c.acceptanceHints.join(" ")).toMatch(/报告/);
      expect(c.acceptanceHints.join(" ")).toMatch(/CSV/);
      expect(c.acceptanceHints.join(" ")).toMatch(/PPT/);
    }
  });

  it("unmarked multi-line list is extracted without flattening newlines first", () => {
    const c = classifyDiscussToTaskIntent(
      "请协作完成一份季度经营复盘。\n- 一份报告\n- 一份计算结果 CSV\n- 六页 PPT",
    );
    expect(c.kind).toBe("explicit_delegation");
    if (c.kind === "explicit_delegation") {
      expect(c.acceptanceHints).toEqual(
        expect.arrayContaining(["一份报告", "一份计算结果 CSV", "六页 PPT"]),
      );
    }
  });

  it("incomplete delegation names the missing field and retains understood content", () => {
    const c = classifyDiscussToTaskIntent("请团队正式开展一项研究");
    expect(c.kind).toBe("needs_clarification");
    if (c.kind === "needs_clarification") {
      expect(c.reason).toBe("missing_acceptance");
      expect(c.missingFields).toContain("deliverables_or_acceptance");
      expect(c.goalHint).toMatch(/研究/);
      const message = formatDiscussToTaskClarificationMessage(c);
      expect(message).toContain("已理解：");
      expect(message).toContain("目标：");
      expect(message).toContain("研究");
      expect(message).toContain("还缺少：交付物或验收条件");
      expect(message).not.toBe(GENERIC_REFUSAL);
      expect(message).not.toBe("委托意图尚不明确或缺少验收条件，请补充后再建立正式任务。");
    }
  });
});
