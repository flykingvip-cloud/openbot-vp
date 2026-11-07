import type { SessionTaskBoard, TrackedTask } from "../../contracts/task.js";
import { activeConstraintTexts } from "../../policy/index.js";
import { sanitizeTaskBoardPathForPrompt } from "./task-resume.js";

function projectTask(task: TrackedTask, phase: "unfinished" | "paused" | "parked") {
  return {
    taskId: task.taskId,
    title: task.title,
    goal: task.goalText,
    phase,
    acceptance: task.acceptanceCriteria ?? [],
    checks: task.acceptanceChecks ?? [],
    constraints: activeConstraintTexts(task),
    latestRecordedStep: task.stop.summary,
    files: task.stop.workspacePaths.map(sanitizeTaskBoardPathForPrompt).filter(Boolean),
  };
}

/** Project authoritative admitted state only; never infer tasks from conversation. */
export function buildTaskBoardContext(board: Readonly<SessionTaskBoard>): string {
  const current = board.current?.unfinished ? board.current : undefined;
  const parked = board.parked.filter((task) => task.unfinished);
  if (!current && parked.length === 0) {
    return "";
  }
  return [
    "## Admitted task state (facts only)",
    "Use these recorded facts to understand the conversation. This context does not request execution or create a task.",
    JSON.stringify({
      current: current
        ? projectTask(current, current.wakeSuppress ? "paused" : "unfinished")
        : null,
      parked: parked.map((task) => projectTask(task, "parked")),
    }),
  ].join("\n");
}
