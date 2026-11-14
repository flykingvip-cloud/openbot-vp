/**
 * P2 shadow-agent contracts: cross-layer input/output, budget, and result types.
 * These types do not activate policy, write configuration, persist candidates,
 * or expand P1 validator authority. The frozen P1 contract remains
 * `rule-adaptation.ts` and is not modified here.
 */
import type { RuntimeRuleAdaptationReasonCode } from "./rule-adaptation.js";

export const SHADOW_AGENT_PROTOCOL_VERSION = "runtime-rule-adaptation-shadow/v1" as const;
export const SHADOW_AGENT_PROMPT_ID = "runtime-rule-adaptation.shadow.system" as const;
export const SHADOW_AGENT_PROMPT_REVISION = "2026-11-12.1" as const;
export const INVENTORY_PIN = "9b65109f41dee30b892a6faff493e46e735cab8d" as const;

/** Stable shadow-run outcomes. Business decisions must use `code` and `path`. */
export type ShadowOutcomeCode =
  | "no_change_needed"
  | "insufficient_sources"
  | "tool_unavailable"
  | "insufficient_permission"
  | "hard_rule_conflict"
  | "budget_exhausted"
  | "malicious_material_rejected"
  | "fabricated_rule_id"
  | "unknown_parameter"
  | "candidate_validated_not_recorded"
  | "cancelled"
  | "protocol_failure"
  | "shadow_recorded"
  | "validator_blocked"
  | "needs_information";

export const SHADOW_OUTCOME_CODES = [
  "no_change_needed",
  "insufficient_sources",
  "tool_unavailable",
  "insufficient_permission",
  "hard_rule_conflict",
  "budget_exhausted",
  "malicious_material_rejected",
  "fabricated_rule_id",
  "unknown_parameter",
  "candidate_validated_not_recorded",
  "cancelled",
  "protocol_failure",
  "shadow_recorded",
  "validator_blocked",
  "needs_information",
] as const satisfies readonly ShadowOutcomeCode[];

export type ShadowReason = {
  code: ShadowOutcomeCode | RuntimeRuleAdaptationReasonCode;
  message: string;
  path?: string;
};

export type ShadowBudgetLimits = {
  maxModelCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxRevisions: number;
  maxDurationMs: number;
  maxCost: number;
  maxTotalCost: number;
};

export const DEFAULT_SHADOW_BUDGET_LIMITS: ShadowBudgetLimits = {
  maxModelCalls: 6,
  maxInputTokens: 32_000,
  maxOutputTokens: 8_000,
  maxRevisions: 2,
  maxDurationMs: 20_000,
  maxCost: 0.5,
  maxTotalCost: 0.5,
};

/**
 * Dimensions that can be pre-enforced before or during a completion:
 * call count and revisions are gated before the next call; remaining
 * output tokens are passed as `maxTokens`; remaining duration is passed
 * as a timeout and combined abort signal.
 */
export type ShadowBudgetDimension =
  | "modelCalls"
  | "inputTokens"
  | "outputTokens"
  | "revisions"
  | "durationMs"
  | "cost"
  | "totalCost";

export const PRE_ENFORCED_BUDGET_DIMENSIONS = [
  "modelCalls",
  "outputTokens",
  "revisions",
  "durationMs",
] as const satisfies readonly ShadowBudgetDimension[];

/**
 * Dimensions that can only be estimated or accounted after a completion
 * returns. Cost is never an absolute pre-enforced hard cap. Input tokens
 * are pre-checked before the next call but cannot be passed as a
 * completion output cap. Output tokens also appear here when a model
 * ignores `maxTokens` and returns an excess that is then accounted.
 */
export const POST_ACCOUNTED_BUDGET_DIMENSIONS = [
  "inputTokens",
  "outputTokens",
  "cost",
  "totalCost",
] as const satisfies readonly ShadowBudgetDimension[];

export type BudgetEnforcementKind = "pre_enforced" | "estimated_post_hoc";

export type ShadowUsage = {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  revisions: number;
  durationMs: number;
  cost: number;
  cancelled: boolean;
  cancelReason?: string;
};

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cost: number;
};

export type LimitedRuleViewEntry = {
  id: string;
  category?: string;
  scope?: string;
  fieldHints?: readonly string[];
  summary?: string;
  version?: string;
  body?: string;
  parameters?: readonly { name: string; description?: string }[];
};

export type EffectivePolicyView = {
  field: string;
  currentEffectiveValue: unknown;
  source?: string;
};

export type HostToolAvailability = {
  searchRules?: boolean;
  getRuleDefinition?: boolean;
  getEffectivePolicy?: boolean;
};

export type HostReadPermissions = {
  readRules?: boolean;
  readEffectivePolicy?: boolean;
};

/**
 * Host-provided limited rule view and independent validator facts.
 * The agent must not query a second catalog or invent host facts.
 */
export type RuleAdaptationHostView = {
  rules: readonly LimitedRuleViewEntry[];
  effectivePolicy: readonly EffectivePolicyView[];
  hostFacts: unknown;
  tools?: HostToolAvailability;
  permissions?: HostReadPermissions;
  ruleViewVersion?: string;
  tenantId?: string;
};

export type ShadowControlSnapshot = {
  task: unknown;
  claim: unknown;
  plan: unknown;
  todo: unknown;
  taskControl: unknown;
};

export type ShadowDiffComparison = "equal" | "tighten" | "widen_or_other" | "unknown" | "absent";

export type ShadowDiffEntry = {
  field: string;
  ruleId?: string;
  currentEffectiveValue: unknown;
  proposedValue: unknown;
  comparison: ShadowDiffComparison;
};

export type ShadowToolJournalEntry = {
  name: string;
  readonly: boolean;
  status: string;
  code?: string;
  path?: string;
};

export type RejectedToolEntry = {
  name: string;
  code: string;
  path?: string;
};

export type ReadOnlyPermissionProof = {
  allowedTools: readonly string[];
  invokedTools: readonly string[];
  rejectedTools: readonly RejectedToolEntry[];
  writeAttempted: boolean;
  configWritten: false;
  policyActivated: false;
  rulesPublished: false;
};

export type LimitFailureProof = {
  limits: ShadowBudgetLimits;
  usage: ShadowUsage;
  exhausted: readonly ShadowBudgetDimension[];
  preEnforcedExhausted: readonly ShadowBudgetDimension[];
  postAccountedExhausted: readonly ShadowBudgetDimension[];
  /** Cost is estimated and reconciled after the fact, not a pre-enforced hard cap. */
  costAccounting: "estimated_post_hoc";
  cancelled: boolean;
  protocolFailed: boolean;
  threwToCaller: false;
  deadlineCleanupFailed: boolean;
  sessionDisposeFailed: boolean;
  /**
   * False when a cancelled or timed-out completion never yielded usage and
   * none can be assumed. Placeholder zeros in `usage` are not a successful
   * post-hoc tally in that case.
   */
  usageKnown: boolean;
  /**
   * False when the wait ended but the underlying complete() is still pending
   * because it ignored the abort signal. Do not claim that call was stopped.
   */
  underlyingRequestStopped: boolean;
  /** True when a usage-accounting post was attempted (not merely planned). */
  usageAccountingAttempted: boolean;
  /**
   * Outcome of commercial / shared usage posting at the time this proof was
   * snapshotted. `not_attempted` means posting was correctly skipped (usage
   * unknown, or no reporting path). A failed post is never reported as
   * `succeeded`. Late updates must not mutate this snapshot.
   */
  usageAccountingStatus: ShadowUsageAccountingStatus;
  /**
   * True only when this completion was wired through the existing agent-run
   * registry cap and official stale/orphan reap. Fixture admission that always
   * succeeds is not occupancy-ready and must not be treated as P2 治理验收.
   */
  governanceOccupancyReady: boolean;
};

export type ShadowPromptIdentity = {
  protocolVersion: typeof SHADOW_AGENT_PROTOCOL_VERSION;
  promptId: typeof SHADOW_AGENT_PROMPT_ID;
  promptRevision: typeof SHADOW_AGENT_PROMPT_REVISION;
};

export type ShadowRunResult = {
  outcomeCode: ShadowOutcomeCode;
  activationAllowed: false;
  claimedEffective: false;
  commitment: "none";
  executionModeOpened: false;
  businessToolsInvoked: readonly string[];
  businessToolsExecuted: readonly string[];
  reasons: ShadowReason[];
  validation?: import("./rule-adaptation.js").RuntimeRuleAdaptationValidationResult;
  proposal?: unknown;
  shadowDiff: ShadowDiffEntry[];
  usage: ShadowUsage;
  cancelled: boolean;
  protocolVersion: typeof SHADOW_AGENT_PROTOCOL_VERSION;
  prompt: ShadowPromptIdentity;
  controlUnchanged: boolean;
  controlSnapshotBefore: ShadowControlSnapshot;
  controlSnapshotAfter: ShadowControlSnapshot;
  candidateToolInvoked: boolean;
  candidatePersisted: false;
  candidateActivated: false;
  candidatePublished: false;
  toolsInvoked: readonly ShadowToolJournalEntry[];
  diagnosedBeforeRetrieval: boolean;
  readOnlyProof: ReadOnlyPermissionProof;
  limitProof: LimitFailureProof;
};

export type ShadowSituation = {
  summary: string;
  symptoms?: readonly string[];
  scope?: { type: string; id: string };
  knownFacts?: Record<string, unknown>;
};

export type ShadowRunRequest = {
  requestId: string;
  situation: ShadowSituation;
  budget?: Partial<ShadowBudgetLimits>;
  signal?: AbortSignal;
};

export type ToolDescriptor = {
  name: string;
  description: string;
  readonly: boolean;
};

export type ModelToolCall = {
  id: string;
  name: string;
  arguments: unknown;
};

export type ModelMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
};

export type ModelCompletion =
  | { kind: "message"; text: string; usage: ModelUsage }
  | { kind: "tool_calls"; toolCalls: readonly ModelToolCall[]; text?: string; usage: ModelUsage }
  | { kind: "cancelled"; usage: ModelUsage; reason?: string }
  | { kind: "protocol_failure"; usage: ModelUsage; detail?: string };

/**
 * Remaining budget that the runner must pass into the actual completion.
 * `maxTokens` and `timeoutMs` are pre-enforced. Cost is not included
 * because it cannot be guaranteed in advance.
 */
export type ShadowCompletionLimits = {
  maxTokens: number;
  timeoutMs: number;
};

export type RuleAdaptationModelPort = {
  complete(
    input: {
      system: string;
      messages: readonly ModelMessage[];
      tools: readonly ToolDescriptor[];
      signal?: AbortSignal;
    } & ShadowCompletionLimits,
  ): Promise<ModelCompletion>;
};

/**
 * Host ports exposed to the product runner. The control board is a snapshot
 * only; mutators are not part of this type and must stay on the test fixture.
 */
export type ShadowHostPorts = {
  view: RuleAdaptationHostView;
  controlBoard: ShadowControlSnapshot;
  now?: () => number;
};

export type ShadowReasonLike = {
  code: string;
  path?: string;
};

export type ShadowUsageRecordReason =
  | "complete"
  | "cancelled"
  | "protocol_failure"
  | "timeout"
  | "output_overflow"
  | "late_usage";

/**
 * Usage posting status, distinct from `usageKnown` and from "a call was made".
 * `not_attempted` is the correct state when usage is unknown (must not post
 * zeros) or there is no credit-reporting path. `unknown` means an attempt
 * resolved without a clear recorded/deduped success or a thrown failure.
 */
export type ShadowUsageAccountingStatus = "not_attempted" | "succeeded" | "failed" | "unknown";

/**
 * Optional result of one posting attempt. Aligns with `recordCreditUsage`,
 * which dedupes on `(enterpriseId, taskId)` and returns
 * `{ recorded: false, deduped: true }` when the stage is already `done`.
 */
export type ShadowUsageRecordOutcome = {
  recorded?: boolean;
  deduped?: boolean;
  /**
   * When false, the hook ran but no ledger post was attempted (for example
   * there is no creditReporting on the authorized session).
   */
  attempted?: boolean;
};

/**
 * Shared usage-accounting hook. Implementations should delegate to
 * `createAuthorizedModelSession(...).recordUsage` or a test fixture of that
 * port, not a separate private ledger. Retries must reuse the same
 * idempotent identity (`enterpriseId`, `taskId` = runId).
 */
export type ShadowUsageRecorder = {
  recordUsage(input: {
    usage: ModelUsage;
    durationMs?: number;
    reason: ShadowUsageRecordReason;
  }): Promise<void | ShadowUsageRecordOutcome> | void | ShadowUsageRecordOutcome;
};

/**
 * Late session-dispose or accounting events after a completion snapshot has
 * already been returned. Callers must not use this to mutate the snapshot.
 */
export type ShadowLateDiagnosticEvent = {
  kind: "session_dispose_failed" | "usage_accounting";
  sessionDisposeFailed?: boolean;
  usageKnown?: boolean;
  usageAccountingAttempted?: boolean;
  usageAccountingStatus?: ShadowUsageAccountingStatus;
};

export type ShadowDiagnosticSink = {
  report(event: ShadowLateDiagnosticEvent): void;
};
