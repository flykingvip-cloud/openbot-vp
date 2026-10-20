import type { TaskStatus } from "../types/task.js";

const VALID_TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  draft: ["ready", "cancelled"],
  ready: ["in_progress", "cancelled"],
  in_progress: ["blocked", "review", "completed", "cancelled"],
  blocked: ["in_progress", "cancelled"],
  review: ["in_progress", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export class InvalidTransitionError extends Error {
  readonly currentState: TaskStatus;
  readonly attemptedState: TaskStatus;
  readonly actor?: string;

  constructor(currentState: TaskStatus, attemptedState: TaskStatus, actor?: string) {
    super(
      `Invalid task status transition from "${currentState}" to "${attemptedState}"${
        actor ? ` by actor "${actor}"` : ""
      }`,
    );
    this.currentState = currentState;
    this.attemptedState = attemptedState;
    this.actor = actor;
    this.name = "InvalidTransitionError";
  }
}

export class TaskStateMachine {
  canTransition(from: TaskStatus, to: TaskStatus): boolean {
    return VALID_TASK_TRANSITIONS[from].includes(to);
  }

  assertTransition(from: TaskStatus, to: TaskStatus, actor?: string): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidTransitionError(from, to, actor);
    }
  }

  transition(from: TaskStatus, to: TaskStatus, actor?: string): TaskStatus {
    this.assertTransition(from, to, actor);
    return to;
  }

  getAvailableTransitions(from: TaskStatus): TaskStatus[] {
    return VALID_TASK_TRANSITIONS[from];
  }

  isTerminalState(state: TaskStatus): boolean {
    return state === "completed" || state === "cancelled";
  }
}
