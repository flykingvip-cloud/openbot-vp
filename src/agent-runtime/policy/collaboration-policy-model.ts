import { COLLABORATION_POLICY_PROTOCOL_VERSION } from "./collaboration-rules.js";
import type {
  CollaborationModeTemplateId,
  DecisionMode,
  LowSignalStrategy,
  ModeTemplate,
  ObserverPermissionMatrix,
  SystemInvariants,
} from "./collaboration-rules.js";

/**
 * Effective collaboration policy model. Pure types for the compiler.
 * PolicyDecisionRecord stays in the gateway host because it carries event-key and diagnosis records.
 */

/** L2 group-admin input. Missing fields fall back to L1-Default. */
export type GroupPolicyInput = {
  collaborationMode?: string | null;
  openDiscussionWithoutMention?: boolean;
  /** When true, primary conclusion may open SUPPLEMENT_WINDOW even if openDiscussionWithoutMention is false. */
  allowSupplementAfterPrimary?: boolean;
  maxVisibleBotRepliesPerRound?: number;
  /** Optional roll-call / broadcast ceiling (BP-02). */
  maxVisibleBotRepliesPerRoundBroad?: number;
  mentionBotMustRespond?: boolean;
  humanStartsNewRound?: boolean;
  botMaySelfAdvanceWithoutHuman?: boolean;
  entersWaitingForHumanAfterVisibleTurnsExhausted?: boolean;
  coordinatorSummarizeAfterRound?: boolean;
  lowSignalStrategy?: LowSignalStrategy | null;
  finalDecisionMode?: string | null;
  allowAgentPublishProposal?: boolean;
  allowSecondaryTakeover?: boolean;
  systemInstructions?: readonly string[] | null;
  /** Presentation (BP-14). inherit = detect per round. */
  replyLanguage?: "zh" | "en" | "inherit" | null;
  /** Governance coordinator single-source (BP-15/16); Q3 migration is P1-A2. */
  coordinatorBotId?: string | null;
  /** Context confidentiality ceiling (BP-11/12). */
  confidentialityTier?: string | null;
  /** Optional L2 overrides for governance.task (defaults from strategy / L1). */
  deliverableRequired?: boolean | null;
  acceptanceCriteriaRequired?: boolean | null;
  allowBotToBotHandoff?: boolean | null;
  /**
   * P5 multi-Beat raise. From collaboration.episode.maxBeats (default 1).
   * Values above 1 open Facilitator next_beat authorization observation only.
   */
  maxBeatsPerEpisode?: number | null;
};

export type PolicyValueSource = "l1-hard" | "l1-default" | "l2";

export type EffectivePolicyValue<T> = {
  value: T;
  source: PolicyValueSource;
  requested?: unknown;
  constrainedBy?: string;
};

export type PolicyClamp = {
  field: string;
  requested: unknown;
  effective: unknown;
  reason: string;
  source: PolicyValueSource;
  constrainedBy?: string;
};

export type EffectivePolicyProvenance = {
  /** Legacy flat keys (UI / P0 consumers). Kept byte-stable for existing fields. */
  collaborationMode: EffectivePolicyValue<CollaborationModeTemplateId>;
  openDiscussionWithoutMention: EffectivePolicyValue<boolean>;
  allowSupplementAfterPrimary: EffectivePolicyValue<boolean>;
  maxVisibleBotRepliesPerRound: EffectivePolicyValue<number>;
  mentionBotMustRespond: EffectivePolicyValue<boolean>;
  lowSignalStrategy: EffectivePolicyValue<LowSignalStrategy>;
  coordinatorWrap: EffectivePolicyValue<boolean>;
  decisionMode: EffectivePolicyValue<DecisionMode>;
  allowAgentPublishProposal: EffectivePolicyValue<boolean>;
  allowSecondaryTakeover: EffectivePolicyValue<boolean>;
  /**
   * P1-A1: nested provenance covering every leaf of the five capability segments.
   * Coverage helper asserts segments ↔ provenance.segments 100%.
   */
  segments: {
    participation: DeepProvenance<EffectiveCollaborationPolicy["participation"]>;
    dispatch: DeepProvenance<EffectiveCollaborationPolicy["dispatch"]>;
    governance: DeepProvenance<EffectiveCollaborationPolicy["governance"]>;
    context: DeepProvenance<EffectiveContextPolicy>;
    presentation: DeepProvenance<EffectiveCollaborationPolicy["presentation"]>;
  };
};

export type EffectiveCollaborationPolicy = {
  protocolVersion: typeof COLLABORATION_POLICY_PROTOCOL_VERSION;
  invariants: SystemInvariants;
  strategy: ModeTemplate;
  participation: {
    openDiscussionWithoutMention: boolean;
    maxVisibleBotRepliesPerRound: number;
    mentionBotMustRespond: boolean;
    mentionMustDispatch: true;
    mentionMaySilentIfNoIncrement: boolean;
    lowSignalStrategy: LowSignalStrategy;
    humanStartsNewRound: boolean;
    /** Derived from openDiscussionWithoutMention (§4 #9). */
    floorOpenness: FloorOpenness;
    /** Roll-call / broadcast ceiling (BP-02). */
    rollCall: { enabled: true; ceiling: number };
    /** Derived: !humanStartsNewRound (§4 #14). */
    proactiveBots: boolean;
    /** Emergency fan-out fuse; L1-hard = maxVisibleRepliesCeiling (12). */
    emergencyFanoutFuse: 12;
  };
  dispatch: {
    primaryThenSupplement: true;
    allowEvidenceCollection: false;
    coordinatorWrap: boolean;
    supplementEnabled: boolean;
    maxSupplementBots: number;
    allowSecondaryTakeover: boolean;
    /** P1-A1 default "legacy"; Floor cutover is later (P3). */
    floorProtocol: FloorProtocol;
    tuning: DispatchTuning;
  };
  governance: {
    decisionMode: DecisionMode;
    allowAgentPublishProposal: boolean;
    observer: ObserverPermissionMatrix;
    entersWaitingForHumanAfterVisibleTurnsExhausted: boolean;
    botMaySelfAdvanceWithoutHuman: boolean;
    /** Single-source coordinator id (BP-15/16). Null until Q3 migration (P1-A2). */
    coordinatorBotId: string | null;
    /** L1-hard capability map (§2.9); L2 cannot widen. */
    capabilities: Readonly<Record<GovernanceRole, readonly ActorCapability[]>>;
    task: GovernanceTaskPolicy;
  };
  /** Context scope policy (BP-11/12). No live consumers in P1-A1. */
  context: EffectiveContextPolicy;
  /**
   * Presentation (BP-14). Consumed via policy-lane-presentation.ts (P1-A5 ⑤) behind
   * collaboration.lane.presentation (default legacy), and rendered by the UI (BP-20).
   */
  presentation: {
    replyLanguage: "zh" | "en" | "inherit";
  };
  /** Prompt-only. Never an enforcement source. */
  guidance: {
    systemInstructions: readonly string[];
  };
  provenance: EffectivePolicyProvenance;
  clamps: readonly PolicyClamp[];
};

/** P2 overlay: Owner is accountable; executors do the work. */
export type TaskResponsibility = {
  owner: string;
  executors: string[];
  reviewer?: string;
  approver?: string;
  coordinator?: string;
  decisionAuthority: string;
};

/** P2 overlay: explicit Bot→Bot handoff. Not chat-history inference. */
export type TaskHandoff = {
  taskId: string;
  from: string;
  to: string;
  reason: string;
  completedArtifacts: string[];
  remainingWork: string;
  assumptions: string[];
  blockers: string[];
  acceptanceCriteria: string[];
  /** T45: idempotent history append key (contract handoffId). */
  handoffId?: string;
};

export type CollaborationTaskState =
  | "OPEN"
  | "TRIAGED"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "REVIEW"
  | "REVISION"
  | "READY"
  | "HUMAN_DECISION"
  | "DELIVERED"
  | "CLOSED";

/** Target round machine (v1.1). Live runtime still uses round-state.ts. */
export type TargetRoundState =
  | "ROUND_CREATED"
  | "CONTEXT_RESOLVE"
  | "PARTICIPANT_SELECT"
  | "PRIMARY_DISPATCHED"
  | "PRIMARY_ACTIVE"
  | "EVIDENCE_COLLECTION"
  | "EVIDENCE_COMPLETE"
  | "SUPPLEMENT_EVAL"
  | "SUPPLEMENT_DISPATCH"
  | "GOVERNANCE_GATE"
  | "ROUND_CLOSED";

/* ── P1-A1 capability-segment extensions (Floor Runtime v2.1 §2.6 / §5.5) ── */

export type FloorOpenness = "mention_only" | "single" | "open";

export type FloorProtocol = "legacy" | "shadow" | "floor";

export type CollaborationReplyLanguagePreference = "zh" | "en" | "inherit";

export type FloorBudgets = Readonly<{
  /** Migrated from maxVisibleBotRepliesPerRound (never widened). */
  visiblePosts: number;
  modelCalls: number;
  tokens: number;
  toolCalls?: number;
  evidenceRequests?: number;
  artifacts?: number;
  taskTransitions?: number;
}>;

export type FloorTuning = Readonly<{
  router: {
    l1TopK: number;
    l1AmbiguityBand: readonly [number, number];
    recentShareWindow: number;
  };
  bid: {
    deadlineMs: number;
    maxBidders: number;
    /** Self-assessment weight in Admission sort; default 0.2 (§2.7). */
    selfAssessmentWeight: number;
  };
  admission: {
    budgets: FloorBudgets;
    noveltyFloor: number;
    duplicateSimilarityMax: number;
    noveltyDecay: number;
    cooldownBeats: number;
    loopGuardDepth: 0 | 1 | 2;
  };
  beats: {
    /** Default 1. P5 may raise via collaboration.episode.maxBeats (≤12). */
    maxBeatsPerEpisode: number;
  };
}>;

export type DispatchTuning = Readonly<{
  floor: FloorTuning;
  tier1Merge: {
    dutyFloor: number;
    proactiveReplyThreshold: number;
    dutyWeight: number;
    relevanceWeight: number;
  };
  cheapGate: {
    clearlyIrrelevant: number;
    clearlyRelevant: number;
  };
  keywordCaps: {
    chitchat: number;
    simpleKnowledge: number;
    numberedDecision: number;
    lowSignal: number;
  };
  timeouts: {
    placeholderMs: number;
    byTaskType: Readonly<Record<string, number>>;
  };
  /** Mirrored from strategy.preserveConflict for dispatch-lane shadow compare. */
  preserveConflict: boolean;
  /** lead_plus_supplement hard cap (contribution-roles B2). */
  leadPlusSupplementCap: number;
}>;

export type EffectiveContextPolicy = Readonly<{
  /**
   * Capability gate, not an authorization grant (§2.6).
   * true = policy does not forbid cross-source retrieval;
   * access still requires AgentAuthorization ∩ SourceAuthorization.
   */
  crossSourceRetrieval: boolean;
  confidentialityCeiling: "public" | "internal" | "restricted";
  defaultMode: "minimal" | "auto" | "focused" | "deep";
  allowMemberOverride: boolean;
  mandatoryGroupContext: boolean;
  allowedSourceTypes: readonly string[];
  budget: { maxTokens: number; maxFiles: number };
  enforceConfidentiality: boolean;
}>;

export type GovernanceRole =
  | "owner"
  | "admin"
  | "coordinator"
  | "reviewer"
  | "final_decider"
  | "member_bot"
  | "member_human"
  | "observer";

export type ActorCapability =
  | "discussion.control"
  | "governance.converge"
  | "governance.request_evidence"
  | "governance.request_human"
  | "governance.restrict_member"
  | "task.assign"
  | "task.owner_transfer";

export type GovernanceTaskPolicy = Readonly<{
  deliverableRequired: boolean;
  acceptanceCriteriaRequired: boolean;
  allowBotToBotHandoff: boolean;
}>;

/** Leaf provenance mirror: every leaf of T becomes EffectivePolicyValue. */
export type DeepProvenance<T> = T extends readonly (infer _U)[]
  ? EffectivePolicyValue<T>
  : T extends object
    ? { [K in keyof T]: DeepProvenance<T[K]> }
    : EffectivePolicyValue<T>;
