import type { SessionTaskBoard, TrackedTask } from "../contracts/task.js";

/** Compact focus line for UI / status: 当前任务 / 已挂起 N 项. */
export function formatTaskBoardFocusLine(board: SessionTaskBoard): string {
  const current = board.current?.title?.trim();
  const n = board.parked.length;
  if (current) {
    return `当前任务：「${current}」；已挂起 ${n} 项`;
  }
  if (n > 0) {
    return `当前无进行中任务；已挂起 ${n} 项`;
  }
  return "当前无进行中任务；已挂起 0 项";
}

export function dropSentence(archived: TrackedTask | undefined): string {
  if (!archived) {
    return "";
  }
  return formatDroppedParkedTaskSentence({
    droppedTaskId: archived.taskId,
    droppedTitle: archived.title,
    droppedPaths: archived.stop.workspacePaths,
  });
}

export function switchStatus(
  currentTitle: string,
  incomingTitle: string,
  archived?: TrackedTask,
  parkedCount?: number,
): string {
  const archivedText = dropSentence(archived);
  const count = typeof parkedCount === "number" ? parkedCount : 1;
  const line = `已挂起「${currentTitle}」，开始「${incomingTitle}」。当前任务：「${incomingTitle}」；已挂起 ${count} 项。`;
  return archivedText ? `${line}${archivedText}` : line;
}

export function formatDroppedParkedTaskSentence(params: {
  droppedTaskId?: string;
  droppedTitle?: string;
  droppedPaths?: readonly string[];
}): string {
  const name = params.droppedTitle?.trim() || params.droppedTaskId?.trim() || "";
  if (!name) {
    return "";
  }
  const paths = (params.droppedPaths ?? []).map((item) => item.trim()).filter(Boolean);
  // C6 / §3.6: capacity overflow → searchable archive + notify (not silent drop).
  if (paths.length === 0) {
    return `已归档最早挂起的「${name}」（可追溯）。`;
  }
  return `已归档最早挂起的「${name}」（可追溯），文件仍在 ${paths.join("、")}。`;
}
