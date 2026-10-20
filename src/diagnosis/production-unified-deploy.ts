/**
 * P24.1 — open unified production deploy conditions only.
 * Diagnosis may ride the next origin/main cutover with other new components.
 * Functional gates stay false. Diagnosis does not own cutover, does not start
 * P25 remediation enablement, and does not declare Production Ready.
 */
import type { DiagnosisIndependentApprovalInput } from "./production-approval-freeze.js";
import {
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
} from "./production-cutover.js";
import { isUnapprovedProductionGateOpen } from "./production-enablement-sequence.js";
import type { DiagnosisP22HumanApprovalClaim } from "./production-p22.js";
import {
  evaluateDiagnosisProductionP24,
  type DiagnosisProductionP24Report,
} from "./production-p24.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";
import { DiagnosisContractError } from "./types.js";

export const DIAGNOSIS_UNIFIED_DEPLOY_INCREMENT = "P24.1" as const;
export const DIAGNOSIS_UNIFIED_DEPLOY_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_UNIFIED_DEPLOY_OWNER = "delivery" as const;

export type DiagnosisUnifiedDeployInput = DiagnosisIndependentApprovalInput & {
  humanApproval?: DiagnosisP22HumanApprovalClaim;
  signedCandidateIsAncestorOfCurrent?: boolean;
  signedLiveIsAncestorOfCurrent?: boolean;
  now?: number;
};

export type DiagnosisUnifiedDeployCondition = {
  name: string;
  passed: boolean;
  detail: string;
};

export type DiagnosisUnifiedDeployReport = {
  increment: typeof DIAGNOSIS_UNIFIED_DEPLOY_INCREMENT;
  schemaVersion: 1;
  productionDeployConditionsOpen: boolean;
  ridesAlongWithOtherComponents: true;
  cutoverOwner: typeof DIAGNOSIS_UNIFIED_DEPLOY_OWNER;
  codeMayShipDark: true;
  approvedForProductionCutover: false;
  diagnosisOnlyCutover: false;
  gatesOpened: false;
  trafficSwitched: false;
  livePackRegistered: false;
  p25Started: false;
  p26ProductionReady: false;
  enablementRequiresLaterIndependentApproval: true;
  approvalDoesNotOpenGate: true;
  p22HumanApprovalRecorded: boolean;
  p23IsolatedCanaryReady: boolean;
  p24IsolatedCanaryReady: boolean;
  identityAligned: boolean;
  conditions: DiagnosisUnifiedDeployCondition[];
  p24: DiagnosisProductionP24Report;
  recordedAt: string;
  note: string;
};

function fail(code: string, message: string, path: string): never {
  throw new DiagnosisContractError(code, message, path);
}

function condition(name: string, passed: boolean, detail: string): DiagnosisUnifiedDeployCondition {
  return { name, passed, detail };
}

export async function evaluateDiagnosisUnifiedDeployConditions(
  input: DiagnosisUnifiedDeployInput,
): Promise<DiagnosisUnifiedDeployReport> {
  const recordedAt = new Date(input.now ?? Date.parse("2026-09-05T07:40:00.000Z")).toISOString();
  const p24 = await evaluateDiagnosisProductionP24(input);
  const productionGatesClosed = !isUnapprovedProductionGateOpen();
  const candidateEqualsOriginMain =
    Boolean(input.candidateSha) &&
    Boolean(input.originMainSha) &&
    input.candidateSha === input.originMainSha;
  const conditions = [
    condition("identity_aligned", p24.identityAligned, String(p24.identityAligned)),
    condition("candidate_equals_origin_main", candidateEqualsOriginMain, input.candidateSha ?? ""),
    condition(
      "p22_human_approval_recorded",
      p24.p22HumanApprovalRecorded,
      String(p24.p22HumanApprovalRecorded),
    ),
    condition(
      "p22_value_after_approval_false",
      p24.p22HumanApprovalRecorded && p24.approvalDoesNotOpenGate,
      "approval does not open a gate",
    ),
    condition(
      "p23_isolated_canary_ready",
      p24.p23IsolatedCanaryReady,
      String(p24.p23IsolatedCanaryReady),
    ),
    condition(
      "p24_isolated_canary_ready",
      p24.isolatedCanaryReady,
      String(p24.isolatedCanaryReady),
    ),
    condition("production_gates_closed", productionGatesClosed, "four gates false"),
    condition(
      "live_pack_unregistered",
      !input.livePackRegistered && !p24.livePackRegistered,
      "diagnosis-reports not live",
    ),
    condition("diagnosis_does_not_own_cutover", true, DIAGNOSIS_UNIFIED_DEPLOY_OWNER),
    condition("rides_along_with_other_components", true, "unified production deploy"),
  ];
  const productionDeployConditionsOpen = conditions.every((row) => row.passed);
  return {
    increment: DIAGNOSIS_UNIFIED_DEPLOY_INCREMENT,
    schemaVersion: DIAGNOSIS_UNIFIED_DEPLOY_SCHEMA_VERSION,
    productionDeployConditionsOpen,
    ridesAlongWithOtherComponents: true,
    cutoverOwner: DIAGNOSIS_UNIFIED_DEPLOY_OWNER,
    codeMayShipDark: true,
    approvedForProductionCutover: false,
    diagnosisOnlyCutover: false,
    gatesOpened: false,
    trafficSwitched: false,
    livePackRegistered: false,
    p25Started: false,
    p26ProductionReady: false,
    enablementRequiresLaterIndependentApproval: true,
    approvalDoesNotOpenGate: true,
    p22HumanApprovalRecorded: p24.p22HumanApprovalRecorded,
    p23IsolatedCanaryReady: p24.p23IsolatedCanaryReady,
    p24IsolatedCanaryReady: p24.isolatedCanaryReady,
    identityAligned: p24.identityAligned,
    conditions,
    p24,
    recordedAt,
    note: "Open unified production deploy conditions only. Diagnosis may ride the next origin/main cutover with other new components while remaining dark. Do not open functional gates, do not start P25 remediation, and do not declare Production Ready.",
  };
}

function packStatus(report: DiagnosisUnifiedDeployReport): string {
  return report.productionDeployConditionsOpen
    ? "Unified production deploy conditions open. Diagnosis gates stay closed"
    : "No-Go";
}

export function renderDiagnosisUnifiedDeployMarkdown(report: DiagnosisUnifiedDeployReport): string {
  return [
    `# OpenBot Diagnosis Platform — P24.1 统一生产部署条件`,
    ``,
    `Date: 2026-09-05`,
    ``,
    `Status: **${packStatus(report)}。**`,
    `Diagnosis 只作为乘客进入下一次统一生产发布。cutoverOwner=${report.cutoverOwner} diagnosisOnlyCutover=${String(report.diagnosisOnlyCutover)} gatesOpened=${String(report.gatesOpened)} p25Started=${String(report.p25Started)} p26ProductionReady=${String(report.p26ProductionReady)}。`,
    ``,
    `## Conditions`,
    ``,
    `- productionDeployConditionsOpen: ${String(report.productionDeployConditionsOpen)}`,
    `- identity aligned: ${String(report.identityAligned)}`,
    `- P22 human approval recorded: ${String(report.p22HumanApprovalRecorded)}`,
    `- P23 isolated canary: ${String(report.p23IsolatedCanaryReady)}`,
    `- P24 isolated canary: ${String(report.p24IsolatedCanaryReady)}`,
    `- LIVE: \`${report.p24.p23.p22.repair.liveSha ?? "unknown"}\``,
    `- candidate: \`${report.p24.p23.p22.p21.preflight.identities.candidateSha ?? "unknown"}\``,
    ...report.conditions.map(
      (row) => `- ${row.name}: passed=${String(row.passed)} (${row.detail})`,
    ),
    ``,
    `## Gates (still closed)`,
    ``,
    `- DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED=${String(DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED)}`,
    `- DIAGNOSIS_REPORT_API_DEPLOYED=${String(DIAGNOSIS_REPORT_API_DEPLOYED)}`,
    `- DIAGNOSIS_DAIBAI_DELIVERY_ENABLED=${String(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED)}`,
    `- DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED=${String(DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED)}`,
    ``,
    report.note,
    ``,
  ].join("\n");
}

export function assertDiagnosisUnifiedDeployClosed(report: DiagnosisUnifiedDeployReport): void {
  if (
    report.approvedForProductionCutover ||
    report.diagnosisOnlyCutover ||
    report.gatesOpened ||
    report.trafficSwitched ||
    report.livePackRegistered ||
    report.p25Started ||
    report.p26ProductionReady ||
    !report.approvalDoesNotOpenGate ||
    !report.ridesAlongWithOtherComponents ||
    report.cutoverOwner !== DIAGNOSIS_UNIFIED_DEPLOY_OWNER ||
    isUnapprovedProductionGateOpen()
  ) {
    fail(
      "unified_deploy_not_closed",
      "unified deploy conditions must not open diagnosis gates or start P25/P26",
      "unified-deploy",
    );
  }
  if (
    report.p24.p23.p22.repair.ledgerMutated ||
    report.p24.p23.p22.repair.releaseRecordMutated ||
    report.p24.p23.p22.repair.provenanceMinted
  ) {
    fail("identity_mutated", "unified deploy must not rewrite LIVE identities", "repair");
  }
  if (report.productionDeployConditionsOpen && !report.p22HumanApprovalRecorded) {
    fail(
      "unsigned_deploy_ready",
      "deploy conditions require recorded P22 human approval",
      "approval",
    );
  }
  if (report.productionDeployConditionsOpen && !report.p24IsolatedCanaryReady) {
    fail("p24_not_ready", "deploy conditions require a Ready P24 isolated canary", "p24");
  }
}
