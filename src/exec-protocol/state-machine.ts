import { ExecProtocolError } from "./errors.js";
import { isTerminalState, type ExecReconcileConclusion, type ExecTaskState } from "./types.js";

const ALLOWED_TRANSITIONS: Record<ExecTaskState, ReadonlySet<ExecTaskState>> = {
  accepted: new Set(["queued", "cancel_requested", "result_unconfirmed"]),
  queued: new Set(["running", "failed", "cancel_requested", "result_unconfirmed"]),
  running: new Set(["succeeded", "failed", "cancel_requested", "result_unconfirmed"]),
  cancel_requested: new Set(["cancelled", "result_unconfirmed"]),
  succeeded: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  result_unconfirmed: new Set(),
};

export function canTransition(from: ExecTaskState, to: ExecTaskState): boolean {
  if (from === to) {
    return true;
  }
  return ALLOWED_TRANSITIONS[from].has(to);
}

export function transitionState(
  from: ExecTaskState,
  to: ExecTaskState,
  context?: { taskId?: string },
): ExecTaskState {
  if (from === to) {
    return from;
  }
  if (isTerminalState(from)) {
    throw new ExecProtocolError(
      "EXEC_CONFLICT",
      `terminal state ${from} cannot transition to ${to}`,
      { taskId: context?.taskId, state: from },
    );
  }
  if (!ALLOWED_TRANSITIONS[from].has(to)) {
    throw new ExecProtocolError("EXEC_CONFLICT", `illegal state transition ${from} -> ${to}`, {
      taskId: context?.taskId,
      state: from,
    });
  }
  if (to === "succeeded" && from !== "running") {
    throw new ExecProtocolError(
      "EXEC_CONFLICT",
      "succeeded is only allowed from running after checksum verification",
      { taskId: context?.taskId, state: from },
    );
  }
  return to;
}

export function assertCanEnterSucceeded(from: ExecTaskState, taskId?: string): void {
  if (from !== "running") {
    throw new ExecProtocolError(
      "EXEC_CONFLICT",
      "succeeded is only allowed from running after checksum verification",
      { taskId, state: from },
    );
  }
}

export function assertNotRestartable(state: ExecTaskState, taskId?: string): void {
  if (state === "cancelled" || state === "cancel_requested") {
    throw new ExecProtocolError("EXEC_CONFLICT", "cancelled tasks must not be restarted", {
      taskId,
      state,
    });
  }
  if (isTerminalState(state)) {
    throw new ExecProtocolError(
      "EXEC_CONFLICT",
      `terminal task cannot be restarted from ${state}`,
      {
        taskId,
        state,
      },
    );
  }
}

export function reconcileTransition(
  from: ExecTaskState,
  conclusion: ExecReconcileConclusion,
  context?: { taskId?: string },
): ExecTaskState {
  if (from !== "result_unconfirmed") {
    throw new ExecProtocolError(
      "EXEC_CONFLICT",
      `reconcile cannot leave ${from}; only result_unconfirmed may be reconciled`,
      { taskId: context?.taskId, state: from },
    );
  }
  if (conclusion === "remain_unconfirmed") {
    return "result_unconfirmed";
  }
  if (conclusion === "succeeded" || conclusion === "failed" || conclusion === "cancelled") {
    return conclusion;
  }
  throw new ExecProtocolError("EXEC_CONFLICT", "unsupported reconcile conclusion", {
    taskId: context?.taskId,
    state: from,
  });
}
