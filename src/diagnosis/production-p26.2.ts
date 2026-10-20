/**
 * P26.2 — unified-window cutover readiness after #992.
 * Historical snapshot: frozen candidate `040e714c` is not current
 * origin/main (`643dcd6a4f` at A4 close). No-Go semantics are unchanged:
 * p26ProductionReady=false, GHCR unproven stays a blocker, no LIVE cut,
 * no gate. This comment update does not resign the frozen identity and
 * does not mean production deployment completed. P26.3+ already
 * invalidated this window; do not stage `040e714c`.
 *
 * Historical P26.1 was frozen to 7d75c0bb and is invalidated now that
 * origin/main moved to 040e714c. Re-runs the isolated acceptance chain
 * and records I1 / GHCR observations. Does not bind Doctor --fix, cut
 * LIVE, rewrite the ledger, mint provenance, or declare Production Ready.
 * Delivery owns cutover. Diagnosis must not swap the live container.
 */
import { evaluateDiagnosisLedgerAlignment } from "./production-admission.js";
import type { DiagnosisIndependentApprovalInput } from "./production-approval-freeze.js";
import {
  DIAGNOSIS_CANARY_POLICY,
  DIAGNOSIS_PRODUCTION_SLO,
  resolveProductionRemediationExecutor,
} from "./production-cutover.js";
import {
  runDiagnosisP25IsolatedCanary,
  type DiagnosisProductionP25Report,
} from "./production-p25.js";
import {
  DIAGNOSIS_P26_1_FROZEN_CANDIDATE_SHA,
  DIAGNOSIS_P26_1_CUTOVER_OWNER,
} from "./production-p26.1.js";
import {
  DIAGNOSIS_P26_FROZEN_LIVE_SHA,
  DIAGNOSIS_P26_TENANT,
  runDiagnosisP26ClosedLoopAcceptance,
  type DiagnosisP26Acceptance,
} from "./production-p26.js";
import { DiagnosisContractError, isDiagnosisContractError } from "./types.js";

export const DIAGNOSIS_PRODUCTION_P26_2_INCREMENT = "P26.2" as const;
export const DIAGNOSIS_PRODUCTION_P26_2_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_P26_2_SIGNATURE_KIND = "human_cutover_readiness_record" as const;
export const DIAGNOSIS_P26_2_TENANT = DIAGNOSIS_P26_TENANT;
export const DIAGNOSIS_P26_2_FROZEN_CANDIDATE_SHA =
  "040e714cfc1266cb9becaa2b42a159dd503a9b89" as const;
export const DIAGNOSIS_P26_2_FROZEN_LIVE_SHA = DIAGNOSIS_P26_FROZEN_LIVE_SHA;
export const DIAGNOSIS_P26_2_MERGED_PRS = [988, 989, 990, 992] as const;
export const DIAGNOSIS_P26_2_CUTOVER_OWNER = DIAGNOSIS_P26_1_CUTOVER_OWNER;
export const DIAGNOSIS_P26_2_DOCKER_RELEASE_STATUSES = [
  "in_progress",
  "success",
  "failure",
  "unknown",
] as const;

export type DiagnosisP26_2DockerReleaseStatus =
  (typeof DIAGNOSIS_P26_2_DOCKER_RELEASE_STATUSES)[number];

export type DiagnosisP26_2HumanReadinessClaim = {
  kind: typeof DIAGNOSIS_P26_2_SIGNATURE_KIND;
  increment: typeof DIAGNOSIS_PRODUCTION_P26_2_INCREMENT;
  schemaVersion: 1;
  candidateSha: string;
  liveSha: string;
  approvalRecordsEvaluation: true;
  acceptsClientParam: false;
  acceptsModelOutput: false;
  confirmHuman: true;
  confirmCutoverReadinessOnly: true;
  confirmHistoricalP26_1Invalidated: true;
  confirmEvaluationOnly: true;
  confirmProductionReady: false;
  confirmNoLiveCutover: true;
  confirmDeliveryOwnsCutover: true;
  confirmLiveExecutorUndeployed: true;
  confirmGhcrNotAssumed: true;
  confirmCanaryTenant: typeof DIAGNOSIS_P26_2_TENANT;
  signer: string;
};

export type DiagnosisProductionP26_2Report = {
  increment: typeof DIAGNOSIS_PRODUCTION_P26_2_INCREMENT;
  schemaVersion: 1;
  rehearsalOnly: true;
  isolatedReadinessReady: boolean;
  humanReadinessRecorded: boolean;
  identityAligned: boolean;
  candidateSha: string;
  originMainSha: string;
  liveSha: string | null;
  frozenCandidateSha: typeof DIAGNOSIS_P26_2_FROZEN_CANDIDATE_SHA;
  frozenLiveSha: typeof DIAGNOSIS_P26_2_FROZEN_LIVE_SHA;
  exactIdentityMatch: boolean;
  liveEqualsCandidate: false;
  productionSloComplete: false;
  liveExecutorUndeployed: true;
  historicalP26_1CandidateSha: typeof DIAGNOSIS_P26_1_FROZEN_CANDIDATE_SHA;
  historicalP26_1Invalidated: true;
  historicalP26_1RequiresResign: true;
  mergedPrs: typeof DIAGNOSIS_P26_2_MERGED_PRS;
  cutoverOwner: typeof DIAGNOSIS_P26_2_CUTOVER_OWNER;
  diagnosisOnlyCutover: false;
  forwardOnly: boolean;
  ghcrImageAvailable: boolean;
  dockerReleaseStatus: DiagnosisP26_2DockerReleaseStatus;
  deliveryMayStage: boolean;
  cutoverSwapExecuted: false;
  acceptance: DiagnosisP26Acceptance;
  blockers: readonly string[];
  canaryTenant: typeof DIAGNOSIS_P26_2_TENANT;
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

export function assertP26_2ReadinessSource(claim: {
  kind?: string;
  clientParam?: unknown;
  modelOutput?: unknown;
}): void {
  if (claim.clientParam !== undefined) {
    fail("client_param_enablement_forbidden", "client parameters are not P26.2 approval", "claim");
  }
  if (claim.modelOutput !== undefined) {
    fail("model_output_enablement_forbidden", "model output is not P26.2 approval", "claim");
  }
  if (claim.kind !== undefined && claim.kind !== DIAGNOSIS_P26_2_SIGNATURE_KIND) {
    fail("unknown_enablement_source", `unsupported P26.2 source ${claim.kind}`);
  }
}

export async function evaluateDiagnosisProductionP26_2(
  input: DiagnosisIndependentApprovalInput & {
    humanReadiness?: DiagnosisP26_2HumanReadinessClaim;
    liveIsAncestorOfCandidate?: boolean;
    ghcrImageAvailable?: boolean;
    dockerReleaseStatus?: DiagnosisP26_2DockerReleaseStatus;
  },
): Promise<DiagnosisProductionP26_2Report> {
  const recordedAt = new Date(input.now ?? Date.parse("2026-09-06T11:10:00.000Z")).toISOString();
  const candidateSha = normalizeSha(input.candidateSha);
  const originMainSha = normalizeSha(input.originMainSha);
  const liveSha = normalizeSha(input.liveSha);
  if (!candidateSha || !originMainSha) {
    fail("identity_missing", "candidate and origin/main are required", "identity");
  }
  const exactIdentityMatch =
    candidateSha === DIAGNOSIS_P26_2_FROZEN_CANDIDATE_SHA &&
    originMainSha === DIAGNOSIS_P26_2_FROZEN_CANDIDATE_SHA &&
    liveSha === DIAGNOSIS_P26_2_FROZEN_LIVE_SHA;
  const alignment = evaluateDiagnosisLedgerAlignment({
    liveSha,
    ledgerOpenShas: input.ledgerOpenShas,
    releaseRecordSha: input.releaseRecordSha ?? null,
    provenanceTagSha: input.provenanceTagSha ?? null,
  });
  let liveExecutorUndeployed = false;
  try {
    resolveProductionRemediationExecutor({ allowlisted: true });
  } catch (err) {
    liveExecutorUndeployed =
      isDiagnosisContractError(err) && err.code === "remediation_live_executor_undeployed";
  }
  const canary = runDiagnosisP25IsolatedCanary();
  const acceptance = await runDiagnosisP26ClosedLoopAcceptance({
    canary,
  } as DiagnosisProductionP25Report);
  const forwardOnly = Boolean(input.liveIsAncestorOfCandidate) && liveSha !== candidateSha;
  const ghcrImageAvailable = input.ghcrImageAvailable === true;
  const dockerReleaseStatus = input.dockerReleaseStatus ?? "unknown";
  const deliveryMayStage = exactIdentityMatch && forwardOnly && ghcrImageAvailable;
  const blockers = [
    ...(liveSha === candidateSha ? [] : ["live_not_equal_candidate"]),
    ...((DIAGNOSIS_PRODUCTION_SLO.completeness as string) === "complete"
      ? []
      : ["production_slo_empty"]),
    "live_executor_undeployed",
    "live_cutover_pending",
    "production_ready_not_separately_approved",
    "historical_p26_1_invalidated",
    ...(ghcrImageAvailable ? [] : ["ghcr_image_unproven"]),
    ...alignment.blockers,
  ];
  const isolatedReadinessReady =
    exactIdentityMatch &&
    input.liveSource === "container" &&
    forwardOnly &&
    canary.probesPassed &&
    acceptance.probesPassed &&
    liveExecutorUndeployed &&
    DIAGNOSIS_CANARY_POLICY.firstStage === "internal_single_tenant" &&
    DIAGNOSIS_CANARY_POLICY.started &&
    blockers.includes("live_not_equal_candidate") &&
    blockers.includes("production_slo_empty") &&
    !deliveryMayStage;
  const report: DiagnosisProductionP26_2Report = {
    increment: DIAGNOSIS_PRODUCTION_P26_2_INCREMENT,
    schemaVersion: DIAGNOSIS_PRODUCTION_P26_2_SCHEMA_VERSION,
    rehearsalOnly: true,
    isolatedReadinessReady,
    humanReadinessRecorded: false,
    identityAligned: exactIdentityMatch && alignment.aligned,
    candidateSha,
    originMainSha,
    liveSha,
    frozenCandidateSha: DIAGNOSIS_P26_2_FROZEN_CANDIDATE_SHA,
    frozenLiveSha: DIAGNOSIS_P26_2_FROZEN_LIVE_SHA,
    exactIdentityMatch,
    liveEqualsCandidate: false,
    productionSloComplete: false,
    liveExecutorUndeployed: true,
    historicalP26_1CandidateSha: DIAGNOSIS_P26_1_FROZEN_CANDIDATE_SHA,
    historicalP26_1Invalidated: true,
    historicalP26_1RequiresResign: true,
    mergedPrs: DIAGNOSIS_P26_2_MERGED_PRS,
    cutoverOwner: DIAGNOSIS_P26_2_CUTOVER_OWNER,
    diagnosisOnlyCutover: false,
    forwardOnly,
    ghcrImageAvailable,
    dockerReleaseStatus,
    deliveryMayStage,
    cutoverSwapExecuted: false,
    acceptance,
    blockers,
    canaryTenant: DIAGNOSIS_P26_2_TENANT,
    trafficSwitched: false,
    approvedForProductionCutover: false,
    p26Evaluated: true,
    p26ProductionReady: false,
    recordedAt,
    note: "P26.2 cutover readiness after #992. Historical P26.1 SHA is invalidated. Isolated chain still holds. I1 allows forward motion. GHCR for 040e714c is not assumed. Production Ready stays No-Go. Delivery owns staging and swap.",
  };
  if (!input.humanReadiness) {
    return report;
  }
  return recordDiagnosisP26_2HumanReadiness(report, input.humanReadiness, { now: input.now });
}

export function recordDiagnosisP26_2HumanReadiness(
  report: DiagnosisProductionP26_2Report,
  claim: DiagnosisP26_2HumanReadinessClaim,
  input: { now?: number } = {},
): DiagnosisProductionP26_2Report {
  assertP26_2ReadinessSource(claim);
  if (claim.increment !== DIAGNOSIS_PRODUCTION_P26_2_INCREMENT) {
    fail("increment_mismatch", "readiness claim must target P26.2", "increment");
  }
  if (
    !claim.confirmHuman ||
    !claim.approvalRecordsEvaluation ||
    !claim.confirmCutoverReadinessOnly ||
    !claim.confirmHistoricalP26_1Invalidated ||
    !claim.confirmEvaluationOnly ||
    claim.confirmProductionReady ||
    !claim.confirmNoLiveCutover ||
    !claim.confirmDeliveryOwnsCutover ||
    !claim.confirmLiveExecutorUndeployed ||
    !claim.confirmGhcrNotAssumed
  ) {
    fail("enablement_confirm_missing", "P26.2 readiness confirmations are required", "claim");
  }
  if (claim.confirmCanaryTenant !== DIAGNOSIS_P26_2_TENANT) {
    fail("canary_tenant_mismatch", "P26.2 must stay on internal single tenant", "claim");
  }
  const candidateSha = normalizeSha(claim.candidateSha);
  const liveSha = normalizeSha(claim.liveSha);
  if (
    candidateSha !== DIAGNOSIS_P26_2_FROZEN_CANDIDATE_SHA ||
    liveSha !== DIAGNOSIS_P26_2_FROZEN_LIVE_SHA
  ) {
    fail("identity_mismatch", "P26.2 claim must match frozen candidate and LIVE SHAs");
  }
  if (candidateSha !== report.candidateSha || liveSha !== report.liveSha) {
    fail("report_identity_mismatch", "P26.2 claim must match evaluated identity", "identity");
  }
  if (!claim.signer.trim()) {
    fail("signer_missing", "P26.2 claim requires a human signer", "signer");
  }
  if (!report.isolatedReadinessReady || report.p26ProductionReady || report.deliveryMayStage) {
    fail(
      "p26_2_not_ready",
      "P26.2 may record readiness only while GHCR is unproven and Production Ready stays false",
      "p26.2",
    );
  }
  return {
    ...report,
    humanReadinessRecorded: true,
    recordedAt: new Date(input.now ?? Date.parse("2026-09-06T11:10:00.000Z")).toISOString(),
    note: "P26.2 cutover readiness recorded as No-Go. Delivery may plan the unified window for 040e714c after Docker Release publishes GHCR. Diagnosis must not swap LIVE or declare Production Ready.",
  };
}

export function renderDiagnosisProductionP26_2Markdown(
  report: DiagnosisProductionP26_2Report,
): string {
  return [
    `# OpenBot Diagnosis Platform — P26.2 统一窗口 cutover 就绪`,
    ``,
    `Date: 2026-09-06`,
    ``,
    `Status: **${report.p26ProductionReady ? "Production Ready" : report.humanReadinessRecorded ? "Cutover-ready No-Go" : report.isolatedReadinessReady ? "Ready for Daniel/CEO signing" : "No-Go"}**`,
    ``,
    `## Identity (exact match required)`,
    ``,
    `- candidate/origin-main: \`${report.candidateSha}\``,
    `- LIVE: \`${report.liveSha ?? "unknown"}\``,
    `- historical P26.1 candidate: \`${report.historicalP26_1CandidateSha}\` invalidated=${String(report.historicalP26_1Invalidated)}`,
    `- merged PRs: ${report.mergedPrs.map((n) => `#${n}`).join(", ")}`,
    `- cutoverOwner: ${report.cutoverOwner}`,
    `- forwardOnly: ${String(report.forwardOnly)}`,
    `- ghcrImageAvailable: ${String(report.ghcrImageAvailable)}`,
    `- dockerReleaseStatus: ${report.dockerReleaseStatus}`,
    `- deliveryMayStage: ${String(report.deliveryMayStage)}`,
    `- p26ProductionReady: ${String(report.p26ProductionReady)}`,
    ``,
    `## Isolated acceptance`,
    ``,
    `- chainHeld: ${String(report.acceptance.chainHeld)}`,
    `- roleMatrixHeld: ${String(report.acceptance.roleMatrixHeld)}`,
    `- probesPassed: ${String(report.acceptance.probesPassed)}`,
    ``,
    `## Blockers`,
    ``,
    ...report.blockers.map((row) => `- ${row}`),
    ``,
    report.note,
    ``,
  ].join("\n");
}

export function assertDiagnosisProductionP26_2Evaluated(
  report: DiagnosisProductionP26_2Report,
): void {
  if (!report.isolatedReadinessReady || !report.humanReadinessRecorded) {
    fail(
      "p26_2_not_evaluated",
      "P26.2 cutover readiness must be signed and identity-aligned",
      "p26.2",
    );
  }
  if (
    report.p26ProductionReady ||
    report.trafficSwitched ||
    report.diagnosisOnlyCutover ||
    report.cutoverSwapExecuted ||
    report.deliveryMayStage
  ) {
    fail("p26_2_surface_violation", "P26.2 must not declare Production Ready or cut LIVE", "p26.2");
  }
}
