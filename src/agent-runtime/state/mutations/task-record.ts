import { titleFromGoal } from "../../context/sources/task-title.js";
import type { TrackedTask, ArchivedTask } from "../../contracts/task.js";
import { MAX_PARKED_TASKS } from "../../policy/task-board-limits.js";
import { allocateTaskInstanceId } from "../repository/task-identity.js";

export function createTask(
  text: string,
  nowMs: number,
  workspacePaths: string[],
  opts?: { inboundRequestId?: string; entropy?: string | number },
): TrackedTask {
  const title = titleFromGoal(text);
  return {
    taskId: allocateTaskInstanceId({
      inboundRequestId: opts?.inboundRequestId,
      entropy: opts?.entropy ?? `${nowMs}:${title}`,
    }),
    title,
    goalText: text.trim(),
    unfinished: true,
    stop: {
      summary: `未完成：${title}`,
      workspacePaths: [...workspacePaths],
    },
    createdAtMs: nowMs,
  };
}

export function parkTask(
  parked: readonly TrackedTask[],
  task: TrackedTask,
  nowMs: number,
  parkReason?: string,
): { parked: TrackedTask[]; archived?: ArchivedTask } {
  const stamped: TrackedTask = {
    ...task,
    unfinished: true,
    parkedAtMs: nowMs,
    parkReason: parkReason ?? task.parkReason ?? "automatic_switch",
    wakeSuppress: true,
  };
  const newestFirst = [stamped, ...parked.filter((row) => row.taskId !== stamped.taskId)];
  if (newestFirst.length <= MAX_PARKED_TASKS) {
    return { parked: newestFirst };
  }
  const overflow = newestFirst[newestFirst.length - 1];
  return {
    parked: newestFirst.slice(0, MAX_PARKED_TASKS),
    archived: overflow
      ? {
          ...overflow,
          archivedAtMs: nowMs,
          archiveReason: "parked_capacity",
        }
      : undefined,
  };
}
