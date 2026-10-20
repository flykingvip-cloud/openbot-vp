import { describe, expect, it } from "vitest";
import {
  CRON_PARKED_NOTICE_SENTINEL,
  formatCronParkedNoticeMessage,
  formatCronResultSurfaceMessage,
} from "./cron-result-template.js";

describe("formatCronResultSurfaceMessage template", () => {
  it("structures message into summary, deliverable, and footer sections", () => {
    const text = formatCronResultSurfaceMessage({
      jobName: "系统skill应用分析",
      jobId: "job-1",
      status: "ok",
      summary: "共 12 个 Skill\n\n| id | name |\n| --- | --- |",
      durationMs: 65_000,
    });
    expect(text).toContain("定时执行结果");
    expect(text).toContain("## 任务摘要");
    expect(text).toContain("## 任务成果");
    expect(text).toContain("共 12 个 Skill");
    expect(text).toContain("| id | name |");
    expect(text).not.toContain("可直接在下方输入");
    expect(text).toContain("定时任务 ID：`job-1`");
    expect(text).not.toContain("**定时任务结果**");
  });

  it("formats a parked-wake notice without deliverable sections", () => {
    const text = formatCronParkedNoticeMessage({
      jobName: "竞品价格检查",
      jobId: "job-1",
      reason: "park",
    });
    expect(text).toContain("定时执行结果");
    expect(text).toContain(CRON_PARKED_NOTICE_SENTINEL);
    expect(text).toContain("定时任务 ID：`job-1`");
    expect(text).toContain("这次定时运行已经结束。");
    expect(text).not.toContain("定时任务已完成");
    expect(text).not.toContain("## 任务成果");
  });

  it("names the oldest parked task and its files when a fourth cron park drops it", () => {
    const text = formatCronParkedNoticeMessage({
      jobName: "竞品价格检查",
      jobId: "job-1",
      reason: "park",
      droppedTaskId: "p1",
      droppedTitle: "最早的报告",
      droppedPaths: ["/tmp/oldest.md"],
    });
    expect(text).toContain("已放下最早挂起的「最早的报告」");
    expect(text).toContain("/tmp/oldest.md");
    expect(text).not.toContain("挂起已满");
  });

  it("does not call a blocked skill delivery a successful run", () => {
    const text = formatCronResultSurfaceMessage({
      jobName: "竞品价格检查",
      jobId: "job-1",
      status: "ok",
      summary: "正在处理，结果尚未对外公布。",
      skillDelivery: "delivery_blocked",
      durationMs: 1_000,
    });
    expect(text).toContain("本次运行已结束 · 交付未通过");
    expect(text).not.toContain("✅ 成功");
    expect(text).not.toContain("任务已完成");
  });

  it("rewrites a blocked summary that claims the work is finished", () => {
    const text = formatCronResultSurfaceMessage({
      jobName: "竞品价格检查",
      jobId: "job-3",
      status: "ok",
      summary: "任务已完成",
      skillDelivery: "delivery_blocked",
      durationMs: 1_000,
    });
    expect(text).toContain("本次运行已结束 · 交付未通过");
    expect(text).not.toContain("任务已完成");
    expect(text).toContain("这次定时运行已经结束。");
  });
});
