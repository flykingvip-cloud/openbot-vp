export const TASK_ENVELOPE_SCHEMA = "openbot.execution-router.task-envelope.v1" as const;
export const SHADOW_EVENT_SCHEMA = "openbot.execution-router.shadow-event.v1" as const;
export const SHADOW_EVENT_NAME = "chat.execution_router_shadow" as const;

export const TASK_CLASSES = [
  "plain_text_qa",
  "skill_dense_readonly",
  "single_readonly_tool",
  "multi_readonly_tool",
  "unknown",
] as const;

export type TaskClass = (typeof TASK_CLASSES)[number];
export type RiskClass = "read_only" | "side_effect" | "unknown";
export type ChannelKind = "internal" | "external" | "unknown";

export const ROUTE_REASON_CODES = [
  "SHADOW_DISABLED",
  "SHADOW_CANDIDATES_RECORDED",
  "LOW_CONFIDENCE_FALLBACK_FULL_PATH",
  "EMPTY_ENVELOPE_FALLBACK",
  "POLICY_IS_FINAL_AUTHORITY",
  "BASELINE_NOT_USED_AS_WEIGHT",
] as const;

export type RouteReasonCode = (typeof ROUTE_REASON_CODES)[number];

/**
 * Phase 1 v1 TaskEnvelope. Distinct from the Phase 0 observation
 * `TaskEnvelope` (`runId` / `createdAt`) exported by contracts.ts.
 */
export type ShadowTaskEnvelope = {
  schema: typeof TASK_ENVELOPE_SCHEMA;
  taskClass: TaskClass;
  riskClass: RiskClass;
  channelKind: ChannelKind;
  textDigest: string;
  tagDigests?: string[];
  requiredSkillDigests?: string[];
  requiredToolDigests?: string[];
};

export type TaskEnvelopeV1 = ShadowTaskEnvelope;

export type CatalogEntry = {
  nameDigest: string;
  tagDigests: string[];
  sideEffect: boolean;
};

export type ScoredCandidate = {
  nameDigest: string;
  score: number;
  rank: number;
};

export type ShadowDecision = {
  apply: false;
  reasonCode: RouteReasonCode;
  confidence: number;
  skillCandidates: ScoredCandidate[];
  toolCandidates: ScoredCandidate[];
};

export type RecallResult = {
  skillRecall: number | null;
  toolRecall: number | null;
};

export type CandidateVsInvoked = {
  skillCandidateCount: number;
  skillInvokedCount: number;
  skillIntersectionCount: number;
  toolCandidateCount: number;
  toolInvokedCount: number;
  toolIntersectionCount: number;
};

export const PHASE1_FLAGS = Object.freeze({
  SKILL_TOP_K_ENABLED: false,
  TOOL_TOP_K_ENABLED: false,
  SHADOW_ROUTER_RECORD: false,
  SHADOW_ROUTER_APPLY: false,
  DAG_ENABLED: false,
  CONVERSATION_TASK_ENABLED: false,
  ORCHESTRATION_LIVE_INVOKE: false,
});

export type Phase1Flags = typeof PHASE1_FLAGS;

export type ShadowRouteEvent = {
  schema: typeof SHADOW_EVENT_SCHEMA;
  event: typeof SHADOW_EVENT_NAME;
  runIdDigest: string;
  sessionKeyHash?: string;
  reasonCode: RouteReasonCode;
  apply: false;
  confidence: number;
  skillCandidates: ScoredCandidate[];
  toolCandidates: ScoredCandidate[];
  flags: Phase1Flags;
};
