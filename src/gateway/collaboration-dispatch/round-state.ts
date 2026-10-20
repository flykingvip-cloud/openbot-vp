import type { CollabEdge } from "./collab-edge.js";
import type { CollaborationEventKey } from "./collaboration-event-key.js";
import type { PolicyDecisionRecord } from "./effective-policy.js";

export type RoundOccupancy = "none" | "executing";

export type PrimaryMode = "single" | "explicit_multi";

/** `broadcast` = @所有人 / @everyone fan-out (lead + invited members). */
export type MentionMode = "none" | "single_primary" | "explicit_multi" | "broadcast";

export type RoundState =
  | "ROUND_CREATED"
  | "CLASSIFYING"
  | "MENTION_UNMATCHED"
  | "MENTION_CONFIRM"
  | "PRIMARY_ASSIGNED"
  | "PRIMARY_QUEUE"
  | "WAITING_PRIMARY"
  | "PRIMARY_RESPONDING"
  | "PRIMARY_COMPLETED"
  | "PRIMARY_TIMEOUT"
  | "FALLBACK"
  | "SUPPLEMENT_WINDOW"
  | "SUPPLEMENTING"
  | "CONVERGENCE_CHECK"
  | "OPTIONAL_CLOSE"
  | "ROUND_COMPLETE"
  | "ROUND_ABORTED";

export type RoundTransitionEvent =
  | "message_received"
  | "mention_unmatched"
  | "mention_confirm"
  | "unmatched_expired"
  | "user_next_message"
  | "classified"
  | "queue_ready"
  | "cursor_ready"
  | "primary_started"
  | "completed"
  | "placeholder"
  | "timeout"
  | "takeover"
  | "fallback_completed"
  | "fallback_failed"
  | "queue_has_next"
  | "queue_exhausted_supplement"
  | "queue_exhausted_no_supplement"
  | "candidate_found"
  | "candidate_dropped"
  | "no_candidate"
  | "supplement_finished"
  | "close_required"
  | "close_not_required"
  | "close_completed"
  | "abort"
  | "fatal_error";

export type RoundEventType =
  | "ROUND_CREATED"
  | "POLICY_SNAPSHOTTED"
  | "CLASSIFIED"
  | "MENTION_UNMATCHED"
  | "MENTION_CONFIRM_ASKED"
  | "MENTION_UNMATCHED_RESOLVED"
  | "PRIMARY_ASSIGNED"
  | "PRIMARY_QUEUE_ENTERED"
  | "PRIMARY_STARTED"
  | "PRIMARY_COMPLETED"
  | "PRIMARY_TIMEOUT"
  | "FALLBACK_STARTED"
  | "FALLBACK_COMPLETED"
  | "SUPPLEMENT_WINDOW_OPENED"
  | "CANDIDATE_DROPPED"
  | "SUPPLEMENT_DISPATCHED"
  | "SUPPLEMENT_COMPLETED"
  | "CONVERGENCE_CHECKED"
  | "CLOSE_STARTED"
  | "ROUND_COMPLETED"
  | "ROUND_ABORTED"
  | "DISPATCH_RETRY_SKIPPED"
  | "SCOPE_RESOLVED";

export type PrimaryCompletionContract = {
  responseStatus: "streaming" | "complete" | "placeholder" | "failed" | "aborted";
  hasConclusion: boolean;
  /** Primary produced a real visible, non-placeholder reply (independent of hasConclusion). */
  visibleReply?: boolean;
  source: "heuristic" | "runner_metadata";
};

export type RoundDispatchStatus =
  | "accepted"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped_duplicate";

export type PersistedRoundDispatch = {
  dispatchId: string;
  agentId: string;
  role: "primary" | "explicit_member" | "fallback" | "supplement" | "close";
  attempt: number;
  status: RoundDispatchStatus;
  createdAt: number;
};

export type PersistedRound = {
  roundId: string;
  groupId: string | null;
  sessionKey: string;
  userMessageId: string;
  tenantId?: string | null;
  collaborationMode:
    | "single_owner"
    | "lead_plus_supplement"
    | "explicit_multi"
    | "debate"
    | "brainstorm"
    | "multi_executor";
  policyVersion: string;
  policyHash: string;
  policySnapshot: unknown;
  state: RoundState;
  occupancy: RoundOccupancy;
  stateVersion: number;
  primaryMode: PrimaryMode;
  mentionMode: MentionMode;
  primaryAgentId?: string;
  primaryQueue: string[];
  primaryCursor: number;
  createdAt: number;
  updatedAt: number;
  deadlineAt?: number;
  placeholderDeadlineAt?: number;
  currentDispatchId?: string;
  completedDispatchIds: string[];
  dispatches: PersistedRoundDispatch[];
  abortRequested: boolean;
  abortReason?: "user_stop" | "mention_unmatched_expired" | "fatal" | "superseded";
  lastEventId?: string;
  lastEventSeq: number;
  retryCount: number;
  seenEventIds: string[];
  completion?: PrimaryCompletionContract;
  /** Same-round edges attached after PRIMARY_COMPLETED (≤2, depth 1). */
  edges?: CollabEdge[];
  contextScopePlan?: unknown;
  policyDecision?: PolicyDecisionRecord;
  /**
   * P0.0b: CollaborationEventKey reference only. This is the legacy single-beat
   * identity (`ep_` + clientRunId), not an Episode Store record. Episode Store
   * and Floor bids exist in-repo and stay off the production round
   * (`collaboration.episodeStore` default false; bids do not drive participants).
   */
  episodeRef?: CollaborationEventKey;
  /** Near-miss mention question. The round waits; it does not expire into an abort. */
  mentionConfirm?: {
    question: string;
    ambiguous: boolean;
    token: string;
    candidates: Array<{ agentId: string; name: string }>;
  };
};

export type RoundRuntimeEvent = {
  eventId: string;
  roundId: string;
  sequence: number;
  timestamp: number;
  type: RoundEventType;
  previousState: RoundState;
  nextState: RoundState;
  dispatchId?: string;
  agentId?: string;
  payload?: Record<string, unknown>;
};

const EXECUTING_STATES = new Set<RoundState>([
  "WAITING_PRIMARY",
  "PRIMARY_RESPONDING",
  "SUPPLEMENTING",
  "FALLBACK",
  "OPTIONAL_CLOSE",
]);

export function occupancyForRoundState(state: RoundState): RoundOccupancy {
  return EXECUTING_STATES.has(state) ? "executing" : "none";
}
