import type { TrackedTask } from "../../contracts/task.js";
import { MAX_PARKED_TASKS } from "../../policy/task-board-limits.js";

export function formatParkedAt(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    return "未知时间";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
}

/** Transcript / UI marker: current focus finished; remind about parked prior tasks. */
export const PARKED_TASK_REMINDER_SENTINEL = "[PARKED_TASK_REMINDER]";

export function renderCompletionNotice(parked: readonly TrackedTask[]): string {
  if (parked.length === 0) {
    return "当前任务已完成，交付已核对。";
  }
  // newest-first board: slot 0 is the prior task the user most recently left.
  const primary = parked[0];
  if (!primary) {
    return "当前任务已完成，交付已核对。";
  }
  const where = primary.stop.summary || "未记录停点";
  const files = primary.stop.workspacePaths.filter(Boolean);
  const lines = [
    "**挂起提醒** · 还有未结束的任务",
    "",
    PARKED_TASK_REMINDER_SENTINEL,
    "",
    `当前任务已完成，交付已核对。已挂起 ${parked.length} 项；可 CONTINUE 继续一项，或 CLOSE 关闭并移出任务板。`,
    "",
    `前任务：「${primary.title}」`,
    `任务 ID：\`${primary.taskId}\``,
    `停在：${where}`,
  ];
  if (files.length > 0) {
    lines.push(`文件：${files.join("、")}`);
  }
  lines.push(`挂起于：${formatParkedAt(primary.parkedAtMs)}`);
  if (parked.length > 1) {
    const others = parked
      .slice(1, MAX_PARKED_TASKS)
      .map((task) => `「${task.title}」`)
      .join("、");
    lines.push("", `另有 ${parked.length - 1} 个挂起任务：${others}。`);
  }
  // Text fallbacks for non-UI / copy-paste clients (CONTINUE / CLOSE aliases accepted).
  lines.push(
    "",
    `继续挂起 ${primary.taskId}`,
    `取消挂起 ${primary.taskId}`,
    `CONTINUE ${primary.taskId}`,
    `CLOSE ${primary.taskId}`,
  );
  return lines.join("\n");
}
