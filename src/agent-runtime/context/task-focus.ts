import type { SessionTaskBoard } from "../contracts/task.js";

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
