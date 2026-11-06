/** Bind existing host effects. No classification, routing, loops or task decisions live here. */
import { abortEmbeddedPiRun, queueEmbeddedPiMessage } from "../../agents/pi-embedded.js";
import { abortMidTaskAsideLanes } from "../../auto-reply/reply/mid-task-aside-reply-lane.js";
import {
  resolveActiveRunQueueAction,
  shouldAttemptCollectAmendSteer,
} from "../../auto-reply/reply/queue-policy.js";
import { clearSessionQueues } from "../../auto-reply/reply/queue.js";
import {
  activeConstraintTexts,
  isOwnerCurrentTaskControlUtterance,
} from "../../conversation-task/session-task-board.js";
import {
  classifyTurnRelation,
  isOwnerExecutionBarrierUtterance,
  shouldPersistOwnerConstraint,
} from "../../conversation-task/turn-relation.js";
import { resolveDialogueIntent } from "../command/index.js";
import type {
  ActiveTaskAmendmentPorts,
  InteractionPorts,
  CurrentTaskControlPorts,
} from "../command/index.js";
import { sessionTaskState } from "../state/index.js";

export function interruptInteractionTask(sessionId: string, sessionKey?: string) {
  abortEmbeddedPiRun(sessionId);
  abortMidTaskAsideLanes(sessionId);
  clearSessionQueues([sessionId, sessionKey]);
}
export const steerInteractionTask = queueEmbeddedPiMessage;

function bindOwnerControlPorts(params: {
  sessionFile: string;
  sessionId: string;
  queueKeys: (string | undefined)[];
}): CurrentTaskControlPorts {
  return {
    applyControl: (prompt) => sessionTaskState.applyControl(params.sessionFile, prompt),
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

function bindAmendmentPorts(params: {
  sessionFile: string;
  sessionId: string;
  prompt: string;
}): ActiveTaskAmendmentPorts {
  return {
    readTaskId: () =>
      params.sessionFile
        ? (sessionTaskState.read(params.sessionFile).current?.taskId?.trim() ?? "")
        : "",
    persist: (expectedTaskId) =>
      Boolean(params.sessionFile) &&
      sessionTaskState.persistConstraint({
        sessionFile: params.sessionFile,
        constraintText: params.prompt,
        expectedTaskId,
      }),
    steer: () => queueEmbeddedPiMessage(params.sessionId, params.prompt),
  };
}

export function resolveInteractionDialogue(
  input: Parameters<InteractionPorts["resolveDialogue"]>[0],
) {
  return resolveDialogueIntent(input, {
    activeConstraints: activeConstraintTexts,
    isConversation: (prompt, goal) => classifyTurnRelation(prompt, goal) === "conversation",
  });
}

export function bindInteractionPorts(params: {
  sessionId: string;
  prompt: string;
  queueKeys: (string | undefined)[];
}): InteractionPorts {
  return {
    readBoard: sessionTaskState.read,
    isOwnerControl: isOwnerCurrentTaskControlUtterance,
    control: (sessionFile) => bindOwnerControlPorts({ ...params, sessionFile }),
    resolveDialogue: resolveInteractionDialogue,
    steer: () => queueEmbeddedPiMessage(params.sessionId, params.prompt),
    resolveRelation: (prompt, board) => {
      const goal = board.current?.goalText?.trim() ?? "";
      const relation = goal
        ? classifyTurnRelation(prompt, goal, {
            activeConstraints: activeConstraintTexts(board.current),
          })
        : null;
      return relation;
    },
    shouldPersistConstraint: shouldPersistOwnerConstraint,
    shouldCollectAmend: shouldAttemptCollectAmendSteer,
    isBarrier: isOwnerExecutionBarrierUtterance,
    amendment: (sessionFile) => bindAmendmentPorts({ ...params, sessionFile }),
    queueAction: resolveActiveRunQueueAction,
  };
}
