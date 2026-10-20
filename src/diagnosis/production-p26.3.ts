/**
 * P26.3 — cutover hold after #993.
 * Historical P26.2 was frozen to 040e714c and is invalidated now that
 * origin/main moved to 91d4247e. The 040e714c GHCR image succeeded but
 * must not be staged as the current tip. Re-runs the isolated acceptance
 * chain and records I1 / GHCR observations. Does not bind Doctor --fix,
 * cut LIVE, rewrite the ledger, mint provenance, or declare Production
 * Ready. Delivery owns cutover. Diagnosis must not chase the tip with
 * another resign until delivery cuts or origin/main moves for a
 * non-diagnosis reason.
 */
import { evaluateDiagnosisLedgerAlignment } from "./production-admission.js";
import type { DiagnosisIndependentApprovalInput } from "./production-approval-freeze.js";
import {
  DIAGNOSIS_CANARY_POLICY,
  DIAGNOSIS_PRODUCTION_SLO,
  isProductionRemediationLiveExecutorUndeployed,
} from "./production-cutover.js";
import {
  runDiagnosisP25IsolatedCanary,
  type DiagnosisProductionP25Report,
} from "./production-p25.js";
import {
  DIAGNOSIS_P26_2_CUTOVER_OWNER,
  DIAGNOSIS_P26_2_FROZEN_CANDIDATE_SHA,
  DIAGNOSIS_P26_2_DOCKER_RELEASE_STATUSES,
  type DiagnosisP26_2DockerReleaseStatus,
} from "./production-p26.2.js";
import {
  DIAGNOSIS_P26_FROZEN_LIVE_SHA,
  DIAGNOSIS_P26_TENANT,
  runDiagnosisP26ClosedLoopAcceptance,
  type DiagnosisP26Acceptance,
} from "./production-p26.js";
import { DiagnosisContractError } from "./types.js";

export const DIAGNOSIS_PRODUCTION_P26_3_INCREMENT = "P26.3" as const;
export const DIAGNOSIS_PRODUCTION_P26_3_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_P26_3_SIGNATURE_KIND = "human_cutover_hold_record" as const;
export const DIAGNOSIS_P26_3_TENANT = DIAGNOSIS_P26_TENANT;
export const DIAGNOSIS_P26_3_FROZEN_CANDIDATE_SHA =
  "91d4247ee21604f60b37fb1de3cc30209443ef76" as const;
export const DIAGNOSIS_P26_3_FROZEN_LIVE_SHA = DIAGNOSIS_P26_FROZEN_LIVE_SHA;
export const DIAGNOSIS_P26_3_MERGED_PRS = [988, 989, 990, 992, 993] as const;
export const DIAGNOSIS_P26_3_CUTOVER_OWNER = DIAGNOSIS_P26_2_CUTOVER_OWNER;
export const DIAGNOSIS_P26_3_NEXT_OFFICIAL_STEP = "delivery_wait_ghcr_then_cutover" as const;
export const DIAGNOSIS_P26_3_DOCKER_RELEASE_STATUSES = DIAGNOSIS_P26_2_DOCKER_RELEASE_STATUSES;
export type DiagnosisP26_3DockerReleaseStatus = DiagnosisP26_2DockerReleaseStatus;

export type DiagnosisP26_3HumanHoldClaim = {
  kind: typeof DIAGNOSIS_P26_3_SIGNATURE_KIND;
  increment: typeof DIAGNOSIS_PRODUCTION_P26_3_INCREMENT;
  schemaVersion: 1;
  candidateSha: string;
  liveSha: string;
  approvalRecordsEvaluation: true;
  acceptsClientParam: false;
  acceptsModelOutput: false;
  confirmHuman: true;
  confirmCutoverHoldOnly: true;
  confirmHistoricalP26_2Invalidated: true;
  confirmAncestorImageNotCandidate: true;
  confirmNoFurtherDiagnosisResignUntilCutover: true;
  confirmEvaluationOnly: true;
  confirmProductionReady: false;
  confirmNoLiveCutover: true;
  confirmDeliveryOwnsCutover: true;
  confirmLiveExecutorUndeployed: true;
  confirmGhcrNotAssumed: true;
  confirmCanaryTenant: typeof DIAGNOSIS_P26_3_TENANT;
  signer: string;
};

export type DiagnosisProductionP26_3Report = {
  increment: typeof DIAGNOSIS_PRODUCTION_P26_3_INCREMENT;
  schemaVersion: 1;
  rehearsalOnly: true;
  isolatedHoldReady: boolean;
  humanHoldRecorded: boolean;
  identityAligned: boolean;
  candidateSha: string;
  originMainSha: string;
  liveSha: string | null;
  frozenCandidateSha: typeof DIAGNOSIS_P26_3_FROZEN_CANDIDATE_SHA;
  frozenLiveSha: typeof DIAGNOSIS_P26_3_FROZEN_LIVE_SHA;
  exactIdentityMatch: boolean;
  liveEqualsCandidate: false;
  productionSloComplete: false;
  liveExecutorUndeployed: true;
  historicalP26_2CandidateSha: typeof DIAGNOSIS_P26_2_FROZEN_CANDIDATE_SHA;
  historicalP26_2Invalidated: true;
  ancestorImageSha: typeof DIAGNOSIS_P26_2_FROZEN_CANDIDATE_SHA;
  ancestorImagePublished: true;
  ancestorImageForbiddenAsCandidate: true;
  furtherDiagnosisResignBlocked: true;
  nextOfficialStep: typeof DIAGNOSIS_P26_3_NEXT_OFFICIAL_STEP;
  mergedPrs: typeof DIAGNOSIS_P26_3_MERGED_PRS;
  cutoverOwner: typeof DIAGNOSIS_P26_3_CUTOVER_OWNER;
  diagnosisOnlyCutover: false;
  forwardOnly: boolean;
  ghcrImageAvailable: boolean;
  dockerReleaseStatus: DiagnosisP26_3DockerReleaseStatus;
  deliveryMayStage: boolean;
  cutoverSwapExecuted: false;
  acceptance: DiagnosisP26Acceptance;
  blockers: readonly string[];
  canaryTenant: typeof DIAGNOSIS_P26_3_TENANT;
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

export function assertP26_3HoldSource(claim: {
  kind?: string;
  clientParam?: unknown;
  modelOutput?: unknown;
}): void {
  if (claim.clientParam !== undefined) {
    fail("client_param_enablement_forbidden", "client parameters are not P26.3 approval", "claim");
  }
  if (claim.modelOutput !== undefined) {
    fail("model_output_enablement_forbidden", "model output is not P26.3 approval", "claim");
  }
  if (claim.kind !== undefined && claim.kind !== DIAGNOSIS_P26_3_SIGNATURE_KIND) {
    fail("unknown_enablement_source", `unsupported P26.3 source ${claim.kind}`);
  }
}

export async function evaluateDiagnosisProductionP26_3(
  input: DiagnosisIndependentApprovalInput & {
    humanHold?: DiagnosisP26_3HumanHoldClaim;
    liveIsAncestorOfCandidate?: boolean;
    ghcrImageAvailable?: boolean;
    dockerReleaseStatus?: DiagnosisP26_3DockerReleaseStatus;
  },
): Promise<DiagnosisProductionP26_3Report> {
  const recordedAt = new Date(input.now ?? Date.parse("2026-09-06T12:00:00.000Z")).toISOString();
  const candidateSha = normalizeSha(input.candidateSha);
  const originMainSha = normalizeSha(input.originMainSha);
  const liveSha = normalizeSha(input.liveSha);
  if (!candidateSha || !originMainSha) {
    fail("identity_missing", "candidate and origin/main are required", "identity");
  }
  if (candidateSha === DIAGNOSIS_P26_2_FROZEN_CANDIDATE_SHA) {
    fail(
      "ancestor_image_not_candidate",
      "040e714c GHCR must not be staged as the current origin/main tip",
      "identity",
    );
  }
  const exactIdentityMatch =
    candidateSha === DIAGNOSIS_P26_3_FROZEN_CANDIDATE_SHA &&
    originMainSha === DIAGNOSIS_P26_3_FROZEN_CANDIDATE_SHA &&
    liveSha === DIAGNOSIS_P26_3_FROZEN_LIVE_SHA;
  const alignment = evaluateDiagnosisLedgerAlignment({
    liveSha,
    ledgerOpenShas: input.ledgerOpenShas,
    releaseRecordSha: input.releaseRecordSha ?? null,
    provenanceTagSha: input.provenanceTagSha ?? null,
  });
  const liveExecutorUndeployed = isProductionRemediationLiveExecutorUndeployed();
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
    "historical_p26_2_invalidated",
    "ancestor_image_not_candidate",
    "further_diagnosis_resign_blocked",
    ...(ghcrImageAvailable ? [] : ["ghcr_image_unproven"]),
    ...alignment.blockers,
  ];
  const isolatedHoldReady =
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
  const report: DiagnosisProductionP26_3Report = {
    increment: DIAGNOSIS_PRODUCTION_P26_3_INCREMENT,
    schemaVersion: DIAGNOSIS_PRODUCTION_P26_3_SCHEMA_VERSION,
    rehearsalOnly: true,
    isolatedHoldReady,
    humanHoldRecorded: false,
    identityAligned: exactIdentityMatch && alignment.aligned,
    candidateSha,
    originMainSha,
    liveSha,
    frozenCandidateSha: DIAGNOSIS_P26_3_FROZEN_CANDIDATE_SHA,
    frozenLiveSha: DIAGNOSIS_P26_3_FROZEN_LIVE_SHA,
    exactIdentityMatch,
    liveEqualsCandidate: false,
    productionSloComplete: false,
    liveExecutorUndeployed: true,
    historicalP26_2CandidateSha: DIAGNOSIS_P26_2_FROZEN_CANDIDATE_SHA,
    historicalP26_2Invalidated: true,
    ancestorImageSha: DIAGNOSIS_P26_2_FROZEN_CANDIDATE_SHA,
    ancestorImagePublished: true,
    ancestorImageForbiddenAsCandidate: true,
    furtherDiagnosisResignBlocked: true,
    nextOfficialStep: DIAGNOSIS_P26_3_NEXT_OFFICIAL_STEP,
    mergedPrs: DIAGNOSIS_P26_3_MERGED_PRS,
    cutoverOwner: DIAGNOSIS_P26_3_CUTOVER_OWNER,
    diagnosisOnlyCutover: false,
    forwardOnly,
    ghcrImageAvailable,
    dockerReleaseStatus,
    deliveryMayStage,
    cutoverSwapExecuted: false,
    acceptance,
    blockers,
    canaryTenant: DIAGNOSIS_P26_3_TENANT,
    trafficSwitched: false,
    approvedForProductionCutover: false,
    p26Evaluated: true,
    p26ProductionReady: false,
    recordedAt,
    note: "P26.3 cutover hold after #993. Historical P26.2 SHA is invalidated. Isolated chain still holds. I1 allows forward motion. 040e714c GHCR succeeded but is not the current tip. GHCR for 91d4247e is not assumed. Diagnosis must not open another SHA resign until delivery cuts. Production Ready stays No-Go.",
  };
  if (!input.humanHold) {
    return report;
  }
  return recordDiagnosisP26_3HumanHold(report, input.humanHold, { now: input.now });
}

export function recordDiagnosisP26_3HumanHold(
  report: DiagnosisProductionP26_3Report,
  claim: DiagnosisP26_3HumanHoldClaim,
  input: { now?: number } = {},
): DiagnosisProductionP26_3Report {
  assertP26_3HoldSource(claim);
  if (claim.increment !== DIAGNOSIS_PRODUCTION_P26_3_INCREMENT) {
    fail("increment_mismatch", "hold claim must target P26.3", "increment");
  }
  if (
    !claim.confirmHuman ||
    !claim.approvalRecordsEvaluation ||
    !claim.confirmCutoverHoldOnly ||
    !claim.confirmHistoricalP26_2Invalidated ||
    !claim.confirmAncestorImageNotCandidate ||
    !claim.confirmNoFurtherDiagnosisResignUntilCutover ||
    !claim.confirmEvaluationOnly ||
    claim.confirmProductionReady ||
    !claim.confirmNoLiveCutover ||
    !claim.confirmDeliveryOwnsCutover ||
    !claim.confirmLiveExecutorUndeployed ||
    !claim.confirmGhcrNotAssumed
  ) {
    fail("enablement_confirm_missing", "P26.3 hold confirmations are required", "claim");
  }
  if (claim.confirmCanaryTenant !== DIAGNOSIS_P26_3_TENANT) {
    fail("canary_tenant_mismatch", "P26.3 must stay on internal single tenant", "claim");
  }
  const candidateSha = normalizeSha(claim.candidateSha);
  const liveSha = normalizeSha(claim.liveSha);
  if (
    candidateSha !== DIAGNOSIS_P26_3_FROZEN_CANDIDATE_SHA ||
    liveSha !== DIAGNOSIS_P26_3_FROZEN_LIVE_SHA
  ) {
    fail("identity_mismatch", "P26.3 claim must match frozen candidate and LIVE SHAs");
  }
  if (candidateSha !== report.candidateSha || liveSha !== report.liveSha) {
    fail("report_identity_mismatch", "P26.3 claim must match evaluated identity", "identity");
  }
  if (!claim.signer.trim()) {
    fail("signer_missing", "P26.3 claim requires a human signer", "signer");
  }
  if (!report.isolatedHoldReady || report.p26ProductionReady || report.deliveryMayStage) {
    fail(
      "p26_3_not_ready",
      "P26.3 may record a hold only while GHCR is unproven and Production Ready stays false",
      "p26.3",
    );
  }
  return {
    ...report,
    humanHoldRecorded: true,
    recordedAt: new Date(input.now ?? Date.parse("2026-09-06T12:00:00.000Z")).toISOString(),
    note: "P26.3 cutover hold recorded as No-Go. Delivery waits for GHCR of the then-current origin/main, then stages and swaps. Diagnosis must not chase the tip or declare Production Ready.",
  };
}

export function renderDiagnosisProductionP26_3Markdown(
  report: DiagnosisProductionP26_3Report,
): string {
  return [
    `# OpenBot Diagnosis Platform — P26.3 统一窗口 cutover hold`,
    ``,
    `Date: 2026-09-06`,
    ``,
    `Status: **${report.p26ProductionReady ? "Production Ready" : report.humanHoldRecorded ? "Cutover hold No-Go" : report.isolatedHoldReady ? "Ready for Daniel/CEO signing" : "No-Go"}**`,
    ``,
    `## Identity (exact match required)`,
    ``,
    `- candidate/origin-main: \`${report.candidateSha}\``,
    `- LIVE: \`${report.liveSha ?? "unknown"}\``,
    `- historical P26.2 candidate: \`${report.historicalP26_2CandidateSha}\` invalidated=${String(report.historicalP26_2Invalidated)}`,
    `- ancestor image: \`${report.ancestorImageSha}\` published=${String(report.ancestorImagePublished)} forbidden=${String(report.ancestorImageForbiddenAsCandidate)}`,
    `- merged PRs: ${report.mergedPrs.map((n) => `#${n}`).join(", ")}`,
    `- cutoverOwner: ${report.cutoverOwner}`,
    `- nextOfficialStep: ${report.nextOfficialStep}`,
    `- furtherDiagnosisResignBlocked: ${String(report.furtherDiagnosisResignBlocked)}`,
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

export function assertDiagnosisProductionP26_3Evaluated(
  report: DiagnosisProductionP26_3Report,
): void {
  if (!report.isolatedHoldReady || !report.humanHoldRecorded) {
    fail("p26_3_not_evaluated", "P26.3 cutover hold must be signed and identity-aligned", "p26.3");
  }
  if (
    report.p26ProductionReady ||
    report.trafficSwitched ||
    report.diagnosisOnlyCutover ||
    report.cutoverSwapExecuted ||
    report.deliveryMayStage ||
    !report.furtherDiagnosisResignBlocked
  ) {
    fail("p26_3_surface_violation", "P26.3 must not declare Production Ready or cut LIVE", "p26.3");
  }
}
