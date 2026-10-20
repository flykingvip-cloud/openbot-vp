/**
 * Floor Runtime v2.1 §3.1 — Episode state machine (P1-B①).
 *
 * Pure transition table. P0 G2 drives one beat through this table from
 * `episode-single-beat-runtime.ts` when `collaboration.episodeStore` is on.
 * The flag defaults off; this module does not run a multi-beat loop.
 */
import type { EpisodeState, EpisodeTransitionEvent } from "./episode-state.js";
import { isEpisodeTerminal } from "./episode-state.js";

/**
 * Allowed transitions. Terminal states have empty maps.
 * E* (abort) and E** (fuse) and E-R (recover) apply from any non-terminal —
 * handled as fallbacks in transitionEpisodeState, not listed per-state.
 */
const TRANSITIONS: Record<EpisodeState, Partial<Record<EpisodeTransitionEvent, EpisodeState>>> = {
  EPISODE_CREATED: {
    snapshot_bound: "POLICY_SNAPSHOTTED",
  },
  POLICY_SNAPSHOTTED: {
    resolve_context: "CONTEXT_RESOLVE",
  },
  CONTEXT_RESOLVE: {
    classified: "INTENT_CLASSIFIED",
  },
  INTENT_CLASSIFIED: {
    unmatched_mention: "WAITING_USER",
    eligibility: "PARTICIPANT_ELIGIBILITY",
  },
  WAITING_USER: {
    notice_sent: "EPISODE_CLOSED",
  },
  PARTICIPANT_ELIGIBILITY: {
    none_eligible: "EPISODE_CLOSED",
    ranked: "BID_ADMISSION",
  },
  BID_ADMISSION: {
    admitted: "BEAT_ACTIVE",
    nobody: "EPISODE_CLOSED",
  },
  BEAT_ACTIVE: {
    beat_done: "FACILITATOR_OBSERVE",
  },
  FACILITATOR_OBSERVE: {
    next_beat: "BID_ADMISSION",
    authorized_action: "BID_ADMISSION",
    redirect: "PARTICIPANT_ELIGIBILITY",
    handoff_proposed: "GOVERNANCE_GATE",
    route_to_task_governance: "GOVERNANCE_GATE",
    converged: "GOVERNANCE_GATE",
    stop_loop: "GOVERNANCE_GATE",
    no_new_value: "GOVERNANCE_GATE",
    budget_exhausted: "GOVERNANCE_GATE",
  },
  GOVERNANCE_GATE: {
    needs_human: "WAIT_HUMAN",
    pass: "COMMIT",
    nothing_to_commit: "COMMIT",
  },
  WAIT_HUMAN: {
    parked: "EPISODE_CLOSED",
  },
  COMMIT: {
    committed: "EPISODE_CLOSED",
  },
  EPISODE_CLOSED: {},
  ABORTED_ON_RESTART: {},
};

/** Events that close any non-terminal episode (E* / E** / E-R). */
const GLOBAL_NON_TERMINAL: Partial<Record<EpisodeTransitionEvent, EpisodeState>> = {
  abort: "EPISODE_CLOSED",
  fuse: "EPISODE_CLOSED",
  recover: "ABORTED_ON_RESTART",
};

export class EpisodeTransitionError extends Error {
  readonly from: EpisodeState;
  readonly event: EpisodeTransitionEvent;

  constructor(from: EpisodeState, event: EpisodeTransitionEvent) {
    super(`illegal episode transition: ${from} + ${event}`);
    this.name = "EpisodeTransitionError";
    this.from = from;
    this.event = event;
  }
}

export function transitionEpisodeState(
  state: EpisodeState,
  event: EpisodeTransitionEvent,
): EpisodeState {
  const next = TRANSITIONS[state]?.[event];
  if (next) {
    return next;
  }
  if (!isEpisodeTerminal(state)) {
    const global = GLOBAL_NON_TERMINAL[event];
    if (global) {
      return global;
    }
  }
  throw new EpisodeTransitionError(state, event);
}

export function canTransitionEpisodeState(
  state: EpisodeState,
  event: EpisodeTransitionEvent,
): boolean {
  if (TRANSITIONS[state]?.[event]) {
    return true;
  }
  if (!isEpisodeTerminal(state) && GLOBAL_NON_TERMINAL[event]) {
    return true;
  }
  return false;
}

/**
 * Legacy 1-beat happy path (design §5.6):
 * POLICY_SNAPSHOTTED → … → EPISODE_CLOSED via BID_ADMISSION(legacy decision).
 * Starts from EPISODE_CREATED so callers can bind a snapshot first (E0).
 */
export const LEGACY_ONE_BEAT_HAPPY_PATH: readonly EpisodeTransitionEvent[] = [
  "snapshot_bound",
  "resolve_context",
  "classified",
  "eligibility",
  "ranked",
  "admitted",
  "beat_done",
  "converged",
  "pass",
  "committed",
] as const;

/** Walk the legacy 1-beat path; throws on any illegal step. */
export function walkLegacyOneBeatPath(start: EpisodeState = "EPISODE_CREATED"): EpisodeState {
  let state = start;
  for (const event of LEGACY_ONE_BEAT_HAPPY_PATH) {
    state = transitionEpisodeState(state, event);
  }
  return state;
}
