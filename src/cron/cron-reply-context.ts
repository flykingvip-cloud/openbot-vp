import type { InputProvenance } from "../sessions/input-provenance.js";

export type CronReplyContext = {
  jobId: string;
  runId?: string;
  jobName?: string;
};

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeCronReplyContext(value: unknown): CronReplyContext | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const jobId = normalizeOptionalString(record.jobId);
  if (!jobId) {
    return undefined;
  }
  return {
    jobId,
    runId: normalizeOptionalString(record.runId),
    jobName: normalizeOptionalString(record.jobName),
  };
}

export function cronReplyContextToInputProvenance(context: CronReplyContext): InputProvenance {
  return {
    kind: "cron",
    cronJobId: context.jobId,
    cronRunId: context.runId,
    cronJobName: context.jobName,
  };
}

export function buildCronReplySystemPrompt(context: CronReplyContext): string {
  const name = context.jobName?.trim() || "未命名定时任务";
  const lines = [
    "[定时执行跟进]",
    `用户正在针对定时任务「${name}」（定时任务 ID：${context.jobId}）的本次执行成果追问。`,
    "结合该次执行的摘要与成果作答。这不是当前对话任务的身份或最终结果。",
    "若用户想调整调度、修改定时说明或重新执行，给出清晰可行的下一步。",
  ];
  if (context.runId) {
    lines.push(`最近一次执行会话 ID：${context.runId}。`);
  }
  return lines.join("\n");
}
