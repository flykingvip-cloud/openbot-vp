/** Compatibility facade; runtime owns recovery and state validation. */
export {
  buildTaskBoardContinuePrompt,
  claimTaskBoardContinue,
  revalidateContinueTicket,
} from "../agent-runtime/state/index.js";
export {
  TASK_BOARD_CONTINUE_DELAY_MS,
  TASK_BOARD_CONTINUE_MAX_PER_TASK,
  TASK_BOARD_CONTINUE_COOLDOWN_MS,
  resetTaskBoardContinueLedgerForTest,
  isTaskBoardContinueInternalPrompt,
  isExplicitHumanGateWait,
  decideTaskBoardContinue,
  scheduleTaskBoardContinueWake,
} from "../agent-runtime/execution/index.js";
export type {
  TaskBoardContinueSkipReason,
  TaskBoardContinueTicket,
  TaskBoardContinueDecision,
} from "../agent-runtime/contracts/continuation.js";
export type { TaskBoardContinueEnqueue } from "../agent-runtime/execution/runner/task-continuation.js";
