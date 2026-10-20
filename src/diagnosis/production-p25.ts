/**
 * Phase 25 — isolated internal single-tenant governed remediation canary.
 * Consumes a recorded P24.8 remediation enablement. Preview, execute, and
 * verification run only inside this process with an allowlisted dry-run
 * executor. The production live executor stays undeployed. Does not bind Doctor --fix.
 * Does not bind Channel restart, Skill disable, or configuration writes.
 * P26 stays closed. Approval never auto-enables a live apply path.
 */
import { createDiagnosisDelegationMachine } from "./delegation.js";
import type { DelegationActor, DelegationCommandInput } from "./delegation.js";
import {
  createDelegationEvolutionInspector,
  createDiagnosisEvolutionProposalMachine,
} from "./evolution-proposal.js";
import { DIAGNOSIS_ADMISSION_TENANT } from "./production-admission.js";
import type { DiagnosisIndependentApprovalInput } from "./production-approval-freeze.js";
import {
  DIAGNOSIS_CANARY_POLICY,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
  isProductionRemediationLiveExecutorUndeployed,
} from "./production-cutover.js";
import { nextEnablementStep } from "./production-enablement-sequence.js";
import {
  DIAGNOSIS_P24_8_FROZEN_CANDIDATE_SHA,
  DIAGNOSIS_P24_8_FROZEN_LIVE_SHA,
  assertDiagnosisProductionP24_8Ready,
  evaluateDiagnosisProductionP24_8,
  type DiagnosisP24_8HumanEnablementClaim,
  type DiagnosisProductionP24_8Report,
} from "./production-p24.8.js";
import {
  BLOCKED_RUNTIME_ACTIONS,
  PRODUCTION_ACTIONS,
  createDiagnosisRemediationMachine,
  createDryRunRemediationExecutor,
  createEvolutionProposalInspector,
  type RemediationActionType,
  type RemediationExecutor,
  type RemediationMetricReader,
} from "./remediation.js";
import { DiagnosisContractError, isDiagnosisContractError } from "./types.js";
import type { DiagnosticPrincipal, DiagnosticTarget, TrustedTenantContext } from "./types.js";

export const DIAGNOSIS_PRODUCTION_P25_INCREMENT = "P25" as const;
export const DIAGNOSIS_PRODUCTION_P25_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_P25_SIGNATURE_KIND = "human_isolated_remediation_canary_record" as const;
export const DIAGNOSIS_P25_TENANT = DIAGNOSIS_ADMISSION_TENANT;
export const DIAGNOSIS_P25_SAMPLE_SCOPE = "isolated_internal_governed_remediation_canary" as const;
export const DIAGNOSIS_P25_FROZEN_CANDIDATE_SHA = DIAGNOSIS_P24_8_FROZEN_CANDIDATE_SHA;
export const DIAGNOSIS_P25_FROZEN_LIVE_SHA = DIAGNOSIS_P24_8_FROZEN_LIVE_SHA;

export type DiagnosisP25Probe = {
  name: string;
  passed: boolean;
  detail: string;
};

export type DiagnosisP25CanaryResult = {
  tenant: typeof DIAGNOSIS_P25_TENANT;
  membershipOnly: true;
  isolatedAllowlisted: true;
  isolatedDryRunOnly: true;
  productionLiveExecutorUndeployed: true;
  doctorFixBound: false;
  channelRestartBound: false;
  skillDisableBound: false;
  configurationWriteBound: false;
  appliedToRuntime: false;
  productionCanaryStarted: false;
  probes: DiagnosisP25Probe[];
  probesPassed: boolean;
  highRiskRequiresApproval: boolean;
  previewExecuteVerifyHeld: boolean;
  baselineObservationRollbackHeld: boolean;
  blockedRuntimeActionsHeld: boolean;
  failureKeepsAppliedFalse: boolean;
  rollbackDrilled: true;
};

export type DiagnosisP25Rollback = {
  disableRemediationGate: true;
  stopNewTasks: true;
  revokeExecutorAllowlist: true;
  keepExecutionAuditAndVerification: true;
  historyDeleted: false;
};

export type DiagnosisP25HumanCanaryClaim = {
  kind: typeof DIAGNOSIS_P25_SIGNATURE_KIND;
  increment: typeof DIAGNOSIS_PRODUCTION_P25_INCREMENT;
  schemaVersion: 1;
  candidateSha: string;
  liveSha: string;
  approvalStartsIsolatedCanary: true;
  acceptsClientParam: false;
  acceptsModelOutput: false;
  confirmHuman: true;
  confirmIsolatedAllowlistedDryRunOnly: true;
  confirmLiveExecutorUndeployed: true;
  confirmNoDoctorFix: true;
  confirmNoChannelRestart: true;
  confirmP26NotStarted: true;
  confirmCanaryTenant: typeof DIAGNOSIS_P25_TENANT;
  signer: string;
};

export type DiagnosisProductionP25Report = {
  increment: typeof DIAGNOSIS_PRODUCTION_P25_INCREMENT;
  schemaVersion: 1;
  rehearsalOnly: true;
  isolatedCanaryReady: boolean;
  humanCanaryRecorded: boolean;
  identityAligned: boolean;
  candidateSha: string;
  originMainSha: string;
  liveSha: string | null;
  frozenCandidateSha: typeof DIAGNOSIS_P25_FROZEN_CANDIDATE_SHA;
  frozenLiveSha: typeof DIAGNOSIS_P25_FROZEN_LIVE_SHA;
  exactIdentityMatch: boolean;
  p24_8Ready: boolean;
  p24_8: DiagnosisProductionP24_8Report;
  canary: DiagnosisP25CanaryResult;
  liveExecutorUndeployed: true;
  nextStep: null;
  canaryTenant: typeof DIAGNOSIS_P25_TENANT;
  canaryStarted: boolean;
  productionCanaryStarted: false;
  trafficSwitched: false;
  approvedForProductionCutover: false;
  p25Started: true;
  p26ProductionReady: false;
  rollback: DiagnosisP25Rollback;
  recordedAt: string;
  note: string;
};

function fail(code: string, message: string, path = ""): never {
  throw new DiagnosisContractError(code, message, path);
}

function normalizeSha(value: string | null | undefined): string | null {
  const sha = value?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

function codeOf(err: unknown): string {
  return isDiagnosisContractError(err) ? err.code : "unknown";
}

export function resolveIsolatedP25RemediationExecutor(
  input: { allowlisted?: boolean } = {},
): RemediationExecutor {
  if (!input.allowlisted) {
    fail(
      "remediation_executor_not_allowlisted",
      "P25 isolated executor requires an explicit allowlist",
      "executor",
    );
  }
  return createDryRunRemediationExecutor();
}

export function assertP25CanarySource(claim: {
  kind?: string;
  clientParam?: unknown;
  modelOutput?: unknown;
}): void {
  if (claim.clientParam !== undefined) {
    fail("client_param_enablement_forbidden", "client parameters are not P25 approval", "claim");
  }
  if (claim.modelOutput !== undefined) {
    fail("model_output_enablement_forbidden", "model output is not P25 approval", "claim");
  }
  if (claim.kind !== undefined && claim.kind !== DIAGNOSIS_P25_SIGNATURE_KIND) {
    fail("unknown_enablement_source", `unsupported P25 source ${claim.kind}`);
  }
}

function principal(id: string, tenantId: string | null): DiagnosticPrincipal {
  return { schemaVersion: 1, principalId: id, kind: "user", tenantId };
}

function canaryTarget(): DiagnosticTarget {
  return {
    schemaVersion: 1,
    targetType: "session",
    targetId: "session-p25",
    tenantId: DIAGNOSIS_P25_TENANT,
    authority: "session_store",
    scope: { sessionKeyHash: "sha256:session-p25" },
  };
}

function metricReader(baseline: number, observed: number): RemediationMetricReader {
  let reads = 0;
  return {
    read() {
      reads += 1;
      return {
        value: reads === 1 ? baseline : observed,
        evidenceRefs: ["ev-p25-metric"],
      };
    },
  };
}

function failingExecutor(): RemediationExecutor {
  return {
    ...createDryRunRemediationExecutor(),
    execute: () => ({ ok: false, reason: "failed", evidence: ["executor_failed"] }),
  };
}

function buildAuthorizedRemediation(executor: RemediationExecutor, observed = 4) {
  const tenant = DIAGNOSIS_P25_TENANT;
  const trustedTenant: TrustedTenantContext = { tenantId: tenant };
  const trustedPlatform: TrustedTenantContext = { tenantId: null };
  const platform: DelegationActor = {
    role: "platform",
    principal: principal("plat-admin", null),
  };
  const enterprise: DelegationActor = {
    role: "enterprise",
    principal: principal("ent-admin", tenant),
  };
  const employee: DelegationActor = {
    role: "employee",
    principal: principal("user-a", tenant),
  };
  const actions: RemediationActionType[] = [
    "read_only_check",
    "safe_reversible",
    "configuration_change",
    ...BLOCKED_RUNTIME_ACTIONS,
    "batch_change",
  ];
  const request = (
    over: Partial<DelegationCommandInput> &
      Pick<DelegationCommandInput, "commandId" | "actor" | "trusted">,
  ) => ({
    command: "request" as const,
    expiresAt: "2026-09-06T12:00:00.000Z",
    targetTenant: tenant,
    allowedEvidence: ["ev-p25"],
    allowedActions: ["diagnose", "suggest", ...actions],
    ...over,
  });
  const grants = createDiagnosisDelegationMachine({
    now: () => Date.parse("2026-09-06T08:00:00.000Z"),
  });
  const enterpriseGrant = grants.dispatch(
    request({
      commandId: "p25-ent-grant",
      actor: platform,
      trusted: trustedPlatform,
      scenario: "platform_to_enterprise",
      approver: enterprise,
      grantee: enterprise,
    }),
  );
  grants.dispatch({
    commandId: "p25-ent-ok",
    command: "approve",
    actor: enterprise,
    trusted: trustedTenant,
    grantId: enterpriseGrant.grantId,
  });
  const employeeGrant = grants.dispatch(
    request({
      commandId: "p25-emp-grant",
      actor: enterprise,
      trusted: trustedTenant,
      scenario: "enterprise_to_employee",
      approver: employee,
      grantee: employee,
      targetPrincipal: "user-a",
    }),
  );
  grants.dispatch({
    commandId: "p25-emp-ok",
    command: "approve",
    actor: employee,
    trusted: trustedTenant,
    grantId: employeeGrant.grantId,
  });
  const grantInspector = createDelegationEvolutionInspector(grants);
  const proposals = createDiagnosisEvolutionProposalMachine({
    now: () => Date.parse("2026-09-06T08:05:00.000Z"),
    grantInspector,
  });
  const suggested = proposals.dispatch({
    commandId: "p25-p8",
    command: "suggest",
    actor: enterprise,
    trusted: trustedTenant,
    grantId: enterpriseGrant.grantId,
    sourceCaseId: "case-p25",
    targetDomain: "skill",
    proposedChange: { summary: "isolated P25 candidate only" },
  });
  proposals.dispatch({
    commandId: "p25-p8-sub",
    command: "submit",
    actor: enterprise,
    trusted: trustedTenant,
    proposalId: suggested.proposalId,
  });
  proposals.dispatch({
    commandId: "p25-p8-apr",
    command: "approve",
    actor: enterprise,
    trusted: trustedTenant,
    proposalId: suggested.proposalId,
  });
  const remediations = createDiagnosisRemediationMachine({
    now: () => Date.parse("2026-09-06T08:10:00.000Z"),
    grantInspector,
    proposalInspector: createEvolutionProposalInspector(proposals),
    executor,
    metricReader: metricReader(10, observed),
  });
  return {
    remediations,
    enterprise,
    trustedTenant,
    enterpriseGrantId: enterpriseGrant.grantId!,
    sourceProposalId: suggested.proposalId,
  };
}

function probe(name: string, passed: boolean, detail: string): DiagnosisP25Probe {
  return { name, passed, detail };
}

export function runDiagnosisP25IsolatedCanary(): DiagnosisP25CanaryResult {
  const probes: DiagnosisP25Probe[] = [];
  try {
    resolveIsolatedP25RemediationExecutor();
    probes.push(probe("allowlisted_executor_only", false, "missing allowlist was accepted"));
  } catch (err) {
    probes.push(
      probe(
        "allowlisted_executor_only",
        codeOf(err) === "remediation_executor_not_allowlisted",
        codeOf(err),
      ),
    );
  }
  const liveUndeployed = isProductionRemediationLiveExecutorUndeployed();
  probes.push(
    probe(
      "production_live_executor_undeployed",
      liveUndeployed && (!DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED || nextEnablementStep() === null),
      liveUndeployed ? "undeployed" : "live-executor-leaked",
    ),
  );

  const executor = resolveIsolatedP25RemediationExecutor({ allowlisted: true });
  const ctx = buildAuthorizedRemediation(executor);
  const happy = ctx.remediations.dispatch({
    commandId: "p25-ro",
    command: "propose",
    actor: ctx.enterprise,
    trusted: ctx.trustedTenant,
    sourceProposalId: ctx.sourceProposalId,
    grantId: ctx.enterpriseGrantId,
    target: canaryTarget(),
    actionType: "read_only_check",
  });
  const executed = ctx.remediations.dispatch({
    commandId: "p25-ro-run",
    command: "execute",
    actor: ctx.enterprise,
    trusted: ctx.trustedTenant,
    remediationId: happy.remediationId,
    executionId: "rex-p25-ro",
  });
  const verified = ctx.remediations.dispatch({
    commandId: "p25-ro-ver",
    command: "verify",
    actor: ctx.enterprise,
    trusted: ctx.trustedTenant,
    remediationId: happy.remediationId,
    expectedOutcome: { metric: "error_rate", direction: "decrease" },
  });
  const proposal = ctx.remediations.getProposal(happy.remediationId);
  const execution = ctx.remediations.getExecution("rex-p25-ro");
  const verification = verified.verificationId
    ? ctx.remediations.getVerification(verified.verificationId)
    : undefined;
  const previewExecuteVerifyHeld =
    happy.status === "PREVIEWED" &&
    executed.status === "EXECUTED" &&
    verified.status === "VERIFIED" &&
    proposal?.dryRunPreview?.dryRun === true &&
    execution?.appliedToRuntime === false &&
    execution?.actionResult === "dry_run";
  probes.push(
    probe(
      "preview_execute_verify",
      previewExecuteVerifyHeld,
      `${happy.status}/${executed.status}/${verified.status}`,
    ),
  );

  const baselineObservationRollbackHeld = Boolean(
    execution?.baselineWindow &&
    verification?.baselineWindow &&
    verification.observationWindow &&
    verification.verdict === "improved",
  );
  const rollback = ctx.remediations.dispatch({
    commandId: "p25-ro-rb",
    command: "rollback",
    actor: ctx.enterprise,
    trusted: ctx.trustedTenant,
    remediationId: happy.remediationId,
  });
  probes.push(
    probe(
      "baseline_observation_rollback",
      baselineObservationRollbackHeld && rollback.status === "ROLLED_BACK",
      rollback.status,
    ),
  );

  const highRisk = ctx.remediations.dispatch({
    commandId: "p25-doc",
    command: "propose",
    actor: ctx.enterprise,
    trusted: ctx.trustedTenant,
    sourceProposalId: ctx.sourceProposalId,
    grantId: ctx.enterpriseGrantId,
    target: canaryTarget(),
    actionType: "doctor_repair",
  });
  ctx.remediations.dispatch({
    commandId: "p25-doc-prev",
    command: "preview",
    actor: ctx.enterprise,
    trusted: ctx.trustedTenant,
    remediationId: highRisk.remediationId,
  });
  let highRiskRequiresApproval = false;
  try {
    ctx.remediations.dispatch({
      commandId: "p25-doc-early",
      command: "execute",
      actor: ctx.enterprise,
      trusted: ctx.trustedTenant,
      remediationId: highRisk.remediationId,
    });
  } catch (err) {
    highRiskRequiresApproval = codeOf(err) === "approval_required";
  }
  probes.push(
    probe(
      "high_risk_requires_approval",
      highRiskRequiresApproval,
      highRiskRequiresApproval ? "held" : "leaked",
    ),
  );

  const blockedHeld = (["configuration_change", ...BLOCKED_RUNTIME_ACTIONS] as const).every(
    (actionType) => {
      const proposed = ctx.remediations.dispatch({
        commandId: `p25-${actionType}`,
        command: "propose",
        actor: ctx.enterprise,
        trusted: ctx.trustedTenant,
        sourceProposalId: ctx.sourceProposalId,
        grantId: ctx.enterpriseGrantId,
        target: canaryTarget(),
        actionType,
      });
      ctx.remediations.dispatch({
        commandId: `p25-${actionType}-prev`,
        command: "preview",
        actor: ctx.enterprise,
        trusted: ctx.trustedTenant,
        remediationId: proposed.remediationId,
      });
      ctx.remediations.dispatch({
        commandId: `p25-${actionType}-sub`,
        command: "submit",
        actor: ctx.enterprise,
        trusted: ctx.trustedTenant,
        remediationId: proposed.remediationId,
      });
      ctx.remediations.dispatch({
        commandId: `p25-${actionType}-apr`,
        command: "approve",
        actor: ctx.enterprise,
        trusted: ctx.trustedTenant,
        remediationId: proposed.remediationId,
      });
      const receipt = ctx.remediations.dispatch({
        commandId: `p25-${actionType}-exec`,
        command: "execute",
        actor: ctx.enterprise,
        trusted: ctx.trustedTenant,
        remediationId: proposed.remediationId,
      });
      const exec = receipt.executionId
        ? ctx.remediations.getExecution(receipt.executionId)
        : undefined;
      return (
        receipt.status === "BLOCKED" &&
        exec?.appliedToRuntime === false &&
        (PRODUCTION_ACTIONS as readonly string[]).includes(actionType)
      );
    },
  );
  probes.push(probe("blocked_runtime_actions", blockedHeld, blockedHeld ? "blocked" : "leaked"));

  const failedCtx = buildAuthorizedRemediation(failingExecutor());
  const failProp = failedCtx.remediations.dispatch({
    commandId: "p25-fail",
    command: "propose",
    actor: failedCtx.enterprise,
    trusted: failedCtx.trustedTenant,
    sourceProposalId: failedCtx.sourceProposalId,
    grantId: failedCtx.enterpriseGrantId,
    target: canaryTarget(),
    actionType: "safe_reversible",
  });
  failedCtx.remediations.dispatch({
    commandId: "p25-fail-prev",
    command: "preview",
    actor: failedCtx.enterprise,
    trusted: failedCtx.trustedTenant,
    remediationId: failProp.remediationId,
  });
  const failed = failedCtx.remediations.dispatch({
    commandId: "p25-fail-run",
    command: "execute",
    actor: failedCtx.enterprise,
    trusted: failedCtx.trustedTenant,
    remediationId: failProp.remediationId,
    executionId: "rex-p25-fail",
  });
  const failedExec = failedCtx.remediations.getExecution("rex-p25-fail");
  const failureKeepsAppliedFalse =
    failed.status === "FAILED" && failedExec?.appliedToRuntime === false;
  probes.push(probe("failure_keeps_applied_false", failureKeepsAppliedFalse, failed.status));

  return {
    tenant: DIAGNOSIS_P25_TENANT,
    membershipOnly: true,
    isolatedAllowlisted: true,
    isolatedDryRunOnly: true,
    productionLiveExecutorUndeployed: true,
    doctorFixBound: false,
    channelRestartBound: false,
    skillDisableBound: false,
    configurationWriteBound: false,
    appliedToRuntime: false,
    productionCanaryStarted: false,
    probes,
    probesPassed: probes.every((row) => row.passed),
    highRiskRequiresApproval,
    previewExecuteVerifyHeld,
    baselineObservationRollbackHeld:
      baselineObservationRollbackHeld && rollback.status === "ROLLED_BACK",
    blockedRuntimeActionsHeld: blockedHeld,
    failureKeepsAppliedFalse,
    rollbackDrilled: true,
  };
}

export function evaluateDiagnosisProductionP25(
  input: DiagnosisIndependentApprovalInput & {
    humanEnablement?: DiagnosisP24_8HumanEnablementClaim;
    humanCanary?: DiagnosisP25HumanCanaryClaim;
  },
): DiagnosisProductionP25Report {
  const recordedAt = new Date(input.now ?? Date.parse("2026-09-06T08:20:00.000Z")).toISOString();
  const p24_8 = evaluateDiagnosisProductionP24_8(input);
  assertDiagnosisProductionP24_8Ready(p24_8);
  const candidateSha = normalizeSha(input.candidateSha);
  const originMainSha = normalizeSha(input.originMainSha);
  const liveSha = normalizeSha(input.liveSha);
  if (!candidateSha || !originMainSha) {
    fail("identity_missing", "candidate and origin/main are required", "identity");
  }
  const exactIdentityMatch =
    candidateSha === DIAGNOSIS_P25_FROZEN_CANDIDATE_SHA &&
    originMainSha === DIAGNOSIS_P25_FROZEN_CANDIDATE_SHA &&
    liveSha === DIAGNOSIS_P25_FROZEN_LIVE_SHA;
  const canary = runDiagnosisP25IsolatedCanary();
  const isolatedCanaryReady =
    p24_8.readyForEnablementSigning &&
    p24_8.humanEnablementRecorded &&
    exactIdentityMatch &&
    input.liveSource === "container" &&
    canary.probesPassed &&
    canary.previewExecuteVerifyHeld &&
    canary.baselineObservationRollbackHeld &&
    canary.highRiskRequiresApproval &&
    canary.blockedRuntimeActionsHeld &&
    canary.failureKeepsAppliedFalse &&
    canary.productionLiveExecutorUndeployed &&
    !canary.doctorFixBound &&
    DIAGNOSIS_CANARY_POLICY.firstStage === "internal_single_tenant" &&
    DIAGNOSIS_CANARY_POLICY.started;
  const report: DiagnosisProductionP25Report = {
    increment: DIAGNOSIS_PRODUCTION_P25_INCREMENT,
    schemaVersion: DIAGNOSIS_PRODUCTION_P25_SCHEMA_VERSION,
    rehearsalOnly: true,
    isolatedCanaryReady,
    humanCanaryRecorded: false,
    identityAligned: exactIdentityMatch && p24_8.identityAligned,
    candidateSha,
    originMainSha,
    liveSha,
    frozenCandidateSha: DIAGNOSIS_P25_FROZEN_CANDIDATE_SHA,
    frozenLiveSha: DIAGNOSIS_P25_FROZEN_LIVE_SHA,
    exactIdentityMatch,
    p24_8Ready: true,
    p24_8,
    canary,
    liveExecutorUndeployed: true,
    nextStep: null,
    canaryTenant: DIAGNOSIS_P25_TENANT,
    canaryStarted: DIAGNOSIS_CANARY_POLICY.started,
    productionCanaryStarted: false,
    trafficSwitched: false,
    approvedForProductionCutover: false,
    p25Started: true,
    p26ProductionReady: false,
    rollback: {
      disableRemediationGate: true,
      stopNewTasks: true,
      revokeExecutorAllowlist: true,
      keepExecutionAuditAndVerification: true,
      historyDeleted: false,
    },
    recordedAt,
    note: "P25 isolated governed remediation canary. Live executor stays undeployed. Delivery cutover still required before user-visible LIVE effect.",
  };
  if (!input.humanCanary) {
    return report;
  }
  return recordDiagnosisP25HumanCanary(report, input.humanCanary, { now: input.now });
}

export function recordDiagnosisP25HumanCanary(
  report: DiagnosisProductionP25Report,
  claim: DiagnosisP25HumanCanaryClaim,
  input: { now?: number } = {},
): DiagnosisProductionP25Report {
  assertP25CanarySource(claim);
  if (claim.increment !== DIAGNOSIS_PRODUCTION_P25_INCREMENT) {
    fail("increment_mismatch", "canary claim must target P25", "increment");
  }
  if (
    !claim.confirmHuman ||
    !claim.approvalStartsIsolatedCanary ||
    !claim.confirmIsolatedAllowlistedDryRunOnly ||
    !claim.confirmLiveExecutorUndeployed ||
    !claim.confirmNoDoctorFix ||
    !claim.confirmNoChannelRestart ||
    !claim.confirmP26NotStarted
  ) {
    fail("enablement_confirm_missing", "P25 isolated canary confirmations are required", "claim");
  }
  if (claim.confirmCanaryTenant !== DIAGNOSIS_P25_TENANT) {
    fail("canary_tenant_mismatch", "P25 must stay on internal single tenant", "claim");
  }
  const candidateSha = normalizeSha(claim.candidateSha);
  const liveSha = normalizeSha(claim.liveSha);
  if (
    candidateSha !== DIAGNOSIS_P25_FROZEN_CANDIDATE_SHA ||
    liveSha !== DIAGNOSIS_P25_FROZEN_LIVE_SHA
  ) {
    fail("identity_mismatch", "P25 claim must match frozen candidate and LIVE SHAs");
  }
  if (candidateSha !== report.candidateSha || liveSha !== report.liveSha) {
    fail("report_identity_mismatch", "P25 claim must match evaluated identity", "identity");
  }
  if (!claim.signer.trim()) {
    fail("signer_missing", "P25 claim requires a human signer", "signer");
  }
  if (!report.isolatedCanaryReady) {
    fail("p25_not_ready", "P25 isolated canary must pass before recording", "p25");
  }
  return {
    ...report,
    humanCanaryRecorded: true,
    recordedAt: new Date(input.now ?? Date.parse("2026-09-06T08:20:00.000Z")).toISOString(),
    note: "P25 isolated governed remediation canary recorded. Live executor stays undeployed. Merge to main and wait for delivery unified-window cutover before user-visible LIVE effect.",
  };
}

export function renderDiagnosisProductionP25Markdown(report: DiagnosisProductionP25Report): string {
  return [
    `# OpenBot Diagnosis Platform — P25 受治理修复隔离灰度`,
    ``,
    `Date: 2026-09-06`,
    ``,
    `Status: **${report.humanCanaryRecorded ? "Isolated canary recorded" : report.isolatedCanaryReady ? "Ready for Daniel/CEO signing" : "No-Go"}**`,
    ``,
    `## Identity (exact match required)`,
    ``,
    `- candidate/origin-main: \`${report.candidateSha}\``,
    `- LIVE: \`${report.liveSha ?? "unknown"}\``,
    `- frozen candidate: \`${report.frozenCandidateSha}\``,
    `- frozen LIVE: \`${report.frozenLiveSha}\``,
    `- exactIdentityMatch: ${String(report.exactIdentityMatch)}`,
    ``,
    `## Isolated canary`,
    ``,
    `- tenant: \`${report.canary.tenant}\``,
    `- isolatedAllowlisted: ${String(report.canary.isolatedAllowlisted)}`,
    `- liveExecutorUndeployed: ${String(report.liveExecutorUndeployed)}`,
    `- previewExecuteVerify: ${String(report.canary.previewExecuteVerifyHeld)}`,
    `- highRiskRequiresApproval: ${String(report.canary.highRiskRequiresApproval)}`,
    `- blockedRuntimeActions: ${String(report.canary.blockedRuntimeActionsHeld)}`,
    `- appliedToRuntime: ${String(report.canary.appliedToRuntime)}`,
    `- p25Started: ${String(report.p25Started)}`,
    `- p26ProductionReady: ${String(report.p26ProductionReady)}`,
    ``,
    report.note,
    ``,
  ].join("\n");
}

export function assertDiagnosisProductionP25Ready(report: DiagnosisProductionP25Report): void {
  if (!report.isolatedCanaryReady || !report.humanCanaryRecorded) {
    fail("p25_not_ready", "P25 isolated canary must be signed and identity-aligned", "p25");
  }
  if (
    !report.liveExecutorUndeployed ||
    report.canary.doctorFixBound ||
    report.canary.channelRestartBound
  ) {
    fail("p25_scope_violation", "P25 must stay isolated dry-run without live apply", "p25");
  }
  if (report.p26ProductionReady || report.trafficSwitched || report.approvedForProductionCutover) {
    fail("p25_surface_violation", "P25 must not start P26 or switch traffic", "p25");
  }
}
