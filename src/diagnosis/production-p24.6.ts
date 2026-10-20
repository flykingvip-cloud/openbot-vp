/**
 * P24.6 — adapters enablement. Official threshold order after P24.5's
 * product-first Da Bai knife: open DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED.
 * Report API and remediation stay closed. Exact candidate/LIVE SHA match.
 * Client params and model output are not approval.
 */
import { DIAGNOSIS_ADMISSION_TENANT } from "./production-admission.js";
import { evaluateDiagnosisLedgerRepair } from "./production-approval-freeze.js";
import type { DiagnosisIndependentApprovalInput } from "./production-approval-freeze.js";
import {
  DIAGNOSIS_CANARY_POLICY,
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
} from "./production-cutover.js";
import {
  DIAGNOSIS_APPROVED_OPEN_GATE_NAMES,
  assertApprovedEnablementPrefix,
  assertEnablementSourceNotClientOrModel,
  isApprovedEnablementPrefixOpen,
  nextEnablementStep,
  type DiagnosisEnablementStepId,
} from "./production-enablement-sequence.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";
import { DiagnosisContractError } from "./types.js";

export const DIAGNOSIS_PRODUCTION_P24_6_INCREMENT = "P24.6" as const;
export const DIAGNOSIS_PRODUCTION_P24_6_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_P24_6_SIGNATURE_KIND = "human_adapters_enablement_record" as const;

export const DIAGNOSIS_P24_6_FROZEN_CANDIDATE_SHA =
  "6bd4569606fd286b7d8b46fb7d9198fb7a134493" as const;
export const DIAGNOSIS_P24_6_FROZEN_LIVE_SHA = "6bd4569606fd286b7d8b46fb7d9198fb7a134493" as const;

export type DiagnosisP24_6HumanSubjectClaim = {
  subject: "gate";
  subjectId:
    | "DIAGNOSIS_DAIBAI_DELIVERY_ENABLED"
    | "DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED"
    | "DIAGNOSIS_REPORT_API_DEPLOYED"
    | "DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED";
  signer: string;
  signed: true;
  decision: "approve";
  valueAfterApproval: boolean;
};

export type DiagnosisP24_6HumanEnablementClaim = {
  kind: typeof DIAGNOSIS_P24_6_SIGNATURE_KIND;
  increment: typeof DIAGNOSIS_PRODUCTION_P24_6_INCREMENT;
  schemaVersion: 1;
  candidateSha: string;
  liveSha: string;
  approvalOpensAdaptersGate: true;
  acceptsClientParam: false;
  acceptsModelOutput: false;
  confirmHuman: true;
  confirmAdaptersOnlyThisIncrement: true;
  confirmCanaryTenant: typeof DIAGNOSIS_ADMISSION_TENANT;
  signer: string;
  subjects: DiagnosisP24_6HumanSubjectClaim[];
};

export type DiagnosisProductionP24_6Report = {
  increment: typeof DIAGNOSIS_PRODUCTION_P24_6_INCREMENT;
  schemaVersion: 1;
  readyForEnablementSigning: boolean;
  humanEnablementRecorded: boolean;
  identityAligned: boolean;
  candidateSha: string;
  originMainSha: string;
  liveSha: string | null;
  frozenCandidateSha: typeof DIAGNOSIS_P24_6_FROZEN_CANDIDATE_SHA;
  frozenLiveSha: typeof DIAGNOSIS_P24_6_FROZEN_LIVE_SHA;
  exactIdentityMatch: boolean;
  approvedPrefix: readonly string[];
  prefixOpen: boolean;
  daibaiGateEnabled: boolean;
  adaptersEnabled: boolean;
  reportApiClosed: boolean;
  remediationClosed: boolean;
  nextStep: DiagnosisEnablementStepId | null;
  canaryTenant: typeof DIAGNOSIS_ADMISSION_TENANT;
  canaryStarted: boolean;
  livePackRegistered: false;
  p25Started: false;
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

export function assertP24_6EnablementSource(claim: {
  kind?: string;
  clientParam?: unknown;
  modelOutput?: unknown;
}): void {
  assertEnablementSourceNotClientOrModel(claim);
  if (claim.kind !== undefined && claim.kind !== DIAGNOSIS_P24_6_SIGNATURE_KIND) {
    fail("unknown_enablement_source", `unsupported enablement source ${claim.kind}`);
  }
}

export function evaluateDiagnosisProductionP24_6(
  input: DiagnosisIndependentApprovalInput & {
    humanEnablement?: DiagnosisP24_6HumanEnablementClaim;
  },
): DiagnosisProductionP24_6Report {
  const recordedAt = new Date(input.now ?? Date.parse("2026-09-06T06:00:00.000Z")).toISOString();
  const repair = evaluateDiagnosisLedgerRepair(input);
  const candidateSha = normalizeSha(input.candidateSha);
  const originMainSha = normalizeSha(input.originMainSha);
  const liveSha = normalizeSha(input.liveSha);
  if (!candidateSha || !originMainSha) {
    fail("identity_missing", "candidate and origin/main are required", "identity");
  }
  const exactIdentityMatch =
    candidateSha === DIAGNOSIS_P24_6_FROZEN_CANDIDATE_SHA &&
    originMainSha === DIAGNOSIS_P24_6_FROZEN_CANDIDATE_SHA &&
    liveSha === DIAGNOSIS_P24_6_FROZEN_LIVE_SHA;
  assertApprovedEnablementPrefix();
  const prefixOpen = isApprovedEnablementPrefixOpen();
  const nextStep = nextEnablementStep();
  const readyForEnablementSigning =
    repair.aligned &&
    exactIdentityMatch &&
    input.liveSource === "container" &&
    !input.livePackRegistered &&
    !input.coreHandlerHasDiagnosis &&
    prefixOpen &&
    DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED &&
    DIAGNOSIS_DAIBAI_DELIVERY_ENABLED &&
    DIAGNOSIS_CANARY_POLICY.firstStage === "internal_single_tenant" &&
    DIAGNOSIS_CANARY_POLICY.started;
  let humanEnablementRecorded = false;
  if (input.humanEnablement) {
    const recorded = recordDiagnosisP24_6HumanEnablement(
      {
        increment: DIAGNOSIS_PRODUCTION_P24_6_INCREMENT,
        schemaVersion: DIAGNOSIS_PRODUCTION_P24_6_SCHEMA_VERSION,
        readyForEnablementSigning,
        humanEnablementRecorded: false,
        identityAligned: repair.aligned && exactIdentityMatch,
        candidateSha,
        originMainSha,
        liveSha,
        frozenCandidateSha: DIAGNOSIS_P24_6_FROZEN_CANDIDATE_SHA,
        frozenLiveSha: DIAGNOSIS_P24_6_FROZEN_LIVE_SHA,
        exactIdentityMatch,
        approvedPrefix: DIAGNOSIS_APPROVED_OPEN_GATE_NAMES,
        prefixOpen,
        daibaiGateEnabled: DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
        adaptersEnabled: DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED,
        reportApiClosed: !DIAGNOSIS_REPORT_API_DEPLOYED,
        remediationClosed: !DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
        nextStep,
        canaryTenant: DIAGNOSIS_ADMISSION_TENANT,
        canaryStarted: DIAGNOSIS_CANARY_POLICY.started,
        livePackRegistered: false,
        p25Started: false,
        p26ProductionReady: false,
        recordedAt,
        note: "",
      },
      input.humanEnablement,
      { now: input.now },
    );
    humanEnablementRecorded = recorded.humanEnablementRecorded;
  }
  return {
    increment: DIAGNOSIS_PRODUCTION_P24_6_INCREMENT,
    schemaVersion: DIAGNOSIS_PRODUCTION_P24_6_SCHEMA_VERSION,
    readyForEnablementSigning,
    humanEnablementRecorded,
    identityAligned: repair.aligned && exactIdentityMatch,
    candidateSha,
    originMainSha,
    liveSha,
    frozenCandidateSha: DIAGNOSIS_P24_6_FROZEN_CANDIDATE_SHA,
    frozenLiveSha: DIAGNOSIS_P24_6_FROZEN_LIVE_SHA,
    exactIdentityMatch,
    approvedPrefix: DIAGNOSIS_APPROVED_OPEN_GATE_NAMES,
    prefixOpen,
    daibaiGateEnabled: DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
    adaptersEnabled: DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED,
    reportApiClosed: !DIAGNOSIS_REPORT_API_DEPLOYED,
    remediationClosed: !DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
    nextStep,
    canaryTenant: DIAGNOSIS_ADMISSION_TENANT,
    canaryStarted: DIAGNOSIS_CANARY_POLICY.started,
    livePackRegistered: false,
    p25Started: false,
    p26ProductionReady: false,
    recordedAt,
    note: humanEnablementRecorded
      ? "P24.6 enablement recorded for adapters. Report API and remediation stay closed. Delivery cutover still required before user-visible LIVE effect."
      : "P24.6 adapters enablement pack frozen. Sign with exact candidate/LIVE SHAs before treating the compile-time adapter gate as authorized.",
  };
}

export function recordDiagnosisP24_6HumanEnablement(
  report: DiagnosisProductionP24_6Report,
  claim: DiagnosisP24_6HumanEnablementClaim,
  input: { now?: number } = {},
): DiagnosisProductionP24_6Report {
  assertP24_6EnablementSource(claim);
  if (claim.increment !== DIAGNOSIS_PRODUCTION_P24_6_INCREMENT) {
    fail("increment_mismatch", "enablement claim must target P24.6", "increment");
  }
  if (
    !claim.confirmHuman ||
    !claim.confirmAdaptersOnlyThisIncrement ||
    !claim.approvalOpensAdaptersGate
  ) {
    fail("enablement_confirm_missing", "human enablement confirmations are required", "claim");
  }
  if (claim.confirmCanaryTenant !== DIAGNOSIS_ADMISSION_TENANT) {
    fail("canary_tenant_mismatch", "enablement must stay on internal single tenant", "claim");
  }
  const candidateSha = normalizeSha(claim.candidateSha);
  const liveSha = normalizeSha(claim.liveSha);
  if (
    candidateSha !== DIAGNOSIS_P24_6_FROZEN_CANDIDATE_SHA ||
    liveSha !== DIAGNOSIS_P24_6_FROZEN_LIVE_SHA
  ) {
    fail("identity_mismatch", "enablement claim must match frozen P24.6 candidate and LIVE SHAs");
  }
  if (candidateSha !== report.candidateSha || liveSha !== report.liveSha) {
    fail("report_identity_mismatch", "enablement claim must match evaluated identity", "identity");
  }
  const bySubject = new Map(claim.subjects.map((row) => [`${row.subject}:${row.subjectId}`, row]));
  const adaptersGate = bySubject.get("gate:DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED");
  if (
    !adaptersGate ||
    !adaptersGate.signed ||
    adaptersGate.decision !== "approve" ||
    !adaptersGate.valueAfterApproval
  ) {
    fail(
      "adapters_gate_signature_missing",
      "Daniel/CEO must approve DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED with valueAfterApproval=true",
      "approval",
    );
  }
  const daibaiGate = bySubject.get("gate:DIAGNOSIS_DAIBAI_DELIVERY_ENABLED");
  if (
    !daibaiGate ||
    !daibaiGate.signed ||
    daibaiGate.decision !== "approve" ||
    !daibaiGate.valueAfterApproval
  ) {
    fail(
      "daibai_predecessor_signature_missing",
      "P24.6 keeps the already-open Da Bai gate at valueAfterApproval=true",
      "approval",
    );
  }
  for (const gateName of [
    "DIAGNOSIS_REPORT_API_DEPLOYED",
    "DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED",
  ] as const) {
    const row = bySubject.get(`gate:${gateName}`);
    if (!row || !row.signed || row.decision !== "approve" || row.valueAfterApproval) {
      fail("companion_gate_signature_missing", `${gateName} must stay valueAfterApproval=false`);
    }
  }
  if (!claim.signer.trim()) {
    fail("signer_missing", "enablement claim requires a human signer", "signer");
  }
  if (!DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED) {
    fail(
      "adapters_gate_not_open",
      "compile-time adapters gate must be true after enablement lands",
    );
  }
  assertApprovedEnablementPrefix();
  return {
    ...report,
    humanEnablementRecorded: true,
    recordedAt: new Date(input.now ?? Date.parse("2026-09-06T06:00:00.000Z")).toISOString(),
    note: "P24.6 human enablement recorded. Merge to main and wait for delivery unified-window cutover before user-visible LIVE effect.",
  };
}

export function renderDiagnosisProductionP24_6Markdown(
  report: DiagnosisProductionP24_6Report,
): string {
  return [
    `# OpenBot Diagnosis Platform — P24.6 adapters 开启批准`,
    ``,
    `Date: 2026-09-06`,
    ``,
    `Status: **${report.humanEnablementRecorded ? "Enablement recorded" : report.readyForEnablementSigning ? "Ready for Daniel/CEO signing" : "No-Go"}**`,
    ``,
    `## Identity (exact match required)`,
    ``,
    `- candidate/origin-main: \`${report.candidateSha}\``,
    `- LIVE: \`${report.liveSha ?? "unknown"}\``,
    `- frozen candidate: \`${report.frozenCandidateSha}\``,
    `- frozen LIVE: \`${report.frozenLiveSha}\``,
    `- exactIdentityMatch: ${String(report.exactIdentityMatch)}`,
    ``,
    `## Enablement scope`,
    ``,
    `- approved prefix: ${report.approvedPrefix.join(", ")}`,
    `- prefixOpen: ${String(report.prefixOpen)}`,
    `- DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED: ${String(report.adaptersEnabled)}`,
    `- DIAGNOSIS_DAIBAI_DELIVERY_ENABLED: ${String(report.daibaiGateEnabled)}`,
    `- reportApiClosed: ${String(report.reportApiClosed)}`,
    `- remediationClosed: ${String(report.remediationClosed)}`,
    `- nextStep: ${report.nextStep ?? "none"}`,
    `- canaryTenant: \`${report.canaryTenant}\``,
    `- livePackRegistered: ${String(report.livePackRegistered)}`,
    `- p25Started: ${String(report.p25Started)}`,
    ``,
    report.note,
    ``,
  ].join("\n");
}

export function assertDiagnosisProductionP24_6Ready(report: DiagnosisProductionP24_6Report): void {
  if (!report.readyForEnablementSigning || !report.humanEnablementRecorded) {
    fail("p24_6_not_ready", "P24.6 enablement must be signed and identity-aligned", "p24.6");
  }
  if (!report.adaptersEnabled || !report.prefixOpen) {
    fail("p24_6_scope_violation", "P24.6 opens adapters on the approved prefix only", "p24.6");
  }
  if (report.livePackRegistered || report.p25Started || report.p26ProductionReady) {
    fail(
      "p24_6_surface_violation",
      "P24.6 must not register report pack or start P25/P26",
      "p24.6",
    );
  }
}
