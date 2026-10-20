import type { ReviewStatus } from "../types/review.js";

const VALID_REVIEW_TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  requested: ["submitted"],
  submitted: ["acknowledged", "resolved"],
  acknowledged: ["resolved"],
  resolved: [],
};

export class InvalidReviewTransitionError extends Error {
  readonly currentState: ReviewStatus;
  readonly attemptedState: ReviewStatus;
  readonly actor?: string;

  constructor(currentState: ReviewStatus, attemptedState: ReviewStatus, actor?: string) {
    super(
      `Invalid review status transition from "${currentState}" to "${attemptedState}"${
        actor ? ` by actor "${actor}"` : ""
      }`,
    );
    this.currentState = currentState;
    this.attemptedState = attemptedState;
    this.actor = actor;
    this.name = "InvalidReviewTransitionError";
  }
}

export class ReviewStateMachine {
  canTransition(from: ReviewStatus, to: ReviewStatus): boolean {
    return VALID_REVIEW_TRANSITIONS[from].includes(to);
  }

  assertTransition(from: ReviewStatus, to: ReviewStatus, actor?: string): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidReviewTransitionError(from, to, actor);
    }
  }

  transition(from: ReviewStatus, to: ReviewStatus, actor?: string): ReviewStatus {
    this.assertTransition(from, to, actor);
    return to;
  }

  getAvailableTransitions(from: ReviewStatus): ReviewStatus[] {
    return VALID_REVIEW_TRANSITIONS[from];
  }

  isTerminalState(state: ReviewStatus): boolean {
    return state === "resolved";
  }
}
