import type { SessionTaskBoard, TaskCompletionBinding } from "../contracts/task.js";

/** Pure validity rule. Storage supplies one snapshot and its normalized active constraints. */
export function isLiveTaskBinding(
  board: SessionTaskBoard,
  binding: TaskCompletionBinding,
  activeConstraints: readonly string[],
): boolean {
  const current = board.current;
  const taskId = binding.taskId.trim();
  return Boolean(
    current?.unfinished &&
    !current.wakeSuppress &&
    !(taskId && board.tombstones?.some((row) => row.taskId === taskId)) &&
    current.taskId === binding.taskId &&
    current.executionAttempt === binding.executionAttempt &&
    current.deliverableVersion === binding.deliverableVersion &&
    (binding.constraints === undefined ||
      JSON.stringify(binding.constraints) === JSON.stringify(activeConstraints)),
  );
}
