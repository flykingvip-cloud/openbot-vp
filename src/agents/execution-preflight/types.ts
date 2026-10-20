/**
 * One execution context, built once before the embedded agent tool loop.
 * Chat, cron, and long-horizon jobs all consume this shape. It does not run tools.
 */

export type IntentClass = "chat" | "retrieve" | "short_action" | "multi_stage" | "long_running";

export type ToolVisibility = "visible" | "not_visible" | "execution_denied";

export type ExecutionPreflight = {
  taskId: string;
  sessionId: string;
  intentClass: IntentClass;
  /** Qualification kind from the existing ConversationTask classifier. Not a second taxonomy owner. */
  qualificationKind: string;
  primarySkill?: string;
  skillAliases: string[];
  candidateSkills: string[];
  allowedTools: string[];
  blockedTools: string[];
  toolVisibility: Record<string, ToolVisibility>;
  resourceScope: string[];
  requiredApproval?: string;
  stage?: string;
  deliveryRequirements: string[];
  decisionCode: string;
  bindingPrompt?: string;
  forbiddenFinalEngines: string[];
  requiredValidators: string[];
  /**
   * Contract stage. Only `generation` or `delivery` from skill frontmatter.
   * Model text cannot set this.
   */
  executionStage?: "generation" | "delivery";
  /** Contract `required-artifacts`. Empty keeps the previous single-file default. */
  requiredArtifacts: string[];
  /**
   * Contract `required-confirmations`. Non-empty blocks completion claims until
   * each id is noted via `noteConfirmationPassed` (not model text).
   */
  requiredConfirmations: string[];
  /** Declared generation-stage tools. Empty keeps write/edit as generation. */
  generationStageTools: string[];
  /** Declared delivery-stage tools. Empty defaults to message/sessions_send when validators are required. */
  deliveryStageTools: string[];
  attemptNumber: number;
  deliveryBlockedUntil?: string;
};

export type FailureClass =
  | "transient_transport"
  | "rate_limit"
  | "provider_failover"
  | "compaction_retry"
  | "approval_required"
  | "approval_denied"
  | "authorization_denied"
  | "resource_out_of_scope"
  | "skill_contract_violation"
  | "validation_failed"
  | "permanent_failure";

export type ValidationReceipt = {
  taskId: string;
  artifactPath: string;
  artifactHash: string;
  validatorId: string;
  validatorVersion: string;
  timestamp: string;
  result: "passed" | "failed";
};

export type ExecutionTraceRecord = {
  taskId: string;
  sessionId: string;
  attemptNumber: number;
  intentClass: string;
  primarySkill?: string;
  decisionStage: string;
  decisionCode: string;
  toolName?: string;
  retryable?: boolean;
  fallback?: string;
  deliveryOutcome?: "allowed" | "blocked";
  validatorId?: string;
  validatorVersion?: string;
  /** SHA-256 of a safe relative artifact path. Never the path text or file body. */
  artifactPathHash?: string;
  artifactSha256?: string;
  transportOutcome?: "not_called" | "ok" | "failed" | "already_delivered" | "blocked";
  cleanupReason?: "none" | "delivered" | "retained";
  hookJobIdHash?: string;
  cronRunIdHash?: string;
  attemptTaskIdHash?: string;
  hookDeliveryPresent?: boolean;
  validatorsRequired?: boolean;
  hookDeliveryDecisionCode?: string;
  hookDeliveryTaskMatch?: boolean;
};

export type DeliveryDecisionCode =
  | "delivery_allowed"
  | "delivery_blocked"
  | "artifact_changed"
  | "validator_unavailable";

export type DeliveryValidatorReceipt = {
  validatorId: string;
  validatorVersion?: string;
  artifactPath: string;
  artifactSha256?: string;
  validationResult: "passed" | "failed" | "missing";
};

export type DeliveryGateInput = {
  taskId: string;
  artifactPath?: string;
  artifactSha256?: string;
  artifactType?: string;
  validatorId?: string;
  validatorVersion?: string;
  validationResult: "passed" | "failed" | "missing" | "not_required";
  /** One row per required validator on each required artifact. */
  validatorReceipts?: DeliveryValidatorReceipt[];
};

export type DeliveryEvidence = {
  artifactExists: boolean;
  artifactReadable: boolean;
  validationPassed: boolean;
  decisionCode: DeliveryDecisionCode;
  userVisibleSummary: string;
  unresolvedRisks: string[];
  allowedToDeliver: boolean;
  gateInput: DeliveryGateInput;
};

export type ExecutionEventName =
  | "execution_preflight_started"
  | "intent_classified"
  | "primary_skill_selected"
  | "skill_alias_resolved"
  | "skill_contract_bound"
  | "tools_filtered"
  | "resource_scope_bound"
  | "approval_requested"
  | "approval_resolved"
  | "tool_started"
  | "tool_finished"
  | "retry_started"
  | "fallback_selected"
  | "validation_started"
  | "validation_finished"
  | "delivery_allowed"
  | "delivery_blocked"
  | "task_parked"
  | "task_resumed"
  | "task_completed"
  | "task_failed";

export type ExecutionEvent = {
  name: ExecutionEventName;
  taskId: string;
  sessionId: string;
  decisionCode?: string;
  skill?: string;
  toolName?: string;
  attemptNumber?: number;
  failureClass?: FailureClass;
  retryable?: boolean;
};
