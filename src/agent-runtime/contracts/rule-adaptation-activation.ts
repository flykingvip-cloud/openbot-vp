import type {
  AuthorizationAssessment,
  HostCompatibilityRecord,
  HostExpectedPolicyState,
  HostIdentity,
  HostAuthorizationStatus,
  RuntimeRuleAdaptationAction,
  RuntimeRuleAdaptationExpectedPolicyVersion,
  RuntimeRuleAdaptationMissingFact,
  RuntimeRuleAdaptationReasonCode,
  RuntimeRuleAdaptationScope,
} from "./rule-adaptation.js";
/**
 * P3 typed contracts for the controlled runtime-rule-adaptation activation host.
 * These types do not grant production activation, open a production whitelist,
 * or wire the snapshot into the main execution chain.
 * Inventory citations stay pinned to 9b65109f41dee30b892a6faff493e46e735cab8d.
 */
import type { SessionTaskBoard } from "./task.js";

/** Closed sentinel: the request declares that no live execution claim is expected. */
export const NO_LIVE_EXECUTION_CLAIM = "no_live_execution_claim" as const;
export type NoLiveExecutionClaim = typeof NO_LIVE_EXECUTION_CLAIM;

export const HOST_ACTIVATION_GATES = ["test_entry", "explicit_approval"] as const;
export type HostActivationGate = (typeof HOST_ACTIVATION_GATES)[number];

export const ACTIVATION_RESULT_KINDS = [
  "activated",
  "conflict",
  "rejected",
  "persist_failed",
] as const;
export type RuntimeRuleAdaptationActivationResultKind = (typeof ACTIVATION_RESULT_KINDS)[number];

export const ACTIVATION_OPERATIONS = ["activate", "revoke", "rollback"] as const;
export type RuntimeRuleAdaptationActivationOperation = (typeof ACTIVATION_OPERATIONS)[number];

export const ACTIVATED_POLICY_STATUSES = ["effective", "revoked", "superseded"] as const;
export type ActivatedRuntimeRulePolicyStatus = (typeof ACTIVATED_POLICY_STATUSES)[number];

export const WHITELIST_SOURCES = ["fixture", "production"] as const;
export type RuntimeRuleWhitelistSource = (typeof WHITELIST_SOURCES)[number];

/**
 * Production / runtime whitelist for this period.
 * Independently accepted content is empty; an empty list always denies.
 * Tests may inject a *fixture* whitelist; that is not a production whitelist.
 */
export type RuntimeRuleWhitelistEntry = {
  ruleId: string;
  field: string;
  action: RuntimeRuleAdaptationAction;
};

export const PRODUCTION_RUNTIME_RULE_WHITELIST: readonly RuntimeRuleWhitelistEntry[] = [];

/** Implementation-version identity for this inventory pin (not the catalog `inventory:` string). */
export const RUNTIME_RULE_ADAPTATION_IMPLEMENTATION_VERSION =
  "9b65109f41dee30b892a6faff493e46e735cab8d" as const;

export const ACTIVATION_EFFECTIVE_NODE = "cas_persist_success" as const;

export type RuntimeRuleAdaptationActivationReasonCode =
  | RuntimeRuleAdaptationReasonCode
  | "empty_whitelist"
  | "whitelist_miss"
  | "unapproved_candidate"
  | "shadow_accepted_not_credential"
  | "candidate_cannot_activate"
  | "execution_claim_mismatch"
  | "policy_version_mismatch"
  | "authorization_revoked"
  | "rule_taken_down"
  | "second_config_authority"
  | "commercial_plan_version"
  | "host_gate_invalid"
  | "permission_axis_mismatch"
  | "rollback_restores_revoked_rights"
  | "incomplete_board_scope"
  | "task_not_bound"
  | "write_epoch_conflict"
  | "proposal_expired"
  | "collaboration_path_unwired";

export const RUNTIME_RULE_ADAPTATION_ACTIVATION_REASON_CODES = [
  "empty_whitelist",
  "whitelist_miss",
  "unapproved_candidate",
  "shadow_accepted_not_credential",
  "candidate_cannot_activate",
  "execution_claim_mismatch",
  "policy_version_mismatch",
  "authorization_revoked",
  "rule_taken_down",
  "second_config_authority",
  "commercial_plan_version",
  "host_gate_invalid",
  "permission_axis_mismatch",
  "rollback_restores_revoked_rights",
  "incomplete_board_scope",
  "task_not_bound",
  "write_epoch_conflict",
  "proposal_expired",
  "collaboration_path_unwired",
] as const satisfies readonly RuntimeRuleAdaptationActivationReasonCode[];

export type RuntimeRuleAdaptationActivationReason = {
  code: RuntimeRuleAdaptationActivationReasonCode;
  /** Human-readable only. Never use as a later business-decision oracle. */
  message: string;
  path?: string;
  missingFact?: RuntimeRuleAdaptationMissingFact;
};

export type RuntimeRuleAdaptationBoardScope = {
  tenantId: string;
  userId: string;
  sessionId: string;
};

export type RuntimeRuleAdaptationTaskBinding = {
  taskId: string;
  boardScope: RuntimeRuleAdaptationBoardScope;
};

export type RuntimeRuleAdaptationExpectedVersions = {
  expectedWriteEpoch: number;
  expectedPolicyVersion: RuntimeRuleAdaptationExpectedPolicyVersion;
  /**
   * Either a live `executionAttempt` / claim identity, or `NO_LIVE_EXECUTION_CLAIM`.
   * The field is required; omitting it is not "don't care".
   */
  expectedExecutionClaim: string;
  /** Optional. Required only when the host also supplies a live claim token in deps. */
  expectedClaimToken?: string;
  /**
   * Optional host-supplied deadline (epoch ms). No default TTL is invented
   * when this field is absent.
   */
  expiresAtMs?: number;
};

export type ApprovedCandidateIdentity = {
  proposalHash: string;
  resultKind: "shadow_accepted";
  validatorImplementationVersion: string;
};

/**
 * Trusted host binding, independent of the proposal.
 * Authorization / compatibility proofs must not appear on the proposal.
 */
export type RuntimeRuleAdaptationActivationBinding = {
  fixture?: boolean;
  authorizationReference: string;
  identity: HostIdentity;
  taskBinding: RuntimeRuleAdaptationTaskBinding;
  expectedVersions: RuntimeRuleAdaptationExpectedVersions;
  approvedCandidateIdentity: ApprovedCandidateIdentity;
  hostActivationGate: HostActivationGate;
  permission: RuntimeRuleAdaptationAction;
  authorizedPermissions: RuntimeRuleAdaptationAction[];
  authorizationStatus: HostAuthorizationStatus;
  expectedPolicyState?: HostExpectedPolicyState;
  currentEffectiveValues?: Record<string, unknown>;
  compatibilityRecord?: HostCompatibilityRecord;
  /** Host clock in ms. Required for a successful write so the snapshot time is not invented. */
  nowMs: number;
};

export const ACTIVATION_BINDING_ROOT_KEYS = [
  "fixture",
  "authorizationReference",
  "identity",
  "taskBinding",
  "expectedVersions",
  "approvedCandidateIdentity",
  "hostActivationGate",
  "permission",
  "authorizedPermissions",
  "authorizationStatus",
  "expectedPolicyState",
  "currentEffectiveValues",
  "compatibilityRecord",
  "nowMs",
] as const;

export const TASK_BINDING_KEYS = ["taskId", "boardScope"] as const;

export const BOARD_SCOPE_BINDING_KEYS = ["tenantId", "userId", "sessionId"] as const;

export const EXPECTED_VERSIONS_KEYS = [
  "expectedWriteEpoch",
  "expectedPolicyVersion",
  "expectedExecutionClaim",
  "expectedClaimToken",
  "expiresAtMs",
] as const;

export const APPROVED_CANDIDATE_IDENTITY_KEYS = [
  "proposalHash",
  "resultKind",
  "validatorImplementationVersion",
] as const;

export const REVOKE_BINDING_ROOT_KEYS = [
  "fixture",
  "authorizationReference",
  "identity",
  "taskBinding",
  "expectedWriteEpoch",
  "expectedExecutionClaim",
  "expectedClaimToken",
  "hostActivationGate",
  "nowMs",
  "revokeReason",
] as const;

export const ROLLBACK_BINDING_ROOT_KEYS = [
  "fixture",
  "authorizationReference",
  "identity",
  "taskBinding",
  "expectedWriteEpoch",
  "expectedExecutionClaim",
  "expectedClaimToken",
  "expectedPolicyVersion",
  "hostActivationGate",
  "permission",
  "authorizedPermissions",
  "authorizationStatus",
  "targetWriteEpoch",
  "nowMs",
  "currentEffectiveValues",
  "compatibilityRecord",
  "expectedPolicyState",
] as const;

export const READ_BINDING_ROOT_KEYS = ["fixture", "identity", "taskBinding"] as const;

export const REVOKE_REASONS = [
  "authorization_revoked",
  "rule_taken_down",
  "disable",
  "task_cancelled",
] as const;
export type RuntimeRuleAdaptationRevokeReason = (typeof REVOKE_REASONS)[number];

export type RuntimeRuleAdaptationRevokeBinding = {
  fixture?: boolean;
  authorizationReference: string;
  identity: HostIdentity;
  taskBinding: RuntimeRuleAdaptationTaskBinding;
  expectedWriteEpoch: number;
  expectedExecutionClaim: string;
  expectedClaimToken?: string;
  hostActivationGate: HostActivationGate;
  nowMs: number;
  revokeReason: RuntimeRuleAdaptationRevokeReason;
};

export type RuntimeRuleAdaptationRollbackBinding = {
  fixture?: boolean;
  authorizationReference: string;
  identity: HostIdentity;
  taskBinding: RuntimeRuleAdaptationTaskBinding;
  expectedWriteEpoch: number;
  expectedExecutionClaim: string;
  expectedClaimToken?: string;
  expectedPolicyVersion: RuntimeRuleAdaptationExpectedPolicyVersion;
  hostActivationGate: HostActivationGate;
  permission: RuntimeRuleAdaptationAction;
  authorizedPermissions: RuntimeRuleAdaptationAction[];
  authorizationStatus: HostAuthorizationStatus;
  /** Historical snapshot writeEpoch to re-check and rewrite as a new version. */
  targetWriteEpoch: number;
  nowMs: number;
  currentEffectiveValues?: Record<string, unknown>;
  compatibilityRecord?: HostCompatibilityRecord;
  expectedPolicyState?: HostExpectedPolicyState;
};

export type RuntimeRuleAdaptationReadBinding = {
  fixture?: boolean;
  identity: HostIdentity;
  taskBinding: RuntimeRuleAdaptationTaskBinding;
};

/** Keys that must never appear on an activation / revoke / rollback / read envelope. */
export const FORBIDDEN_ACTIVATION_KEYS = [
  "authorizationAssessment",
  "activationAllowed",
  "authorized",
  "authorization",
  "activationRequested",
  "activateNow",
  "compileNow",
  "registerNow",
  "compatibilityProof",
  "gitAncestry",
  "pathUnchangedProof",
  "planVersionId",
  "OpenBotConfig",
  "operatingState",
  "collaborationPolicySnapshot",
  "policySnapshot",
  "CONFIG_DIR",
] as const;

export const FORBIDDEN_ACTIVATION_KEY_SET: ReadonlySet<string> = new Set(FORBIDDEN_ACTIVATION_KEYS);

export type ActivatedRuntimeRulePolicyItem = {
  ruleId: string;
  field: string;
  action: RuntimeRuleAdaptationAction;
  parameter: unknown;
};

/**
 * Immutable effective (or revoke / rollback) snapshot stored on the board-level
 * map `SessionTaskBoard.runtimeRuleAdaptationByTaskId`, keyed by taskId.
 */
export type ActivatedRuntimeRulePolicySnapshot = {
  status: ActivatedRuntimeRulePolicyStatus;
  operation: RuntimeRuleAdaptationActivationOperation;
  taskId: string;
  scope: RuntimeRuleAdaptationScope;
  boardScope: RuntimeRuleAdaptationBoardScope;
  items: readonly ActivatedRuntimeRulePolicyItem[];
  implementationVersion: string;
  catalogVersion: string;
  policyHash: string;
  protocolVersion: string;
  compilerRevision: string;
  writeEpoch: number;
  authorizationReference: string;
  approvedCandidateIdentity?: ApprovedCandidateIdentity;
  hostActivationGate: HostActivationGate;
  permission?: RuntimeRuleAdaptationAction;
  actor: HostIdentity;
  recordedAtMs: number;
  effectiveNode: typeof ACTIVATION_EFFECTIVE_NODE;
  whitelistSource: RuntimeRuleWhitelistSource;
  /** Always false in this period: P3 does not wire the main execution chain. */
  mainChainWired: false;
  supersededWriteEpoch?: number;
  revokeReason?: RuntimeRuleAdaptationRevokeReason;
};

export type RuntimeRuleAdaptationTaskRecord = {
  current?: ActivatedRuntimeRulePolicySnapshot;
  history: ActivatedRuntimeRulePolicySnapshot[];
};

export type RuntimeRuleAdaptationActivationResult = {
  resultKind: RuntimeRuleAdaptationActivationResultKind;
  reasons: RuntimeRuleAdaptationActivationReason[];
  snapshot?: ActivatedRuntimeRulePolicySnapshot;
  retainedSnapshot?: ActivatedRuntimeRulePolicySnapshot;
  boardWriteEpoch?: number;
  whitelistSource?: RuntimeRuleWhitelistSource;
  authorizationAssessment?: AuthorizationAssessment;
};

export type RuntimeRuleAdaptationReadResult = {
  resultKind: "found" | "not_found" | "rejected";
  reasons: RuntimeRuleAdaptationActivationReason[];
  snapshot?: ActivatedRuntimeRulePolicySnapshot;
  history?: readonly ActivatedRuntimeRulePolicySnapshot[];
  boardWriteEpoch?: number;
};

export type ActivationPrecheckContext = {
  liveBoard?: SessionTaskBoard;
  currentImplementationVersion?: string;
  currentExpectedPolicyVersion?: RuntimeRuleAdaptationExpectedPolicyVersion;
  fixtureWhitelist?: readonly RuntimeRuleWhitelistEntry[];
  takenDownRuleIds?: readonly string[];
  liveClaimToken?: string;
};

export type ActivationPrecheckOk = {
  ok: true;
  reasons: RuntimeRuleAdaptationActivationReason[];
  binding: RuntimeRuleAdaptationActivationBinding;
  whitelistSource: RuntimeRuleWhitelistSource;
  authorizationAssessment: AuthorizationAssessment;
  proposalHash: string;
};

export type ActivationPrecheckRejected = {
  ok: false;
  resultKind: "rejected" | "conflict";
  reasons: RuntimeRuleAdaptationActivationReason[];
  authorizationAssessment?: AuthorizationAssessment;
  whitelistSource?: RuntimeRuleWhitelistSource;
};

export type ActivationPrecheckResult = ActivationPrecheckOk | ActivationPrecheckRejected;
