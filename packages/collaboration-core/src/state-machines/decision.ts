import type { DecisionStatus } from "../types/decision.js";

const VALID_DECISION_TRANSITIONS: Record<DecisionStatus, DecisionStatus[]> = {
  draft: ["finalized"],
  finalized: ["superseded"],
  superseded: [],
};

export class InvalidDecisionTransitionError extends Error {
  readonly currentState: DecisionStatus;
  readonly attemptedState: DecisionStatus;
  readonly actor?: string;

  constructor(currentState: DecisionStatus, attemptedState: DecisionStatus, actor?: string) {
    super(
      `Invalid decision status transition from "${currentState}" to "${attemptedState}"${
        actor ? ` by actor "${actor}"` : ""
      }`,
    );
    this.currentState = currentState;
    this.attemptedState = attemptedState;
    this.actor = actor;
    this.name = "InvalidDecisionTransitionError";
  }
}

export class DecisionStateMachine {
  canTransition(from: DecisionStatus, to: DecisionStatus): boolean {
    return VALID_DECISION_TRANSITIONS[from].includes(to);
  }

  assertTransition(from: DecisionStatus, to: DecisionStatus, actor?: string): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidDecisionTransitionError(from, to, actor);
    }
  }

  transition(from: DecisionStatus, to: DecisionStatus, actor?: string): DecisionStatus {
    this.assertTransition(from, to, actor);
    return to;
  }

  getAvailableTransitions(from: DecisionStatus): DecisionStatus[] {
    return VALID_DECISION_TRANSITIONS[from];
  }

  isTerminalState(state: DecisionStatus): boolean {
    return state === "superseded";
  }
}
