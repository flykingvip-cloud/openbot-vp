import {
  applyIncomingUserMessage,
  commitSameTaskConstraint,
  commitAdmittedSessionTask,
  commitInteractionTaskProposal,
  mutateSessionTaskBoard,
  readSessionTaskBoard,
  startBoundTaskExecution,
} from "../../conversation-task/session-task-board.js";

/** The existing board owns persistence, locking and identity validation. */
export const sessionTaskState = {
  read: readSessionTaskBoard,
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
