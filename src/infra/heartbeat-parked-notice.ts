import { formatDroppedParkedTaskSentence } from "../conversation-task/focus-policy.js";
import {
  buildCronBriefSynopsis,
  formatCronParkedNoticeMessage,
} from "../cron/cron-result-template.js";
import { resolveHeartbeatReasonKind } from "./heartbeat-reason.js";

export const HEARTBEAT_PARKED_NOTICE_SENTINEL = "[HEARTBEAT_PARKED_NOTICE]";
export const HEARTBEAT_PARK_FULL_NOTICE_SENTINEL = "[HEARTBEAT_PARK_FULL_NOTICE]";

const HEARTBEAT_RESULT_MARKER = "后台结果";
const WAKE_KEY_RE = /唤醒[：:]\s*`([^`]+)`/;

export type HeartbeatParkedNoticeLike = {
  role?: unknown;
  content?: unknown;
};

function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && "text" in block) {
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string") {
        parts.push(text);
      }
    }
  }
  return parts.join("\n");
}

export function resolveHeartbeatCronJobId(reason?: string): string | undefined {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  const match = /^cron:([^:]+)/i.exec(trimmed);
  const jobId = match?.[1]?.trim();
  return jobId || undefined;
}

function titleForHeartbeatWake(reason?: string): string {
  const kind = resolveHeartbeatReasonKind(reason);
  if (kind === "exec-event") {
    return "命令完成";
  }
  if (kind === "hook") {
    return "外部事件";
  }
  return "后台唤醒";
}

export function formatHeartbeatParkedNoticeMessage(params: {
  reason?: string;
  parkReason: "park" | "reject_park_full";
  synopsis?: string;
  droppedTaskId?: string;
  droppedTitle?: string;
  droppedPaths?: readonly string[];
}): string {
  const title = titleForHeartbeatWake(params.reason);
  const marker =
    params.parkReason === "reject_park_full"
      ? HEARTBEAT_PARK_FULL_NOTICE_SENTINEL
      : HEARTBEAT_PARKED_NOTICE_SENTINEL;
  const dropped = formatDroppedParkedTaskSentence({
    droppedTaskId: params.droppedTaskId,
    droppedTitle: params.droppedTitle,
    droppedPaths: params.droppedPaths,
  });
  const detail = dropped
    ? `当前对话还在做别的事。结果已挂起，没有打断正在进行的工作。${dropped}`
    : params.parkReason === "reject_park_full"
      ? "当前对话正忙，且挂起已满。结果没有打进正在进行的工作。"
      : "当前对话还在做别的事。结果已挂起，没有打断正在进行的工作。";
  const wakeKey = params.reason?.trim() || "heartbeat";
  const synopsis = params.synopsis?.trim();
  const lines = [`**${HEARTBEAT_RESULT_MARKER}** · ${title}`, "", marker, "", detail];
  if (synopsis) {
    lines.push("", synopsis);
  }
  lines.push("", `唤醒：\`${wakeKey}\``);
  return lines.join("\n");
}

export function formatHeartbeatParkedOutboundText(params: {
  parkReason: "park" | "reject_park_full";
  synopsis?: string;
  droppedTaskId?: string;
  droppedTitle?: string;
  droppedPaths?: readonly string[];
}): string {
  const dropped = formatDroppedParkedTaskSentence({
    droppedTaskId: params.droppedTaskId,
    droppedTitle: params.droppedTitle,
    droppedPaths: params.droppedPaths,
  });
  const headline = dropped
    ? `当前对话还在做别的事。后台结果已挂起，没有打断正在进行的工作。${dropped}`
    : params.parkReason === "reject_park_full"
      ? "当前对话正忙，且挂起已满。后台结果没有打断正在进行的工作。"
      : "当前对话还在做别的事。后台结果已挂起，没有打断正在进行的工作。";
  const synopsis = params.synopsis?.trim();
  return synopsis ? `${headline}\n\n${synopsis}` : headline;
}

export function isHeartbeatParkedNoticeMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const text = extractText((message as HeartbeatParkedNoticeLike).content);
  return (
    text.includes(HEARTBEAT_PARKED_NOTICE_SENTINEL) ||
    text.includes(HEARTBEAT_PARK_FULL_NOTICE_SENTINEL) ||
    (text.includes(HEARTBEAT_RESULT_MARKER) && WAKE_KEY_RE.test(text))
  );
}

export function omitHeartbeatParkedNotices<T>(messages: readonly T[]): T[] {
  return messages.filter((message) => !isHeartbeatParkedNoticeMessage(message));
}

export function resolveHeartbeatParkedNoticePayload(params: {
  reason?: string;
  parkReason: "park" | "reject_park_full";
  eventTexts?: readonly string[];
  droppedTaskId?: string;
  droppedTitle?: string;
  droppedPaths?: readonly string[];
}): {
  message: string;
  label: string;
  outboundText: string;
  cronJobId?: string;
  cronJobName?: string;
} {
  const synopsis = buildCronBriefSynopsis((params.eventTexts ?? []).join("\n"));
  const cronJobId = resolveHeartbeatCronJobId(params.reason);
  const outboundText = formatHeartbeatParkedOutboundText({
    parkReason: params.parkReason,
    synopsis,
    droppedTaskId: params.droppedTaskId,
    droppedTitle: params.droppedTitle,
    droppedPaths: params.droppedPaths,
  });
  if (cronJobId) {
    return {
      message: formatCronParkedNoticeMessage({
        jobName: synopsis || "定时提醒",
        jobId: cronJobId,
        reason: params.parkReason,
        droppedTaskId: params.droppedTaskId,
        droppedTitle: params.droppedTitle,
        droppedPaths: params.droppedPaths,
      }),
      label: `定时任务 · ${cronJobId}`,
      outboundText,
      cronJobId,
      cronJobName: synopsis || "定时提醒",
    };
  }
  return {
    message: formatHeartbeatParkedNoticeMessage({
      reason: params.reason,
      parkReason: params.parkReason,
      synopsis,
      droppedTaskId: params.droppedTaskId,
      droppedTitle: params.droppedTitle,
      droppedPaths: params.droppedPaths,
    }),
    label: "后台结果",
    outboundText,
  };
}
