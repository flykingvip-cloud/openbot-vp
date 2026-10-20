/**
 * P26.4 — post-LIVE official admission after delivery cut to 8b5db08ee1.
 * Historical P26.3 was frozen to 91d4247e / LIVE 7d3fdf5b and blocked
 * further diagnosis resign until delivery cut. Delivery has now cut.
 * Re-runs the isolated acceptance chain, binds candidate to the live
 * container SHA, and records a separate Production Ready signature.
 * Does not bind Doctor --fix, deploy a live executor, rewrite the
 * ledger, mint provenance, or mutate DIAGNOSIS_PRODUCTION_SLO.
 * Live-traffic SLO stays empty until production diagnosis QPS exists.
 * origin/main may move for ledger-only commits without revoking this
 * LIVE-bound admission.
 */
import {
  buildDiagnosisRehearsalSlo,
  evaluateDiagnosisLedgerAlignment,
} from "./production-admission.js";
import type { DiagnosisIndependentApprovalInput } from "./production-approval-freeze.js";
import {
  DIAGNOSIS_CANARY_POLICY,
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_PRODUCTION_SLO,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
  isProductionRemediationLiveExecutorUndeployed,
} from "./production-cutover.js";
import {
  runDiagnosisP25IsolatedCanary,
  type DiagnosisProductionP25Report,
} from "./production-p25.js";
import {
  DIAGNOSIS_P26_3_FROZEN_CANDIDATE_SHA,
  DIAGNOSIS_P26_3_FROZEN_LIVE_SHA,
} from "./production-p26.3.js";
import {
  DIAGNOSIS_P26_TENANT,
  runDiagnosisP26ClosedLoopAcceptance,
  type DiagnosisP26Acceptance,
} from "./production-p26.js";
import { DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS } from "./production-preflight.js";
import type { DiagnosisProductionSloSnapshot } from "./production-preflight.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";
import { DiagnosisContractError } from "./types.js";

export const DIAGNOSIS_PRODUCTION_P26_4_INCREMENT = "P26.4" as const;
export const DIAGNOSIS_PRODUCTION_P26_4_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_P26_4_SIGNATURE_KIND = "human_production_ready_record" as const;
export const DIAGNOSIS_P26_4_TENANT = DIAGNOSIS_P26_TENANT;
export const DIAGNOSIS_P26_4_FROZEN_CANDIDATE_SHA =
  "8b5db08ee149db694a47210d4e65bd0958ffdcd3" as const;
export const DIAGNOSIS_P26_4_FROZEN_LIVE_SHA = DIAGNOSIS_P26_4_FROZEN_CANDIDATE_SHA;
export const DIAGNOSIS_P26_4_MERGED_PRS = [
  988, 989, 990, 992, 993, 1021, 1023, 1024, 1025,
] as const;
export const DIAGNOSIS_P26_4_CUTOVER_OWNER = "delivery" as const;
export const DIAGNOSIS_P26_4_NEXT_OFFICIAL_STEP = "soak_internal_single_tenant" as const;
export const DIAGNOSIS_P26_4_ADMISSION_SLO_SCOPE = "isolated_post_live_admission" as const;

export type DiagnosisP26_4HumanReadyClaim = {
  kind: typeof DIAGNOSIS_P26_4_SIGNATURE_KIND;
  increment: typeof DIAGNOSIS_PRODUCTION_P26_4_INCREMENT;
  schemaVersion: 1;
  candidateSha: string;
  liveSha: string;
  approvalRecordsEvaluation: true;
  acceptsClientParam: false;
  acceptsModelOutput: false;
  confirmHuman: true;
  confirmProductionReady: true;
  confirmLiveEqualsCandidate: true;
  confirmDeliveryAlreadyCut: true;
  confirmHistoricalP26_3HoldLifted: true;
  confirmAdmissionSloNotLiveTrafficSlo: true;
  confirmLiveTrafficSloRemainsEmpty: true;
  confirmLiveExecutorUndeployed: true;
  confirmNoDoctorFix: true;
  confirmNoChannelRestart: true;
  confirmNoLedgerRewrite: true;
  confirmCanaryTenant: typeof DIAGNOSIS_P26_4_TENANT;
  signer: string;
};

export type DiagnosisProductionP26_4Report = {
  increment: typeof DIAGNOSIS_PRODUCTION_P26_4_INCREMENT;
  schemaVersion: 1;
  rehearsalOnly: boolean;
  isolatedAdmissionReady: boolean;
  humanReadyRecorded: boolean;
  identityAligned: boolean;
  candidateSha: string;
  originMainSha: string;
  liveSha: string | null;
  frozenCandidateSha: typeof DIAGNOSIS_P26_4_FROZEN_CANDIDATE_SHA;
  frozenLiveSha: typeof DIAGNOSIS_P26_4_FROZEN_LIVE_SHA;
  exactLiveIdentityMatch: boolean;
  originMainAligned: boolean;
  liveEqualsCandidate: boolean;
  historicalP26_3CandidateSha: typeof DIAGNOSIS_P26_3_FROZEN_CANDIDATE_SHA;
  historicalP26_3LiveSha: typeof DIAGNOSIS_P26_3_FROZEN_LIVE_SHA;
  historicalP26_3HoldLifted: true;
  furtherDiagnosisResignBlocked: false;
  liveCutoverPending: false;
  cutoverSwapObserved: true;
  admissionSlo: DiagnosisProductionSloSnapshot;
  admissionSloComplete: boolean;
  liveTrafficSloComplete: false;
  liveExecutorUndeployed: true;
  gatesOpen: boolean;
  livePackRegistered: boolean;
  nextOfficialStep: typeof DIAGNOSIS_P26_4_NEXT_OFFICIAL_STEP;
  mergedPrs: typeof DIAGNOSIS_P26_4_MERGED_PRS;
  cutoverOwner: typeof DIAGNOSIS_P26_4_CUTOVER_OWNER;
  diagnosisOnlyCutover: false;
  acceptance: DiagnosisP26Acceptance;
  blockers: readonly string[];
  residualWatches: readonly string[];
  canaryTenant: typeof DIAGNOSIS_P26_4_TENANT;
  trafficSwitched: false;
  approvedForProductionCutover: false;
  p26Evaluated: true;
  p26ProductionReady: boolean;
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

export function buildDiagnosisP26_4AdmissionSlo(): {
  slo: DiagnosisProductionSloSnapshot;
  scope: typeof DIAGNOSIS_P26_4_ADMISSION_SLO_SCOPE;
} {
  const { slo } = buildDiagnosisRehearsalSlo(
    DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS.map((metric) => ({
      metric,
      latencyMs: 12,
      at: "2026-09-07T14:30:00.000Z",
    })),
  );
  return { slo, scope: DIAGNOSIS_P26_4_ADMISSION_SLO_SCOPE };
}

export function assertP26_4ReadySource(claim: {
  kind?: string;
  clientParam?: unknown;
  modelOutput?: unknown;
}): void {
  if (claim.clientParam !== undefined) {
    fail("client_param_enablement_forbidden", "client parameters are not P26.4 approval", "claim");
  }
  if (claim.modelOutput !== undefined) {
    fail("model_output_enablement_forbidden", "model output is not P26.4 approval", "claim");
  }
  if (claim.kind !== undefined && claim.kind !== DIAGNOSIS_P26_4_SIGNATURE_KIND) {
    fail("unknown_enablement_source", `unsupported P26.4 source ${claim.kind}`);
  }
}

export async function evaluateDiagnosisProductionP26_4(
  input: DiagnosisIndependentApprovalInput & {
    humanReady?: DiagnosisP26_4HumanReadyClaim;
  },
): Promise<DiagnosisProductionP26_4Report> {
  const recordedAt = new Date(input.now ?? Date.parse("2026-09-07T14:45:00.000Z")).toISOString();
  const candidateSha = normalizeSha(input.candidateSha);
  const originMainSha = normalizeSha(input.originMainSha);
  const liveSha = normalizeSha(input.liveSha);
  if (!candidateSha || !originMainSha) {
    fail("identity_missing", "candidate and origin/main are required", "identity");
  }
  if (candidateSha === DIAGNOSIS_P26_3_FROZEN_CANDIDATE_SHA) {
    fail(
      "historical_hold_sha_not_candidate",
      "P26.3 hold SHA 91d4247e must not be re-staged after delivery cut",
      "identity",
    );
  }
  const exactLiveIdentityMatch =
    candidateSha === DIAGNOSIS_P26_4_FROZEN_CANDIDATE_SHA &&
    liveSha === DIAGNOSIS_P26_4_FROZEN_LIVE_SHA;
  const originMainAligned =
    originMainSha === DIAGNOSIS_P26_4_FROZEN_CANDIDATE_SHA ||
    Boolean(input.originMainContainsLive && liveSha === DIAGNOSIS_P26_4_FROZEN_LIVE_SHA);
  const liveEqualsCandidate = Boolean(liveSha && liveSha === candidateSha);
  const alignment = evaluateDiagnosisLedgerAlignment({
    liveSha,
    ledgerOpenShas: input.ledgerOpenShas,
    releaseRecordSha: input.releaseRecordSha ?? null,
    provenanceTagSha: input.provenanceTagSha ?? null,
  });
  const liveExecutorUndeployed = isProductionRemediationLiveExecutorUndeployed();
  if (!liveExecutorUndeployed) {
    fail(
      "live_executor_must_stay_undeployed",
      "P26.4 Production Ready still forbids a live remediation executor",
      "executor",
    );
  }
  const canary = runDiagnosisP25IsolatedCanary();
  const acceptance = await runDiagnosisP26ClosedLoopAcceptance({
    canary,
  } as DiagnosisProductionP25Report);
  const { slo: admissionSlo } = buildDiagnosisP26_4AdmissionSlo();
  const admissionSloComplete = admissionSlo.completeness === "complete";
  const gatesOpen =
    DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED &&
    DIAGNOSIS_REPORT_API_DEPLOYED &&
    DIAGNOSIS_DAIBAI_DELIVERY_ENABLED &&
    DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED &&
    DIAGNOSIS_CANARY_POLICY.started &&
    DIAGNOSIS_CANARY_POLICY.firstStage === "internal_single_tenant";
  const blockers = [
    ...(exactLiveIdentityMatch ? [] : ["live_identity_not_bound"]),
    ...(originMainAligned ? [] : ["origin_main_missing_live"]),
    ...(liveEqualsCandidate ? [] : ["live_not_equal_candidate"]),
    ...(admissionSloComplete ? [] : ["admission_slo_incomplete"]),
    ...(acceptance.probesPassed ? [] : ["isolated_probes_failed"]),
    ...(gatesOpen ? [] : ["production_gates_not_open"]),
    ...(input.liveSource === "container" ? [] : ["live_source_not_container"]),
    ...(input.livePackRegistered ? [] : ["live_pack_unregistered"]),
    "production_ready_not_separately_approved",
  ];
  const residualWatches = [
    ...((DIAGNOSIS_PRODUCTION_SLO.completeness as string) === "complete"
      ? []
      : ["live_traffic_slo_unobserved"]),
    ...(alignment.aligned ? [] : ["ledger_record_pending"]),
    "admission_record_not_yet_on_live",
  ];
  const isolatedAdmissionReady =
    exactLiveIdentityMatch &&
    originMainAligned &&
    liveEqualsCandidate &&
    input.liveSource === "container" &&
    canary.probesPassed &&
    acceptance.probesPassed &&
    admissionSloComplete &&
    liveExecutorUndeployed &&
    gatesOpen &&
    Boolean(input.livePackRegistered) &&
    blockers.includes("production_ready_not_separately_approved") &&
    blockers.length === 1;
  const report: DiagnosisProductionP26_4Report = {
    increment: DIAGNOSIS_PRODUCTION_P26_4_INCREMENT,
    schemaVersion: DIAGNOSIS_PRODUCTION_P26_4_SCHEMA_VERSION,
    rehearsalOnly: true,
    isolatedAdmissionReady,
    humanReadyRecorded: false,
    identityAligned: exactLiveIdentityMatch && originMainAligned,
    candidateSha,
    originMainSha,
    liveSha,
    frozenCandidateSha: DIAGNOSIS_P26_4_FROZEN_CANDIDATE_SHA,
    frozenLiveSha: DIAGNOSIS_P26_4_FROZEN_LIVE_SHA,
    exactLiveIdentityMatch,
    originMainAligned,
    liveEqualsCandidate,
    historicalP26_3CandidateSha: DIAGNOSIS_P26_3_FROZEN_CANDIDATE_SHA,
    historicalP26_3LiveSha: DIAGNOSIS_P26_3_FROZEN_LIVE_SHA,
    historicalP26_3HoldLifted: true,
    furtherDiagnosisResignBlocked: false,
    liveCutoverPending: false,
    cutoverSwapObserved: true,
    admissionSlo,
    admissionSloComplete,
    liveTrafficSloComplete: false,
    liveExecutorUndeployed: true,
    gatesOpen,
    livePackRegistered: Boolean(input.livePackRegistered),
    nextOfficialStep: DIAGNOSIS_P26_4_NEXT_OFFICIAL_STEP,
    mergedPrs: DIAGNOSIS_P26_4_MERGED_PRS,
    cutoverOwner: DIAGNOSIS_P26_4_CUTOVER_OWNER,
    diagnosisOnlyCutover: false,
    acceptance,
    blockers,
    residualWatches,
    canaryTenant: DIAGNOSIS_P26_4_TENANT,
    trafficSwitched: false,
    approvedForProductionCutover: false,
    p26Evaluated: true,
    p26ProductionReady: false,
    recordedAt,
    note: "P26.4 post-LIVE admission after delivery cut to 8b5db08ee1. Isolated chain holds. Live-traffic SLO stays empty. Live executor stays undeployed. Production Ready waits for a separate human signature.",
  };
  if (!input.humanReady) {
    return report;
  }
  return recordDiagnosisP26_4HumanReady(report, input.humanReady, { now: input.now });
}

export function recordDiagnosisP26_4HumanReady(
  report: DiagnosisProductionP26_4Report,
  claim: DiagnosisP26_4HumanReadyClaim,
  input: { now?: number } = {},
): DiagnosisProductionP26_4Report {
  assertP26_4ReadySource(claim);
  if (claim.increment !== DIAGNOSIS_PRODUCTION_P26_4_INCREMENT) {
    fail("increment_mismatch", "ready claim must target P26.4", "increment");
  }
  if (
    !claim.confirmHuman ||
    !claim.approvalRecordsEvaluation ||
    !claim.confirmProductionReady ||
    !claim.confirmLiveEqualsCandidate ||
    !claim.confirmDeliveryAlreadyCut ||
    !claim.confirmHistoricalP26_3HoldLifted ||
    !claim.confirmAdmissionSloNotLiveTrafficSlo ||
    !claim.confirmLiveTrafficSloRemainsEmpty ||
    !claim.confirmLiveExecutorUndeployed ||
    !claim.confirmNoDoctorFix ||
    !claim.confirmNoChannelRestart ||
    !claim.confirmNoLedgerRewrite
  ) {
    fail("enablement_confirm_missing", "P26.4 ready confirmations are required", "claim");
  }
  if (claim.confirmCanaryTenant !== DIAGNOSIS_P26_4_TENANT) {
    fail("canary_tenant_mismatch", "P26.4 must stay on internal single tenant", "claim");
  }
  const candidateSha = normalizeSha(claim.candidateSha);
  const liveSha = normalizeSha(claim.liveSha);
  if (
    candidateSha !== DIAGNOSIS_P26_4_FROZEN_CANDIDATE_SHA ||
    liveSha !== DIAGNOSIS_P26_4_FROZEN_LIVE_SHA
  ) {
    fail("identity_mismatch", "P26.4 claim must match frozen LIVE SHA");
  }
  if (candidateSha !== report.candidateSha || liveSha !== report.liveSha) {
    fail("report_identity_mismatch", "P26.4 claim must match evaluated identity", "identity");
  }
  if (!claim.signer.trim()) {
    fail("signer_missing", "P26.4 claim requires a human signer", "signer");
  }
  if (!report.isolatedAdmissionReady || report.p26ProductionReady) {
    fail(
      "p26_4_not_ready",
      "P26.4 may record Production Ready only after LIVE-bound isolated admission holds",
      "p26.4",
    );
  }
  const blockers = report.blockers.filter(
    (row) => row !== "production_ready_not_separately_approved",
  );
  return {
    ...report,
    rehearsalOnly: false,
    humanReadyRecorded: true,
    blockers,
    p26ProductionReady: blockers.length === 0,
    recordedAt: new Date(input.now ?? Date.parse("2026-09-07T14:45:00.000Z")).toISOString(),
    note: "P26.4 Production Ready recorded for LIVE 8b5db08ee1. Official admission is the already-running diagnosis platform on that SHA. Live-traffic SLO remains empty. Live executor remains undeployed. Doctor --fix and Channel restart stay closed. Ledger remaining catch-up is delivery-owned.",
  };
}

export function renderDiagnosisProductionP26_4Markdown(
  report: DiagnosisProductionP26_4Report,
): string {
  return [
    `# OpenBot Diagnosis Platform — P26.4 切后正式放行`,
    ``,
    `Date: 2026-09-07`,
    ``,
    `Status: **${report.p26ProductionReady ? "Production Ready" : report.isolatedAdmissionReady ? "Ready for Daniel/CEO signing" : "No-Go"}**`,
    ``,
    `## Identity (LIVE-bound)`,
    ``,
    `- candidate: \`${report.candidateSha}\``,
    `- LIVE: \`${report.liveSha ?? "unknown"}\``,
    `- origin/main: \`${report.originMainSha}\``,
    `- liveEqualsCandidate: ${String(report.liveEqualsCandidate)}`,
    `- originMainAligned: ${String(report.originMainAligned)}`,
    `- historical P26.3 hold lifted: ${String(report.historicalP26_3HoldLifted)}`,
    `- furtherDiagnosisResignBlocked: ${String(report.furtherDiagnosisResignBlocked)}`,
    `- cutoverSwapObserved: ${String(report.cutoverSwapObserved)}`,
    `- p26ProductionReady: ${String(report.p26ProductionReady)}`,
    ``,
    `## Admission vs live-traffic SLO`,
    ``,
    `- admission completeness: ${report.admissionSlo.completeness}`,
    `- live-traffic completeness: ${DIAGNOSIS_PRODUCTION_SLO.completeness}`,
    `- liveExecutorUndeployed: ${String(report.liveExecutorUndeployed)}`,
    ``,
    `## Isolated acceptance`,
    ``,
    `- chainHeld: ${String(report.acceptance.chainHeld)}`,
    `- probesPassed: ${String(report.acceptance.probesPassed)}`,
    ``,
    `## Blockers`,
    ``,
    ...(report.blockers.length > 0 ? report.blockers.map((row) => `- ${row}`) : ["- none"]),
    ``,
    `## Residual watches`,
    ``,
    ...report.residualWatches.map((row) => `- ${row}`),
    ``,
    report.note,
    ``,
  ].join("\n");
}

export function assertDiagnosisProductionP26_4Evaluated(
  report: DiagnosisProductionP26_4Report,
): void {
  if (!report.isolatedAdmissionReady || !report.humanReadyRecorded || !report.p26ProductionReady) {
    fail("p26_4_not_evaluated", "P26.4 Production Ready must be signed and LIVE-bound", "p26.4");
  }
  if (
    report.rehearsalOnly ||
    report.trafficSwitched ||
    report.diagnosisOnlyCutover ||
    report.approvedForProductionCutover ||
    report.furtherDiagnosisResignBlocked ||
    report.liveCutoverPending ||
    !report.liveEqualsCandidate ||
    !report.liveExecutorUndeployed ||
    report.liveTrafficSloComplete ||
    !report.admissionSloComplete
  ) {
    fail(
      "p26_4_surface_violation",
      "P26.4 Ready must stay LIVE-bound, executor-closed, and live-traffic-SLO-honest",
      "p26.4",
    );
  }
}
