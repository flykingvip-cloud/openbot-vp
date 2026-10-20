/**
 * P26.1 — post-merge closed-loop re-evaluation after #988/#989/#990.
 * Historical snapshot: frozen candidate `7d75c0bb` is not current
 * origin/main (`643dcd6a4f` at A4 close). No-Go semantics are unchanged:
 * p26ProductionReady=false, no LIVE cut, no gate, no Doctor --fix.
 * Updating this comment does not resign the frozen identity and does not
 * mean production deployment completed.
 *
 * Historical P26 was frozen to 0d8a31a2 and is invalidated now that
 * origin/main moved. Re-runs the isolated acceptance chain against the
 * new tip. Does not bind Doctor --fix, cut LIVE, rewrite the ledger,
 * mint provenance, or declare Production Ready. Delivery owns cutover.
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
  DIAGNOSIS_P26_FROZEN_CANDIDATE_SHA,
  DIAGNOSIS_P26_FROZEN_LIVE_SHA,
  DIAGNOSIS_P26_TENANT,
  runDiagnosisP26ClosedLoopAcceptance,
  type DiagnosisP26Acceptance,
} from "./production-p26.js";
import { DiagnosisContractError, isDiagnosisContractError } from "./types.js";

export const DIAGNOSIS_PRODUCTION_P26_1_INCREMENT = "P26.1" as const;
export const DIAGNOSIS_PRODUCTION_P26_1_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_P26_1_SIGNATURE_KIND = "human_postmerge_readiness_record" as const;
export const DIAGNOSIS_P26_1_TENANT = DIAGNOSIS_P26_TENANT;
export const DIAGNOSIS_P26_1_FROZEN_CANDIDATE_SHA =
  "7d75c0bba6ab692f1396cde3d366a10c68ae092d" as const;
export const DIAGNOSIS_P26_1_FROZEN_LIVE_SHA = DIAGNOSIS_P26_FROZEN_LIVE_SHA;
export const DIAGNOSIS_P26_1_MERGED_PRS = [988, 989, 990] as const;
export const DIAGNOSIS_P26_1_CUTOVER_OWNER = "delivery" as const;

export type DiagnosisP26_1HumanReevalClaim = {
  kind: typeof DIAGNOSIS_P26_1_SIGNATURE_KIND;
  increment: typeof DIAGNOSIS_PRODUCTION_P26_1_INCREMENT;
  schemaVersion: 1;
  candidateSha: string;
  liveSha: string;
  approvalRecordsEvaluation: true;
  acceptsClientParam: false;
  acceptsModelOutput: false;
  confirmHuman: true;
  confirmPostMergeReeval: true;
  confirmHistoricalP26Invalidated: true;
  confirmEvaluationOnly: true;
  confirmProductionReady: false;
  confirmNoLiveCutover: true;
  confirmDeliveryOwnsCutover: true;
  confirmLiveExecutorUndeployed: true;
  confirmCanaryTenant: typeof DIAGNOSIS_P26_1_TENANT;
  signer: string;
};

export type DiagnosisProductionP26_1Report = {
  increment: typeof DIAGNOSIS_PRODUCTION_P26_1_INCREMENT;
  schemaVersion: 1;
  rehearsalOnly: true;
  isolatedReevalReady: boolean;
  humanReevalRecorded: boolean;
  identityAligned: boolean;
  candidateSha: string;
  originMainSha: string;
  liveSha: string | null;
  frozenCandidateSha: typeof DIAGNOSIS_P26_1_FROZEN_CANDIDATE_SHA;
  frozenLiveSha: typeof DIAGNOSIS_P26_1_FROZEN_LIVE_SHA;
  exactIdentityMatch: boolean;
  liveEqualsCandidate: false;
  productionSloComplete: false;
  liveExecutorUndeployed: true;
  historicalP26CandidateSha: typeof DIAGNOSIS_P26_FROZEN_CANDIDATE_SHA;
  historicalP26Invalidated: true;
  historicalP26RequiresResign: true;
  mergedPrs: typeof DIAGNOSIS_P26_1_MERGED_PRS;
  cutoverOwner: typeof DIAGNOSIS_P26_1_CUTOVER_OWNER;
  diagnosisOnlyCutover: false;
  forwardOnly: true;
  acceptance: DiagnosisP26Acceptance;
  blockers: readonly string[];
  canaryTenant: typeof DIAGNOSIS_P26_1_TENANT;
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

export function assertP26_1ReevalSource(claim: {
  kind?: string;
  clientParam?: unknown;
  modelOutput?: unknown;
}): void {
  if (claim.clientParam !== undefined) {
    fail("client_param_enablement_forbidden", "client parameters are not P26.1 approval", "claim");
  }
  if (claim.modelOutput !== undefined) {
    fail("model_output_enablement_forbidden", "model output is not P26.1 approval", "claim");
  }
  if (claim.kind !== undefined && claim.kind !== DIAGNOSIS_P26_1_SIGNATURE_KIND) {
    fail("unknown_enablement_source", `unsupported P26.1 source ${claim.kind}`);
  }
}

export async function evaluateDiagnosisProductionP26_1(
  input: DiagnosisIndependentApprovalInput & {
    humanReeval?: DiagnosisP26_1HumanReevalClaim;
    liveIsAncestorOfCandidate?: boolean;
  },
): Promise<DiagnosisProductionP26_1Report> {
  const recordedAt = new Date(input.now ?? Date.parse("2026-09-06T10:40:00.000Z")).toISOString();
  const candidateSha = normalizeSha(input.candidateSha);
  const originMainSha = normalizeSha(input.originMainSha);
  const liveSha = normalizeSha(input.liveSha);
  if (!candidateSha || !originMainSha) {
    fail("identity_missing", "candidate and origin/main are required", "identity");
  }
  const exactIdentityMatch =
    candidateSha === DIAGNOSIS_P26_1_FROZEN_CANDIDATE_SHA &&
    originMainSha === DIAGNOSIS_P26_1_FROZEN_CANDIDATE_SHA &&
    liveSha === DIAGNOSIS_P26_1_FROZEN_LIVE_SHA;
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
  const blockers = [
    ...(liveSha === candidateSha ? [] : ["live_not_equal_candidate"]),
    ...((DIAGNOSIS_PRODUCTION_SLO.completeness as string) === "complete"
      ? []
      : ["production_slo_empty"]),
    "live_executor_undeployed",
    "live_cutover_pending",
    "production_ready_not_separately_approved",
    "historical_p26_invalidated",
    ...alignment.blockers,
  ];
  const isolatedReevalReady =
    exactIdentityMatch &&
    input.liveSource === "container" &&
    Boolean(input.liveIsAncestorOfCandidate) &&
    canary.probesPassed &&
    acceptance.probesPassed &&
    liveExecutorUndeployed &&
    DIAGNOSIS_CANARY_POLICY.firstStage === "internal_single_tenant" &&
    DIAGNOSIS_CANARY_POLICY.started &&
    blockers.includes("live_not_equal_candidate") &&
    blockers.includes("production_slo_empty");
  const report: DiagnosisProductionP26_1Report = {
    increment: DIAGNOSIS_PRODUCTION_P26_1_INCREMENT,
    schemaVersion: DIAGNOSIS_PRODUCTION_P26_1_SCHEMA_VERSION,
    rehearsalOnly: true,
    isolatedReevalReady,
    humanReevalRecorded: false,
    identityAligned: exactIdentityMatch && alignment.aligned,
    candidateSha,
    originMainSha,
    liveSha,
    frozenCandidateSha: DIAGNOSIS_P26_1_FROZEN_CANDIDATE_SHA,
    frozenLiveSha: DIAGNOSIS_P26_1_FROZEN_LIVE_SHA,
    exactIdentityMatch,
    liveEqualsCandidate: false,
    productionSloComplete: false,
    liveExecutorUndeployed: true,
    historicalP26CandidateSha: DIAGNOSIS_P26_FROZEN_CANDIDATE_SHA,
    historicalP26Invalidated: true,
    historicalP26RequiresResign: true,
    mergedPrs: DIAGNOSIS_P26_1_MERGED_PRS,
    cutoverOwner: DIAGNOSIS_P26_1_CUTOVER_OWNER,
    diagnosisOnlyCutover: false,
    forwardOnly: true,
    acceptance,
    blockers,
    canaryTenant: DIAGNOSIS_P26_1_TENANT,
    trafficSwitched: false,
    approvedForProductionCutover: false,
    p26Evaluated: true,
    p26ProductionReady: false,
    recordedAt,
    note: "P26.1 post-merge re-eval after #988/#989/#990. Historical P26 SHA is invalidated. Isolated chain still holds. Production Ready stays No-Go until delivery cuts LIVE to this origin/main tip and a separate approval is recorded.",
  };
  if (!input.humanReeval) {
    return report;
  }
  return recordDiagnosisP26_1HumanReeval(report, input.humanReeval, { now: input.now });
}

export function recordDiagnosisP26_1HumanReeval(
  report: DiagnosisProductionP26_1Report,
  claim: DiagnosisP26_1HumanReevalClaim,
  input: { now?: number } = {},
): DiagnosisProductionP26_1Report {
  assertP26_1ReevalSource(claim);
  if (claim.increment !== DIAGNOSIS_PRODUCTION_P26_1_INCREMENT) {
    fail("increment_mismatch", "reeval claim must target P26.1", "increment");
  }
  if (
    !claim.confirmHuman ||
    !claim.approvalRecordsEvaluation ||
    !claim.confirmPostMergeReeval ||
    !claim.confirmHistoricalP26Invalidated ||
    !claim.confirmEvaluationOnly ||
    claim.confirmProductionReady ||
    !claim.confirmNoLiveCutover ||
    !claim.confirmDeliveryOwnsCutover ||
    !claim.confirmLiveExecutorUndeployed
  ) {
    fail("enablement_confirm_missing", "P26.1 re-eval confirmations are required", "claim");
  }
  if (claim.confirmCanaryTenant !== DIAGNOSIS_P26_1_TENANT) {
    fail("canary_tenant_mismatch", "P26.1 must stay on internal single tenant", "claim");
  }
  const candidateSha = normalizeSha(claim.candidateSha);
  const liveSha = normalizeSha(claim.liveSha);
  if (
    candidateSha !== DIAGNOSIS_P26_1_FROZEN_CANDIDATE_SHA ||
    liveSha !== DIAGNOSIS_P26_1_FROZEN_LIVE_SHA
  ) {
    fail("identity_mismatch", "P26.1 claim must match frozen candidate and LIVE SHAs");
  }
  if (candidateSha !== report.candidateSha || liveSha !== report.liveSha) {
    fail("report_identity_mismatch", "P26.1 claim must match evaluated identity", "identity");
  }
  if (!claim.signer.trim()) {
    fail("signer_missing", "P26.1 claim requires a human signer", "signer");
  }
  if (!report.isolatedReevalReady || report.p26ProductionReady) {
    fail(
      "p26_1_not_ready",
      "P26.1 may record evaluation only while Production Ready stays false",
      "p26.1",
    );
  }
  return {
    ...report,
    humanReevalRecorded: true,
    recordedAt: new Date(input.now ?? Date.parse("2026-09-06T10:40:00.000Z")).toISOString(),
    note: "P26.1 post-merge re-eval recorded as No-Go. Delivery owns the next unified-window cutover to 7d75c0bb. Diagnosis must not swap LIVE or declare Production Ready.",
  };
}

export function renderDiagnosisProductionP26_1Markdown(
  report: DiagnosisProductionP26_1Report,
): string {
  return [
    `# OpenBot Diagnosis Platform — P26.1 合入后复评`,
    ``,
    `Date: 2026-09-06`,
    ``,
    `Status: **${report.p26ProductionReady ? "Production Ready" : report.humanReevalRecorded ? "Post-merge No-Go" : report.isolatedReevalReady ? "Ready for Daniel/CEO signing" : "No-Go"}**`,
    ``,
    `## Identity (exact match required)`,
    ``,
    `- candidate/origin-main: \`${report.candidateSha}\``,
    `- LIVE: \`${report.liveSha ?? "unknown"}\``,
    `- historical P26 candidate: \`${report.historicalP26CandidateSha}\` invalidated=${String(report.historicalP26Invalidated)}`,
    `- merged PRs: ${report.mergedPrs.map((n) => `#${n}`).join(", ")}`,
    `- cutoverOwner: ${report.cutoverOwner}`,
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

export function assertDiagnosisProductionP26_1Evaluated(
  report: DiagnosisProductionP26_1Report,
): void {
  if (!report.isolatedReevalReady || !report.humanReevalRecorded) {
    fail(
      "p26_1_not_evaluated",
      "P26.1 post-merge re-eval must be signed and identity-aligned",
      "p26.1",
    );
  }
  if (report.p26ProductionReady || report.trafficSwitched || report.diagnosisOnlyCutover) {
    fail("p26_1_surface_violation", "P26.1 must not declare Production Ready or cut LIVE", "p26.1");
  }
}
