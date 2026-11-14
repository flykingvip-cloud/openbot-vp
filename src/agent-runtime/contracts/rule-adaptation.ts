/**
 * P1 typed contracts for runtime-rule-adaptation.
 * Inventory citations stay pinned to 9b65109f41dee30b892a6faff493e46e735cab8d.
 * These types describe proposal input, trusted host facts, and validator output.
 * They do not grant authority, activate policy, or persist candidates.
 */

/** Closed set of P1 validator result kinds. `candidate_recorded` is retired. */
export type RuntimeRuleAdaptationResultKind =
  | "no_change"
  | "needs_information"
  | "blocked"
  | "shadow_accepted"
  | "candidate_validated";

/** Stable reason codes. Business decisions must use `code` and `path`, never message text. */
export type RuntimeRuleAdaptationReasonCode =
  | "structural_non_plain_object"
  | "structural_circular_reference"
  | "structural_input_too_deep"
  | "structural_forbidden_field"
  | "structural_unknown_field"
  | "structural_invalid_type"
  | "structural_missing_binding"
  | "structural_mixed_input_kinds"
  | "structural_duplicate_field"
  | "structural_unusable_host_value"
  | "identity_scope_mismatch"
  | "unknown_rule_id"
  | "non_candidate_field"
  | "cancelled_or_tombstone"
  | "below_hard_min"
  | "above_hard_ceiling"
  | "above_current_effective"
  | "delete_or_relax_as_tighten"
  | "unauthorized_action"
  | "hard_boundary_conflict"
  | "missing_host_fact"
  | "compatibility_not_approved"
  | "current_below_hard_min"
  | "equal_to_legal_baseline"
  | "shadow_legal"
  | "candidate_validated"
  | "validator_must_not_create_candidate";

export const RUNTIME_RULE_ADAPTATION_REASON_CODES = [
  "structural_non_plain_object",
  "structural_circular_reference",
  "structural_input_too_deep",
  "structural_forbidden_field",
  "structural_unknown_field",
  "structural_invalid_type",
  "structural_missing_binding",
  "structural_mixed_input_kinds",
  "structural_duplicate_field",
  "structural_unusable_host_value",
  "identity_scope_mismatch",
  "unknown_rule_id",
  "non_candidate_field",
  "cancelled_or_tombstone",
  "below_hard_min",
  "above_hard_ceiling",
  "above_current_effective",
  "delete_or_relax_as_tighten",
  "unauthorized_action",
  "hard_boundary_conflict",
  "missing_host_fact",
  "compatibility_not_approved",
  "current_below_hard_min",
  "equal_to_legal_baseline",
  "shadow_legal",
  "candidate_validated",
  "validator_must_not_create_candidate",
] as const satisfies readonly RuntimeRuleAdaptationReasonCode[];

/**
 * Conservative maximum nesting depth for already-parsed programmatic input.
 * The top-level `proposal` or `hostFacts` argument is depth 1. A value at
 * depth 33 is rejected with `structural_input_too_deep`. This is not a JSON
 * parser and does not inspect numeric spelling in source text.
 */
export const RUNTIME_RULE_ADAPTATION_MAX_INPUT_DEPTH = 32;

export type RuntimeRuleAdaptationMissingFact =
  | "identity"
  | "scopeContext"
  | "lane"
  | "currentEffectiveValue"
  | "authorizationStatus"
  | "compatibilityRecord"
  | "expectedPolicyState";

export type AuthorizationAssessment =
  | "host_authorized"
  | "host_unauthorized"
  | "assessment_unavailable";

export type RuntimeRuleAdaptationReason = {
  code: RuntimeRuleAdaptationReasonCode;
  /** Human-readable only. Never use as a later business-decision oracle. */
  message: string;
  path?: string;
  missingFact?: RuntimeRuleAdaptationMissingFact;
};

export type RuntimeRuleAdaptationItemResult = {
  ruleId?: string;
  field?: string;
  proposedRuleId?: string;
  resultKind: RuntimeRuleAdaptationResultKind;
  reasons: RuntimeRuleAdaptationReason[];
};

/**
 * P1 validation result. `activationAllowed` is identically false.
 * Must not contain registration receipts or storage ids.
 */
export type RuntimeRuleAdaptationValidationResult = {
  resultKind: RuntimeRuleAdaptationResultKind;
  activationAllowed: false;
  authorizationAssessment: AuthorizationAssessment;
  reasons: RuntimeRuleAdaptationReason[];
  items: RuntimeRuleAdaptationItemResult[];
};

export type RuntimeRuleAdaptationScopeType = "personal" | "group" | "enterprise" | "task";

export type RuntimeRuleAdaptationScope = {
  type: RuntimeRuleAdaptationScopeType;
  id: string;
};

export type RuntimeRuleAdaptationExpectedPolicyVersion = {
  policyHash: string;
  protocolVersion: string;
  compilerRevision: string;
};

export type RuntimeRuleAdaptationAction =
  | "tune"
  | "select"
  | "modify"
  | "create"
  | "disable"
  | "delete";

export type RuntimeRuleAdaptationProposalItem = {
  ruleId: string;
  field: string;
  action: RuntimeRuleAdaptationAction;
  proposedValue: unknown;
};

export type PolicyProposalInput = {
  kind: "policy_proposal";
  scope: RuntimeRuleAdaptationScope;
  implementationVersion: string;
  expectedPolicyVersion: RuntimeRuleAdaptationExpectedPolicyVersion;
  items: RuntimeRuleAdaptationProposalItem[];
};

export type RuleCandidateBody = {
  proposedRuleId: string;
  summary: string;
  body: string;
};

export type RuleCandidateInput = {
  kind: "rule_candidate";
  scope: RuntimeRuleAdaptationScope;
  implementationVersion?: string;
  candidate: RuleCandidateBody;
};

/**
 * Model-proposal input after ordinary parsing. The public validator accepts
 * `unknown` and admits only JSON-like acyclic plain data, subject to the
 * closed schema below and `RUNTIME_RULE_ADAPTATION_MAX_INPUT_DEPTH`.
 */
export type RuntimeRuleAdaptationProposal = PolicyProposalInput | RuleCandidateInput;

export type HostPrincipalType = "personal" | "enterprise" | "group" | "platform";

export type HostIdentity = {
  principalType: HostPrincipalType;
  principalId: string;
  scope: RuntimeRuleAdaptationScope;
};

export type HostLane = "legacy" | "effective" | "shadow";

export type HostAuthorizationStatus = "authorized" | "unauthorized";

export type HostCompatibilityStatus = "approved_compatible" | "unapproved" | "incompatible";

export type HostCompatibilityRecord = {
  status: HostCompatibilityStatus;
  boundImplementationVersion: string;
  boundExpectedPolicyVersion: RuntimeRuleAdaptationExpectedPolicyVersion;
};

export type HostExpectedPolicyState = "active" | "cancelled" | "tombstone" | "expired";

/**
 * Trusted host facts supplied as an independent function parameter.
 * `fixture` is a test marker only and must never be treated as a credential.
 * The `{ proposal, host }` JSON envelope is a test-fixture format only and
 * must not be used as an external authorization interface.
 *
 * Programmatic values for both `proposal` and `hostFacts` must be JSON-like
 * acyclic plain data: plain objects (prototype `Object.prototype` or `null`),
 * plain arrays (prototype `Array.prototype`), and primitives already allowed
 * by the schema. Class instances, `Date`, `Map`, `Set`, functions, and other
 * host objects are rejected.
 */
export type TrustedHostFacts = {
  fixture?: boolean;
  identity?: HostIdentity;
  lane?: HostLane;
  currentEffectiveValues?: Record<string, unknown>;
  authorizationStatus?: HostAuthorizationStatus;
  compatibilityRecord?: HostCompatibilityRecord;
  expectedPolicyState?: HostExpectedPolicyState;
};

/** Keys that must never appear on a model proposal (structural reject). */
export const FORBIDDEN_PROPOSAL_KEYS = [
  "authorizationStatus",
  "authorizationAssessment",
  "activationAllowed",
  "authorized",
  "authorization",
  "activationRequested",
  "activateNow",
  "compileNow",
  "registerNow",
  "currentEffectiveValue",
  "currentEffectiveValues",
  "compatibilityRecord",
  "compatibilityProof",
  "compatibility",
  "compatibilityStatus",
  "gitAncestry",
  "pathUnchangedProof",
] as const;

export const FORBIDDEN_PROPOSAL_KEY_SET: ReadonlySet<string> = new Set(FORBIDDEN_PROPOSAL_KEYS);

export const POLICY_PROPOSAL_ROOT_KEYS = [
  "kind",
  "scope",
  "implementationVersion",
  "expectedPolicyVersion",
  "items",
] as const;

export const RULE_CANDIDATE_ROOT_KEYS = [
  "kind",
  "scope",
  "implementationVersion",
  "candidate",
] as const;

export const PROPOSAL_ITEM_KEYS = ["ruleId", "field", "action", "proposedValue"] as const;

export const CANDIDATE_BODY_KEYS = ["proposedRuleId", "summary", "body"] as const;

export const SCOPE_KEYS = ["type", "id"] as const;

export const EXPECTED_POLICY_VERSION_KEYS = [
  "policyHash",
  "protocolVersion",
  "compilerRevision",
] as const;

export const HOST_ROOT_KEYS = [
  "fixture",
  "identity",
  "lane",
  "currentEffectiveValues",
  "authorizationStatus",
  "compatibilityRecord",
  "expectedPolicyState",
] as const;

export const HOST_IDENTITY_KEYS = ["principalType", "principalId", "scope"] as const;

export const HOST_COMPATIBILITY_RECORD_KEYS = [
  "status",
  "boundImplementationVersion",
  "boundExpectedPolicyVersion",
] as const;

export const SCOPE_TYPES = ["personal", "group", "enterprise", "task"] as const;

export const PRINCIPAL_TYPES = ["personal", "enterprise", "group", "platform"] as const;

export const HOST_LANES = ["legacy", "effective", "shadow"] as const;

export const HOST_AUTHORIZATION_STATUSES = ["authorized", "unauthorized"] as const;

export const HOST_COMPATIBILITY_STATUSES = [
  "approved_compatible",
  "unapproved",
  "incompatible",
] as const;

export const HOST_EXPECTED_POLICY_STATES = ["active", "cancelled", "tombstone", "expired"] as const;

export const TERMINAL_POLICY_STATES: ReadonlySet<string> = new Set([
  "cancelled",
  "tombstone",
  "expired",
]);

export const PROPOSAL_ACTIONS = [
  "tune",
  "select",
  "modify",
  "create",
  "disable",
  "delete",
] as const;
