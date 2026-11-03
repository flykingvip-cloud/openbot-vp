/** Bind existing host effects. No classification, routing, loops or task decisions live here. */
import { abortEmbeddedPiRun, queueEmbeddedPiMessage } from "../../agents/pi-embedded.js";
import { abortMidTaskAsideLanes } from "../../auto-reply/reply/mid-task-aside-reply-lane.js";
import { clearSessionQueues } from "../../auto-reply/reply/queue.js";
import {
  applyIncomingUserMessage,
  commitSameTaskConstraint,
  mutateSessionTaskBoard,
  readSessionTaskBoard,
} from "../../conversation-task/session-task-board.js";
import type { ActiveTaskAmendmentPorts, CurrentTaskControlPorts } from "../command/index.js";

export function bindOwnerControlPorts(params: {
  sessionFile: string;
  sessionId: string;
  queueKeys: (string | undefined)[];
}): CurrentTaskControlPorts {
  return {
    applyControl: (prompt) =>
      mutateSessionTaskBoard(params.sessionFile, (board) => {
        const result = applyIncomingUserMessage({ board, incomingText: prompt });
        return { board: result.board, value: result };
      }),
    abortMain: () => {
      abortEmbeddedPiRun(params.sessionId);
    },
    abortAsides: () => {
      abortMidTaskAsideLanes(params.sessionId);
    },
    clearPending: () => {
      clearSessionQueues(params.queueKeys);
    },
  };
}

export function bindAmendmentPorts(params: {
  sessionFile: string;
  sessionId: string;
  prompt: string;
}): ActiveTaskAmendmentPorts {
  return {
    readTaskId: () =>
      params.sessionFile
        ? (readSessionTaskBoard(params.sessionFile).current?.taskId?.trim() ?? "")
        : "",
    persist: (expectedTaskId) =>
      Boolean(params.sessionFile) &&
      commitSameTaskConstraint({
        sessionFile: params.sessionFile,
        constraintText: params.prompt,
        expectedTaskId,
      }),
    steer: () => queueEmbeddedPiMessage(params.sessionId, params.prompt),
  };
}
