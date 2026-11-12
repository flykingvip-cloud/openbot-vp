import {
  commitAdmittedSessionTask,
  isTurnExecutionAdmissionCurrent,
} from "../mutations/admit-task.js";
import {
  captureTaskCompletionBinding,
  isTaskExecutionBindingCurrent,
  startBoundTaskExecution,
} from "../mutations/execution-binding.js";
import { commitExplicitTaskControl } from "../mutations/explicit-control.js";
import { commitInteractionTaskProposal } from "../mutations/interaction-proposal.js";
import { resumePausedCurrentTask } from "../mutations/resume-current.js";
import { recordCheckedTaskCompletion } from "../mutations/task-completion.js";
import { readSessionTaskBoard, readInteractionTaskBoard } from "./task-board-file.js";

/** Typed runtime state authority; legacy text classification is outside this API. */
export const sessionTaskState = {
  applyExplicitControl: commitExplicitTaskControl,
  resumeCurrent: resumePausedCurrentTask,
  read: readSessionTaskBoard,
  readForInteraction: readInteractionTaskBoard,
  captureBinding: captureTaskCompletionBinding,
  bindingCurrent: isTaskExecutionBindingCurrent,
  completeChecked: recordCheckedTaskCompletion,
  admitExecution: commitAdmittedSessionTask,
  turnAdmissionCurrent: isTurnExecutionAdmissionCurrent,
  applyInteractionProposal: commitInteractionTaskProposal,
  startExecution: startBoundTaskExecution,
};
