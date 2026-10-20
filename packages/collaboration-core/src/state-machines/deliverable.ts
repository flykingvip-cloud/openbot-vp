import type { DeliverableStatus } from "../types/deliverable.js";

const VALID_DELIVERABLE_TRANSITIONS: Record<DeliverableStatus, DeliverableStatus[]> = {
  draft: ["submitted"],
  submitted: ["in_review", "draft"],
  in_review: ["approved", "submitted"],
  approved: ["published", "in_review"],
  published: ["superseded", "archived"],
  superseded: ["archived"],
  archived: [],
};

export class InvalidDeliverableTransitionError extends Error {
  readonly currentState: DeliverableStatus;
  readonly attemptedState: DeliverableStatus;
  readonly actor?: string;

  constructor(currentState: DeliverableStatus, attemptedState: DeliverableStatus, actor?: string) {
    super(
      `Invalid deliverable status transition from "${currentState}" to "${attemptedState}"${
        actor ? ` by actor "${actor}"` : ""
      }`,
    );
    this.currentState = currentState;
    this.attemptedState = attemptedState;
    this.actor = actor;
    this.name = "InvalidDeliverableTransitionError";
  }
}

export class DeliverableStateMachine {
  canTransition(from: DeliverableStatus, to: DeliverableStatus): boolean {
    return VALID_DELIVERABLE_TRANSITIONS[from].includes(to);
  }

  assertTransition(from: DeliverableStatus, to: DeliverableStatus, actor?: string): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidDeliverableTransitionError(from, to, actor);
    }
  }

  transition(from: DeliverableStatus, to: DeliverableStatus, actor?: string): DeliverableStatus {
    this.assertTransition(from, to, actor);
    return to;
  }

  getAvailableTransitions(from: DeliverableStatus): DeliverableStatus[] {
    return VALID_DELIVERABLE_TRANSITIONS[from];
  }

  isTerminalState(state: DeliverableStatus): boolean {
    return state === "archived";
  }
}
