import {
  applyIncomingUserMessage,
  commitSameTaskConstraint,
  commitAdmittedSessionTask,
  commitInteractionTaskProposal,
} from "../../../conversation-task/session-task-board.js";
import {
  captureTaskCompletionBinding,
  isTaskExecutionBindingCurrent,
  startBoundTaskExecution,
} from "../mutations/execution-binding.js";
import { resumePausedCurrentTask } from "../mutations/resume-current.js";
import { recordCheckedTaskCompletion } from "../mutations/task-completion.js";
import { mutateSessionTaskBoard, readSessionTaskBoard } from "./task-board-file.js";

/** Runtime owns storage and binding; remaining legacy business mutations share that same repository. */
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
