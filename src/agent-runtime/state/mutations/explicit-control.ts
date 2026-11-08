import fs from "node:fs";
import type { ExplicitTaskControl } from "../../contracts/task-control.js";
import { mutateSessionTaskBoard } from "../repository/task-board-file.js";
import { resumeParkedTask, type ResumeParkedRecheck } from "./resume-parked.js";
import {
  suppressCurrentTaskWake,
  cancelCurrentTask,
  pauseParkedTask,
  cancelParkedTask,
} from "./task-control.js";

/** Typed, locked control update. Never classifies text, creates work or schedules execution. */
export function commitExplicitTaskControl(input: {
  sessionFile?: string;
  control: ExplicitTaskControl;
  nowMs?: number;
  workspacePaths?: string[];
  recheck: ResumeParkedRecheck;
}) {
  const file = input.sessionFile?.trim();
  if (!file || !fs.existsSync(file)) {
    return undefined;
  }
  return mutateSessionTaskBoard(file, (board) => {
    const control = input.control;
    const result =
      control.scope === "current"
        ? control.action === "pause"
          ? suppressCurrentTaskWake({ board, sessionFile: file })
          : cancelCurrentTask({ board, nowMs: input.nowMs, sessionFile: file })
        : control.action === "resume"
          ? resumeParkedTask({
              board,
              taskId: control.taskId,
              nowMs: input.nowMs,
              workspacePaths: input.workspacePaths,
              recheck: input.recheck,
            })
          : control.action === "pause"
            ? pauseParkedTask({ board, taskId: control.taskId })
            : cancelParkedTask({ board, taskId: control.taskId, nowMs: input.nowMs });
    return { board: result.board, value: result };
  });
}
