/**
 * Floor Runtime v2.1 §3.1 / §5.6 — Episode orchestration fact types (P1-B①).
 *
 * Additive only. Live write path is gated by `collaboration.episodeStore`
 * (plan name `collab.episodeStore`), default OFF. Flag-off production paths
 * must not call into the store (byte-for-byte unchanged).
 */
import type { CollaborationEventKey } from "./collaboration-event-key.js";

export type EpisodeState =
  | "EPISODE_CREATED"
  | "POLICY_SNAPSHOTTED"
  | "CONTEXT_RESOLVE"
  | "INTENT_CLASSIFIED"
  | "WAITING_USER"
  | "PARTICIPANT_ELIGIBILITY"
  | "BID_ADMISSION"
  | "BEAT_ACTIVE"
  | "FACILITATOR_OBSERVE"
  | "GOVERNANCE_GATE"
  | "WAIT_HUMAN"
  | "COMMIT"
  | "EPISODE_CLOSED"
  | "ABORTED_ON_RESTART";

/** Two terminal states per design §3.1. */
export const EPISODE_TERMINAL_STATES: ReadonlySet<EpisodeState> = new Set([
  "EPISODE_CLOSED",
  "ABORTED_ON_RESTART",
]);

export function isEpisodeTerminal(state: EpisodeState): boolean {
  return EPISODE_TERMINAL_STATES.has(state);
}

export type EpisodeCloseReason =
  | "completed"
  | "silent"
  | "no_eligible"
  | "waiting_user"
  | "awaiting_human"
  | "aborted"
  | "budget_exhausted"
  | "fuse_tripped"
  | "error";

/**
 * Transition events (design §3.1 E0–E19 / E* / E** / E-R).
 * Names are snake_case mirrors of the design event column.
 */
export type EpisodeTransitionEvent =
  | "snapshot_bound"
  | "resolve_context"
  | "classified"
  | "unmatched_mention"
  | "notice_sent"
  | "eligibility"
  | "none_eligible"
  | "ranked"
  | "admitted"
  | "nobody"
  | "beat_done"
  | "next_beat"
  | "authorized_action"
  | "redirect"
  | "handoff_proposed"
  | "route_to_task_governance"
  | "converged"
  | "stop_loop"
  | "no_new_value"
  | "budget_exhausted"
  | "needs_human"
  | "parked"
  | "pass"
  | "nothing_to_commit"
  | "committed"
  | "abort"
  | "fuse"
  | "recover";

export type EpisodeEventType =
  | "EPISODE_CREATED"
  | "POLICY_SNAPSHOTTED"
  | "CONTEXT_RESOLVED"
  | "INTENT_CLASSIFIED"
  | "WAITING_USER"
  | "PARTICIPANT_ELIGIBILITY"
  | "BID_ADMISSION"
  | "BEAT_ACTIVE"
  | "BEAT_COMPLETED"
  | "FACILITATOR_OBSERVE"
  | "GOVERNANCE_GATE"
  | "WAIT_HUMAN"
  | "COMMIT"
  | "EPISODE_CLOSED"
  | "EPISODE_ABORTED"
  | "EPISODE_ABORTED_ON_RESTART"
  | "EMERGENCY_FUSE_TRIPPED";

export type EpisodeBeatRef = Readonly<{
  beatId: string;
  beatIndex: number;
  roundId: string;
}>;

/**
 * Persisted Episode snapshot under `<ns>/episodes/<episodeId>/episode.json`.
 * Legacy rounds are modeled as a 1-beat Episode (beats.length === 1).
 */
export type PersistedEpisode = {
  episodeId: string;
  groupId: string;
  tenantId: string | null;
  parentEpisodeId?: string | null;
  protocol: "legacy" | "shadow" | "floor";
  state: EpisodeState;
  stateVersion: number;
  closeReason?: EpisodeCloseReason | null;
  /** Frozen snapshot id bound at E0; immutable thereafter. */
  policySnapshotId: string | null;
  policyHash: string | null;
  provenanceHash: string | null;
  compilerRevision: string | null;
  beats: EpisodeBeatRef[];
  /**
   * P0 G3. Gate results recorded at FACILITATOR_OBSERVE.
   * Same element shape as EpisodeDecisionRecord.facilitator
   * (`authorized` | `denied` | `route_to_task_governance`).
   * Absent until the control plane runs. Not a participant list.
   */
  facilitator?: ReadonlyArray<{
    actionId: string;
    outcome: "authorized" | "denied" | "route_to_task_governance";
  }>;
  /** Optional legacy decision fingerprint recorded at BID_ADMISSION (P1-B①). */
  legacyDecisionRef?: string | null;
  createdAt: number;
  updatedAt: number;
  key?: CollaborationEventKey | null;
};

export type EpisodeRuntimeEvent = {
  eventId: string;
  eventType: EpisodeEventType;
  at: number;
  fromState: EpisodeState;
  toState: EpisodeState;
  transition: EpisodeTransitionEvent;
  episodeId: string;
  beatId?: string | null;
  closeReason?: EpisodeCloseReason | null;
  note?: string | null;
  key?: CollaborationEventKey | null;
};

export type EpisodeCommit = {
  snapshot: PersistedEpisode;
  event: EpisodeRuntimeEvent;
};
