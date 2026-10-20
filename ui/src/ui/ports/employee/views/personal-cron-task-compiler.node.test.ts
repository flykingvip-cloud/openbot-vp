import { describe, expect, it } from "vitest";
import {
  compileTaskPrompt,
  lintTaskDraft,
  parseCompiledPrompt,
  polishTaskDraft,
  recommendExecutionTargetForTask,
  suggestGoalAndAcceptance,
} from "./personal-cron-task-compiler.ts";
import { DEFAULT_PERSONAL_CRON_TASK_META } from "./personal-cron-task-meta.ts";

describe("personal-cron-task-compiler", () => {
  it("compiles data dependency section from bindings", () => {
    const meta = {
      ...DEFAULT_PERSONAL_CRON_TASK_META,
      dataBindings: [
        {
          bindingId: "cap-1",
          kind: "capability" as const,
          resourceId: "crm.customers",
          label: "客户列表",
          accessState: "granted" as const,
        },
      ],
    };
    const compiled = compileTaskPrompt({
      intentText: "汇总 {{bind:cap-1}}",
      meta,
    });
    expect(compiled.message).toContain("## 数据依赖");
    expect(compiled.message).toContain("客户列表");
    expect(compiled.message).toContain("【客户列表】");
  });

  it("compiles goal, instruction and acceptance into payload message", () => {
    const meta = {
      ...DEFAULT_PERSONAL_CRON_TASK_META,
      goal: "生成运营日报",
      acceptanceRules: ["必须生成 PDF", "包含 GMV"],
    };
    const compiled = compileTaskPrompt({
      intentText: "汇总昨日核心指标",
      meta,
      taskName: "日报",
    });
    expect(compiled.message).toContain("## 定时说明");
    expect(compiled.message).toContain("生成运营日报");
    expect(compiled.message).toContain("## 执行指令");
    expect(compiled.message).toContain("汇总昨日核心指标");
    expect(compiled.message).toContain("必须生成 PDF");
  });

  it("round-trips compiled sections", () => {
    const meta = {
      ...DEFAULT_PERSONAL_CRON_TASK_META,
      goal: "目标A",
      acceptanceRules: ["规则1"],
    };
    const message = compileTaskPrompt({ intentText: "做某事", meta }).message;
    const parsed = parseCompiledPrompt(message);
    expect(parsed.goal).toBe("目标A");
    expect(parsed.intentText).toBe("做某事");
    expect(parsed.acceptanceRules).toEqual(["规则1"]);
  });

  it("suggests goal and acceptance from intent", () => {
    const suggestion = suggestGoalAndAcceptance({
      intentText: "生成 PDF 日报并发送到管理层群",
      category: "ops",
      taskName: "日报",
    });
    expect(suggestion.goal.length).toBeGreaterThan(0);
    expect(suggestion.acceptanceRules.length).toBeGreaterThan(0);
  });

  it("lint catches missing intent", () => {
    const issues = lintTaskDraft({
      intentText: "",
      meta: DEFAULT_PERSONAL_CRON_TASK_META,
      taskName: "测试",
      hasSchedule: true,
    });
    expect(issues.some((item) => item.level === "error")).toBe(true);
  });

  it("polish expands intent into steps and fills missing goal", () => {
    const polished = polishTaskDraft({
      intentText: "汇总昨日数据；生成日报",
      meta: { ...DEFAULT_PERSONAL_CRON_TASK_META, goal: "", acceptanceRules: [] },
      taskName: "日报",
    });
    expect(polished.goal.length).toBeGreaterThan(0);
    expect(polished.intentText).toContain("1.");
    expect(polished.acceptanceRules.length).toBeGreaterThan(0);
    expect(polished.changes.length).toBeGreaterThan(0);
  });

  it("recommends execution target from intent and labels", () => {
    const result = recommendExecutionTargetForTask({
      intentText: "整理市场竞品价格并输出分析报告",
      category: "sales",
      taskName: "竞品巡检",
      agents: [
        { id: "a1", label: "客服助手" },
        { id: "a2", label: "市场助手" },
      ],
      groups: [
        {
          sessionKey: "space:g1",
          label: "产品研发小组",
          purpose: "研发迭代",
        },
        {
          sessionKey: "space:g2",
          label: "市场研究组",
          purpose: "竞品与市场分析",
        },
      ],
    });
    expect(result?.kind).toBe("group");
    expect(result?.id).toBe("space:g2");
    expect(result?.label).toBe("市场研究组");
  });
});
