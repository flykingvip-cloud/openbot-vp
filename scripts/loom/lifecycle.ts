/**
 * lifecycle.ts — Task lifecycle state machine + session liveness (Requirement 10).
 *
 * Pure metadata only: this phase NEVER triggers worktree create/destroy (R10.5).
 * `lastSignalAt` is refreshed by any successful Loom write (register/accept/
 * state transition) so `dead` detection can close the loop (R10.3, design §3.8).
 */

import type { Session, Task, TaskState } from "./registry.js";

/** Allowed task state transitions. `landed` and `abandoned` are terminal. */
export const TASK_TRANSITIONS: Record<TaskState, TaskState[]> = {
  claimed: ["active", "abandoned"],
  active: ["paused", "blocked", "ready", "abandoned"],
  paused: ["active", "abandoned"],
  blocked: ["active", "abandoned"],
  ready: ["landed", "active", "abandoned"],
  landed: [],
  abandoned: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: TaskState,
    public readonly to: TaskState,
  ) {
    const allowed = TASK_TRANSITIONS[from];
    const hint = allowed.length > 0 ? allowed.join(", ") : "(terminal — no transitions)";
    super(`Illegal task state transition ${from} → ${to}. Allowed from ${from}: ${hint}.`);
    this.name = "IllegalTransitionError";
  }
}

/** Return a new Task with the transitioned state, or throw on an illegal move. */
export function transitionTask(task: Task, to: TaskState, now: Date = new Date()): Task {
  if (task.state === to) {
    return task;
  }
  if (!canTransition(task.state, to)) {
    throw new IllegalTransitionError(task.state, to);
  }
  return { ...task, state: to, sessions: task.sessions.map((s) => touchSignal(s, now)) };
}

/** Default session liveness threshold (D5): 24h with no activity signal. */
export const DEFAULT_DEAD_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * A session is considered `dead` when it has an activity signal that is older
 * than the threshold. Sessions already marked done/error are not "dead", and a
 * session with no recorded signal is not auto-killed (treated as live until a
 * signal exists to age out).
 */
export function isSessionDead(
  session: Session,
  now: Date = new Date(),
  thresholdMs: number = DEFAULT_DEAD_THRESHOLD_MS,
): boolean {
  if (session.status === "done" || session.status === "error" || session.status === "dead") {
    return session.status === "dead";
  }
  if (!session.lastSignalAt) {
    return false;
  }
  const last = Date.parse(session.lastSignalAt);
  if (Number.isNaN(last)) {
    return false;
  }
  return now.getTime() - last > thresholdMs;
}

/** Refresh a session's activity signal (called by successful write operations). */
export function touchSignal(session: Session, now: Date = new Date()): Session {
  return { ...session, lastSignalAt: now.toISOString() };
}
