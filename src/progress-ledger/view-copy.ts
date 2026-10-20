import type { BlockingGate, ProgressView, ReplanHistoryItem } from "./types.js";

const REPLAN_REASON_LABELS: Record<string, string> = {
  missing_data: "CRM 数据缺失",
  blocked_data: "数据未就绪",
  policy: "策略变更",
  user_request: "你调整了目标",
};

export function replanReasonLabel(reason: string): string {
  const trimmed = reason.trim();
  return REPLAN_REASON_LABELS[trimmed] ?? trimmed;
}

export function formatReplanClock(atMs: number, timeZone?: string): string {
  return new Date(atMs).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  });
}

export function formatReplanHistoryLine(
  item: ReplanHistoryItem,
  options?: { timeZone?: string },
): string {
  const clock = formatReplanClock(item.atMs, options?.timeZone);
  return `任务曾于 ${clock} 重新规划（${replanReasonLabel(item.reason)}）`;
}

export function formatLatestReplanLine(
  view: Pick<ProgressView, "replans">,
  options?: { timeZone?: string },
): string | null {
  const latest = view.replans.at(-1);
  if (!latest) {
    return null;
  }
  if (view.replans.length === 1) {
    return formatReplanHistoryLine(latest, options);
  }
  return `${formatReplanHistoryLine(latest, options)} · 共 ${view.replans.length} 次`;
}

export function formatAcceptanceBadge(view: Pick<ProgressView, "acceptanceProgress">): string {
  return `${view.acceptanceProgress.met}/${view.acceptanceProgress.total} 项验收已满足`;
}

export function formatExecutionSummary(view: Pick<ProgressView, "executionProgress">): string {
  const { completed, inProgress, remaining } = view.executionProgress;
  return `已完成 ${completed} · 进行中 ${inProgress} · 剩余 ${remaining}`;
}

export function formatStaleLabel(
  view: Pick<ProgressView, "stale" | "lastMeaningfulChangeAtMs">,
  nowMs: number,
): string | null {
  if (!view.stale || view.lastMeaningfulChangeAtMs <= 0) {
    return null;
  }
  const elapsedMs = Math.max(0, nowMs - view.lastMeaningfulChangeAtMs);
  const hours = Math.floor(elapsedMs / (60 * 60 * 1000));
  if (hours < 24) {
    return `已 ${Math.max(1, hours)} 小时无进展`;
  }
  return `已 ${Math.floor(hours / 24)} 天无进展`;
}

export function formatListProgressLine(view: ProgressView): string {
  if (view.blockingGate) {
    return view.headline;
  }
  return formatAcceptanceBadge(view);
}

export function listHumanGates(view: Pick<ProgressView, "blockingGate">): BlockingGate[] {
  const reason = view.blockingGate?.reason;
  if (reason === "blocked_user" || reason === "blocked_authorization") {
    return view.blockingGate ? [view.blockingGate] : [];
  }
  return [];
}

/**
 * Conversation occupancy gate. Product-off: chat threads must not steal
 * composer space with a progress strip. Cron / task-center chrome uses
 * shouldRenderProgressChrome.
 */
export function shouldRenderChatStrip(_view: ProgressView): boolean {
  return false;
}

/** Progress chrome for cron list/detail, not conversation chat. */
export function shouldRenderProgressChrome(view: ProgressView): boolean {
  return view.projectionKind === "canonical" && view.emitToChat;
}
