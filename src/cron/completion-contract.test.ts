import { describe, expect, it } from "vitest";
import {
  classifyCronCompletion,
  CRON_COMPLETION_EMPTY_PREFIX,
  isCronCompletionScheduleHold,
} from "./completion-contract.js";
import { formatCronResultSurfaceMessage } from "./cron-result-template.js";

describe("cron completion contract", () => {
  it("does not green-check the market-assistant empty cron", () => {
    const classified = classifyCronCompletion({
      status: "ok",
      jobName: "系统skill应用分析",
      summary: "",
    });
    expect(classified.completion).toBe("empty");
    expect(classified.status).not.toBe("ok");
    expect(classified.userReason).toContain("没有摘要，也没有产物，不能记为成功");
    expect(isCronCompletionScheduleHold(classified.error)).toBe(true);
    expect(classified.error?.startsWith(CRON_COMPLETION_EMPTY_PREFIX)).toBe(true);

    const card = formatCronResultSurfaceMessage({
      jobName: "系统skill应用分析",
      jobId: "market-skill-analysis",
      status: "ok",
      summary: undefined,
      durationMs: 0,
    });
    expect(card).toContain("系统skill应用分析");
    expect(card).toContain("**状态**：empty");
    expect(card).toContain("没有摘要，也没有产物，不能记为成功");
    expect(card).not.toContain("✅");
    expect(card).not.toContain("任务已完成，但未生成可展示的摘要");
  });

  it("marks a fake completed placeholder as needs_attention and a real error as failed", () => {
    const attention = classifyCronCompletion({
      status: "ok",
      summary: "任务已完成，但未生成可展示的摘要。",
      jobName: "系统skill应用分析",
    });
    expect(attention.completion).toBe("needs_attention");
    expect(attention.status).toBe("error");

    const failed = classifyCronCompletion({
      status: "error",
      error: "model timed out",
    });
    expect(failed.completion).toBe("failed");
    expect(failed.status).toBe("error");
    const card = formatCronResultSurfaceMessage({
      jobName: "系统skill应用分析",
      jobId: "job-err",
      status: "error",
      error: "model timed out",
    });
    expect(card).toContain("**状态**：failed");
    expect(card).not.toContain("✅");
  });

  it("still allows success when a summary or an artifact exists", () => {
    expect(classifyCronCompletion({ status: "ok", summary: "共 12 个 Skill" }).completion).toBe(
      "ok",
    );
    expect(
      classifyCronCompletion({
        status: "ok",
        outputText: "已写入 deliverables/skill-report.md",
      }).status,
    ).toBe("ok");
    const card = formatCronResultSurfaceMessage({
      jobName: "系统skill应用分析",
      jobId: "job-1",
      status: "ok",
      summary: "共 12 个 Skill",
      durationMs: 65_000,
    });
    expect(card).toContain("✅ 成功");
  });
});
