/**
 * P24.3 — unified-window lock and delivery verify-live observation.
 * Locks candidate to freshly fetched origin/main after P24.2 is on trunk.
 * Re-runs delivery gates. Diagnosis does not own cutover, does not swap
 * LIVE, and does not open functional gates even if verify-live later passes.
 */
import { DIAGNOSIS_DAIBAI_DELIVERY_ENABLED } from "./production-cutover.js";
import { isUnapprovedProductionGateOpen } from "./production-enablement-sequence.js";
import {
  evaluateDiagnosisUnifiedDeps,
  type DiagnosisUnifiedDepsInput,
  type DiagnosisUnifiedDepsReport,
} from "./production-unified-deps.js";
import { DiagnosisContractError } from "./types.js";

export const DIAGNOSIS_UNIFIED_LOCK_INCREMENT = "P24.3" as const;
export const DIAGNOSIS_UNIFIED_LOCK_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_UNIFIED_LOCK_OWNER = "delivery" as const;

export type DiagnosisUnifiedLockCheck = {
  name: string;
  passed: boolean;
  exitCode?: number;
  detail: string;
};

export type DiagnosisUnifiedVerifyLiveObservation = {
  ran: boolean;
  passed: boolean;
  buildInfoMatches: boolean;
  healthzOk: boolean;
  readyzOk: boolean;
  gatewayUiSameIdentity: boolean;
  ledgerReleaseProvenanceConsistent: boolean;
  detail: string;
};

export type DiagnosisUnifiedLockInput = DiagnosisUnifiedDepsInput & {
  p242PresentOnOriginMain?: boolean;
  pr976Merged?: boolean;
  pr976MergeSha?: string | null;
  forwardOnly?: DiagnosisUnifiedLockCheck;
  deliveryAlignment?: DiagnosisUnifiedLockCheck;
  preflight?: DiagnosisUnifiedLockCheck;
  convergence?: DiagnosisUnifiedLockCheck;
  verifyLive?: DiagnosisUnifiedVerifyLiveObservation;
  cutoverPlanObserved?: boolean;
  cutoverSwapExecuted?: boolean;
  ghcrImageAvailable?: boolean;
};

export type DiagnosisUnifiedLockReport = {
  increment: typeof DIAGNOSIS_UNIFIED_LOCK_INCREMENT;
  schemaVersion: 1;
  unifiedWindowLocked: boolean;
  candidateEqualsOriginMain: boolean;
  p242PresentOnOriginMain: boolean;
  pr976Merged: boolean;
  pr976MergeSha: string | null;
  liveConfirmedFromContainer: boolean;
  liveSha: string | null;
  candidateSha: string;
  originMainSha: string;
  forwardOnlyPassed: boolean;
  deliveryAlignmentPassed: boolean;
  preflightObserved: boolean;
  standalonePreflightNotLiveHealth: true;
  convergenceObserved: boolean;
  gatesOpened: false;
  productionWrite: false;
  liveConnected: false;
  daibaiUnconnected: boolean;
  conversationUnconnected: boolean;
  remediationUnconnected: true;
  livePackRegistered: false;
  coreGatewayHasDiagnosisMethods: false;
  diagnosisOnlyCutover: false;
  cutoverOwner: typeof DIAGNOSIS_UNIFIED_LOCK_OWNER;
  cutoverSwapExecuted: false;
  cutoverPlanObserved: boolean;
  ghcrImageAvailable: boolean;
  verifyLivePassed: boolean;
  verifyLiveFailedStopEnablement: boolean;
  enablementBlocked: true;
  approvedForProductionCutover: false;
  p25Started: false;
  p26ProductionReady: false;
  diagnosisPlatformComplete: false;
  approvalDoesNotOpenGate: true;
  checks: DiagnosisUnifiedLockCheck[];
  verifyLive: DiagnosisUnifiedVerifyLiveObservation;
  deps: DiagnosisUnifiedDepsReport;
  recordedAt: string;
  note: string;
};

function fail(code: string, message: string, path: string): never {
  throw new DiagnosisContractError(code, message, path);
}

function check(
  name: string,
  passed: boolean,
  detail: string,
  exitCode?: number,
): DiagnosisUnifiedLockCheck {
  return exitCode === undefined ? { name, passed, detail } : { name, passed, detail, exitCode };
}

function defaultVerifyLive(): DiagnosisUnifiedVerifyLiveObservation {
  return {
    ran: false,
    passed: false,
    buildInfoMatches: false,
    healthzOk: false,
    readyzOk: false,
    gatewayUiSameIdentity: false,
    ledgerReleaseProvenanceConsistent: false,
    detail: "verify-live not observed; delivery has not swapped LIVE to candidate",
  };
}

export async function evaluateDiagnosisUnifiedLock(
  input: DiagnosisUnifiedLockInput,
): Promise<DiagnosisUnifiedLockReport> {
  const recordedAt = new Date(input.now ?? Date.parse("2026-09-05T11:30:00.000Z")).toISOString();
  const deps = await evaluateDiagnosisUnifiedDeps(input);
  const productionGatesClosed = !isUnapprovedProductionGateOpen();
  const candidateEqualsOriginMain =
    Boolean(input.candidateSha) &&
    Boolean(input.originMainSha) &&
    input.candidateSha === input.originMainSha;
  const liveConfirmedFromContainer = input.liveSource === "container" && Boolean(input.liveSha);
  const p242PresentOnOriginMain = input.p242PresentOnOriginMain === true;
  const pr976Merged = input.pr976Merged === true;
  const forwardOnly = input.forwardOnly ?? check("forward_only", false, "not run");
  const deliveryAlignment =
    input.deliveryAlignment ?? check("delivery_alignment", false, "not run");
  const preflight = input.preflight ?? check("production_preflight", false, "not run");
  const convergence = input.convergence ?? check("trunk_convergence", false, "not run");
  const verifyLive = input.verifyLive ?? defaultVerifyLive();
  if (input.cutoverSwapExecuted === true) {
    fail(
      "diagnosis_must_not_swap",
      "diagnosis must not execute the live container swap",
      "cutover",
    );
  }
  const checks = [
    check("pr976_merged", pr976Merged, input.pr976MergeSha ?? "not merged"),
    check(
      "p242_present_on_origin_main",
      p242PresentOnOriginMain,
      p242PresentOnOriginMain ? "production-unified-deps on origin/main" : "P24.2 not on trunk",
    ),
    check("candidate_equals_origin_main", candidateEqualsOriginMain, input.candidateSha ?? ""),
    check(
      "live_confirmed_from_container",
      liveConfirmedFromContainer,
      input.liveSha ?? "LIVE unknown",
    ),
    check("forward_only", forwardOnly.passed, forwardOnly.detail, forwardOnly.exitCode),
    check(
      "delivery_alignment",
      deliveryAlignment.passed,
      deliveryAlignment.detail,
      deliveryAlignment.exitCode,
    ),
    check(
      "production_preflight_observed",
      input.preflight !== undefined,
      preflight.detail,
      preflight.exitCode,
    ),
    check(
      "trunk_convergence_observed",
      input.convergence !== undefined,
      convergence.detail,
      convergence.exitCode,
    ),
    check("production_gates_closed", productionGatesClosed, "only Da Bai gate may be open"),
    check("production_write_false", true, "false"),
    check("live_connected_false", true, "false"),
    check(
      "daibai_delivery_scoped",
      DIAGNOSIS_DAIBAI_DELIVERY_ENABLED
        ? !deps.injection.daibaiUnconnected
        : deps.injection.daibaiUnconnected,
      "P24.5 live Da Bai on canary tenant",
    ),
    check(
      "conversation_bound_scoped",
      DIAGNOSIS_DAIBAI_DELIVERY_ENABLED
        ? !deps.injection.conversationUnconnected
        : deps.injection.conversationUnconnected,
      "P24.5 live conversation on canary tenant",
    ),
    check(
      "remediation_unconnected",
      deps.injection.remediationUnconnected,
      "until later enablement",
    ),
    check("live_pack_unregistered", !input.livePackRegistered, "diagnosis-reports not live"),
    check(
      "core_gateway_has_no_diagnosis_methods",
      !input.coreHandlerHasDiagnosis,
      "no diagnosis methods",
    ),
    check("diagnosis_does_not_own_cutover", true, DIAGNOSIS_UNIFIED_LOCK_OWNER),
    check("diagnosis_only_cutover_false", true, "false"),
    check("cutover_swap_not_executed_by_diagnosis", true, "delivery owns swap"),
  ];
  const unifiedWindowLocked =
    pr976Merged &&
    p242PresentOnOriginMain &&
    candidateEqualsOriginMain &&
    liveConfirmedFromContainer &&
    forwardOnly.passed &&
    deliveryAlignment.passed &&
    productionGatesClosed &&
    deps.productionDependenciesInjected &&
    (DIAGNOSIS_DAIBAI_DELIVERY_ENABLED
      ? !deps.injection.daibaiUnconnected && !deps.injection.conversationUnconnected
      : deps.injection.daibaiUnconnected && deps.injection.conversationUnconnected) &&
    deps.injection.remediationUnconnected &&
    !input.livePackRegistered &&
    !input.coreHandlerHasDiagnosis &&
    !input.cutoverSwapExecuted;
  const verifyLivePassed = verifyLive.ran && verifyLive.passed;
  return {
    increment: DIAGNOSIS_UNIFIED_LOCK_INCREMENT,
    schemaVersion: DIAGNOSIS_UNIFIED_LOCK_SCHEMA_VERSION,
    unifiedWindowLocked,
    candidateEqualsOriginMain,
    p242PresentOnOriginMain,
    pr976Merged,
    pr976MergeSha: input.pr976MergeSha ?? null,
    liveConfirmedFromContainer,
    liveSha: input.liveSha ?? null,
    candidateSha: input.candidateSha,
    originMainSha: input.originMainSha,
    forwardOnlyPassed: forwardOnly.passed,
    deliveryAlignmentPassed: deliveryAlignment.passed,
    preflightObserved: preflight.detail.length > 0,
    standalonePreflightNotLiveHealth: true,
    convergenceObserved: convergence.detail.length > 0,
    gatesOpened: false,
    productionWrite: false,
    liveConnected: false,
    daibaiUnconnected: deps.injection.daibaiUnconnected,
    conversationUnconnected: deps.injection.conversationUnconnected,
    remediationUnconnected: true,
    livePackRegistered: false,
    coreGatewayHasDiagnosisMethods: false,
    diagnosisOnlyCutover: false,
    cutoverOwner: DIAGNOSIS_UNIFIED_LOCK_OWNER,
    cutoverSwapExecuted: false,
    cutoverPlanObserved: input.cutoverPlanObserved === true,
    ghcrImageAvailable: input.ghcrImageAvailable === true,
    verifyLivePassed,
    verifyLiveFailedStopEnablement: !verifyLivePassed,
    enablementBlocked: true,
    approvedForProductionCutover: false,
    p25Started: false,
    p26ProductionReady: false,
    diagnosisPlatformComplete: false,
    approvalDoesNotOpenGate: true,
    checks,
    verifyLive,
    deps,
    recordedAt,
    note: "Lock the official unified window after P24.2 is on origin/main. Delivery owns cutover. Diagnosis does not swap LIVE, open gates, bind live chat, or start P25. verify-live pass is unified-window publication only, not Diagnosis Platform complete.",
  };
}

export function renderDiagnosisUnifiedLockMarkdown(report: DiagnosisUnifiedLockReport): string {
  const status = report.unifiedWindowLocked
    ? report.verifyLivePassed
      ? "Unified window locked. verify-live PASS. Gates stay closed"
      : "Unified window locked. verify-live not passed. Enablement stopped"
    : "No-Go";
  return [
    `# OpenBot Diagnosis Platform — P24.3 统一窗口锁点与 delivery verify-live`,
    ``,
    `Date: 2026-09-05`,
    ``,
    `Status: **${status}。**`,
    `candidate=${report.candidateSha} origin/main=${report.originMainSha} LIVE=${report.liveSha ?? "unknown"}.`,
    `gatesOpened=${String(report.gatesOpened)} productionWrite=${String(report.productionWrite)} liveConnected=${String(report.liveConnected)} enablementBlocked=${String(report.enablementBlocked)}.`,
    `cutoverOwner=${report.cutoverOwner} diagnosisOnlyCutover=${String(report.diagnosisOnlyCutover)} cutoverSwapExecuted=${String(report.cutoverSwapExecuted)}.`,
    `verifyLivePassed=${String(report.verifyLivePassed)} diagnosisPlatformComplete=${String(report.diagnosisPlatformComplete)}.`,
    ``,
    `## Checks`,
    ``,
    ...report.checks.map(
      (row) =>
        `- ${row.name}: ${row.passed ? "PASS" : "HOLD"} ${row.detail}${row.exitCode === undefined ? "" : ` exit=${String(row.exitCode)}`}`,
    ),
    ``,
    `## verify-live`,
    ``,
    `- ran: ${String(report.verifyLive.ran)}`,
    `- passed: ${String(report.verifyLive.passed)}`,
    `- build-info: ${String(report.verifyLive.buildInfoMatches)}`,
    `- healthz: ${String(report.verifyLive.healthzOk)}`,
    `- readyz: ${String(report.verifyLive.readyzOk)}`,
    `- gateway/UI same identity: ${String(report.verifyLive.gatewayUiSameIdentity)}`,
    `- ledger / RELEASE_RECORD / provenance: ${String(report.verifyLive.ledgerReleaseProvenanceConsistent)}`,
    `- ${report.verifyLive.detail}`,
    ``,
    report.note,
    ``,
  ].join("\n");
}

export function assertDiagnosisUnifiedLockClosed(report: DiagnosisUnifiedLockReport): void {
  if (
    report.gatesOpened ||
    report.productionWrite ||
    report.liveConnected ||
    (DIAGNOSIS_DAIBAI_DELIVERY_ENABLED
      ? report.daibaiUnconnected || report.conversationUnconnected
      : !report.daibaiUnconnected || !report.conversationUnconnected) ||
    !report.remediationUnconnected ||
    report.livePackRegistered ||
    report.coreGatewayHasDiagnosisMethods ||
    report.diagnosisOnlyCutover ||
    report.cutoverSwapExecuted ||
    report.approvedForProductionCutover ||
    report.p25Started ||
    report.p26ProductionReady ||
    report.diagnosisPlatformComplete ||
    !report.enablementBlocked ||
    !report.approvalDoesNotOpenGate ||
    !report.standalonePreflightNotLiveHealth ||
    isUnapprovedProductionGateOpen()
  ) {
    fail(
      "unified_lock_not_closed",
      "unified-window lock must not open gates, swap LIVE, or complete the platform",
      "unified-lock",
    );
  }
  if (report.verifyLivePassed && report.verifyLiveFailedStopEnablement) {
    fail(
      "verify_live_stop_conflict",
      "verify-live pass cannot also stop enablement as a failure",
      "verify-live",
    );
  }
  if (!report.verifyLivePassed && !report.verifyLiveFailedStopEnablement) {
    fail(
      "verify_live_must_stop_enablement",
      "failed or unobserved verify-live must stop later enablement",
      "verify-live",
    );
  }
}
