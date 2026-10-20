/**
 * Phase 15 — trunk convergence rehearsal and release-identity evidence chain.
 * Distinguishes ledger / RELEASE_RECORD / provenance consistency, rejects
 * old candidates, and keeps Ready false until production reader/audit/quota
 * are actually available. Embedded P14 rehearsal SLO is not production health.
 * candidate != origin/main, and writes a remint plan without publishing tags.
 * Does not open gates, register live packs, rewrite delivery SoT files, or
 * switch traffic.
 */
import {
  DIAGNOSIS_INDEPENDENT_APPROVAL_DOES_NOT_OPEN_GATES,
  assertDiagnosisIndependentApprovalClosed,
  evaluateDiagnosisIndependentApproval,
  type DiagnosisIndependentApprovalInput,
  type DiagnosisIndependentApprovalReport,
  type DiagnosisLiveSource,
} from "./production-approval-freeze.js";
import { isUnapprovedProductionGateOpen } from "./production-enablement-sequence.js";
import { renderDiagnosisProductionPreflightMarkdown } from "./production-preflight.js";
import { DiagnosisContractError } from "./types.js";

export const DIAGNOSIS_TRUNK_CONVERGENCE_INCREMENT = "P15" as const;
export const DIAGNOSIS_TRUNK_CONVERGENCE_SCHEMA_VERSION = 1 as const;

export type DiagnosisIdentityEvidenceId =
  | "candidate"
  | "origin_main"
  | "live"
  | "ledger"
  | "release_record"
  | "provenance";

export type DiagnosisIdentityEvidence = {
  id: DiagnosisIdentityEvidenceId;
  sha: string | null;
  source: string;
  observedAt: string | null;
  evidence: string;
  provable: boolean;
  consistentWithLive: boolean | null;
  requiredApprover: string;
  blocker: string | null;
};

export type DiagnosisIdentityConsistency = {
  candidateEqualsOriginMain: boolean;
  liveEqualsLedger: boolean;
  liveEqualsReleaseRecord: boolean;
  liveEqualsProvenance: boolean;
};

export type DiagnosisProvenanceRemintPlan = {
  action: "do_not_mint";
  proposedTag: string;
  published: false;
  reason: string;
  requiredApprover: "delivery_ledger_owner";
};

export type DiagnosisTrunkConvergenceInput = DiagnosisIndependentApprovalInput & {
  liveObservedAt?: string | null;
  ledgerObservedAt?: string | null;
  releaseRecordObservedAt?: string | null;
  pullRequestUrl?: string;
};

export type DiagnosisTrunkConvergenceReport = {
  increment: typeof DIAGNOSIS_TRUNK_CONVERGENCE_INCREMENT;
  schemaVersion: 1;
  rehearsalOnly: true;
  readyForIndependentApproval: boolean;
  approvedForProductionCutover: false;
  gatesOpened: false;
  trafficSwitched: false;
  approvalDoesNotOpenGate: true;
  trunk: {
    candidateEqualsOriginMain: boolean;
    liveIsAncestorOfCandidate: boolean;
    liveIsAncestorOfOriginMain: boolean;
    pullRequestUrl: string | null;
  };
  consistency: DiagnosisIdentityConsistency;
  evidence: DiagnosisIdentityEvidence[];
  remintPlan: DiagnosisProvenanceRemintPlan;
  approval: DiagnosisIndependentApprovalReport;
  pendingApprovers: string[];
  recordedAt: string;
};

function fail(code: string, message: string, path = ""): never {
  throw new DiagnosisContractError(code, message, path);
}

function normalizeSha(sha: string | null | undefined): string | null {
  if (!sha) {
    return null;
  }
  const trimmed = sha.trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(trimmed) ? trimmed : null;
}

function short(sha: string | null): string {
  return sha ? sha.slice(0, 12) : "unknown";
}

function sameSha(left: string | null, right: string | null): boolean {
  return Boolean(left && right && left === right);
}

function evidence(row: DiagnosisIdentityEvidence): DiagnosisIdentityEvidence {
  if (!row.provable && !row.blocker) {
    return { ...row, blocker: `${row.id} evidence is missing; fail closed` };
  }
  return row;
}

export function buildDiagnosisIdentityEvidence(input: DiagnosisTrunkConvergenceInput): {
  consistency: DiagnosisIdentityConsistency;
  evidence: DiagnosisIdentityEvidence[];
} {
  const candidateSha = normalizeSha(input.candidateSha);
  const originMainSha = normalizeSha(input.originMainSha);
  const liveSha = normalizeSha(input.liveSha);
  const liveSource: DiagnosisLiveSource = liveSha ? (input.liveSource ?? "injected") : "unknown";
  const open = input.ledgerOpenShas
    .map((sha) => normalizeSha(sha))
    .filter((sha): sha is string => sha !== null);
  const ledgerOpenSha = open.length === 1 ? open[0] : null;
  const releaseRecordSha = normalizeSha(input.releaseRecordSha);
  const provenanceTagSha = normalizeSha(input.provenanceTagSha);
  const consistency: DiagnosisIdentityConsistency = {
    candidateEqualsOriginMain: sameSha(candidateSha, originMainSha),
    liveEqualsLedger: sameSha(liveSha, ledgerOpenSha),
    liveEqualsReleaseRecord: sameSha(liveSha, releaseRecordSha),
    liveEqualsProvenance: sameSha(liveSha, provenanceTagSha),
  };
  const rows: DiagnosisIdentityEvidence[] = [
    evidence({
      id: "candidate",
      sha: candidateSha,
      source: "git rev-parse HEAD",
      observedAt: null,
      evidence: candidateSha
        ? `feature or trunk tip ${short(candidateSha)}`
        : "candidate SHA is missing",
      provable: Boolean(candidateSha),
      consistentWithLive: liveSha ? sameSha(candidateSha, liveSha) : null,
      requiredApprover: "platform_security",
      blocker: consistency.candidateEqualsOriginMain
        ? null
        : `candidate ${short(candidateSha)} != origin/main ${short(originMainSha)}; refuse old candidate`,
    }),
    evidence({
      id: "origin_main",
      sha: originMainSha,
      source: "git rev-parse origin/main",
      observedAt: null,
      evidence: originMainSha
        ? `freshly fetched origin/main ${short(originMainSha)}`
        : "origin/main SHA is missing",
      provable: Boolean(originMainSha),
      consistentWithLive: liveSha ? sameSha(originMainSha, liveSha) : null,
      requiredApprover: "platform_security",
      blocker: originMainSha ? null : "origin/main is unknown; fail closed",
    }),
    evidence({
      id: "live",
      sha: liveSha,
      source: liveSource === "container" ? "container build-info.json" : liveSource,
      observedAt: input.liveObservedAt ?? null,
      evidence:
        liveSource === "container" && liveSha
          ? `running artifact commit ${short(liveSha)}`
          : liveSha
            ? `LIVE ${short(liveSha)} was not read from the running container`
            : "LIVE is unknown; fail closed",
      provable: liveSource === "container" && Boolean(liveSha),
      consistentWithLive: liveSha ? true : null,
      requiredApprover: "delivery_ledger_owner",
      blocker:
        liveSource === "container" && liveSha
          ? null
          : "LIVE must come from the running container; do not rewrite records",
    }),
    evidence({
      id: "ledger",
      sha: ledgerOpenSha,
      source: "open ledger row",
      observedAt: input.ledgerObservedAt ?? null,
      evidence: ledgerOpenSha
        ? `single open row ${short(ledgerOpenSha)}`
        : `ledger has ${open.length} open rows`,
      provable: Boolean(ledgerOpenSha),
      consistentWithLive: consistency.liveEqualsLedger,
      requiredApprover: "delivery_ledger_owner",
      blocker: consistency.liveEqualsLedger
        ? null
        : `ledger ${short(ledgerOpenSha)} != LIVE ${short(liveSha)}; do not rewrite history`,
    }),
    evidence({
      id: "release_record",
      sha: releaseRecordSha,
      source: "Latest cutover",
      observedAt: input.releaseRecordObservedAt ?? null,
      evidence: releaseRecordSha
        ? `Latest cutover ${short(releaseRecordSha)}`
        : "Latest cutover SHA is missing",
      provable: Boolean(releaseRecordSha),
      consistentWithLive: consistency.liveEqualsReleaseRecord,
      requiredApprover: "delivery_ledger_owner",
      blocker: consistency.liveEqualsReleaseRecord
        ? null
        : `Latest cutover ${short(releaseRecordSha)} lags LIVE ${short(liveSha)}; do not mask LIVE`,
    }),
    evidence({
      id: "provenance",
      sha: provenanceTagSha,
      source: "annotated provenance tag^{commit}",
      observedAt: null,
      evidence: provenanceTagSha
        ? `provenance peeled target identifies ${short(provenanceTagSha)}`
        : "provenance tag is missing or has no peeled commit",
      provable: Boolean(provenanceTagSha),
      consistentWithLive: consistency.liveEqualsProvenance,
      requiredApprover: "delivery_ledger_owner",
      blocker: consistency.liveEqualsProvenance
        ? null
        : `missing or mismatched provenance peeled target for LIVE ${short(liveSha)}; P15 must not mint it`,
    }),
  ];
  return { consistency, evidence: rows };
}

export function buildDiagnosisProvenanceRemintPlan(input: {
  liveSha: string | null;
  provenanceTagSha: string | null;
  provenancePublishedAtCutover?: boolean;
}): DiagnosisProvenanceRemintPlan {
  const liveSha = normalizeSha(input.liveSha);
  const tag = `provenance/sha-${short(liveSha)}`;
  if (liveSha && normalizeSha(input.provenanceTagSha) === liveSha) {
    return {
      action: "do_not_mint",
      proposedTag: tag,
      published: false,
      reason: "provenance peeled target already identifies LIVE; no remint is required",
      requiredApprover: "delivery_ledger_owner",
    };
  }
  return {
    action: "do_not_mint",
    proposedTag: tag,
    published: false,
    reason: input.provenancePublishedAtCutover
      ? "a cutover claimed publication but the tag is missing; remint only through the normal release path"
      : "cutover pulled GHCR main without a provenance-sha tag; minting now would fabricate publication",
    requiredApprover: "delivery_ledger_owner",
  };
}

export async function evaluateDiagnosisTrunkConvergence(
  input: DiagnosisTrunkConvergenceInput,
): Promise<DiagnosisTrunkConvergenceReport> {
  const { consistency, evidence: rows } = buildDiagnosisIdentityEvidence(input);
  const remintPlan = buildDiagnosisProvenanceRemintPlan(input);
  const approval = await evaluateDiagnosisIndependentApproval(input);
  const missingEvidence = rows.some((row) => !row.provable || row.blocker !== null);
  const productionDependenciesReady =
    input.readerAvailable && input.auditAvailable && input.quotaAvailable;
  const readyForIndependentApproval =
    approval.readyForIndependentApproval &&
    consistency.candidateEqualsOriginMain &&
    consistency.liveEqualsLedger &&
    consistency.liveEqualsReleaseRecord &&
    consistency.liveEqualsProvenance &&
    productionDependenciesReady &&
    !missingEvidence &&
    !remintPlan.published;
  return {
    increment: DIAGNOSIS_TRUNK_CONVERGENCE_INCREMENT,
    schemaVersion: DIAGNOSIS_TRUNK_CONVERGENCE_SCHEMA_VERSION,
    rehearsalOnly: true,
    readyForIndependentApproval,
    approvedForProductionCutover: false,
    gatesOpened: false,
    trafficSwitched: false,
    approvalDoesNotOpenGate: DIAGNOSIS_INDEPENDENT_APPROVAL_DOES_NOT_OPEN_GATES,
    trunk: {
      candidateEqualsOriginMain: consistency.candidateEqualsOriginMain,
      liveIsAncestorOfCandidate: input.liveIsAncestorOfCandidate,
      liveIsAncestorOfOriginMain: input.originMainContainsLive,
      pullRequestUrl: input.pullRequestUrl ?? null,
    },
    consistency,
    evidence: rows,
    remintPlan,
    approval,
    pendingApprovers: [
      "platform_security",
      "enterprise_admin",
      "employee",
      "delivery_ledger_owner",
    ],
    recordedAt: new Date(input.now ?? Date.parse("2026-09-03T09:00:00.000Z")).toISOString(),
  };
}

export function renderDiagnosisTrunkConvergenceMarkdown(
  report: DiagnosisTrunkConvergenceReport,
): string {
  return [
    `# OpenBot Diagnosis P15 Trunk Convergence`,
    ``,
    `Status: **${report.readyForIndependentApproval ? "Ready for independent approval" : "No-Go"}**.`,
    `P15 ≠ 生产部署。gatesOpened=${String(report.gatesOpened)} approvalDoesNotOpenGate=${String(report.approvalDoesNotOpenGate)}.`,
    ``,
    `## Trunk`,
    ``,
    `- candidateEqualsOriginMain: ${String(report.trunk.candidateEqualsOriginMain)}`,
    `- liveIsAncestorOfCandidate: ${String(report.trunk.liveIsAncestorOfCandidate)}`,
    `- liveIsAncestorOfOriginMain: ${String(report.trunk.liveIsAncestorOfOriginMain)}`,
    `- pullRequest: ${report.trunk.pullRequestUrl ?? "none"}`,
    ``,
    `## Identity consistency`,
    ``,
    `- ledger: ${String(report.consistency.liveEqualsLedger)}`,
    `- RELEASE_RECORD: ${String(report.consistency.liveEqualsReleaseRecord)}`,
    `- provenance: ${String(report.consistency.liveEqualsProvenance)}`,
    ``,
    `## Evidence chain`,
    ``,
    `| Id | SHA | Source | Time | Provable | Approver | Blocker |`,
    `| --- | --- | --- | --- | --- | --- | --- |`,
    ...report.evidence.map(
      (row) =>
        `| ${row.id} | \`${row.sha ?? "unknown"}\` | ${row.source} | ${row.observedAt ?? "n/a"} | ${String(row.provable)} | ${row.requiredApprover} | ${row.blocker ?? "none"} |`,
    ),
    ``,
    `## Provenance remint plan`,
    ``,
    `- action: ${report.remintPlan.action}`,
    `- proposedTag: ${report.remintPlan.proposedTag}`,
    `- published: ${String(report.remintPlan.published)}`,
    `- requiredApprover: ${report.remintPlan.requiredApprover}`,
    `- reason: ${report.remintPlan.reason}`,
    ``,
    renderDiagnosisProductionPreflightMarkdown(report.approval.admission.preflight),
    ``,
  ].join("\n");
}

export function assertDiagnosisTrunkConvergenceClosed(
  report: DiagnosisTrunkConvergenceReport,
): void {
  assertDiagnosisIndependentApprovalClosed(report.approval);
  if (
    report.approvedForProductionCutover ||
    report.gatesOpened ||
    report.trafficSwitched ||
    !report.approvalDoesNotOpenGate ||
    report.remintPlan.published ||
    report.remintPlan.action !== "do_not_mint" ||
    isUnapprovedProductionGateOpen()
  ) {
    fail("trunk_convergence_not_closed", "P15 must not open gates or publish provenance", "p15");
  }
}
