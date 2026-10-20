import { textHasCompletionClaim } from "../agents/execution-preflight/completion-claim.js";
import { formatDroppedParkedTaskSentence } from "../conversation-task/focus-policy.js";
import { isCronDeliveryOnlyFailure } from "./delivery-only-failure.js";
import type { CronRunStatus } from "./types.js";

export const CRON_RESULT_SECTION_SUMMARY = "## 任务摘要";
export const CRON_RESULT_SECTION_DELIVERABLE = "## 任务成果";
export const CRON_PARKED_NOTICE_SENTINEL = "[CRON_PARKED_NOTICE]";
export const CRON_PARK_FULL_NOTICE_SENTINEL = "[CRON_PARK_FULL_NOTICE]";
/** Occurrence card title. Legacy cards used 定时任务结果; parsers must accept both. */
export const CRON_RESULT_TITLE_MARKER = "定时执行结果";
export const CRON_RESULT_TITLE_MARKER_LEGACY = "定时任务结果";
export const CRON_RESULT_JOB_ID_LABEL = "定时任务 ID";

function formatDurationLabel(durationMs?: number): string {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs <= 0) {
    return "—";
  }
  const sec = Math.round(durationMs / 1000);
  if (sec < 60) {
    return `${sec} 秒`;
  }
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min} 分 ${rem} 秒` : `${min} 分`;
}

export function buildCronBriefSynopsis(body: string, maxLen = 280): string {
  const trimmed = body.trim();
  if (!trimmed) {
    return "";
  }
  const blocks = trimmed
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const firstBlock = blocks[0] ?? trimmed;
  const singleLine = firstBlock.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLen) {
    return singleLine;
  }
  return `${singleLine.slice(0, maxLen).trim()}…`;
}

/** Schedule-run state is separate from skill receipt state. */
export type CronSkillDeliveryState =
  | "not_required"
  | "run_finished"
  | "artifact_created"
  | "validation_pending"
  | "delivery_blocked"
  | "delivery_allowed";

function skillDeliveryStatusLine(state: CronSkillDeliveryState): string | undefined {
  switch (state) {
    case "run_finished":
      return "本次运行已结束";
    case "artifact_created":
      return "本次运行已结束 · 产物已生成";
    case "validation_pending":
      return "本次运行已结束 · 交付待验收";
    case "delivery_blocked":
      return "本次运行已结束 · 交付未通过";
    case "delivery_allowed":
      return "✅ 交付已通过";
    default:
      return undefined;
  }
}

export function formatCronResultSurfaceMessage(params: {
  jobName: string;
  jobId: string;
  status: CronRunStatus;
  summary?: string;
  error?: string;
  durationMs?: number;
  skillDelivery?: CronSkillDeliveryState;
}): string {
  const deliveryOnly = isCronDeliveryOnlyFailure(params);
  const effectiveStatus = deliveryOnly ? "ok" : params.status;
  const skillLine = params.skillDelivery
    ? skillDeliveryStatusLine(params.skillDelivery)
    : undefined;
  const statusLine =
    skillLine ??
    (effectiveStatus === "ok"
      ? deliveryOnly
        ? "✅ 执行成功（外部通知未送达）"
        : "✅ 成功"
      : effectiveStatus === "skipped"
        ? "⏭ 已跳过"
        : "❌ 失败");
  const awaitingReceipt =
    params.skillDelivery === "run_finished" ||
    params.skillDelivery === "artifact_created" ||
    params.skillDelivery === "validation_pending" ||
    params.skillDelivery === "delivery_blocked";
  const rawSummary = params.summary?.trim();
  const summary =
    awaitingReceipt && rawSummary && textHasCompletionClaim(rawSummary)
      ? "这次定时运行已经结束。"
      : rawSummary;
  const deliverable =
    effectiveStatus === "error"
      ? params.error?.trim() || summary || "任务执行失败，未生成摘要。"
      : summary ||
        params.error?.trim() ||
        (awaitingReceipt
          ? "这次运行已经结束，还没有通过交付验收的成果。"
          : "任务已完成，但未生成可展示的摘要。");

  const title = params.jobName.trim() || params.jobId;
  const briefSynopsis = buildCronBriefSynopsis(deliverable);
  const summaryLines = [
    `**状态**：${statusLine}`,
    `**耗时**：${formatDurationLabel(params.durationMs)}`,
  ];
  if (briefSynopsis) {
    summaryLines.push("", briefSynopsis);
  }
  if (deliveryOnly && params.error?.trim()) {
    summaryLines.push("", `> 通知：${params.error.trim()}`);
  }

  const lines = [
    `**${CRON_RESULT_TITLE_MARKER}** · ${title}`,
    "",
    CRON_RESULT_SECTION_SUMMARY,
    "",
    ...summaryLines,
    "",
    CRON_RESULT_SECTION_DELIVERABLE,
    "",
    deliverable,
    "",
    "---",
    "",
    `${CRON_RESULT_JOB_ID_LABEL}：\`${params.jobId}\``,
  ];
  return lines.join("\n");
}

/** Projection-only wake notice when FOCUS is occupied (EA-B4 / §7). */
export function formatCronParkedNoticeMessage(params: {
  jobName: string;
  jobId: string;
  reason: "park" | "reject_park_full";
  droppedTaskId?: string;
  droppedTitle?: string;
  droppedPaths?: readonly string[];
}): string {
  const title = params.jobName.trim() || params.jobId;
  const marker =
    params.reason === "reject_park_full"
      ? CRON_PARK_FULL_NOTICE_SENTINEL
      : CRON_PARKED_NOTICE_SENTINEL;
  const dropped = formatDroppedParkedTaskSentence({
    droppedTaskId: params.droppedTaskId,
    droppedTitle: params.droppedTitle,
    droppedPaths: params.droppedPaths,
  });
  const detail = dropped
    ? `当前对话还在做别的事。结果已挂起，没有打断正在进行的工作。${dropped}`
    : params.reason === "reject_park_full"
      ? "当前对话正忙，且挂起已满。结果没有打进正在进行的工作。"
      : "当前对话还在做别的事。结果已挂起，没有打断正在进行的工作。";
  return [
    `**${CRON_RESULT_TITLE_MARKER}** · ${title}`,
    "",
    marker,
    "",
    "这次定时运行已经结束。",
    detail,
    "",
    `${CRON_RESULT_JOB_ID_LABEL}：\`${params.jobId}\``,
  ].join("\n");
}
