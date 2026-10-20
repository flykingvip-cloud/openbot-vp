import { DIAGNOSIS_ADMISSION_TENANT } from "./production-admission.js";
import { evaluateDiagnosisLedgerRepair } from "./production-approval-freeze.js";
import type { DiagnosisIndependentApprovalInput } from "./production-approval-freeze.js";
import {
  DIAGNOSIS_CANARY_POLICY,
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
} from "./production-cutover.js";
/**
 * P24.5 — human enablement pack for Da Bai delivery + live conversation only.
 * Requires exact candidate/origin-main and LIVE SHA match. Ancestor reuse is invalid.
 * Opens only DIAGNOSIS_DAIBAI_DELIVERY_ENABLED with valueAfterApproval=true and
 * liveConversationBound=true. Other gates must stay false in the signed claim.
 */
import { isOnlyDaibaiProductionGateOpen } from "./production-gate-contract.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";
import { DiagnosisContractError } from "./types.js";

export const DIAGNOSIS_PRODUCTION_P24_5_INCREMENT = "P24.5" as const;
export const DIAGNOSIS_PRODUCTION_P24_5_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_P24_5_SIGNATURE_KIND = "human_daibai_enablement_record" as const;
export const DIAGNOSIS_P24_5_LIVE_CONVERSATION_SUBJECT = "live_conversation_bound" as const;

export const DIAGNOSIS_P24_5_FROZEN_CANDIDATE_SHA =
  "6bd4569606fd286b7d8b46fb7d9198fb7a134493" as const;
export const DIAGNOSIS_P24_5_FROZEN_LIVE_SHA = "6bd4569606fd286b7d8b46fb7d9198fb7a134493" as const;

export type DiagnosisP24_5HumanSubjectClaim =
  | {
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
    }
  | {
      subject: "live_conversation";
      subjectId: typeof DIAGNOSIS_P24_5_LIVE_CONVERSATION_SUBJECT;
      signer: string;
      signed: true;
      decision: "approve";
      bound: true;
    };

export type DiagnosisP24_5HumanEnablementClaim = {
  kind: typeof DIAGNOSIS_P24_5_SIGNATURE_KIND;
  increment: typeof DIAGNOSIS_PRODUCTION_P24_5_INCREMENT;
  schemaVersion: 1;
  candidateSha: string;
  liveSha: string;
  liveConversationBound: true;
  approvalOpensOnlyDaibaiGate: true;
  acceptsClientParam: false;
  acceptsModelOutput: false;
  confirmHuman: true;
  confirmOnlyDaibaiGate: true;
  confirmCanaryTenant: typeof DIAGNOSIS_ADMISSION_TENANT;
  signer: string;
  subjects: DiagnosisP24_5HumanSubjectClaim[];
};

export type DiagnosisProductionP24_5Report = {
  increment: typeof DIAGNOSIS_PRODUCTION_P24_5_INCREMENT;
  schemaVersion: 1;
  readyForEnablementSigning: boolean;
  humanEnablementRecorded: boolean;
  identityAligned: boolean;
  candidateSha: string;
  originMainSha: string;
  liveSha: string | null;
  frozenCandidateSha: typeof DIAGNOSIS_P24_5_FROZEN_CANDIDATE_SHA;
  frozenLiveSha: typeof DIAGNOSIS_P24_5_FROZEN_LIVE_SHA;
  exactIdentityMatch: boolean;
  liveConversationBound: boolean;
  daibaiGateEnabled: boolean;
  onlyDaibaiGateOpen: boolean;
  canaryTenant: typeof DIAGNOSIS_ADMISSION_TENANT;
  canaryStarted: boolean;
  adaptersClosed: boolean;
  reportApiClosed: boolean;
  remediationClosed: boolean;
  livePackRegistered: false;
  p25Started: false;
  p26ProductionReady: false;
  productionWriteLimitedToDeliveryReceipts: true;
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

export function assertP24_5EnablementSource(claim: {
  kind?: string;
  clientParam?: unknown;
  modelOutput?: unknown;
}): void {
  if (claim.clientParam !== undefined) {
    fail("client_param_enablement_forbidden", "client parameters are not enablement approval");
  }
  if (claim.modelOutput !== undefined) {
    fail("model_output_enablement_forbidden", "model output is not enablement approval");
  }
  if (claim.kind !== undefined && claim.kind !== DIAGNOSIS_P24_5_SIGNATURE_KIND) {
    fail("unknown_enablement_source", `unsupported enablement source ${claim.kind}`);
  }
}

export function evaluateDiagnosisProductionP24_5(
  input: DiagnosisIndependentApprovalInput & {
    humanEnablement?: DiagnosisP24_5HumanEnablementClaim;
  },
): DiagnosisProductionP24_5Report {
  const recordedAt = new Date(input.now ?? Date.parse("2026-09-05T15:00:00.000Z")).toISOString();
  const repair = evaluateDiagnosisLedgerRepair(input);
  const candidateSha = normalizeSha(input.candidateSha);
  const originMainSha = normalizeSha(input.originMainSha);
  const liveSha = normalizeSha(input.liveSha);
  if (!candidateSha || !originMainSha) {
    fail("identity_missing", "candidate and origin/main are required", "identity");
  }
  const exactIdentityMatch =
    candidateSha === DIAGNOSIS_P24_5_FROZEN_CANDIDATE_SHA &&
    originMainSha === DIAGNOSIS_P24_5_FROZEN_CANDIDATE_SHA &&
    liveSha === DIAGNOSIS_P24_5_FROZEN_LIVE_SHA;
  const onlyDaibaiGateOpen = isOnlyDaibaiProductionGateOpen();
  const readyForEnablementSigning =
    repair.aligned &&
    exactIdentityMatch &&
    input.liveSource === "container" &&
    !input.livePackRegistered &&
    !input.coreHandlerHasDiagnosis &&
    DIAGNOSIS_DAIBAI_DELIVERY_ENABLED &&
    DIAGNOSIS_CANARY_POLICY.firstStage === "internal_single_tenant" &&
    DIAGNOSIS_CANARY_POLICY.started;
  let humanEnablementRecorded = false;
  let liveConversationBound = false;
  if (input.humanEnablement) {
    const recorded = recordDiagnosisP24_5HumanEnablement(
      {
        increment: DIAGNOSIS_PRODUCTION_P24_5_INCREMENT,
        schemaVersion: DIAGNOSIS_PRODUCTION_P24_5_SCHEMA_VERSION,
        readyForEnablementSigning,
        humanEnablementRecorded: false,
        identityAligned: repair.aligned && exactIdentityMatch,
        candidateSha,
        originMainSha,
        liveSha,
        frozenCandidateSha: DIAGNOSIS_P24_5_FROZEN_CANDIDATE_SHA,
        frozenLiveSha: DIAGNOSIS_P24_5_FROZEN_LIVE_SHA,
        exactIdentityMatch,
        liveConversationBound: false,
        daibaiGateEnabled: DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
        onlyDaibaiGateOpen,
        canaryTenant: DIAGNOSIS_ADMISSION_TENANT,
        canaryStarted: DIAGNOSIS_CANARY_POLICY.started,
        adaptersClosed: !DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED,
        reportApiClosed: !DIAGNOSIS_REPORT_API_DEPLOYED,
        remediationClosed: !DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
        livePackRegistered: false,
        p25Started: false,
        p26ProductionReady: false,
        productionWriteLimitedToDeliveryReceipts: true,
        recordedAt,
        note: "",
      },
      input.humanEnablement,
      { now: input.now },
    );
    humanEnablementRecorded = recorded.humanEnablementRecorded;
    liveConversationBound = recorded.liveConversationBound;
  }
  return {
    increment: DIAGNOSIS_PRODUCTION_P24_5_INCREMENT,
    schemaVersion: DIAGNOSIS_PRODUCTION_P24_5_SCHEMA_VERSION,
    readyForEnablementSigning,
    humanEnablementRecorded,
    identityAligned: repair.aligned && exactIdentityMatch,
    candidateSha,
    originMainSha,
    liveSha,
    frozenCandidateSha: DIAGNOSIS_P24_5_FROZEN_CANDIDATE_SHA,
    frozenLiveSha: DIAGNOSIS_P24_5_FROZEN_LIVE_SHA,
    exactIdentityMatch,
    liveConversationBound,
    daibaiGateEnabled: DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
    onlyDaibaiGateOpen,
    canaryTenant: DIAGNOSIS_ADMISSION_TENANT,
    canaryStarted: DIAGNOSIS_CANARY_POLICY.started,
    adaptersClosed: !DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED,
    reportApiClosed: !DIAGNOSIS_REPORT_API_DEPLOYED,
    remediationClosed: !DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
    livePackRegistered: false,
    p25Started: false,
    p26ProductionReady: false,
    productionWriteLimitedToDeliveryReceipts: true,
    recordedAt,
    note: humanEnablementRecorded
      ? "P24.5 enablement recorded for Da Bai delivery + live conversation only. Delivery cutover still required before user-visible LIVE effect."
      : "P24.5 enablement pack frozen. Sign with exact candidate/LIVE SHAs before treating compile-time gate as authorized.",
  };
}

export function recordDiagnosisP24_5HumanEnablement(
  report: DiagnosisProductionP24_5Report,
  claim: DiagnosisP24_5HumanEnablementClaim,
  input: { now?: number } = {},
): DiagnosisProductionP24_5Report {
  assertP24_5EnablementSource(claim);
  if (claim.increment !== DIAGNOSIS_PRODUCTION_P24_5_INCREMENT) {
    fail("increment_mismatch", "enablement claim must target P24.5", "increment");
  }
  if (!claim.confirmHuman || !claim.confirmOnlyDaibaiGate || !claim.liveConversationBound) {
    fail("enablement_confirm_missing", "human enablement confirmations are required", "claim");
  }
  if (claim.confirmCanaryTenant !== DIAGNOSIS_ADMISSION_TENANT) {
    fail("canary_tenant_mismatch", "enablement must stay on internal single tenant", "claim");
  }
  const candidateSha = normalizeSha(claim.candidateSha);
  const liveSha = normalizeSha(claim.liveSha);
  if (
    candidateSha !== DIAGNOSIS_P24_5_FROZEN_CANDIDATE_SHA ||
    liveSha !== DIAGNOSIS_P24_5_FROZEN_LIVE_SHA
  ) {
    fail("identity_mismatch", "enablement claim must match frozen P24.5 candidate and LIVE SHAs");
  }
  if (candidateSha !== report.candidateSha || liveSha !== report.liveSha) {
    fail("report_identity_mismatch", "enablement claim must match evaluated identity", "identity");
  }
  const bySubject = new Map(
    claim.subjects.map((row) => [`${row.subject}:${row.subjectId}`, row] as const),
  );
  const daibaiGate = bySubject.get("gate:DIAGNOSIS_DAIBAI_DELIVERY_ENABLED");
  if (
    !daibaiGate ||
    daibaiGate.subject !== "gate" ||
    !daibaiGate.signed ||
    daibaiGate.decision !== "approve" ||
    !daibaiGate.valueAfterApproval
  ) {
    fail(
      "daibai_gate_signature_missing",
      "Daniel/CEO must approve DIAGNOSIS_DAIBAI_DELIVERY_ENABLED with valueAfterApproval=true",
      "approval",
    );
  }
  for (const gateName of [
    "DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED",
    "DIAGNOSIS_REPORT_API_DEPLOYED",
    "DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED",
  ] as const) {
    const row = bySubject.get(`gate:${gateName}`);
    if (
      !row ||
      row.subject !== "gate" ||
      !row.signed ||
      row.decision !== "approve" ||
      row.valueAfterApproval
    ) {
      fail("companion_gate_signature_missing", `${gateName} must stay valueAfterApproval=false`);
    }
  }
  const conversation = bySubject.get(
    `live_conversation:${DIAGNOSIS_P24_5_LIVE_CONVERSATION_SUBJECT}`,
  );
  if (
    !conversation ||
    conversation.subject !== "live_conversation" ||
    !conversation.signed ||
    conversation.decision !== "approve" ||
    !conversation.bound
  ) {
    fail(
      "live_conversation_signature_missing",
      "Daniel/CEO must approve live conversation binding",
      "approval",
    );
  }
  if (!claim.signer.trim()) {
    fail("signer_missing", "enablement claim requires a human signer", "signer");
  }
  if (!DIAGNOSIS_DAIBAI_DELIVERY_ENABLED) {
    fail("daibai_gate_not_open", "compile-time Da Bai gate must be true after enablement lands");
  }
  return {
    ...report,
    humanEnablementRecorded: true,
    liveConversationBound: true,
    recordedAt: new Date(input.now ?? Date.parse("2026-09-05T15:00:00.000Z")).toISOString(),
    note: "P24.5 human enablement recorded. Merge to main and wait for delivery unified-window cutover before user-visible LIVE effect.",
  };
}

export function renderDiagnosisProductionP24_5Markdown(
  report: DiagnosisProductionP24_5Report,
): string {
  return [
    `# OpenBot Diagnosis Platform — P24.5 大白 + 对话开启批准`,
    ``,
    `Date: 2026-09-05`,
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
    `- DIAGNOSIS_DAIBAI_DELIVERY_ENABLED: ${String(report.daibaiGateEnabled)}`,
    `- liveConversationBound: ${String(report.liveConversationBound)}`,
    `- onlyDaibaiGateOpen: ${String(report.onlyDaibaiGateOpen)}`,
    `- canaryTenant: \`${report.canaryTenant}\``,
    `- canaryStarted: ${String(report.canaryStarted)}`,
    `- adaptersClosed: ${String(report.adaptersClosed)}`,
    `- reportApiClosed: ${String(report.reportApiClosed)}`,
    `- remediationClosed: ${String(report.remediationClosed)}`,
    `- livePackRegistered: ${String(report.livePackRegistered)}`,
    `- p25Started: ${String(report.p25Started)}`,
    ``,
    report.note,
    ``,
  ].join("\n");
}

export function assertDiagnosisProductionP24_5Ready(report: DiagnosisProductionP24_5Report): void {
  if (!report.readyForEnablementSigning || !report.humanEnablementRecorded) {
    fail("p24_5_not_ready", "P24.5 enablement must be signed and identity-aligned", "p24.5");
  }
  if (!report.daibaiGateEnabled || !report.liveConversationBound) {
    fail("p24_5_scope_violation", "P24.5 opens only Da Bai + conversation", "p24.5");
  }
  if (report.livePackRegistered || report.p25Started || report.p26ProductionReady) {
    fail(
      "p24_5_surface_violation",
      "P24.5 must not register report pack or start P25/P26",
      "p24.5",
    );
  }
}
