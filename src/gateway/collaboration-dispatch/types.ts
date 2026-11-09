import type { SessionEntry } from "../../config/sessions.js";
import type { GatewayCollaborationGroupOperatingState } from "../collaboration-learning.js";
import type { GatewayCollaborationSpaceSnapshot } from "../collaboration-learning.js";
import type { FloorShadowAttachment } from "./floor-shadow-plan.js";
import type { MentionMode, PrimaryMode } from "./round-state.js";

/** Hard safety cap for a single human round (prevents runaway fan-out). */
export const COLLABORATION_ABSOLUTE_VISIBLE_TURN_LIMIT = 12;
/**
 * Legacy fallback for non-dispatch paths (e.g. recent-bot scan heuristics in chat.ts).
 * Dispatch reply ceilings read `operatingState.collaborationPolicy` or
 * `compileEffectivePolicyFromScope()` (L1 default 5 in policy-compiler.ts).
 */
export const COLLABORATION_DEFAULT_MAX_VISIBLE_REPLIES = 3;
/** @deprecated Use COLLABORATION_DEFAULT_MAX_VISIBLE_REPLIES — kept for imports/tests. */
export const COLLABORATION_VISIBLE_TURN_LIMIT = COLLABORATION_DEFAULT_MAX_VISIBLE_REPLIES;

export type CollaborationBotTarget = {
  agentId: string;
  name: string;
  sessionKey: string;
  updatedAt: number;
};

export type CollaborationDispatchScope = {
  groupId: string;
  rawSessionKey: string;
  title: string;
  coordinatorBotId?: string | null;
  groupProfile?: SessionEntry["collaborationGroupProfile"];
  members?: GatewayCollaborationSpaceSnapshot["members"];
  operatingState?: GatewayCollaborationGroupOperatingState | null;
  recentAssistantBotIds?: string[];
  /** Agent ids blocked on unfinished handoff / missing deliverable. */
  blockedAgentIds?: string[];
  bots: CollaborationBotTarget[];
  /** Trusted tenant for C5 collaboration I/O. */
  tenantId?: string | null;
  /**
   * P4 Mode B: active board 责任人 agent ids (loaded by caller / composition root).
   * When set, prefer these over `@所有人` broadcast for lead selection.
   */
  modeBBoardClaimantIds?: readonly string[] | null;
};

export type ParticipationTier = "mention" | "duty" | "relevance" | "wrap";

export type CollaborationResponseMode =
  | "single_owner"
  | "lead_plus_supplement"
  | "debate_or_brainstorm"
  | "decision_to_executor";

export type ContributionRole =
  | "lead"
  | "supplement"
  | "challenge"
  | "wrap"
  | "confirm"
  | "executor";

export type RoundPlanParticipant = {
  agentId: string;
  displayName: string;
  tier: ParticipationTier;
  contributionRole: ContributionRole;
  reasonText: string;
};

export type MentionConfirmCandidate = {
  agentId: string;
  name: string;
};

/** Near-miss mention. The round asks once instead of stopping unmatched. */
export type MentionConfirm = {
  ambiguous: boolean;
  token: string;
  candidates: MentionConfirmCandidate[];
  question: string;
};

export type RoundPlanAlert = {
  kind:
    | "mention_unmatched"
    | "mention_confirm"
    | "low_signal_limited"
    | "group_broadcast_expanded"
    | "introduction_follow_up"
    | "single_owner_mode"
    | "directed_decision_reply"
    | "last_speaker_follow_up"
    | "decision_to_executor_mode"
    | "onboarding_mission_stale"
    | "strategy_constrained"
    | "strategy_on_demand"
    | "standing_coordinator"
    | "matcher_nominated"
    | "fallback_speaker"
    | "blocked_on"
    | "broadcast_mention"
    | "mode_b_board_lead";
  message: string;
};

export type CollaborationRoundPlanPayload = {
  roundId: string;
  sessionKey: string;
  responseMode: CollaborationResponseMode;
  summaryText: string;
  participants: RoundPlanParticipant[];
  alerts?: RoundPlanAlert[];
  /** Existing orchestrator mention mode — surfaced for UI, not a second policy. */
  mentionMode?: MentionMode;
  /** True when the user @everyone / @所有人 / @all. Display-only. */
  mentionAll?: boolean;
};

/** Derived once by the decision engine; not a new policy source. */
export type RoundVisibleReplyBudget = { kind: "ordinary" | "broadcast"; limit: number };

export type ParticipationDecision = {
  visibleReplyBudget?: RoundVisibleReplyBudget;
  roundId: string;
  responseMode: CollaborationResponseMode;
  tier0: CollaborationBotTarget[];
  tier1: CollaborationBotTarget[];
  tier2: CollaborationBotTarget[];
  executionBots: CollaborationBotTarget[];
  roundPlan: CollaborationRoundPlanPayload;
  lowSignalLimited: boolean;
  mentionUnmatched: boolean;
  /** Set when a name is close but not exact. Dispatch waits for a reply. */
  mentionConfirm?: MentionConfirm | null;
  primaryMode: PrimaryMode;
  mentionMode: MentionMode;
  primaryQueue: string[];
  /**
   * Shadow attachment. Absent unless collaboration.floor.shadowStage is "A" or "B".
   * Never read by dispatch. Production participant lists stay on the fields above.
   * Shadow-B bids are not applied to this object.
   */
  floorShadow?: FloorShadowAttachment;
};
