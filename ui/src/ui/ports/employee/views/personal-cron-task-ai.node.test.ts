import { describe, expect, it } from "vitest";
import {
  enhanceCronTaskWithRules,
  recommendExecutionTargetWithRules,
} from "./personal-cron-task-ai.ts";
import { DEFAULT_PERSONAL_CRON_TASK_META } from "./personal-cron-task-meta.ts";

describe("personal-cron-task-ai", () => {
  it("overwrites goal and acceptance when complete overwrite is requested", () => {
    const result = enhanceCronTaskWithRules({
      mode: "complete",
      taskName: "日报",
      intentText: "收集 GMV 与留存率，生成运营日报",
      meta: {
        ...DEFAULT_PERSONAL_CRON_TASK_META,
        goal: "旧目标",
        acceptanceRules: ["旧规则"],
      },
      overwrite: true,
    });
    expect(result.goal).not.toBe("旧目标");
    expect(result.acceptanceRules).not.toEqual(["旧规则"]);
    expect(result.acceptanceRules.length).toBeGreaterThan(0);
  });

  it("preserves existing goal when complete overwrite is false", () => {
    const result = enhanceCronTaskWithRules({
      mode: "complete",
      taskName: "日报",
      intentText: "收集 GMV 与留存率，生成运营日报",
      meta: {
        ...DEFAULT_PERSONAL_CRON_TASK_META,
        goal: "已有目标",
        acceptanceRules: ["已有规则"],
      },
      overwrite: false,
    });
    expect(result.goal).toBe("已有目标");
    expect(result.acceptanceRules).toEqual(["已有规则"]);
  });

  it("falls back to rules-based execution target recommendation", () => {
    const result = recommendExecutionTargetWithRules({
      taskName: "竞品巡检",
      intentText: "整理市场竞品价格并输出分析报告",
      category: "sales",
      agents: [
        { id: "a1", label: "客服助手", source: "owned" },
        { id: "a2", label: "市场助手", source: "owned" },
      ],
      groups: [
        {
          sessionKey: "space:g2",
          label: "市场研究组",
          memberCount: 3,
          purpose: "竞品与市场分析",
        },
      ],
    });
    expect(result?.source).toBe("rules");
    expect(result?.kind).toBe("group");
    expect(result?.id).toBe("space:g2");
  });
});
