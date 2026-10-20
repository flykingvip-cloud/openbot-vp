/**
 * E5.1 control-plane consumption contract.
 *
 * wouldConsume is a shadow decision. It never Applies, installs, or pauses.
 * Surface autonomy comes from evaluateSurfaceAutonomy, not a caller boolean.
 * Live surfaces stay autoApply=false. e52SwitchAllowed stays false unless
 * every deny reason is zero and every contract check passed. E5.2 still
 * needs a separate approval before any direct mutator is replaced.
 */

import { createHash } from "node:crypto";
import { evaluateSurfaceAutonomy, type SurfaceAutonomyPolicy } from "./autonomy.js";
import { classifyGrantActivity, type AuthorityGrantView } from "./contracts.js";
import { getEvolutionSurface } from "./surfaces.js";
import {
  evolutionTargetKey,
  type EvolutionApplication,
  type EvolutionExperiment,
  type EvolutionProposal,
  type EvolutionProposalStatus,
  type EvolutionTarget,
} from "./types.js";

export const APPLICATION_CONSUMPTION_SCHEMA = 1 as const;

export const RUNTIME_CONSUMPTION_ACTIONS = ["pause", "resume", "limit", "clear_limit"] as const;
export type RuntimeConsumptionAction = (typeof RUNTIME_CONSUMPTION_ACTIONS)[number];

export const CONSUMPTION_DENY_REASONS = [
  "missing_proposal",
  "missing_experiment",
  "missing_application",
  "binding_mismatch",
  "application_not_approved",
  "surface_mismatch",
  "adapter_mismatch",
  "target_mismatch",
  "tenant_mismatch",
  "cross_tenant",
  "action_mismatch",
  "candidate_mismatch",
  "grant_missing",
  "grant_expired",
  "grant_revoked",
  "kill_switch",
  "mode_not_auto",
  "assist_zero_mutation",
  "grant_action_forbidden",
  "proposal_expired",
  "experiment_expired",
  "autonomy_not_approved",
  "rollback_missing",
  "duplicate_consumption",
] as const;
export type ConsumptionDenyReason = (typeof CONSUMPTION_DENY_REASONS)[number];

export type ConsumptionOutcome = "would_consume" | "denied" | "idempotent_replay";

const APPLICATION_GATE_STATUSES = new Set<EvolutionProposalStatus>([
  "APPROVED_FOR_APPLICATION",
  "CANARY",
  "ACTIVE",
  "VERIFIED",
]);

export type RuntimeConsumptionIntent = {
  kind: "runtime-action";
  surfaceId: "system.runtime-binding-governance";
  adapterId: "runtime-governance";
  runtimeAgentId: string;
  action: RuntimeConsumptionAction;
  approvedAction: string;
  candidateVersion: string;
  tenantScope: string | null;
};

export type SkillConsumptionIntent = {
  kind: "skill-install";
  surfaceId: "capability.skill-installation";
  adapterId: "skill-installation";
  agentId: string;
  skillId: string;
  version: string;
  approvedAction: string;
  candidateVersion: string;
  autoInstallIntent: boolean;
  approvalAuditRef: string;
  tenantScope: string | null;
};

export type ConsumptionIntent = RuntimeConsumptionIntent | SkillConsumptionIntent;

export type PriorConsumption = {
  applicationId: string;
  idempotencyKey: string;
  consumedAt: string;
};

/** Candidate Store row. payloadHash is recomputed from payload and must match. */
export type StoredConsumptionCandidate = {
  candidateRef: string;
  version: string;
  payloadHash: string;
  payload: unknown;
};

export type ConsumptionContractChecks = {
  grantActions: boolean;
  expiry: boolean;
  candidateStore: boolean;
  surfacePolicy: boolean;
};

export const CONSUMPTION_CHECKS_NONE: ConsumptionContractChecks = {
  grantActions: false,
  expiry: false,
  candidateStore: false,
  surfacePolicy: false,
};

export function hashConsumptionCandidatePayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export type ControlPlaneConsumptionBinding = {
  proposal: EvolutionProposal | null;
  experiment: EvolutionExperiment | null;
  application: EvolutionApplication | null;
  grant: AuthorityGrantView | null;
  /** Candidate Store record for proposal.candidateRef. Null when the store has no row. */
  storedCandidate: StoredConsumptionCandidate | null;
  trustedTenantId: string | null;
  mode: "off" | "assist" | "auto";
  killSwitch: boolean;
  /** Evaluation clock. Missing or unparseable clocks fail closed as expired. */
  now: string;
  /** Real surface autonomy policy. A caller boolean cannot replace this. */
  autonomyPolicy?: SurfaceAutonomyPolicy;
  rollbackAvailable: boolean;
  idempotencyKey: string;
  priorConsumption: PriorConsumption | null;
  intent: ConsumptionIntent;
};

export type ControlPlaneApplicationConsumption = {
  schemaVersion: typeof APPLICATION_CONSUMPTION_SCHEMA;
  applicationId: string;
  proposalId: string;
  experimentId: string;
  surfaceId: string;
  target: EvolutionTarget;
  tenantScope: string | null;
  adapterId: string;
  scope: EvolutionApplication["scope"] | "shadow";
  candidateVersion: string;
  approvedAction: string;
  rollbackRef: string;
  grantId: string;
  idempotencyKey: string;
  consumedAt: string | null;
  outcome: ConsumptionOutcome;
  wouldConsume: boolean;
  denyReason: ConsumptionDenyReason | null;
  /** Which E5.2 allowance checks actually passed. A denial leaves the failed check false. */
  contractChecks: ConsumptionContractChecks;
  /** E5.1 never executes a consumer. Writers must leave this false. */
  executedConsumer: boolean;
};

export type ConsumptionObservation = ControlPlaneApplicationConsumption & {
  recordedAt: string;
  directIntentPresent: boolean;
};

export type CutoverReadinessReport = {
  matchedApplications: number;
  orphanDirectMutations: number;
  targetMismatch: number;
  tenantMismatch: number;
  missingGrant: number;
  missingRollback: number;
  duplicateConsumption: number;
  crossTenantEvents: number;
  actionMismatch: number;
  killSwitchDrillPassed: boolean;
  rollbackDrillPassed: boolean;
  idempotentReplayPassed: boolean;
  assistZeroMutation: boolean;
  alignmentComplete: boolean;
  /** Every deny reason, including candidate, binding, and surface failures. */
  denyCounts: Record<ConsumptionDenyReason, number>;
  unresolvedDenials: number;
  /** False when a latched or live store fault is present. Restart does not clear it. */
  observationStoreHealthy: boolean;
  corruptionCount: number;
  unsupportedSchemaCount: number;
  truncated: boolean;
  /** True when a shadow read or write did not land. */
  persistenceFailure: boolean;
  shadowObservationWindow: {
    startedAt: string | null;
    endedAt: string | null;
    sampleCount: number;
  };
  cutoverReady: boolean;
  /** E5.2 stays false while direct mutators still exist. */
  e52SwitchAllowed: boolean;
};

export type ShadowStoreHealth = {
  observationStoreHealthy: boolean;
  corruptionCount: number;
  unsupportedSchemaCount: number;
  truncated: boolean;
  persistenceFailure: boolean;
};

export const HEALTHY_SHADOW_STORE: ShadowStoreHealth = {
  observationStoreHealthy: true,
  corruptionCount: 0,
  unsupportedSchemaCount: 0,
  truncated: false,
  persistenceFailure: false,
};

function intentTarget(intent: ConsumptionIntent): EvolutionTarget {
  if (intent.kind === "runtime-action") {
    return { domain: "system", componentId: intent.runtimeAgentId };
  }
  return { domain: "capability", skillId: intent.skillId };
}

function emptyRecord(
  binding: ControlPlaneConsumptionBinding,
  outcome: ConsumptionOutcome,
  denyReason: ConsumptionDenyReason | null,
  consumedAt: string | null,
  contractChecks: ConsumptionContractChecks = CONSUMPTION_CHECKS_NONE,
): ControlPlaneApplicationConsumption {
  const application = binding.application;
  const proposal = binding.proposal;
  const experiment = binding.experiment;
  return {
    schemaVersion: APPLICATION_CONSUMPTION_SCHEMA,
    applicationId: application?.applicationId ?? "",
    proposalId: proposal?.proposalId ?? application?.proposalId ?? "",
    experimentId: experiment?.experimentId ?? application?.experimentId ?? "",
    surfaceId: binding.intent.surfaceId,
    target: intentTarget(binding.intent),
    tenantScope: binding.intent.tenantScope,
    adapterId: binding.intent.adapterId,
    scope: application?.scope ?? "shadow",
    candidateVersion: binding.intent.candidateVersion,
    approvedAction: binding.intent.approvedAction,
    rollbackRef: application?.rollbackRef ?? "",
    grantId: binding.grant?.grantId ?? proposal?.grantId ?? "",
    idempotencyKey: binding.idempotencyKey,
    consumedAt,
    outcome,
    wouldConsume: outcome !== "denied",
    denyReason,
    contractChecks,
    executedConsumer: false,
  };
}

function deny(
  binding: ControlPlaneConsumptionBinding,
  reason: ConsumptionDenyReason,
  contractChecks: ConsumptionContractChecks = CONSUMPTION_CHECKS_NONE,
): ControlPlaneApplicationConsumption {
  return emptyRecord(binding, "denied", reason, null, contractChecks);
}

const CHECKS_BEFORE_POLICY: ConsumptionContractChecks = {
  grantActions: true,
  expiry: true,
  candidateStore: true,
  surfacePolicy: false,
};

function instant(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isExpired(now: string, expiresAt: string): boolean {
  const nowMs = instant(now);
  const expiresMs = instant(expiresAt);
  if (nowMs == null || expiresMs == null) {
    return true;
  }
  return nowMs >= expiresMs;
}

function requestedAction(intent: ConsumptionIntent): string {
  return intent.kind === "runtime-action" ? intent.action : "install";
}

function recordField(payload: unknown, key: string): unknown {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  return (payload as Record<string, unknown>)[key];
}

function storedCandidateMatches(binding: ControlPlaneConsumptionBinding): boolean {
  const stored = binding.storedCandidate;
  const proposal = binding.proposal;
  const experiment = binding.experiment;
  const intent = binding.intent;
  if (!stored || !proposal || !experiment) {
    return false;
  }
  if (stored.candidateRef !== proposal.candidateRef) {
    return false;
  }
  if (
    stored.version !== experiment.candidateRef ||
    stored.version !== experiment.frozen.candidateVersion
  ) {
    return false;
  }
  if (stored.payloadHash !== hashConsumptionCandidatePayload(stored.payload)) {
    return false;
  }
  if (intent.kind === "runtime-action") {
    return (
      recordField(stored.payload, "action") === intent.action &&
      recordField(stored.payload, "runtimeAgentId") === intent.runtimeAgentId &&
      recordField(stored.payload, "candidateVersion") === intent.candidateVersion
    );
  }
  return (
    recordField(stored.payload, "skillId") === intent.skillId &&
    recordField(stored.payload, "agentId") === intent.agentId &&
    recordField(stored.payload, "version") === intent.version &&
    recordField(stored.payload, "candidateVersion") === intent.candidateVersion &&
    recordField(stored.payload, "operation") === "install" &&
    recordField(stored.payload, "autoInstallIntent") === true &&
    recordField(stored.payload, "approvalAuditRef") === intent.approvalAuditRef
  );
}

function sameTarget(left: EvolutionTarget, right: EvolutionTarget): boolean {
  return evolutionTargetKey(left) === evolutionTargetKey(right);
}

function candidateMatches(binding: ControlPlaneConsumptionBinding): boolean {
  const intent = binding.intent;
  const experiment = binding.experiment;
  const application = binding.application;
  if (!experiment || !application) {
    return false;
  }
  if (intent.candidateVersion !== experiment.frozen.candidateVersion) {
    return false;
  }
  if (intent.candidateVersion !== application.targetVersionAfter) {
    return false;
  }
  if (intent.kind === "skill-install") {
    return (
      intent.autoInstallIntent &&
      intent.approvalAuditRef.trim() !== "" &&
      intent.version === intent.candidateVersion &&
      intent.agentId.trim() !== "" &&
      intent.skillId.trim() !== ""
    );
  }
  return true;
}

function actionMatches(intent: ConsumptionIntent): boolean {
  if (intent.kind === "runtime-action") {
    return intent.approvedAction === intent.action;
  }
  return intent.approvedAction === "install";
}

/**
 * Decide whether a historical auto intent would consume one control-plane
 * Application. Returning wouldConsume=true does not execute anything.
 */
export function evaluateControlPlaneApplicationConsumption(
  binding: ControlPlaneConsumptionBinding,
): ControlPlaneApplicationConsumption {
  const { proposal, experiment, application, grant, intent } = binding;
  if (!proposal && !experiment && !application) {
    return deny(binding, "missing_application");
  }
  if (!proposal) {
    return deny(binding, "missing_proposal");
  }
  if (!experiment) {
    return deny(binding, "missing_experiment");
  }
  if (!application) {
    return deny(binding, "missing_application");
  }
  const bound =
    experiment.proposalId === proposal.proposalId &&
    application.proposalId === proposal.proposalId &&
    application.experimentId === experiment.experimentId &&
    (proposal.experimentId == null || proposal.experimentId === experiment.experimentId) &&
    (proposal.applicationId == null || proposal.applicationId === application.applicationId);
  if (!bound) {
    return deny(binding, "binding_mismatch");
  }
  if (
    !APPLICATION_GATE_STATUSES.has(proposal.status) ||
    application.status === "failed" ||
    application.status === "rolled_back"
  ) {
    return deny(binding, "application_not_approved");
  }
  const surface = getEvolutionSurface(intent.surfaceId);
  if (
    !surface ||
    proposal.surfaceId !== intent.surfaceId ||
    experiment.surfaceId !== intent.surfaceId
  ) {
    return deny(binding, "surface_mismatch");
  }
  if (application.adapterId !== surface.adapterId || intent.adapterId !== surface.adapterId) {
    return deny(binding, "adapter_mismatch");
  }
  const target = intentTarget(intent);
  if (
    !sameTarget(proposal.target, target) ||
    !sameTarget(experiment.target, target) ||
    (intent.kind === "runtime-action" && intent.runtimeAgentId.trim() === "") ||
    (intent.kind === "skill-install" && intent.skillId.trim() === "")
  ) {
    return deny(binding, "target_mismatch");
  }
  if (
    binding.trustedTenantId !== intent.tenantScope ||
    binding.trustedTenantId !== proposal.tenantScope
  ) {
    return deny(binding, "cross_tenant");
  }
  if (
    experiment.tenantScope !== proposal.tenantScope ||
    intent.tenantScope !== proposal.tenantScope ||
    (grant != null && grant.tenantScope !== proposal.tenantScope)
  ) {
    return deny(binding, "tenant_mismatch");
  }
  if (!actionMatches(intent)) {
    return deny(binding, "action_mismatch");
  }
  if (!candidateMatches(binding)) {
    return deny(binding, "candidate_mismatch");
  }
  if (!grant || !grant.grantId.trim() || grant.grantId !== proposal.grantId) {
    return deny(binding, "grant_missing");
  }
  if (grant.expired || grant.status === "EXPIRED") {
    return deny(binding, "grant_expired");
  }
  if (grant.revoked || grant.status === "REVOKED") {
    return deny(binding, "grant_revoked");
  }
  const grantActivity = classifyGrantActivity(grant);
  if (!grantActivity.active) {
    return deny(binding, "grant_missing");
  }
  if (binding.killSwitch) {
    return deny(binding, "kill_switch");
  }
  if (binding.mode === "assist") {
    return deny(binding, "assist_zero_mutation");
  }
  if (binding.mode !== "auto") {
    return deny(binding, "mode_not_auto");
  }
  if (!grant.allowedActions.includes(requestedAction(intent))) {
    return deny(binding, "grant_action_forbidden");
  }
  const grantActionsChecked: ConsumptionContractChecks = {
    ...CONSUMPTION_CHECKS_NONE,
    grantActions: true,
  };
  if (
    isExpired(binding.now, proposal.expiresAt) ||
    isExpired(binding.now, experiment.expiresAt) ||
    isExpired(binding.now, experiment.frozen.expiresAt)
  ) {
    const reason = isExpired(binding.now, proposal.expiresAt)
      ? "proposal_expired"
      : "experiment_expired";
    return deny(binding, reason, grantActionsChecked);
  }
  const expiryChecked: ConsumptionContractChecks = { ...grantActionsChecked, expiry: true };
  if (!storedCandidateMatches(binding)) {
    return deny(binding, "candidate_mismatch", expiryChecked);
  }
  const rollbackRef = application.rollbackRef.trim();
  if (!binding.rollbackAvailable || rollbackRef === "") {
    return deny(binding, "rollback_missing", CHECKS_BEFORE_POLICY);
  }
  const key = binding.idempotencyKey.trim();
  if (!key || key !== application.idempotencyKey) {
    return deny(binding, "binding_mismatch", CHECKS_BEFORE_POLICY);
  }
  const prior = binding.priorConsumption;
  if (prior && prior.applicationId === application.applicationId && prior.idempotencyKey !== key) {
    return deny(binding, "duplicate_consumption", CHECKS_BEFORE_POLICY);
  }
  const autonomy = evaluateSurfaceAutonomy({
    surface,
    ...(binding.autonomyPolicy ? { policy: binding.autonomyPolicy } : {}),
    killSwitch: binding.killSwitch,
    now: binding.now,
    requestedScope: application.scope,
    expandScope: false,
  });
  if (!autonomy.ok) {
    return deny(binding, "autonomy_not_approved", CHECKS_BEFORE_POLICY);
  }
  const checked: ConsumptionContractChecks = { ...CHECKS_BEFORE_POLICY, surfacePolicy: true };
  if (
    (prior && prior.applicationId === application.applicationId && prior.idempotencyKey === key) ||
    application.status === "applied"
  ) {
    return emptyRecord(
      binding,
      "idempotent_replay",
      null,
      prior?.consumedAt ?? application.appliedAt ?? null,
      checked,
    );
  }
  return emptyRecord(binding, "would_consume", null, null, checked);
}

export function evaluateCutoverReadiness(input: {
  observations: readonly ConsumptionObservation[];
  killSwitchDrillPassed: boolean;
  rollbackDrillPassed: boolean;
  idempotentReplayPassed: boolean;
  assistZeroMutation: boolean;
  store?: ShadowStoreHealth;
  /** Live readers pass false. E5.2 cannot flip this while direct mutators remain. */
  directMutatorsRetired?: boolean;
}): CutoverReadinessReport {
  const observations = input.observations;
  const denyCounts = Object.fromEntries(
    CONSUMPTION_DENY_REASONS.map((reason) => [reason, 0]),
  ) as Record<ConsumptionDenyReason, number>;
  for (const row of observations) {
    if (row.denyReason) {
      denyCounts[row.denyReason] += 1;
    }
  }
  const count = (reason: ConsumptionDenyReason) => denyCounts[reason];
  const unresolvedDenials = CONSUMPTION_DENY_REASONS.reduce(
    (sum, reason) => sum + denyCounts[reason],
    0,
  );
  const targetMismatch = count("target_mismatch");
  const tenantMismatch = count("tenant_mismatch");
  const missingGrant = count("grant_missing") + count("grant_expired") + count("grant_revoked");
  const missingRollback = count("rollback_missing");
  const duplicateConsumption = count("duplicate_consumption");
  const crossTenantEvents = count("cross_tenant");
  const actionMismatch = count("action_mismatch");
  const orphanDirectMutations = observations.filter(
    (row) => row.directIntentPresent && row.denyReason === "missing_application",
  ).length;
  const matchedApplications = observations.filter((row) => row.wouldConsume).length;
  const times = observations
    .map((row) => row.recordedAt)
    .filter((value): value is string => typeof value === "string" && value.trim() !== "");
  const startedAt =
    times.length > 0 ? times.reduce((min, value) => (value < min ? value : min)) : null;
  const endedAt =
    times.length > 0 ? times.reduce((max, value) => (value > max ? value : max)) : null;
  const sampleCount = observations.length;
  const alignmentComplete =
    sampleCount > 0 && targetMismatch === 0 && tenantMismatch === 0 && actionMismatch === 0;
  const windowClean =
    sampleCount > 0 &&
    startedAt != null &&
    endedAt != null &&
    startedAt <= endedAt &&
    orphanDirectMutations === 0;
  const assistZeroMutation =
    input.assistZeroMutation && observations.every((row) => !row.executedConsumer);
  const contractChecksPassed = observations.every((row) => {
    const checks = row.contractChecks;
    return (
      checks?.grantActions === true &&
      checks.expiry === true &&
      checks.candidateStore === true &&
      checks.surfacePolicy === true
    );
  });
  const store = input.store ?? HEALTHY_SHADOW_STORE;
  const storeHealthy =
    store.observationStoreHealthy &&
    store.corruptionCount === 0 &&
    store.unsupportedSchemaCount === 0 &&
    !store.truncated &&
    !store.persistenceFailure;
  const cutoverReady =
    windowClean &&
    alignmentComplete &&
    unresolvedDenials === 0 &&
    contractChecksPassed &&
    matchedApplications > 0 &&
    storeHealthy &&
    input.killSwitchDrillPassed &&
    input.rollbackDrillPassed &&
    input.idempotentReplayPassed &&
    assistZeroMutation;
  return {
    matchedApplications,
    orphanDirectMutations,
    targetMismatch,
    tenantMismatch,
    missingGrant,
    missingRollback,
    duplicateConsumption,
    crossTenantEvents,
    actionMismatch,
    killSwitchDrillPassed: input.killSwitchDrillPassed,
    rollbackDrillPassed: input.rollbackDrillPassed,
    idempotentReplayPassed: input.idempotentReplayPassed,
    assistZeroMutation,
    alignmentComplete,
    denyCounts,
    unresolvedDenials,
    observationStoreHealthy: storeHealthy,
    corruptionCount: store.corruptionCount,
    unsupportedSchemaCount: store.unsupportedSchemaCount,
    truncated: store.truncated,
    persistenceFailure: store.persistenceFailure,
    shadowObservationWindow: { startedAt, endedAt, sampleCount },
    cutoverReady,
    e52SwitchAllowed: cutoverReady && input.directMutatorsRetired === true,
  };
}

export function drillKillSwitchDenial(binding: ControlPlaneConsumptionBinding): {
  passed: boolean;
  denyReason: ConsumptionDenyReason | null;
} {
  const decision = evaluateControlPlaneApplicationConsumption({ ...binding, killSwitch: true });
  return {
    passed: decision.wouldConsume === false && decision.denyReason === "kill_switch",
    denyReason: decision.denyReason,
  };
}

export function drillMissingRollbackDenial(binding: ControlPlaneConsumptionBinding): {
  passed: boolean;
  denyReason: ConsumptionDenyReason | null;
} {
  const decision = evaluateControlPlaneApplicationConsumption({
    ...binding,
    rollbackAvailable: false,
  });
  return {
    passed: decision.wouldConsume === false && decision.denyReason === "rollback_missing",
    denyReason: decision.denyReason,
  };
}
