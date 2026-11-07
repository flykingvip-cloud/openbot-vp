import {
  applyIncomingUserMessage,
  captureTaskCompletionBinding,
  isTaskExecutionBindingCurrent,
  recordCheckedTaskCompletion,
  commitSameTaskConstraint,
  commitAdmittedSessionTask,
  commitInteractionTaskProposal,
  startBoundTaskExecution,
} from "../../../conversation-task/session-task-board.js";
import { resumePausedCurrentTask } from "../mutations/resume-current.js";
import { mutateSessionTaskBoard, readSessionTaskBoard } from "./task-board-file.js";

/** The existing board owns persistence, locking and identity validation. */
export const sessionTaskState = {
  resumeCurrent: resumePausedCurrentTask,
  read: readSessionTaskBoard,
  captureBinding: captureTaskCompletionBinding,
  bindingCurrent: isTaskExecutionBindingCurrent,
  completeChecked: recordCheckedTaskCompletion,
  admitExecution: commitAdmittedSessionTask,
  applyInteractionProposal: commitInteractionTaskProposal,
  startExecution: startBoundTaskExecution,
  applyControl(sessionFile: string, prompt: string) {
    return mutateSessionTaskBoard(sessionFile, (board) => {
      const result = applyIncomingUserMessage({ board, incomingText: prompt });
      return { board: result.board, value: result };
    });
  },
  persistConstraint: commitSameTaskConstraint,
};
