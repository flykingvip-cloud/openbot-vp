import { describe, expect, it } from "vitest";
import {
  buildCronReplySystemPrompt,
  cronReplyContextToInputProvenance,
  normalizeCronReplyContext,
} from "./cron-reply-context.js";

describe("cron-reply-context", () => {
  it("normalizes cron reply context", () => {
    expect(
      normalizeCronReplyContext({
        jobId: " job-1 ",
        runId: " run-1 ",
        jobName: " 日报 ",
      }),
    ).toEqual({
      jobId: "job-1",
      runId: "run-1",
      jobName: "日报",
    });
  });

  it("maps to cron input provenance", () => {
    expect(
      cronReplyContextToInputProvenance({
        jobId: "job-1",
        runId: "run-1",
        jobName: "日报",
      }),
    ).toEqual({
      kind: "cron",
      cronJobId: "job-1",
      cronRunId: "run-1",
      cronJobName: "日报",
    });
  });

  it("builds follow-up system prompt", () => {
    const prompt = buildCronReplySystemPrompt({
      jobId: "job-1",
      jobName: "日报",
      runId: "run-1",
    });
    expect(prompt).toContain("定时执行跟进");
    expect(prompt).toContain("job-1");
    expect(prompt).toContain("日报");
    expect(prompt).toContain("run-1");
    expect(prompt).toContain("这不是当前对话任务的身份或最终结果");
  });
});
