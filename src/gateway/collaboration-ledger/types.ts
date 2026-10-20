import type { CollaborationEventKey } from "../collaboration-dispatch/collaboration-event-key.js";
import type {
  CollaborationEpisodeDecisionRecord,
  CollaborationPolicyDecisionRecord,
} from "../collaboration-dispatch/episode-decision-record.js";
import type { PolicyMigrationEvent } from "../collaboration-dispatch/policy-migration-event.js";
import type { ParticipationTier } from "../collaboration-dispatch/types.js";
import type { GroupLifecycleStatus } from "../collaboration-learning/group-charter-types.js";
import type { GatewayCollaborationOperatingPhase } from "../collaboration-learning/operating-state-types.js";

export type CollaborationDispatchRecord = {
  kind: "dispatch";
  roundId: string;
  groupId: string;
  sessionKey: string;
  messagePreview: string;
  summaryText: string;
  responseMode?: string;
  participantAgentIds: string[];
  participantRoles?: Array<{ agentId: string; contributionRole: string }>;
  alerts?: Array<{ kind: string; message: string }>;
  recordedAtMs: number;
  /** P0.0b: CollaborationEventKey (only appended; legacy records may omit). */
  key?: CollaborationEventKey;
};

export type CollaborationExecutionRecord = {
  kind: "execution";
  roundId: string;
  groupId: string;
  sessionKey: string;
  agentId: string;
  agentName: string;
  tier: ParticipationTier;
  status: "completed" | "skipped" | "failed";
  contributionRole?: string;
  incrementalContribution?: boolean;
  suppressedAsDuplicate?: boolean;
  skipReason?: "pure_ack" | "no_increment" | "blocked_on" | "language";
  latencyMs?: number;
  recordedAtMs: number;
  /** P0.0b: CollaborationEventKey (only appended; legacy records may omit). */
  key?: CollaborationEventKey;
};

export type CollaborationQualityEvent =
  | "turn"
  | "handoff"
  | "review"
  | "deliverable"
  | "human_feedback";

export type CollaborationQualityOutcome =
  | "completed"
  | "skipped"
  | "failed"
  | "accepted"
  | "rejected";

/** How the selected bots actually performed. Distinct from PolicyDecisionRecord. */
export type CollaborationQualityRecord = {
  kind: "quality";
  groupId: string;
  event: CollaborationQualityEvent;
  outcome: CollaborationQualityOutcome;
  agentId?: string;
  roundId?: string;
  taskId?: string;
  deliverableId?: string;
  reviewId?: string;
  latencyMs?: number;
  artifacts?: string[];
  handoff?: { from: string; to: string; reason: string };
  reviewVerdict?: string;
  humanFeedback?: "positive" | "negative";
  effectivePolicyHash?: string;
  recordedAtMs: number;
  /** P0.0b: CollaborationEventKey (only appended; legacy records may omit). */
  key?: CollaborationEventKey;
};

export type CollaborationGovernanceRecord = {
  kind: "governance";
  groupId: string;
  event: "charter_sync" | "phase_change" | "lifecycle_change";
  lifecycleStatus?: GroupLifecycleStatus;
  phase?: GatewayCollaborationOperatingPhase;
  previousPhase?: GatewayCollaborationOperatingPhase;
  summary: string;
  recordedAtMs: number;
  /** P0.0b: CollaborationEventKey (only appended; legacy records may omit). */
  key?: CollaborationEventKey;
};

export type CollaborationPromotionAuditRecord = {
  kind: "promotion";
  groupId: string;
  sourceGroupId: string;
  botId: string;
  capsuleId?: string;
  projectionId?: string;
  assetId?: string;
  promoted: boolean;
  reason: string;
  targetScope: "personal" | "group" | "tenant";
  recordedAtMs: number;
  /** P0.0b: CollaborationEventKey (only appended; legacy records may omit). */
  key?: CollaborationEventKey;
};

export type CollaborationContextScopeRecord = {
  kind: "context_scope";
  groupId: string;
  sessionKey: string;
  roundId?: string;
  mode: string;
  confidentialityMaxLevel: string;
  allowedSources: Array<{ type: string; id: string }>;
  deniedSources: Array<{ type: string; id: string; reason: string }>;
  budgetMaxTokens: number;
  budgetMaxFiles: number;
  evidenceCount?: number;
  recordedAtMs: number;
  /** P0.0b: CollaborationEventKey (only appended; legacy records may omit). */
  key?: CollaborationEventKey;
};

/**
 * P1-A2 (Floor Runtime v2.1 §4.2): PolicyMigrationEvent appended to
 * `<ns>/ledger/collaboration.jsonl` with `kind: "policy_migration"`.
 * `recordedAtMs` mirrors `at` so the archive reader can sort it like other kinds.
 */
export type CollaborationPolicyMigrationRecord = PolicyMigrationEvent & {
  recordedAtMs: number;
  /** Migrations are not round-scoped; kept optional for ledger-shape uniformity. */
  key?: CollaborationEventKey;
};

/**
 * P1-B③ (§2.10 / §2.11): handoff facts. `type` is the fact name.
 * Append-only. Unknown ledger kinds stay skipped by the reader.
 */
export const HANDOFF_FACT_TYPES = [
  "TaskHandoffReceiverAccepted",
  "TaskHandoffApproved",
  "TaskResponsibilityChanged",
] as const;

export type HandoffFactType = (typeof HANDOFF_FACT_TYPES)[number];

export type CollaborationFactRecord = {
  kind: "fact";
  type: HandoffFactType;
  factId: string;
  groupId: string;
  taskId: string;
  handoffId: string;
  key: CollaborationEventKey;
  at: number;
  recordedAtMs: number;
  fromAgentId: string;
  toAgentId: string;
  responsibilityRole: string;
  ownerBefore?: string;
  ownerAfter?: string;
};

/**
 * P1-B② (§2.11 / §5.6): EpisodeDecisionRecord and PolicyDecisionRecord v2.
 * P1-B③ adds `fact`. Append-only. Legacy readers skip unknown kinds.
 */
export type CollaborationLedgerRecord =
  | CollaborationDispatchRecord
  | CollaborationExecutionRecord
  | CollaborationGovernanceRecord
  | CollaborationPromotionAuditRecord
  | CollaborationContextScopeRecord
  | CollaborationQualityRecord
  | CollaborationPolicyMigrationRecord
  | CollaborationPolicyDecisionRecord
  | CollaborationEpisodeDecisionRecord
  | CollaborationFactRecord;

export const COLLABORATION_LEDGER_KINDS = [
  "dispatch",
  "execution",
  "governance",
  "promotion",
  "context_scope",
  "quality",
  "policy_migration",
  "policy_decision",
  "episode_decision",
  "fact",
] as const;

export type CollaborationLedgerKind = (typeof COLLABORATION_LEDGER_KINDS)[number];

export type CollaborationLedgerArchiveQuery = {
  groupId: string;
  /** Server-resolved tenant (never a client param); required for the managed runtime namespace. */
  tenantId?: string | null;
  limit?: number;
  fromMs?: number;
  kinds?: CollaborationLedgerRecord["kind"][];
};

export type CollaborationLedgerArchiveResult = {
  groupId: string;
  records: CollaborationLedgerRecord[];
  totalRead: number;
  truncated: boolean;
  sources: string[];
};
