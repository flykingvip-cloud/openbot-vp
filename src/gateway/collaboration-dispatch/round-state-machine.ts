import {
  occupancyForRoundState,
  type RoundState,
  type RoundTransitionEvent,
} from "./round-state.js";

const TRANSITIONS: Record<RoundState, Partial<Record<RoundTransitionEvent, RoundState>>> = {
  ROUND_CREATED: {
    message_received: "CLASSIFYING",
    abort: "ROUND_ABORTED",
    fatal_error: "ROUND_ABORTED",
  },
  CLASSIFYING: {
    mention_unmatched: "MENTION_UNMATCHED",
    mention_confirm: "MENTION_CONFIRM",
    classified: "PRIMARY_ASSIGNED",
    abort: "ROUND_ABORTED",
    fatal_error: "ROUND_ABORTED",
  },
  MENTION_UNMATCHED: {
    user_next_message: "ROUND_ABORTED",
    unmatched_expired: "ROUND_ABORTED",
    abort: "ROUND_ABORTED",
    fatal_error: "ROUND_ABORTED",
  },
  MENTION_CONFIRM: {
    user_next_message: "ROUND_ABORTED",
    abort: "ROUND_ABORTED",
    fatal_error: "ROUND_ABORTED",
  },
  PRIMARY_ASSIGNED: {
    queue_ready: "PRIMARY_QUEUE",
    abort: "ROUND_ABORTED",
    fatal_error: "ROUND_ABORTED",
  },
  PRIMARY_QUEUE: {
    cursor_ready: "WAITING_PRIMARY",
    abort: "ROUND_ABORTED",
    fatal_error: "ROUND_ABORTED",
  },
  WAITING_PRIMARY: {
    primary_started: "PRIMARY_RESPONDING",
    abort: "ROUND_ABORTED",
    fatal_error: "ROUND_ABORTED",
  },
  PRIMARY_RESPONDING: {
    completed: "PRIMARY_COMPLETED",
    placeholder: "PRIMARY_RESPONDING",
    timeout: "PRIMARY_TIMEOUT",
    abort: "ROUND_ABORTED",
    fatal_error: "ROUND_ABORTED",
  },
  PRIMARY_COMPLETED: {
    queue_has_next: "PRIMARY_QUEUE",
    queue_exhausted_supplement: "SUPPLEMENT_WINDOW",
    queue_exhausted_no_supplement: "CONVERGENCE_CHECK",
    abort: "ROUND_ABORTED",
    fatal_error: "ROUND_ABORTED",
  },
  PRIMARY_TIMEOUT: {
    takeover: "FALLBACK",
    abort: "ROUND_ABORTED",
    fatal_error: "ROUND_ABORTED",
  },
  FALLBACK: {
    fallback_completed: "PRIMARY_COMPLETED",
    fallback_failed: "ROUND_ABORTED",
    abort: "ROUND_ABORTED",
    fatal_error: "ROUND_ABORTED",
  },
  SUPPLEMENT_WINDOW: {
    candidate_found: "SUPPLEMENTING",
    candidate_dropped: "SUPPLEMENT_WINDOW",
    no_candidate: "CONVERGENCE_CHECK",
    abort: "ROUND_ABORTED",
    fatal_error: "ROUND_ABORTED",
  },
  SUPPLEMENTING: {
    candidate_dropped: "SUPPLEMENTING",
    supplement_finished: "CONVERGENCE_CHECK",
    abort: "ROUND_ABORTED",
    fatal_error: "ROUND_ABORTED",
  },
  CONVERGENCE_CHECK: {
    close_required: "OPTIONAL_CLOSE",
    close_not_required: "ROUND_COMPLETE",
    abort: "ROUND_ABORTED",
    fatal_error: "ROUND_ABORTED",
  },
  OPTIONAL_CLOSE: {
    close_completed: "ROUND_COMPLETE",
    abort: "ROUND_ABORTED",
    fatal_error: "ROUND_ABORTED",
  },
  ROUND_COMPLETE: {},
  ROUND_ABORTED: {},
};

export class RoundTransitionError extends Error {
  readonly from: RoundState;
  readonly event: RoundTransitionEvent;

  constructor(from: RoundState, event: RoundTransitionEvent) {
    super(`illegal round transition: ${from} + ${event}`);
    this.name = "RoundTransitionError";
    this.from = from;
    this.event = event;
  }
}

export function transitionRoundState(state: RoundState, event: RoundTransitionEvent): RoundState {
  const next = TRANSITIONS[state]?.[event];
  if (!next) {
    throw new RoundTransitionError(state, event);
  }
  return next;
}

export function canTransitionRoundState(state: RoundState, event: RoundTransitionEvent) {
  return Boolean(TRANSITIONS[state]?.[event]);
}

export function occupancyAfterTransition(state: RoundState, event: RoundTransitionEvent) {
  return occupancyForRoundState(transitionRoundState(state, event));
}
