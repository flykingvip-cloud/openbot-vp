/**
 * Pure P3 precheck for activation / revoke / rollback / read.
 * No state writes, locks, CAS, or persistence. Command organizes the use case;
 * the state mutation entry holds the official board lock and persists.
 */
import { createHash } from "node:crypto";
import {
  APPROVED_CANDIDATE_IDENTITY_KEYS,
  ACTIVATION_BINDING_ROOT_KEYS,
  BOARD_SCOPE_BINDING_KEYS,
  EXPECTED_VERSIONS_KEYS,
  FORBIDDEN_ACTIVATION_KEY_SET,
  HOST_ACTIVATION_GATES,
  NO_LIVE_EXECUTION_CLAIM,
  PRODUCTION_RUNTIME_RULE_WHITELIST,
  READ_BINDING_ROOT_KEYS,
  REVOKE_BINDING_ROOT_KEYS,
  REVOKE_REASONS,
  ROLLBACK_BINDING_ROOT_KEYS,
  RUNTIME_RULE_ADAPTATION_IMPLEMENTATION_VERSION,
  TASK_BINDING_KEYS,
  type ActivationPrecheckContext,
  type ActivationPrecheckResult,
  type ApprovedCandidateIdentity,
  type RuntimeRuleAdaptationActivationBinding,
  type RuntimeRuleAdaptationActivationReason,
  type RuntimeRuleAdaptationActivationReasonCode,
  type RuntimeRuleAdaptationBoardScope,
  type RuntimeRuleAdaptationReadBinding,
  type RuntimeRuleAdaptationRevokeBinding,
  type RuntimeRuleAdaptationRollbackBinding,
  type RuntimeRuleAdaptationTaskBinding,
  type RuntimeRuleWhitelistEntry,
  type RuntimeRuleWhitelistSource,
} from "../../contracts/rule-adaptation-activation.js";
import {
  EXPECTED_POLICY_VERSION_KEYS,
  FORBIDDEN_PROPOSAL_KEY_SET,
  HOST_AUTHORIZATION_STATUSES,
  HOST_COMPATIBILITY_RECORD_KEYS,
  HOST_EXPECTED_POLICY_STATES,
  HOST_IDENTITY_KEYS,
  PRINCIPAL_TYPES,
  PROPOSAL_ACTIONS,
  SCOPE_KEYS,
  SCOPE_TYPES,
  TERMINAL_POLICY_STATES,
  type AuthorizationAssessment,
  type HostIdentity,
  type RuntimeRuleAdaptationAction,
  type RuntimeRuleAdaptationExpectedPolicyVersion,
  type RuntimeRuleAdaptationMissingFact,
  type TrustedHostFacts,
} from "../../contracts/rule-adaptation.js";
import { COLLABORATION_POLICY_PROTOCOL_VERSION, POLICY_COMPILER_REVISION } from "../index.js";
import { isKnownCatalogRuleId } from "./descriptors.js";
import {
  collectForbiddenKeys,
  collectInputShapeReasons,
  collectProposalUnknownKeys,
  isNonEmptyString,
  isPlainArray,
  isPlainObject,
  isSafeIntegerNumber,
} from "./inspect.js";
import { validateRuntimeRuleProposal } from "./validate.js";

export function activationReason(
  code: RuntimeRuleAdaptationActivationReasonCode,
  message: string,
  path?: string,
  missingFact?: RuntimeRuleAdaptationMissingFact,
): RuntimeRuleAdaptationActivationReason {
  const entry: RuntimeRuleAdaptationActivationReason = { code, message };
  if (path !== undefined) {
    entry.path = path;
  }
  if (missingFact !== undefined) {
    entry.missingFact = missingFact;
  }
  return entry;
}

export function deepFreezeActivation<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    if (Array.isArray(value)) {
      for (const entry of value) {
        deepFreezeActivation(entry);
      }
    } else {
      for (const child of Object.values(value as Record<string, unknown>)) {
        deepFreezeActivation(child);
      }
    }
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).toSorted();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function hashCanonicalJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
function collectForbiddenActivationKeys(
  value: unknown,
  basePath: string,
  out: RuntimeRuleAdaptationActivationReason[],
): void {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      collectForbiddenActivationKeys(entry, `${basePath}[${index}]`, out);
    }
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const path = `${basePath}.${key}`;
    if (FORBIDDEN_ACTIVATION_KEY_SET.has(key)) {
      if (key === "planVersionId") {
        out.push(
          activationReason(
            "commercial_plan_version",
            "Commercial planVersionId is not a CAS axis for runtime-rule-adaptation activation.",
            path,
          ),
        );
      } else if (
        key === "OpenBotConfig" ||
        key === "operatingState" ||
        key === "collaborationPolicySnapshot" ||
        key === "policySnapshot" ||
        key === "CONFIG_DIR"
      ) {
        out.push(
          activationReason(
            "second_config_authority",
            "Activation must not write a second configuration authority or open a production snapshot flag.",
            path,
          ),
        );
      } else {
        out.push(
          activationReason(
            "structural_forbidden_field",
            `${key} is forbidden on the activation envelope and is a structural reject.`,
            path,
          ),
        );
      }
    }
    collectForbiddenActivationKeys(child, path, out);
  }
}

function collectUnknown(
  value: unknown,
  basePath: string,
  allowed: readonly string[],
  out: RuntimeRuleAdaptationActivationReason[],
): void {
  if (!isPlainObject(value)) {
    return;
  }
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (allowedSet.has(key)) {
      continue;
    }
    if (FORBIDDEN_ACTIVATION_KEY_SET.has(key) || FORBIDDEN_PROPOSAL_KEY_SET.has(key)) {
      continue;
    }
    out.push(
      activationReason(
        "structural_unknown_field",
        `Unknown field '${key}' is not in the closed schema and is a structural reject.`,
        `${basePath}.${key}`,
      ),
    );
  }
}

function missingBinding(path: string): RuntimeRuleAdaptationActivationReason {
  return activationReason(
    "structural_missing_binding",
    "A required host binding field is missing. Defaults must not be invented to complete activation.",
    path,
  );
}

function asP1Reasons(
  reasons: ReadonlyArray<{
    code: string;
    message: string;
    path?: string;
    missingFact?: RuntimeRuleAdaptationMissingFact;
  }>,
): RuntimeRuleAdaptationActivationReason[] {
  return reasons.map((entry) =>
    activationReason(
      entry.code as RuntimeRuleAdaptationActivationReasonCode,
      entry.message,
      entry.path,
      entry.missingFact,
    ),
  );
}

export function scopesEqual(
  left: { type?: unknown; id?: unknown } | undefined,
  right: { type?: unknown; id?: unknown } | undefined,
): boolean {
  return (
    isNonEmptyString(left?.type) &&
    isNonEmptyString(left?.id) &&
    left.type === right?.type &&
    left.id === right?.id
  );
}

export function boardScopesEqual(
  left: RuntimeRuleAdaptationBoardScope,
  right: { tenantId?: string; userId?: string; sessionId?: string } | undefined,
): boolean {
  return (
    Boolean(right) &&
    left.tenantId === right?.tenantId &&
    left.userId === right?.userId &&
    left.sessionId === right?.sessionId
  );
}

export function policyVersionsEqual(
  left: RuntimeRuleAdaptationExpectedPolicyVersion,
  right: RuntimeRuleAdaptationExpectedPolicyVersion | undefined,
): boolean {
  return (
    Boolean(right) &&
    left.policyHash === right?.policyHash &&
    left.protocolVersion === right?.protocolVersion &&
    left.compilerRevision === right?.compilerRevision
  );
}

export function resolveActivationWhitelist(
  fixture: boolean | undefined,
  fixtureWhitelist: readonly RuntimeRuleWhitelistEntry[] | undefined,
): { source: RuntimeRuleWhitelistSource; entries: readonly RuntimeRuleWhitelistEntry[] } {
  if (fixture === true && fixtureWhitelist) {
    return { source: "fixture", entries: fixtureWhitelist };
  }
  return { source: "production", entries: PRODUCTION_RUNTIME_RULE_WHITELIST };
}

export function whitelistHit(
  entries: readonly RuntimeRuleWhitelistEntry[],
  ruleId: string,
  field: string,
  action: RuntimeRuleAdaptationAction,
): boolean {
  return entries.some(
    (entry) => entry.ruleId === ruleId && entry.field === field && entry.action === action,
  );
}

type LiveTaskView = {
  taskId: string;
  unfinished: boolean;
  executionAttempt?: string;
  admittedGeneration?: number;
};

export function findActivatableTask(
  context: ActivationPrecheckContext,
  taskId: string,
): { task?: LiveTaskView; tombstoned: boolean } {
  const board = context.liveBoard;
  if (!board) {
    return { tombstoned: false };
  }
  const tombstoned = (board.tombstones ?? []).some((row) => row.taskId === taskId);
  if (tombstoned) {
    return { tombstoned: true };
  }
  if (board.current?.taskId === taskId) {
    return { task: board.current, tombstoned: false };
  }
  const parked = board.parked?.find((row) => row.taskId === taskId);
  return { task: parked, tombstoned: false };
}

export function compareExecutionClaim(
  expectedExecutionClaim: string,
  expectedClaimToken: string | undefined,
  liveAttempt: string | undefined,
  liveClaimToken: string | undefined,
  pathPrefix: string,
): RuntimeRuleAdaptationActivationReason[] {
  const reasons: RuntimeRuleAdaptationActivationReason[] = [];
  const hasLive = Boolean(liveAttempt) || Boolean(liveClaimToken);
  if (!hasLive) {
    if (expectedExecutionClaim !== NO_LIVE_EXECUTION_CLAIM) {
      reasons.push(
        activationReason(
          "execution_claim_mismatch",
          "No live execution claim exists; the request must use the closed no-live-claim sentinel.",
          `${pathPrefix}.expectedExecutionClaim`,
        ),
      );
    }
    if (expectedClaimToken !== undefined) {
      reasons.push(
        activationReason(
          "execution_claim_mismatch",
          "No live claim token exists; expectedClaimToken must be omitted.",
          `${pathPrefix}.expectedClaimToken`,
        ),
      );
    }
    return reasons;
  }
  if (liveAttempt && expectedExecutionClaim !== liveAttempt) {
    reasons.push(
      activationReason(
        "execution_claim_mismatch",
        "The expected execution claim does not match the live executionAttempt.",
        `${pathPrefix}.expectedExecutionClaim`,
      ),
    );
  }
  if (liveClaimToken) {
    if (!isNonEmptyString(expectedClaimToken)) {
      reasons.push(missingBinding(`${pathPrefix}.expectedClaimToken`));
    } else if (expectedClaimToken !== liveClaimToken) {
      reasons.push(
        activationReason(
          "execution_claim_mismatch",
          "The expected claim token does not match the live claim token.",
          `${pathPrefix}.expectedClaimToken`,
        ),
      );
    }
  } else if (expectedClaimToken !== undefined) {
    reasons.push(
      activationReason(
        "execution_claim_mismatch",
        "No live claim token is present; expectedClaimToken must be omitted.",
        `${pathPrefix}.expectedClaimToken`,
      ),
    );
  }
  return reasons;
}
function parseBoardScope(
  value: unknown,
  path: string,
  reasons: RuntimeRuleAdaptationActivationReason[],
): RuntimeRuleAdaptationBoardScope | undefined {
  if (value === undefined) {
    reasons.push(missingBinding(path));
    return undefined;
  }
  if (!isPlainObject(value)) {
    reasons.push(
      activationReason(
        "structural_invalid_type",
        "boardScope must be a plain object with tenantId, userId, and sessionId.",
        path,
      ),
    );
    return undefined;
  }
  collectUnknown(value, path, BOARD_SCOPE_BINDING_KEYS, reasons);
  const tenantId = value.tenantId;
  const userId = value.userId;
  const sessionId = value.sessionId;
  let complete = true;
  for (const [key, field] of [
    ["tenantId", tenantId],
    ["userId", userId],
    ["sessionId", sessionId],
  ] as const) {
    if (!isNonEmptyString(field)) {
      reasons.push(
        activationReason(
          "incomplete_board_scope",
          "Task-board scope keys must all be present and non-empty; incomplete keys fail closed.",
          `${path}.${key}`,
        ),
      );
      complete = false;
    }
  }
  if (!complete) {
    return undefined;
  }
  return {
    tenantId: tenantId as string,
    userId: userId as string,
    sessionId: sessionId as string,
  };
}

function parseIdentity(
  value: unknown,
  path: string,
  reasons: RuntimeRuleAdaptationActivationReason[],
): HostIdentity | undefined {
  if (value === undefined) {
    reasons.push(missingBinding(path));
    return undefined;
  }
  if (!isPlainObject(value)) {
    reasons.push(
      activationReason("structural_invalid_type", "identity must be a plain object.", path),
    );
    return undefined;
  }
  collectUnknown(value, path, HOST_IDENTITY_KEYS, reasons);
  const principalType = value.principalType;
  const principalId = value.principalId;
  if (
    !isNonEmptyString(principalType) ||
    !(PRINCIPAL_TYPES as readonly string[]).includes(principalType)
  ) {
    reasons.push(
      isNonEmptyString(principalType)
        ? activationReason(
            "structural_invalid_type",
            "identity.principalType is not in the closed set.",
            `${path}.principalType`,
          )
        : missingBinding(`${path}.principalType`),
    );
  }
  if (!isNonEmptyString(principalId)) {
    reasons.push(missingBinding(`${path}.principalId`));
  }
  if (!isPlainObject(value.scope)) {
    reasons.push(
      value.scope === undefined
        ? missingBinding(`${path}.scope`)
        : activationReason(
            "structural_invalid_type",
            "identity.scope must be a plain object.",
            `${path}.scope`,
          ),
    );
    return undefined;
  }
  collectUnknown(value.scope, `${path}.scope`, SCOPE_KEYS, reasons);
  const scopeType = value.scope.type;
  const scopeId = value.scope.id;
  if (!isNonEmptyString(scopeType) || !(SCOPE_TYPES as readonly string[]).includes(scopeType)) {
    reasons.push(
      isNonEmptyString(scopeType)
        ? activationReason(
            "structural_invalid_type",
            "identity.scope.type is not in the closed set.",
            `${path}.scope.type`,
          )
        : missingBinding(`${path}.scope.type`),
    );
  }
  if (!isNonEmptyString(scopeId)) {
    reasons.push(missingBinding(`${path}.scope.id`));
  }
  if (
    isNonEmptyString(principalType) &&
    isNonEmptyString(principalId) &&
    isNonEmptyString(scopeType) &&
    isNonEmptyString(scopeId) &&
    (PRINCIPAL_TYPES as readonly string[]).includes(principalType) &&
    (SCOPE_TYPES as readonly string[]).includes(scopeType)
  ) {
    return {
      principalType: principalType as HostIdentity["principalType"],
      principalId,
      scope: { type: scopeType as HostIdentity["scope"]["type"], id: scopeId },
    };
  }
  return undefined;
}

function parseTaskBinding(
  value: unknown,
  path: string,
  reasons: RuntimeRuleAdaptationActivationReason[],
): RuntimeRuleAdaptationTaskBinding | undefined {
  if (value === undefined) {
    reasons.push(missingBinding(path));
    return undefined;
  }
  if (!isPlainObject(value)) {
    reasons.push(
      activationReason("structural_invalid_type", "taskBinding must be a plain object.", path),
    );
    return undefined;
  }
  collectUnknown(value, path, TASK_BINDING_KEYS, reasons);
  if (!isNonEmptyString(value.taskId)) {
    reasons.push(
      value.taskId === undefined
        ? missingBinding(`${path}.taskId`)
        : activationReason(
            "structural_invalid_type",
            "taskId must be a non-empty string.",
            `${path}.taskId`,
          ),
    );
  }
  const boardScope = parseBoardScope(value.boardScope, `${path}.boardScope`, reasons);
  if (isNonEmptyString(value.taskId) && boardScope) {
    return { taskId: value.taskId, boardScope };
  }
  return undefined;
}

function parseExpectedPolicyVersion(
  value: unknown,
  path: string,
  reasons: RuntimeRuleAdaptationActivationReason[],
): RuntimeRuleAdaptationExpectedPolicyVersion | undefined {
  if (value === undefined) {
    reasons.push(missingBinding(path));
    return undefined;
  }
  if (!isPlainObject(value)) {
    reasons.push(
      activationReason(
        "structural_invalid_type",
        "expectedPolicyVersion must be a plain object.",
        path,
      ),
    );
    return undefined;
  }
  collectUnknown(value, path, EXPECTED_POLICY_VERSION_KEYS, reasons);
  const policyHash = value.policyHash;
  const protocolVersion = value.protocolVersion;
  const compilerRevision = value.compilerRevision;
  let ok = true;
  for (const [key, field] of [
    ["policyHash", policyHash],
    ["protocolVersion", protocolVersion],
    ["compilerRevision", compilerRevision],
  ] as const) {
    if (!isNonEmptyString(field)) {
      reasons.push(missingBinding(`${path}.${key}`));
      ok = false;
    }
  }
  if (!ok) {
    return undefined;
  }
  return {
    policyHash: policyHash as string,
    protocolVersion: protocolVersion as string,
    compilerRevision: compilerRevision as string,
  };
}

function parseApprovedIdentity(
  value: unknown,
  path: string,
  reasons: RuntimeRuleAdaptationActivationReason[],
): ApprovedCandidateIdentity | undefined {
  if (value === undefined) {
    reasons.push(missingBinding(path));
    return undefined;
  }
  if (!isPlainObject(value)) {
    reasons.push(
      activationReason(
        "structural_invalid_type",
        "approvedCandidateIdentity must be a plain object.",
        path,
      ),
    );
    return undefined;
  }
  collectUnknown(value, path, APPROVED_CANDIDATE_IDENTITY_KEYS, reasons);
  if (!isNonEmptyString(value.proposalHash)) {
    reasons.push(missingBinding(`${path}.proposalHash`));
  }
  if (value.resultKind === "candidate_validated") {
    reasons.push(
      activationReason(
        "candidate_cannot_activate",
        "candidate_validated is not an activation credential.",
        `${path}.resultKind`,
      ),
    );
  } else if (value.resultKind !== "shadow_accepted") {
    reasons.push(
      value.resultKind === undefined
        ? missingBinding(`${path}.resultKind`)
        : activationReason(
            "unapproved_candidate",
            "approvedCandidateIdentity.resultKind must be shadow_accepted.",
            `${path}.resultKind`,
          ),
    );
  }
  if (!isNonEmptyString(value.validatorImplementationVersion)) {
    reasons.push(missingBinding(`${path}.validatorImplementationVersion`));
  }
  if (
    isNonEmptyString(value.proposalHash) &&
    value.resultKind === "shadow_accepted" &&
    isNonEmptyString(value.validatorImplementationVersion)
  ) {
    return {
      proposalHash: value.proposalHash,
      resultKind: "shadow_accepted",
      validatorImplementationVersion: value.validatorImplementationVersion,
    };
  }
  return undefined;
}

function parseAction(
  value: unknown,
  path: string,
  reasons: RuntimeRuleAdaptationActivationReason[],
): RuntimeRuleAdaptationAction | undefined {
  if (value === undefined) {
    reasons.push(missingBinding(path));
    return undefined;
  }
  if (!isNonEmptyString(value) || !(PROPOSAL_ACTIONS as readonly string[]).includes(value)) {
    reasons.push(
      activationReason(
        "structural_invalid_type",
        "permission is not in the closed action set.",
        path,
      ),
    );
    return undefined;
  }
  return value as RuntimeRuleAdaptationAction;
}

function parseActionList(
  value: unknown,
  path: string,
  reasons: RuntimeRuleAdaptationActivationReason[],
): RuntimeRuleAdaptationAction[] | undefined {
  if (value === undefined) {
    reasons.push(missingBinding(path));
    return undefined;
  }
  if (!isPlainArray(value)) {
    reasons.push(
      activationReason(
        "structural_invalid_type",
        "authorizedPermissions must be a plain array.",
        path,
      ),
    );
    return undefined;
  }
  const actions: RuntimeRuleAdaptationAction[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isNonEmptyString(entry) || !(PROPOSAL_ACTIONS as readonly string[]).includes(entry)) {
      reasons.push(
        activationReason(
          "structural_invalid_type",
          "authorizedPermissions entries must be closed action words.",
          `${path}[${index}]`,
        ),
      );
      continue;
    }
    actions.push(entry as RuntimeRuleAdaptationAction);
  }
  return actions;
}

function parseHostGate(
  value: unknown,
  path: string,
  reasons: RuntimeRuleAdaptationActivationReason[],
): RuntimeRuleAdaptationActivationBinding["hostActivationGate"] | undefined {
  if (value === undefined) {
    reasons.push(
      activationReason(
        "shadow_accepted_not_credential",
        "shadow_accepted is not an activation credential; a hostActivationGate of test_entry or explicit_approval is required.",
        path,
      ),
    );
    return undefined;
  }
  if (!isNonEmptyString(value) || !(HOST_ACTIVATION_GATES as readonly string[]).includes(value)) {
    reasons.push(
      activationReason(
        "host_gate_invalid",
        "hostActivationGate must be test_entry or explicit_approval.",
        path,
      ),
    );
    return undefined;
  }
  return value as RuntimeRuleAdaptationActivationBinding["hostActivationGate"];
}
function collectLiveTaskReasons(
  context: ActivationPrecheckContext,
  taskBinding: RuntimeRuleAdaptationTaskBinding,
  expectedExecutionClaim: string,
  expectedClaimToken: string | undefined,
  expectedWriteEpoch: number | undefined,
  reasons: RuntimeRuleAdaptationActivationReason[],
): { conflict: boolean } {
  let conflict = false;
  if (!context.liveBoard) {
    reasons.push(
      activationReason(
        "task_not_bound",
        "A live session task board is required to precheck activation; it was not supplied.",
        "context.liveBoard",
      ),
    );
    return { conflict };
  }
  const boardScope = context.liveBoard.scope;
  if (
    !boardScope ||
    !isNonEmptyString(boardScope.tenantId) ||
    !isNonEmptyString(boardScope.userId) ||
    !isNonEmptyString(boardScope.sessionId)
  ) {
    reasons.push(
      activationReason(
        "incomplete_board_scope",
        "The live task board scope is missing or incomplete; isolation fails closed.",
        "liveBoard.scope",
      ),
    );
  } else if (!boardScopesEqual(taskBinding.boardScope, boardScope)) {
    reasons.push(
      activationReason(
        "identity_scope_mismatch",
        "The request boardScope does not match the live SessionTaskBoard scope.",
        "binding.taskBinding.boardScope",
      ),
    );
  }
  const { task, tombstoned } = findActivatableTask(context, taskBinding.taskId);
  if (tombstoned) {
    reasons.push(
      activationReason(
        "cancelled_or_tombstone",
        "The bound task is tombstoned and must not be activated or rolled back into a live task.",
        "binding.taskBinding.taskId",
      ),
    );
    return { conflict };
  }
  if (!task) {
    reasons.push(
      activationReason(
        "task_not_bound",
        "The bound taskId is not a live current or parked task on the board; a task must not be created to complete activation.",
        "binding.taskBinding.taskId",
      ),
    );
    return { conflict };
  }
  if (!task.unfinished) {
    reasons.push(
      activationReason(
        "cancelled_or_tombstone",
        "The bound task is no longer unfinished and cannot receive a new effective policy.",
        "binding.taskBinding.taskId",
      ),
    );
  }
  if (
    typeof context.liveBoard.resetGeneration === "number" &&
    task.admittedGeneration !== context.liveBoard.resetGeneration
  ) {
    reasons.push(
      activationReason(
        "cancelled_or_tombstone",
        "The bound task is not a default target of the current resetGeneration.",
        "binding.taskBinding.taskId",
      ),
    );
  }
  reasons.push(
    ...compareExecutionClaim(
      expectedExecutionClaim,
      expectedClaimToken,
      task.executionAttempt,
      context.liveClaimToken,
      "binding.expectedVersions",
    ),
  );
  if (typeof expectedWriteEpoch === "number") {
    const diskEpoch =
      typeof context.liveBoard.writeEpoch === "number" ? context.liveBoard.writeEpoch : 0;
    if (expectedWriteEpoch !== diskEpoch) {
      if (diskEpoch > expectedWriteEpoch) {
        conflict = true;
        reasons.push(
          activationReason(
            "write_epoch_conflict",
            "The expected writeEpoch is stale relative to the on-disk board; the newer snapshot must not be overwritten.",
            "binding.expectedVersions.expectedWriteEpoch",
          ),
        );
      } else {
        reasons.push(
          activationReason(
            "policy_version_mismatch",
            "The expected writeEpoch does not match the on-disk board and must not be rewritten to the live value.",
            "binding.expectedVersions.expectedWriteEpoch",
          ),
        );
      }
    }
  }
  if (
    reasons.some((entry) => entry.code === "execution_claim_mismatch") &&
    !conflict &&
    typeof expectedWriteEpoch === "number"
  ) {
    const diskEpoch =
      typeof context.liveBoard.writeEpoch === "number" ? context.liveBoard.writeEpoch : 0;
    if (expectedWriteEpoch === diskEpoch) {
      conflict = true;
    }
  }
  return { conflict };
}

function collectVersionAndAuthReasons(
  proposalVersion: RuntimeRuleAdaptationExpectedPolicyVersion | undefined,
  bindingVersion: RuntimeRuleAdaptationExpectedPolicyVersion | undefined,
  bindingImplementationFromProposal: string | undefined,
  context: ActivationPrecheckContext,
  authorizationStatus: unknown,
  expectedPolicyState: unknown,
  nowMs: number | undefined,
  expiresAtMs: number | undefined,
  compatibilityRecord: unknown,
  reasons: RuntimeRuleAdaptationActivationReason[],
): void {
  const currentImplementation =
    context.currentImplementationVersion ?? RUNTIME_RULE_ADAPTATION_IMPLEMENTATION_VERSION;
  if (
    isNonEmptyString(bindingImplementationFromProposal) &&
    bindingImplementationFromProposal !== currentImplementation
  ) {
    reasons.push(
      activationReason(
        "policy_version_mismatch",
        "implementationVersion is unknown or is not the current implementation identity.",
        "proposal.implementationVersion",
      ),
    );
  }
  const currentPolicy = context.currentExpectedPolicyVersion ?? {
    policyHash: "",
    protocolVersion: COLLABORATION_POLICY_PROTOCOL_VERSION,
    compilerRevision: POLICY_COMPILER_REVISION,
  };
  if (!context.currentExpectedPolicyVersion) {
    reasons.push(
      activationReason(
        "missing_host_fact",
        "The current expected policy version authority was not supplied by the host.",
        "context.currentExpectedPolicyVersion",
        "expectedPolicyState",
      ),
    );
  } else if (bindingVersion && !policyVersionsEqual(bindingVersion, currentPolicy)) {
    reasons.push(
      activationReason(
        "policy_version_mismatch",
        "expectedPolicyVersion does not match the current policy authority (stale or unknown version).",
        "binding.expectedVersions.expectedPolicyVersion",
      ),
    );
  }
  if (proposalVersion && bindingVersion && !policyVersionsEqual(proposalVersion, bindingVersion)) {
    reasons.push(
      activationReason(
        "policy_version_mismatch",
        "expectedPolicyVersion on the proposal does not match the host binding.",
        "proposal.expectedPolicyVersion",
      ),
    );
  }
  if (bindingVersion) {
    if (
      bindingVersion.protocolVersion !== COLLABORATION_POLICY_PROTOCOL_VERSION ||
      bindingVersion.compilerRevision !== POLICY_COMPILER_REVISION
    ) {
      reasons.push(
        activationReason(
          "policy_version_mismatch",
          "protocolVersion or compilerRevision is not the current official revision.",
          "binding.expectedVersions.expectedPolicyVersion",
        ),
      );
    }
  }
  if (isPlainObject(compatibilityRecord) && bindingVersion) {
    const bound = compatibilityRecord.boundExpectedPolicyVersion;
    if (isPlainObject(bound)) {
      const boundVersion = {
        policyHash: typeof bound.policyHash === "string" ? bound.policyHash : "",
        protocolVersion: typeof bound.protocolVersion === "string" ? bound.protocolVersion : "",
        compilerRevision: typeof bound.compilerRevision === "string" ? bound.compilerRevision : "",
      };
      if (!policyVersionsEqual(bindingVersion, boundVersion)) {
        reasons.push(
          activationReason(
            "policy_version_mismatch",
            "compatibilityRecord.boundExpectedPolicyVersion does not match the binding.",
            "binding.compatibilityRecord.boundExpectedPolicyVersion",
          ),
        );
      }
    }
    if (
      isNonEmptyString(compatibilityRecord.status) &&
      compatibilityRecord.status !== "approved_compatible"
    ) {
      reasons.push(
        activationReason(
          "unapproved_candidate",
          "The compatibility record is not approved_compatible.",
          "binding.compatibilityRecord.status",
        ),
      );
    }
  }
  if (authorizationStatus === undefined) {
    reasons.push(
      activationReason(
        "missing_host_fact",
        "Current authorizationStatus must be re-evaluated at activation time.",
        "binding.authorizationStatus",
        "authorizationStatus",
      ),
    );
  } else if (authorizationStatus === "unauthorized") {
    reasons.push(
      activationReason(
        "authorization_revoked",
        "The authorization reference is not currently host_authorized; a prior assessment must not be reused.",
        "binding.authorizationStatus",
      ),
    );
  } else if (authorizationStatus !== "authorized") {
    reasons.push(
      activationReason(
        "structural_invalid_type",
        "authorizationStatus is not in the closed set.",
        "binding.authorizationStatus",
      ),
    );
  }
  if (expectedPolicyState !== undefined) {
    if (
      !isNonEmptyString(expectedPolicyState) ||
      !(HOST_EXPECTED_POLICY_STATES as readonly string[]).includes(expectedPolicyState)
    ) {
      reasons.push(
        activationReason(
          "structural_invalid_type",
          "expectedPolicyState is not in the closed set.",
          "binding.expectedPolicyState",
        ),
      );
    } else if (TERMINAL_POLICY_STATES.has(expectedPolicyState)) {
      reasons.push(
        activationReason(
          "proposal_expired",
          "The expected policy state is expired, cancelled, or tombstone.",
          "binding.expectedPolicyState",
        ),
      );
    }
  }
  if (expiresAtMs !== undefined) {
    if (nowMs === undefined) {
      reasons.push(
        activationReason(
          "missing_host_fact",
          "A host deadline was supplied; nowMs is required to evaluate it. No default TTL is invented.",
          "binding.nowMs",
        ),
      );
    } else if (nowMs >= expiresAtMs) {
      reasons.push(
        activationReason(
          "proposal_expired",
          "The host-supplied deadline has already passed.",
          "binding.expectedVersions.expiresAtMs",
        ),
      );
    }
  }
}
/**
 * True only after the caller identity and board scope have been matched against
 * the live SessionTaskBoard (and, when a proposal is supplied, the proposal
 * scope). Failures before this point must not reveal retained snapshots,
 * history, or other board state.
 */
export function activationAccessScopeVerified(
  binding: unknown,
  liveBoard: ActivationPrecheckContext["liveBoard"],
  proposal?: unknown,
): boolean {
  if (!isPlainObject(binding) || !liveBoard) {
    return false;
  }
  const sink: RuntimeRuleAdaptationActivationReason[] = [];
  const identity = parseIdentity(binding.identity, "binding.identity", sink);
  const taskBinding = parseTaskBinding(binding.taskBinding, "binding.taskBinding", sink);
  if (!identity || !taskBinding || identity.scope.type !== "personal") {
    return false;
  }
  const boardScope = liveBoard.scope;
  if (
    !boardScope ||
    !isNonEmptyString(boardScope.tenantId) ||
    !isNonEmptyString(boardScope.userId) ||
    !isNonEmptyString(boardScope.sessionId) ||
    !boardScopesEqual(taskBinding.boardScope, boardScope)
  ) {
    return false;
  }
  if (
    isPlainObject(proposal) &&
    isPlainObject(proposal.scope) &&
    !scopesEqual(identity.scope, proposal.scope as { type?: unknown; id?: unknown })
  ) {
    return false;
  }
  return true;
}

export function precheckRuntimeRuleActivation(
  proposal: unknown,
  binding: unknown,
  context: ActivationPrecheckContext = {},
): ActivationPrecheckResult {
  const reasons: RuntimeRuleAdaptationActivationReason[] = [];
  reasons.push(...asP1Reasons(collectInputShapeReasons(proposal, binding)));
  collectForbiddenKeys(proposal, "proposal", reasons as never);
  collectForbiddenActivationKeys(binding, "binding", reasons);

  if (!isPlainObject(proposal)) {
    if (!reasons.some((entry) => entry.path === "proposal" || entry.path?.startsWith("proposal"))) {
      reasons.push(
        activationReason(
          "structural_non_plain_object",
          "The proposal must be a plain data object.",
          "proposal",
        ),
      );
    }
  } else {
    collectProposalUnknownKeys(proposal, reasons as never);
    if (proposal.kind === "rule_candidate") {
      reasons.push(
        activationReason(
          "candidate_cannot_activate",
          "rule_candidate cannot be activated.",
          "proposal.kind",
        ),
      );
    } else if (proposal.kind !== "policy_proposal") {
      reasons.push(
        activationReason(
          "structural_invalid_type",
          "Only a closed policy_proposal may be activated.",
          "proposal.kind",
        ),
      );
    }
  }

  if (!isPlainObject(binding)) {
    if (!reasons.some((entry) => entry.path === "binding" || entry.path?.startsWith("binding"))) {
      reasons.push(
        activationReason(
          "structural_non_plain_object",
          "The host binding must be a plain data object.",
          "binding",
        ),
      );
    }
    return { ok: false, resultKind: "rejected", reasons };
  }

  collectUnknown(binding, "binding", ACTIVATION_BINDING_ROOT_KEYS, reasons);
  const identity = parseIdentity(binding.identity, "binding.identity", reasons);
  const taskBinding = parseTaskBinding(binding.taskBinding, "binding.taskBinding", reasons);
  if (!isNonEmptyString(binding.authorizationReference)) {
    reasons.push(
      binding.authorizationReference === undefined
        ? missingBinding("binding.authorizationReference")
        : activationReason(
            "structural_invalid_type",
            "authorizationReference must be a non-empty string.",
            "binding.authorizationReference",
          ),
    );
  }
  if (!isPlainObject(binding.expectedVersions)) {
    reasons.push(
      binding.expectedVersions === undefined
        ? missingBinding("binding.expectedVersions")
        : activationReason(
            "structural_invalid_type",
            "expectedVersions must be a plain object.",
            "binding.expectedVersions",
          ),
    );
  } else {
    collectUnknown(
      binding.expectedVersions,
      "binding.expectedVersions",
      EXPECTED_VERSIONS_KEYS,
      reasons,
    );
  }
  const expectedVersions = isPlainObject(binding.expectedVersions)
    ? binding.expectedVersions
    : undefined;
  if (expectedVersions && expectedVersions.expectedWriteEpoch === undefined) {
    reasons.push(missingBinding("binding.expectedVersions.expectedWriteEpoch"));
  } else if (expectedVersions && !isSafeIntegerNumber(expectedVersions.expectedWriteEpoch)) {
    reasons.push(
      activationReason(
        "structural_invalid_type",
        "expectedWriteEpoch must be a safe integer.",
        "binding.expectedVersions.expectedWriteEpoch",
      ),
    );
  }
  if (expectedVersions && !isNonEmptyString(expectedVersions.expectedExecutionClaim)) {
    reasons.push(
      expectedVersions.expectedExecutionClaim === undefined
        ? missingBinding("binding.expectedVersions.expectedExecutionClaim")
        : activationReason(
            "structural_invalid_type",
            "expectedExecutionClaim must be a non-empty string.",
            "binding.expectedVersions.expectedExecutionClaim",
          ),
    );
  }
  if (
    expectedVersions &&
    expectedVersions.expectedClaimToken !== undefined &&
    !isNonEmptyString(expectedVersions.expectedClaimToken)
  ) {
    reasons.push(
      activationReason(
        "structural_invalid_type",
        "expectedClaimToken must be a non-empty string when present.",
        "binding.expectedVersions.expectedClaimToken",
      ),
    );
  }
  if (
    expectedVersions &&
    expectedVersions.expiresAtMs !== undefined &&
    !isSafeIntegerNumber(expectedVersions.expiresAtMs)
  ) {
    reasons.push(
      activationReason(
        "structural_invalid_type",
        "expiresAtMs must be a safe integer when present.",
        "binding.expectedVersions.expiresAtMs",
      ),
    );
  }
  const bindingPolicyVersion = expectedVersions
    ? parseExpectedPolicyVersion(
        expectedVersions.expectedPolicyVersion,
        "binding.expectedVersions.expectedPolicyVersion",
        reasons,
      )
    : undefined;
  const approvedIdentity = parseApprovedIdentity(
    binding.approvedCandidateIdentity,
    "binding.approvedCandidateIdentity",
    reasons,
  );
  const hostGate = parseHostGate(binding.hostActivationGate, "binding.hostActivationGate", reasons);
  const permission = parseAction(binding.permission, "binding.permission", reasons);
  const authorizedPermissions = parseActionList(
    binding.authorizedPermissions,
    "binding.authorizedPermissions",
    reasons,
  );
  if (binding.nowMs === undefined) {
    reasons.push(missingBinding("binding.nowMs"));
  } else if (!isSafeIntegerNumber(binding.nowMs)) {
    reasons.push(
      activationReason("structural_invalid_type", "nowMs must be a safe integer.", "binding.nowMs"),
    );
  }
  if (binding.authorizationStatus !== undefined) {
    if (
      !isNonEmptyString(binding.authorizationStatus) ||
      !(HOST_AUTHORIZATION_STATUSES as readonly string[]).includes(binding.authorizationStatus)
    ) {
      reasons.push(
        activationReason(
          "structural_invalid_type",
          "authorizationStatus is not in the closed set.",
          "binding.authorizationStatus",
        ),
      );
    }
  }
  if (isPlainObject(binding.compatibilityRecord)) {
    collectUnknown(
      binding.compatibilityRecord,
      "binding.compatibilityRecord",
      HOST_COMPATIBILITY_RECORD_KEYS,
      reasons,
    );
    if (isPlainObject(binding.compatibilityRecord.boundExpectedPolicyVersion)) {
      collectUnknown(
        binding.compatibilityRecord.boundExpectedPolicyVersion,
        "binding.compatibilityRecord.boundExpectedPolicyVersion",
        EXPECTED_POLICY_VERSION_KEYS,
        reasons,
      );
    }
  }
  if (
    binding.currentEffectiveValues !== undefined &&
    !isPlainObject(binding.currentEffectiveValues)
  ) {
    reasons.push(
      activationReason(
        "structural_invalid_type",
        "currentEffectiveValues must be a plain object when present.",
        "binding.currentEffectiveValues",
      ),
    );
  }
  if (binding.fixture !== undefined && typeof binding.fixture !== "boolean") {
    reasons.push(
      activationReason(
        "structural_invalid_type",
        "fixture must be a boolean when present.",
        "binding.fixture",
      ),
    );
  }

  const proposalRecord = isPlainObject(proposal) ? proposal : undefined;
  const proposalVersion = proposalRecord
    ? parseExpectedPolicyVersion(
        proposalRecord.expectedPolicyVersion,
        "proposal.expectedPolicyVersion",
        reasons,
      )
    : undefined;

  if (identity && proposalRecord && isPlainObject(proposalRecord.scope)) {
    if (!scopesEqual(identity.scope, proposalRecord.scope as { type?: unknown; id?: unknown })) {
      reasons.push(
        activationReason(
          "identity_scope_mismatch",
          "Host identity scope does not match the proposal scope.",
          "binding.identity.scope",
        ),
      );
    }
  }

  if (identity && identity.scope.type !== "personal") {
    reasons.push(
      activationReason(
        "collaboration_path_unwired",
        "This period only implements the personal SessionTaskBoard activation path. Collaboration remains fail-closed and unwired.",
        "binding.identity.scope.type",
      ),
    );
  }

  if (permission === "delete") {
    reasons.push(
      activationReason(
        "permission_axis_mismatch",
        "delete is not a legal activation or rollback permission axis.",
        "binding.permission",
      ),
    );
  }
  if (permission && authorizedPermissions && !authorizedPermissions.includes(permission)) {
    reasons.push(
      activationReason(
        "permission_axis_mismatch",
        "The requested permission axis is not present on the current authorization.",
        "binding.permission",
      ),
    );
  }

  const itemRows: Array<{
    ruleId: string;
    field: string;
    action: RuntimeRuleAdaptationAction;
    proposedValue: unknown;
  }> = [];
  if (
    proposalRecord &&
    proposalRecord.kind === "policy_proposal" &&
    isPlainArray(proposalRecord.items)
  ) {
    for (const [index, item] of proposalRecord.items.entries()) {
      if (!isPlainObject(item)) {
        continue;
      }
      if (
        isNonEmptyString(item.ruleId) &&
        isNonEmptyString(item.field) &&
        isNonEmptyString(item.action) &&
        (PROPOSAL_ACTIONS as readonly string[]).includes(item.action)
      ) {
        itemRows.push({
          ruleId: item.ruleId,
          field: item.field,
          action: item.action as RuntimeRuleAdaptationAction,
          proposedValue: item.proposedValue,
        });
        if (permission && item.action !== permission) {
          reasons.push(
            activationReason(
              "permission_axis_mismatch",
              "The requested permission axis does not cover this proposal item action.",
              `proposal.items[${index}].action`,
            ),
          );
        }
      }
    }
  }

  const { source: whitelistSource, entries: whitelist } = resolveActivationWhitelist(
    binding.fixture === true,
    context.fixtureWhitelist,
  );
  if (itemRows.length > 0) {
    if (whitelist.length === 0) {
      reasons.push(
        activationReason(
          "empty_whitelist",
          "The runtime whitelist is empty; activation is denied. A fixture whitelist is not a production whitelist.",
          "whitelist",
        ),
      );
    } else {
      for (const [index, item] of itemRows.entries()) {
        if (!whitelistHit(whitelist, item.ruleId, item.field, item.action)) {
          reasons.push(
            activationReason(
              "whitelist_miss",
              "The ruleId, field, and action are not on the current whitelist.",
              `proposal.items[${index}]`,
            ),
          );
        }
      }
    }
  }

  for (const [index, item] of itemRows.entries()) {
    if (
      (context.takenDownRuleIds ?? []).includes(item.ruleId) ||
      !isKnownCatalogRuleId(item.ruleId)
    ) {
      reasons.push(
        activationReason(
          "rule_taken_down",
          "The rule is taken down or is not listed in the current catalog.",
          `proposal.items[${index}].ruleId`,
        ),
      );
    }
  }

  collectVersionAndAuthReasons(
    proposalVersion,
    bindingPolicyVersion,
    isPlainObject(proposal) && isNonEmptyString(proposal.implementationVersion)
      ? proposal.implementationVersion
      : undefined,
    context,
    binding.authorizationStatus,
    binding.expectedPolicyState,
    isSafeIntegerNumber(binding.nowMs) ? binding.nowMs : undefined,
    expectedVersions && isSafeIntegerNumber(expectedVersions.expiresAtMs)
      ? expectedVersions.expiresAtMs
      : undefined,
    binding.compatibilityRecord,
    reasons,
  );

  let conflict = false;
  if (
    taskBinding &&
    expectedVersions &&
    isNonEmptyString(expectedVersions.expectedExecutionClaim)
  ) {
    const live = collectLiveTaskReasons(
      context,
      taskBinding,
      expectedVersions.expectedExecutionClaim,
      isNonEmptyString(expectedVersions.expectedClaimToken)
        ? expectedVersions.expectedClaimToken
        : undefined,
      isSafeIntegerNumber(expectedVersions.expectedWriteEpoch)
        ? expectedVersions.expectedWriteEpoch
        : undefined,
      reasons,
    );
    conflict = live.conflict;
  }

  const proposalHash = isPlainObject(proposal) ? hashCanonicalJson(proposal) : "";
  if (approvedIdentity && proposalHash && approvedIdentity.proposalHash !== proposalHash) {
    reasons.push(
      activationReason(
        "unapproved_candidate",
        "The proposal does not match the approved candidate identity; a rewritten proposal is unapproved.",
        "binding.approvedCandidateIdentity.proposalHash",
      ),
    );
  }
  if (
    approvedIdentity &&
    approvedIdentity.validatorImplementationVersion !==
      (context.currentImplementationVersion ?? RUNTIME_RULE_ADAPTATION_IMPLEMENTATION_VERSION)
  ) {
    reasons.push(
      activationReason(
        "policy_version_mismatch",
        "validatorImplementationVersion is not the current implementation identity.",
        "binding.approvedCandidateIdentity.validatorImplementationVersion",
      ),
    );
  }

  let authorizationAssessment: AuthorizationAssessment | undefined;
  if (isPlainObject(proposal) && isPlainObject(binding) && identity) {
    const hostFacts: TrustedHostFacts = {
      ...(binding.fixture === true ? { fixture: true } : {}),
      identity,
      ...(isPlainObject(binding.currentEffectiveValues)
        ? { currentEffectiveValues: binding.currentEffectiveValues }
        : {}),
      ...(binding.authorizationStatus === "authorized" ||
      binding.authorizationStatus === "unauthorized"
        ? { authorizationStatus: binding.authorizationStatus }
        : {}),
      ...(isPlainObject(binding.compatibilityRecord)
        ? {
            compatibilityRecord:
              binding.compatibilityRecord as TrustedHostFacts["compatibilityRecord"],
          }
        : {}),
      ...(isNonEmptyString(binding.expectedPolicyState)
        ? {
            expectedPolicyState:
              binding.expectedPolicyState as TrustedHostFacts["expectedPolicyState"],
          }
        : {}),
    };
    const validation = validateRuntimeRuleProposal(proposal, hostFacts);
    authorizationAssessment = validation.authorizationAssessment;
    if (validation.resultKind === "candidate_validated") {
      reasons.push(
        activationReason(
          "candidate_cannot_activate",
          "candidate_validated cannot activate a policy.",
          "proposal",
        ),
      );
    } else if (validation.resultKind !== "shadow_accepted") {
      reasons.push(
        activationReason(
          "unapproved_candidate",
          "The proposal is not a current shadow_accepted policy_proposal.",
          "proposal",
        ),
      );
    }
    if (validation.activationAllowed) {
      reasons.push(
        activationReason(
          "structural_forbidden_field",
          "The validator must not report activationAllowed other than false.",
          "validator",
        ),
      );
    }
  }

  if (reasons.length > 0) {
    const onlyConflict =
      conflict &&
      reasons.every(
        (entry) =>
          entry.code === "write_epoch_conflict" || entry.code === "execution_claim_mismatch",
      );
    if (onlyConflict) {
      return {
        ok: false,
        resultKind: "conflict",
        reasons,
        authorizationAssessment,
        whitelistSource,
      };
    }
    return {
      ok: false,
      resultKind:
        conflict && reasons.some((entry) => entry.code === "write_epoch_conflict")
          ? "conflict"
          : "rejected",
      reasons,
      authorizationAssessment,
      whitelistSource,
    };
  }

  if (
    !identity ||
    !taskBinding ||
    !approvedIdentity ||
    !hostGate ||
    !permission ||
    !authorizedPermissions ||
    !bindingPolicyVersion ||
    !isNonEmptyString(binding.authorizationReference) ||
    !isSafeIntegerNumber(binding.nowMs) ||
    !expectedVersions ||
    !isNonEmptyString(expectedVersions.expectedExecutionClaim) ||
    !isSafeIntegerNumber(expectedVersions.expectedWriteEpoch) ||
    binding.authorizationStatus !== "authorized"
  ) {
    return {
      ok: false,
      resultKind: "rejected",
      reasons: reasons.length ? reasons : [missingBinding("binding")],
    };
  }

  const parsedBinding: RuntimeRuleAdaptationActivationBinding = {
    ...(binding.fixture === true ? { fixture: true } : {}),
    authorizationReference: binding.authorizationReference,
    identity,
    taskBinding,
    expectedVersions: {
      expectedWriteEpoch: expectedVersions.expectedWriteEpoch,
      expectedPolicyVersion: bindingPolicyVersion,
      expectedExecutionClaim: expectedVersions.expectedExecutionClaim,
      ...(isNonEmptyString(expectedVersions.expectedClaimToken)
        ? { expectedClaimToken: expectedVersions.expectedClaimToken }
        : {}),
      ...(isSafeIntegerNumber(expectedVersions.expiresAtMs)
        ? { expiresAtMs: expectedVersions.expiresAtMs }
        : {}),
    },
    approvedCandidateIdentity: approvedIdentity,
    hostActivationGate: hostGate,
    permission,
    authorizedPermissions,
    authorizationStatus: "authorized",
    ...(isNonEmptyString(binding.expectedPolicyState)
      ? {
          expectedPolicyState:
            binding.expectedPolicyState as RuntimeRuleAdaptationActivationBinding["expectedPolicyState"],
        }
      : {}),
    ...(isPlainObject(binding.currentEffectiveValues)
      ? { currentEffectiveValues: binding.currentEffectiveValues }
      : {}),
    ...(isPlainObject(binding.compatibilityRecord)
      ? {
          compatibilityRecord:
            binding.compatibilityRecord as RuntimeRuleAdaptationActivationBinding["compatibilityRecord"],
        }
      : {}),
    nowMs: binding.nowMs,
  };

  return {
    ok: true,
    reasons: [],
    binding: parsedBinding,
    whitelistSource,
    authorizationAssessment: authorizationAssessment ?? "host_authorized",
    proposalHash,
  };
}
export function precheckIdentityAndScope(
  identity: HostIdentity | undefined,
  taskBinding: RuntimeRuleAdaptationTaskBinding | undefined,
  context: ActivationPrecheckContext,
  expectedExecutionClaim: string | undefined,
  expectedClaimToken: string | undefined,
  expectedWriteEpoch: number | undefined,
  reasons: RuntimeRuleAdaptationActivationReason[],
): { conflict: boolean } {
  if (!identity || !taskBinding) {
    return { conflict: false };
  }
  if (identity.scope.type !== "personal") {
    reasons.push(
      activationReason(
        "collaboration_path_unwired",
        "This period only implements the personal SessionTaskBoard path. Collaboration remains fail-closed.",
        "binding.identity.scope.type",
      ),
    );
  }
  if (!expectedExecutionClaim) {
    return { conflict: false };
  }
  return collectLiveTaskReasons(
    context,
    taskBinding,
    expectedExecutionClaim,
    expectedClaimToken,
    expectedWriteEpoch,
    reasons,
  );
}

export function precheckRuntimeRuleRevoke(
  binding: unknown,
  context: ActivationPrecheckContext = {},
): {
  ok: boolean;
  resultKind: "rejected" | "conflict";
  reasons: RuntimeRuleAdaptationActivationReason[];
  parsed?: RuntimeRuleAdaptationRevokeBinding;
} {
  const reasons: RuntimeRuleAdaptationActivationReason[] = [];
  reasons.push(...asP1Reasons(collectInputShapeReasons(binding, undefined)));
  collectForbiddenActivationKeys(binding, "binding", reasons);
  if (!isPlainObject(binding)) {
    reasons.push(
      activationReason(
        "structural_non_plain_object",
        "The revoke binding must be a plain data object.",
        "binding",
      ),
    );
    return { ok: false, resultKind: "rejected", reasons };
  }
  collectUnknown(binding, "binding", REVOKE_BINDING_ROOT_KEYS, reasons);
  const identity = parseIdentity(binding.identity, "binding.identity", reasons);
  const taskBinding = parseTaskBinding(binding.taskBinding, "binding.taskBinding", reasons);
  if (!isNonEmptyString(binding.authorizationReference)) {
    reasons.push(missingBinding("binding.authorizationReference"));
  }
  if (!isSafeIntegerNumber(binding.expectedWriteEpoch)) {
    reasons.push(
      binding.expectedWriteEpoch === undefined
        ? missingBinding("binding.expectedWriteEpoch")
        : activationReason(
            "structural_invalid_type",
            "expectedWriteEpoch must be a safe integer.",
            "binding.expectedWriteEpoch",
          ),
    );
  }
  if (!isNonEmptyString(binding.expectedExecutionClaim)) {
    reasons.push(missingBinding("binding.expectedExecutionClaim"));
  }
  const hostGate = parseHostGate(binding.hostActivationGate, "binding.hostActivationGate", reasons);
  if (!isSafeIntegerNumber(binding.nowMs)) {
    reasons.push(
      binding.nowMs === undefined
        ? missingBinding("binding.nowMs")
        : activationReason(
            "structural_invalid_type",
            "nowMs must be a safe integer.",
            "binding.nowMs",
          ),
    );
  }
  if (
    !isNonEmptyString(binding.revokeReason) ||
    !(REVOKE_REASONS as readonly string[]).includes(binding.revokeReason)
  ) {
    reasons.push(
      binding.revokeReason === undefined
        ? missingBinding("binding.revokeReason")
        : activationReason(
            "structural_invalid_type",
            "revokeReason is not in the closed set.",
            "binding.revokeReason",
          ),
    );
  }
  const live = precheckIdentityAndScope(
    identity,
    taskBinding,
    context,
    isNonEmptyString(binding.expectedExecutionClaim) ? binding.expectedExecutionClaim : undefined,
    isNonEmptyString(binding.expectedClaimToken) ? binding.expectedClaimToken : undefined,
    isSafeIntegerNumber(binding.expectedWriteEpoch) ? binding.expectedWriteEpoch : undefined,
    reasons,
  );
  if (reasons.length > 0) {
    return {
      ok: false,
      resultKind: live.conflict ? "conflict" : "rejected",
      reasons,
    };
  }
  if (
    !identity ||
    !taskBinding ||
    !hostGate ||
    !isNonEmptyString(binding.authorizationReference) ||
    !isSafeIntegerNumber(binding.nowMs) ||
    !isSafeIntegerNumber(binding.expectedWriteEpoch) ||
    !isNonEmptyString(binding.expectedExecutionClaim) ||
    !isNonEmptyString(binding.revokeReason)
  ) {
    return { ok: false, resultKind: "rejected", reasons: [missingBinding("binding")] };
  }
  return {
    ok: true,
    resultKind: "rejected",
    reasons: [],
    parsed: {
      ...(binding.fixture === true ? { fixture: true } : {}),
      authorizationReference: binding.authorizationReference,
      identity,
      taskBinding,
      expectedWriteEpoch: binding.expectedWriteEpoch,
      expectedExecutionClaim: binding.expectedExecutionClaim,
      ...(isNonEmptyString(binding.expectedClaimToken)
        ? { expectedClaimToken: binding.expectedClaimToken }
        : {}),
      hostActivationGate: hostGate,
      nowMs: binding.nowMs,
      revokeReason: binding.revokeReason as RuntimeRuleAdaptationRevokeBinding["revokeReason"],
    },
  };
}

export function precheckRuntimeRuleRollback(
  binding: unknown,
  context: ActivationPrecheckContext = {},
): {
  ok: boolean;
  resultKind: "rejected" | "conflict";
  reasons: RuntimeRuleAdaptationActivationReason[];
  parsed?: RuntimeRuleAdaptationRollbackBinding;
  whitelistSource?: RuntimeRuleWhitelistSource;
} {
  const reasons: RuntimeRuleAdaptationActivationReason[] = [];
  reasons.push(...asP1Reasons(collectInputShapeReasons(binding, undefined)));
  collectForbiddenActivationKeys(binding, "binding", reasons);
  if (!isPlainObject(binding)) {
    reasons.push(
      activationReason(
        "structural_non_plain_object",
        "The rollback binding must be a plain data object.",
        "binding",
      ),
    );
    return { ok: false, resultKind: "rejected", reasons };
  }
  collectUnknown(binding, "binding", ROLLBACK_BINDING_ROOT_KEYS, reasons);
  const identity = parseIdentity(binding.identity, "binding.identity", reasons);
  const taskBinding = parseTaskBinding(binding.taskBinding, "binding.taskBinding", reasons);
  if (!isNonEmptyString(binding.authorizationReference)) {
    reasons.push(missingBinding("binding.authorizationReference"));
  }
  if (!isSafeIntegerNumber(binding.expectedWriteEpoch)) {
    reasons.push(
      binding.expectedWriteEpoch === undefined
        ? missingBinding("binding.expectedWriteEpoch")
        : activationReason(
            "structural_invalid_type",
            "expectedWriteEpoch must be a safe integer.",
            "binding.expectedWriteEpoch",
          ),
    );
  }
  if (!isSafeIntegerNumber(binding.targetWriteEpoch)) {
    reasons.push(
      binding.targetWriteEpoch === undefined
        ? missingBinding("binding.targetWriteEpoch")
        : activationReason(
            "structural_invalid_type",
            "targetWriteEpoch must be a safe integer.",
            "binding.targetWriteEpoch",
          ),
    );
  }
  if (!isNonEmptyString(binding.expectedExecutionClaim)) {
    reasons.push(missingBinding("binding.expectedExecutionClaim"));
  }
  const policyVersion = parseExpectedPolicyVersion(
    binding.expectedPolicyVersion,
    "binding.expectedPolicyVersion",
    reasons,
  );
  const hostGate = parseHostGate(binding.hostActivationGate, "binding.hostActivationGate", reasons);
  const permission = parseAction(binding.permission, "binding.permission", reasons);
  const authorizedPermissions = parseActionList(
    binding.authorizedPermissions,
    "binding.authorizedPermissions",
    reasons,
  );
  if (!isSafeIntegerNumber(binding.nowMs)) {
    reasons.push(
      binding.nowMs === undefined
        ? missingBinding("binding.nowMs")
        : activationReason(
            "structural_invalid_type",
            "nowMs must be a safe integer.",
            "binding.nowMs",
          ),
    );
  }
  if (permission === "delete") {
    reasons.push(
      activationReason(
        "permission_axis_mismatch",
        "delete is not a legal rollback permission axis.",
        "binding.permission",
      ),
    );
  }
  if (permission && authorizedPermissions && !authorizedPermissions.includes(permission)) {
    reasons.push(
      activationReason(
        "permission_axis_mismatch",
        "The requested permission axis is not present on the current authorization.",
        "binding.permission",
      ),
    );
  }
  collectVersionAndAuthReasons(
    policyVersion,
    policyVersion,
    undefined,
    context,
    binding.authorizationStatus,
    binding.expectedPolicyState,
    isSafeIntegerNumber(binding.nowMs) ? binding.nowMs : undefined,
    undefined,
    binding.compatibilityRecord,
    reasons,
  );
  const { source: whitelistSource } = resolveActivationWhitelist(
    binding.fixture === true,
    context.fixtureWhitelist,
  );
  const live = precheckIdentityAndScope(
    identity,
    taskBinding,
    context,
    isNonEmptyString(binding.expectedExecutionClaim) ? binding.expectedExecutionClaim : undefined,
    isNonEmptyString(binding.expectedClaimToken) ? binding.expectedClaimToken : undefined,
    isSafeIntegerNumber(binding.expectedWriteEpoch) ? binding.expectedWriteEpoch : undefined,
    reasons,
  );
  if (reasons.length > 0) {
    return {
      ok: false,
      resultKind: live.conflict ? "conflict" : "rejected",
      reasons,
      whitelistSource,
    };
  }
  if (
    !identity ||
    !taskBinding ||
    !hostGate ||
    !permission ||
    !authorizedPermissions ||
    !policyVersion ||
    !isNonEmptyString(binding.authorizationReference) ||
    !isSafeIntegerNumber(binding.nowMs) ||
    !isSafeIntegerNumber(binding.expectedWriteEpoch) ||
    !isSafeIntegerNumber(binding.targetWriteEpoch) ||
    !isNonEmptyString(binding.expectedExecutionClaim) ||
    binding.authorizationStatus !== "authorized"
  ) {
    return {
      ok: false,
      resultKind: "rejected",
      reasons: [missingBinding("binding")],
      whitelistSource,
    };
  }
  return {
    ok: true,
    resultKind: "rejected",
    reasons: [],
    whitelistSource,
    parsed: {
      ...(binding.fixture === true ? { fixture: true } : {}),
      authorizationReference: binding.authorizationReference,
      identity,
      taskBinding,
      expectedWriteEpoch: binding.expectedWriteEpoch,
      expectedExecutionClaim: binding.expectedExecutionClaim,
      ...(isNonEmptyString(binding.expectedClaimToken)
        ? { expectedClaimToken: binding.expectedClaimToken }
        : {}),
      expectedPolicyVersion: policyVersion,
      hostActivationGate: hostGate,
      permission,
      authorizedPermissions,
      authorizationStatus: "authorized",
      targetWriteEpoch: binding.targetWriteEpoch,
      nowMs: binding.nowMs,
      ...(isPlainObject(binding.currentEffectiveValues)
        ? { currentEffectiveValues: binding.currentEffectiveValues }
        : {}),
      ...(isPlainObject(binding.compatibilityRecord)
        ? {
            compatibilityRecord:
              binding.compatibilityRecord as RuntimeRuleAdaptationRollbackBinding["compatibilityRecord"],
          }
        : {}),
      ...(isNonEmptyString(binding.expectedPolicyState)
        ? {
            expectedPolicyState:
              binding.expectedPolicyState as RuntimeRuleAdaptationRollbackBinding["expectedPolicyState"],
          }
        : {}),
    },
  };
}

export function precheckRuntimeRuleRead(
  binding: unknown,
  context: ActivationPrecheckContext = {},
): {
  ok: boolean;
  reasons: RuntimeRuleAdaptationActivationReason[];
  parsed?: RuntimeRuleAdaptationReadBinding;
} {
  const reasons: RuntimeRuleAdaptationActivationReason[] = [];
  reasons.push(...asP1Reasons(collectInputShapeReasons(binding, undefined)));
  collectForbiddenActivationKeys(binding, "binding", reasons);
  if (!isPlainObject(binding)) {
    reasons.push(
      activationReason(
        "structural_non_plain_object",
        "The read binding must be a plain data object.",
        "binding",
      ),
    );
    return { ok: false, reasons };
  }
  collectUnknown(binding, "binding", READ_BINDING_ROOT_KEYS, reasons);
  const identity = parseIdentity(binding.identity, "binding.identity", reasons);
  const taskBinding = parseTaskBinding(binding.taskBinding, "binding.taskBinding", reasons);
  if (identity && identity.scope.type !== "personal") {
    reasons.push(
      activationReason(
        "collaboration_path_unwired",
        "This period only implements the personal SessionTaskBoard path.",
        "binding.identity.scope.type",
      ),
    );
  }
  if (taskBinding && context.liveBoard) {
    const boardScope = context.liveBoard.scope;
    if (
      !boardScope ||
      !isNonEmptyString(boardScope.tenantId) ||
      !isNonEmptyString(boardScope.userId) ||
      !isNonEmptyString(boardScope.sessionId)
    ) {
      reasons.push(
        activationReason(
          "incomplete_board_scope",
          "The live task board scope is missing or incomplete; isolation fails closed.",
          "liveBoard.scope",
        ),
      );
    } else if (!boardScopesEqual(taskBinding.boardScope, boardScope)) {
      reasons.push(
        activationReason(
          "identity_scope_mismatch",
          "The request boardScope does not match the live SessionTaskBoard scope.",
          "binding.taskBinding.boardScope",
        ),
      );
    }
  } else if (!context.liveBoard) {
    reasons.push(
      activationReason(
        "task_not_bound",
        "A live session task board is required to read an activated policy.",
        "context.liveBoard",
      ),
    );
  }
  if (reasons.length > 0 || !identity || !taskBinding) {
    return { ok: false, reasons };
  }
  return {
    ok: true,
    reasons: [],
    parsed: {
      ...(binding.fixture === true ? { fixture: true } : {}),
      identity,
      taskBinding,
    },
  };
}
