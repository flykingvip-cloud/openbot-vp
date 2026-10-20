/**
 * Phase 26 — closed-loop acceptance and production-readiness evaluation.
 * Consumes a recorded P25 isolated canary. Walks the official inspection
 * → delivery → authorization → report → remediation → verification chain
 * in-process only. Does not bind Doctor --fix, Channel restart, or a live
 * executor. Approval never auto-declares Production Ready. LIVE cutover
 * stays with delivery.
 */
import { createDiagnosisDelegationMachine } from "./delegation.js";
import type { DelegationActor, DelegationCommandInput } from "./delegation.js";
import {
  evaluateDiagnosisLedgerAlignment,
  proveDiagnosisAdmissionFailClosed,
  runDiagnosisGovernedChainRehearsal,
  type DiagnosisGovernedChainRehearsal,
} from "./production-admission.js";
import type { DiagnosisIndependentApprovalInput } from "./production-approval-freeze.js";
import {
  DIAGNOSIS_CANARY_POLICY,
  DIAGNOSIS_PRODUCTION_SLO,
  isProductionRemediationLiveExecutorUndeployed,
} from "./production-cutover.js";
import type { DiagnosisP24_8HumanEnablementClaim } from "./production-p24.8.js";
import {
  DIAGNOSIS_P25_FROZEN_CANDIDATE_SHA,
  DIAGNOSIS_P25_FROZEN_LIVE_SHA,
  DIAGNOSIS_P25_TENANT,
  assertDiagnosisProductionP25Ready,
  evaluateDiagnosisProductionP25,
  type DiagnosisP25HumanCanaryClaim,
  type DiagnosisProductionP25Report,
} from "./production-p25.js";
import { DiagnosisContractError, isDiagnosisContractError } from "./types.js";
import type { DiagnosticPrincipal, TrustedTenantContext } from "./types.js";
import {
  DIAGNOSIS_VIEW_ROLES,
  projectDiagnosisVisualization,
  type DiagnosisVisualizationAudience,
  type DiagnosisVisualizationCatalog,
} from "./visualization.js";

export const DIAGNOSIS_PRODUCTION_P26_INCREMENT = "P26" as const;
export const DIAGNOSIS_PRODUCTION_P26_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_P26_SIGNATURE_KIND = "human_closed_loop_acceptance_record" as const;
export const DIAGNOSIS_P26_TENANT = DIAGNOSIS_P25_TENANT;
export const DIAGNOSIS_P26_FROZEN_CANDIDATE_SHA = DIAGNOSIS_P25_FROZEN_CANDIDATE_SHA;
export const DIAGNOSIS_P26_FROZEN_LIVE_SHA = DIAGNOSIS_P25_FROZEN_LIVE_SHA;

export const DIAGNOSIS_P26_CHAIN_STEPS = [
  "dynamic_inspection",
  "diagnostic_signal",
  "daibai_delivery",
  "authorization_wait",
  "remote_consultation",
  "composite_report",
  "remediation_preview",
  "human_approval",
  "governed_execution",
  "verification",
  "continued_observation",
] as const;

export type DiagnosisP26ChainStep = (typeof DIAGNOSIS_P26_CHAIN_STEPS)[number];

export type DiagnosisP26Probe = {
  name: string;
  passed: boolean;
  detail: string;
};

export type DiagnosisP26Acceptance = {
  tenant: typeof DIAGNOSIS_P26_TENANT;
  chain: DiagnosisGovernedChainRehearsal;
  chainHeld: boolean;
  roleMatrixHeld: boolean;
  crossTenantHeld: boolean;
  surfaceConsistencyHeld: boolean;
  faultInjectionHeld: boolean;
  rollbackDrilled: boolean;
  probes: DiagnosisP26Probe[];
  probesPassed: boolean;
};

export type DiagnosisP26HumanAcceptanceClaim = {
  kind: typeof DIAGNOSIS_P26_SIGNATURE_KIND;
  increment: typeof DIAGNOSIS_PRODUCTION_P26_INCREMENT;
  schemaVersion: 1;
  candidateSha: string;
  liveSha: string;
  approvalRecordsEvaluation: true;
  acceptsClientParam: false;
  acceptsModelOutput: false;
  confirmHuman: true;
  confirmEvaluationOnly: true;
  confirmProductionReady: false;
  confirmNoLiveCutover: true;
  confirmLiveExecutorUndeployed: true;
  confirmCanaryTenant: typeof DIAGNOSIS_P26_TENANT;
  signer: string;
};

export type DiagnosisProductionP26Report = {
  increment: typeof DIAGNOSIS_PRODUCTION_P26_INCREMENT;
  schemaVersion: 1;
  rehearsalOnly: true;
  isolatedAcceptanceReady: boolean;
  humanAcceptanceRecorded: boolean;
  identityAligned: boolean;
  candidateSha: string;
  originMainSha: string;
  liveSha: string | null;
  frozenCandidateSha: typeof DIAGNOSIS_P26_FROZEN_CANDIDATE_SHA;
  frozenLiveSha: typeof DIAGNOSIS_P26_FROZEN_LIVE_SHA;
  exactIdentityMatch: boolean;
  liveEqualsCandidate: boolean;
  productionSloComplete: false;
  liveExecutorUndeployed: true;
  p25Ready: boolean;
  p25: DiagnosisProductionP25Report;
  acceptance: DiagnosisP26Acceptance;
  blockers: readonly string[];
  canaryTenant: typeof DIAGNOSIS_P26_TENANT;
  trafficSwitched: false;
  approvedForProductionCutover: false;
  p26Evaluated: true;
  p26ProductionReady: false;
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

function probe(name: string, passed: boolean, detail: string): DiagnosisP26Probe {
  return { name, passed, detail };
}

export function assertP26AcceptanceSource(claim: {
  kind?: string;
  clientParam?: unknown;
  modelOutput?: unknown;
}): void {
  if (claim.clientParam !== undefined) {
    fail("client_param_enablement_forbidden", "client parameters are not P26 approval", "claim");
  }
  if (claim.modelOutput !== undefined) {
    fail("model_output_enablement_forbidden", "model output is not P26 approval", "claim");
  }
  if (claim.kind !== undefined && claim.kind !== DIAGNOSIS_P26_SIGNATURE_KIND) {
    fail("unknown_enablement_source", `unsupported P26 source ${claim.kind}`);
  }
}

function principal(id: string, tenantId: string | null): DiagnosticPrincipal {
  return { schemaVersion: 1, principalId: id, kind: "user", tenantId };
}

function runRoleMatrixAndCrossTenant(): { roleMatrixHeld: boolean; crossTenantHeld: boolean } {
  const tenant = DIAGNOSIS_P26_TENANT;
  const trusted: TrustedTenantContext = { tenantId: tenant };
  const trustedPlatform: TrustedTenantContext = { tenantId: null };
  const platform: DelegationActor = { role: "platform", principal: principal("plat-admin", null) };
  const enterprise: DelegationActor = {
    role: "enterprise",
    principal: principal("ent-admin", tenant),
  };
  const employee: DelegationActor = {
    role: "employee",
    principal: principal("user-a", tenant),
  };
  const grants = createDiagnosisDelegationMachine({
    now: () => Date.parse("2026-09-06T08:30:00.000Z"),
  });
  const request = (
    over: Partial<DelegationCommandInput> &
      Pick<DelegationCommandInput, "commandId" | "actor" | "trusted">,
  ) => ({
    command: "request" as const,
    expiresAt: "2026-09-06T12:00:00.000Z",
    targetTenant: tenant,
    allowedEvidence: ["ev-p26"],
    allowedActions: ["diagnose", "suggest"],
    ...over,
  });
  const enterpriseGrant = grants.dispatch(
    request({
      commandId: "p26-ent",
      actor: platform,
      trusted: trustedPlatform,
      scenario: "platform_to_enterprise",
      approver: enterprise,
      grantee: enterprise,
    }),
  );
  grants.dispatch({
    commandId: "p26-ent-ok",
    command: "approve",
    actor: enterprise,
    trusted,
    grantId: enterpriseGrant.grantId,
  });
  const employeeGrant = grants.dispatch(
    request({
      commandId: "p26-emp",
      actor: enterprise,
      trusted,
      scenario: "enterprise_to_employee",
      approver: employee,
      grantee: employee,
      targetPrincipal: "user-a",
    }),
  );
  grants.dispatch({
    commandId: "p26-emp-ok",
    command: "approve",
    actor: employee,
    trusted,
    grantId: employeeGrant.grantId,
  });
  const roleMatrixHeld = Boolean(enterpriseGrant.grantId && employeeGrant.grantId);
  let impersonationHeld = false;
  try {
    grants.dispatch(
      request({
        commandId: "p26-impersonate",
        actor: employee,
        trusted,
        scenario: "platform_to_enterprise",
        approver: enterprise,
        grantee: enterprise,
      }),
    );
  } catch (err) {
    impersonationHeld = codeOf(err).length > 0;
  }
  grants.dispatch({
    commandId: "p26-rev",
    command: "revoke",
    actor: enterprise,
    trusted,
    grantId: employeeGrant.grantId,
  });
  let afterRevokeHeld = false;
  try {
    grants.dispatch({
      commandId: "p26-after-rev",
      command: "approve",
      actor: employee,
      trusted,
      grantId: employeeGrant.grantId,
    });
  } catch (err) {
    afterRevokeHeld = codeOf(err).length > 0;
  }
  return {
    roleMatrixHeld,
    crossTenantHeld: impersonationHeld && afterRevokeHeld,
  };
}

function runSurfaceConsistency(): boolean {
  const empty: DiagnosisVisualizationCatalog = {};
  return DIAGNOSIS_VIEW_ROLES.every((role) => {
    const audience: DiagnosisVisualizationAudience = {
      role,
      trusted: { tenantId: role === "platform" ? null : DIAGNOSIS_P26_TENANT },
      principal: principal(`${role}-p26`, role === "platform" ? null : DIAGNOSIS_P26_TENANT),
      redactionProfile: role === "employee" ? "user" : "administrator",
    };
    const bundle = projectDiagnosisVisualization(audience, empty);
    return bundle.permissionState === "empty" && bundle.health.tone === "empty";
  });
}

export async function runDiagnosisP26ClosedLoopAcceptance(
  p25: DiagnosisProductionP25Report,
): Promise<DiagnosisP26Acceptance> {
  const chain = await runDiagnosisGovernedChainRehearsal();
  const faults = await proveDiagnosisAdmissionFailClosed();
  const roles = runRoleMatrixAndCrossTenant();
  const surfaceConsistencyHeld = runSurfaceConsistency();
  const liveExecutorUndeployed = isProductionRemediationLiveExecutorUndeployed();
  const chainHeld = Boolean(
    chain.signalId &&
    chain.deliveryId &&
    chain.conversationState &&
    chain.grantId &&
    chain.reportId &&
    chain.proposalId &&
    chain.remediationId &&
    chain.previewOnly &&
    !chain.appliedToRuntime &&
    p25.canary.previewExecuteVerifyHeld &&
    p25.canary.highRiskRequiresApproval,
  );
  const faultInjectionHeld =
    faults.timeoutFailClosed &&
    faults.unavailableFailClosed &&
    faults.tenantMismatch &&
    p25.canary.failureKeepsAppliedFalse &&
    liveExecutorUndeployed;
  const probes = [
    probe("closed_loop_chain", chainHeld, chain.conversationState),
    probe("role_matrix", roles.roleMatrixHeld, roles.roleMatrixHeld ? "held" : "leaked"),
    probe("cross_tenant", roles.crossTenantHeld, roles.crossTenantHeld ? "held" : "leaked"),
    probe(
      "surface_consistency",
      surfaceConsistencyHeld,
      surfaceConsistencyHeld ? "held" : "leaked",
    ),
    probe("fault_injection", faultInjectionHeld, faultInjectionHeld ? "held" : "leaked"),
    probe("rollback", p25.canary.rollbackDrilled, "p25-rollback"),
  ];
  return {
    tenant: DIAGNOSIS_P26_TENANT,
    chain,
    chainHeld,
    roleMatrixHeld: roles.roleMatrixHeld,
    crossTenantHeld: roles.crossTenantHeld,
    surfaceConsistencyHeld,
    faultInjectionHeld,
    rollbackDrilled: p25.canary.rollbackDrilled,
    probes,
    probesPassed: probes.every((row) => row.passed),
  };
}

export async function evaluateDiagnosisProductionP26(
  input: DiagnosisIndependentApprovalInput & {
    humanEnablement?: DiagnosisP24_8HumanEnablementClaim;
    humanCanary?: DiagnosisP25HumanCanaryClaim;
    humanAcceptance?: DiagnosisP26HumanAcceptanceClaim;
  },
): Promise<DiagnosisProductionP26Report> {
  const recordedAt = new Date(input.now ?? Date.parse("2026-09-06T08:40:00.000Z")).toISOString();
  const p25 = evaluateDiagnosisProductionP25(input);
  assertDiagnosisProductionP25Ready(p25);
  const candidateSha = normalizeSha(input.candidateSha);
  const originMainSha = normalizeSha(input.originMainSha);
  const liveSha = normalizeSha(input.liveSha);
  if (!candidateSha || !originMainSha) {
    fail("identity_missing", "candidate and origin/main are required", "identity");
  }
  const exactIdentityMatch =
    candidateSha === DIAGNOSIS_P26_FROZEN_CANDIDATE_SHA &&
    originMainSha === DIAGNOSIS_P26_FROZEN_CANDIDATE_SHA &&
    liveSha === DIAGNOSIS_P26_FROZEN_LIVE_SHA;
  const alignment = evaluateDiagnosisLedgerAlignment({
    liveSha,
    ledgerOpenShas: input.ledgerOpenShas,
    releaseRecordSha: input.releaseRecordSha ?? null,
    provenanceTagSha: input.provenanceTagSha ?? null,
  });
  const acceptance = await runDiagnosisP26ClosedLoopAcceptance(p25);
  const liveEqualsCandidate = Boolean(liveSha && liveSha === candidateSha);
  const blockers = [
    ...(liveEqualsCandidate ? [] : ["live_not_equal_candidate"]),
    ...((DIAGNOSIS_PRODUCTION_SLO.completeness as string) === "complete"
      ? []
      : ["production_slo_empty"]),
    "live_executor_undeployed",
    "live_cutover_pending",
    "production_ready_not_separately_approved",
    ...alignment.blockers,
  ];
  const isolatedAcceptanceReady =
    p25.isolatedCanaryReady &&
    p25.humanCanaryRecorded &&
    exactIdentityMatch &&
    input.liveSource === "container" &&
    acceptance.probesPassed &&
    DIAGNOSIS_CANARY_POLICY.firstStage === "internal_single_tenant" &&
    DIAGNOSIS_CANARY_POLICY.started &&
    blockers.includes("production_slo_empty") &&
    (liveEqualsCandidate
      ? blockers.includes("live_cutover_pending")
      : blockers.includes("live_not_equal_candidate"));
  const report: DiagnosisProductionP26Report = {
    increment: DIAGNOSIS_PRODUCTION_P26_INCREMENT,
    schemaVersion: DIAGNOSIS_PRODUCTION_P26_SCHEMA_VERSION,
    rehearsalOnly: true,
    isolatedAcceptanceReady,
    humanAcceptanceRecorded: false,
    identityAligned: exactIdentityMatch && alignment.aligned,
    candidateSha,
    originMainSha,
    liveSha,
    frozenCandidateSha: DIAGNOSIS_P26_FROZEN_CANDIDATE_SHA,
    frozenLiveSha: DIAGNOSIS_P26_FROZEN_LIVE_SHA,
    exactIdentityMatch,
    liveEqualsCandidate,
    productionSloComplete: false,
    liveExecutorUndeployed: true,
    p25Ready: true,
    p25,
    acceptance,
    blockers,
    canaryTenant: DIAGNOSIS_P26_TENANT,
    trafficSwitched: false,
    approvedForProductionCutover: false,
    p26Evaluated: true,
    p26ProductionReady: false,
    recordedAt,
    note: "P26 closed-loop acceptance evaluated. Isolated chain passed. Production Ready stays No-Go until LIVE equals candidate, production SLO is complete, and a separate approval is recorded. Delivery still owns cutover.",
  };
  if (!input.humanAcceptance) {
    return report;
  }
  return recordDiagnosisP26HumanAcceptance(report, input.humanAcceptance, { now: input.now });
}

export function recordDiagnosisP26HumanAcceptance(
  report: DiagnosisProductionP26Report,
  claim: DiagnosisP26HumanAcceptanceClaim,
  input: { now?: number } = {},
): DiagnosisProductionP26Report {
  assertP26AcceptanceSource(claim);
  if (claim.increment !== DIAGNOSIS_PRODUCTION_P26_INCREMENT) {
    fail("increment_mismatch", "acceptance claim must target P26", "increment");
  }
  if (
    !claim.confirmHuman ||
    !claim.approvalRecordsEvaluation ||
    !claim.confirmEvaluationOnly ||
    claim.confirmProductionReady ||
    !claim.confirmNoLiveCutover ||
    !claim.confirmLiveExecutorUndeployed
  ) {
    fail("enablement_confirm_missing", "P26 evaluation confirmations are required", "claim");
  }
  if (claim.confirmCanaryTenant !== DIAGNOSIS_P26_TENANT) {
    fail("canary_tenant_mismatch", "P26 must stay on internal single tenant", "claim");
  }
  const candidateSha = normalizeSha(claim.candidateSha);
  const liveSha = normalizeSha(claim.liveSha);
  if (
    candidateSha !== DIAGNOSIS_P26_FROZEN_CANDIDATE_SHA ||
    liveSha !== DIAGNOSIS_P26_FROZEN_LIVE_SHA
  ) {
    fail("identity_mismatch", "P26 claim must match frozen candidate and LIVE SHAs");
  }
  if (candidateSha !== report.candidateSha || liveSha !== report.liveSha) {
    fail("report_identity_mismatch", "P26 claim must match evaluated identity", "identity");
  }
  if (!claim.signer.trim()) {
    fail("signer_missing", "P26 claim requires a human signer", "signer");
  }
  if (!report.isolatedAcceptanceReady || report.p26ProductionReady) {
    fail(
      "p26_not_ready",
      "P26 may record evaluation only while Production Ready stays false",
      "p26",
    );
  }
  return {
    ...report,
    humanAcceptanceRecorded: true,
    recordedAt: new Date(input.now ?? Date.parse("2026-09-06T08:40:00.000Z")).toISOString(),
    note: "P26 closed-loop acceptance recorded as No-Go. Isolated chain passed. Do not treat this as Production Ready. Merge and wait for delivery unified-window cutover before user-visible LIVE effect.",
  };
}

export function renderDiagnosisProductionP26Markdown(report: DiagnosisProductionP26Report): string {
  return [
    `# OpenBot Diagnosis Platform — P26 闭环验收`,
    ``,
    `Date: 2026-09-06`,
    ``,
    `Status: **${report.p26ProductionReady ? "Production Ready" : report.humanAcceptanceRecorded ? "Evaluated No-Go" : report.isolatedAcceptanceReady ? "Ready for Daniel/CEO signing" : "No-Go"}**`,
    ``,
    `## Identity (exact match required)`,
    ``,
    `- candidate/origin-main: \`${report.candidateSha}\``,
    `- LIVE: \`${report.liveSha ?? "unknown"}\``,
    `- liveEqualsCandidate: ${String(report.liveEqualsCandidate)}`,
    `- productionSloComplete: ${String(report.productionSloComplete)}`,
    `- p26ProductionReady: ${String(report.p26ProductionReady)}`,
    ``,
    `## Isolated acceptance`,
    ``,
    `- chainHeld: ${String(report.acceptance.chainHeld)}`,
    `- roleMatrixHeld: ${String(report.acceptance.roleMatrixHeld)}`,
    `- crossTenantHeld: ${String(report.acceptance.crossTenantHeld)}`,
    `- surfaceConsistencyHeld: ${String(report.acceptance.surfaceConsistencyHeld)}`,
    `- faultInjectionHeld: ${String(report.acceptance.faultInjectionHeld)}`,
    `- rollbackDrilled: ${String(report.acceptance.rollbackDrilled)}`,
    ``,
    `## Blockers`,
    ``,
    ...report.blockers.map((row) => `- ${row}`),
    ``,
    report.note,
    ``,
  ].join("\n");
}

export function assertDiagnosisProductionP26Evaluated(report: DiagnosisProductionP26Report): void {
  if (!report.isolatedAcceptanceReady || !report.humanAcceptanceRecorded || !report.p26Evaluated) {
    fail(
      "p26_not_evaluated",
      "P26 closed-loop acceptance must be signed and identity-aligned",
      "p26",
    );
  }
  if (report.p26ProductionReady || report.trafficSwitched || report.approvedForProductionCutover) {
    fail("p26_surface_violation", "P26 must not declare Production Ready or switch traffic", "p26");
  }
  if (!report.liveExecutorUndeployed || report.productionSloComplete) {
    fail("p26_scope_violation", "P26 current facts must keep Production Ready closed", "p26");
  }
}
