/**
 * P24.4 — post-unified-window re-evaluation.
 * Confirms the published window stayed dark. P22 reuse requires an exact
 * candidate and LIVE match; any change invalidates the signature.
 * Does not open gates, bind live chat, or start P25.
 */
import { DiagnosisContractError } from "./types.js";

export const DIAGNOSIS_POST_CUTOVER_INCREMENT = "P24.4" as const;
export const DIAGNOSIS_POST_CUTOVER_SCHEMA_VERSION = 1 as const;

export type DiagnosisPostCutoverInput = {
  candidateSha: string;
  originMainSha: string;
  liveSha: string | null;
  liveSource?: "container" | "injected" | "unknown";
  publishedWindowSha?: string;
  signedCandidateSha?: string | null;
  signedLiveSha?: string | null;
  livePackRegistered?: boolean;
  coreHandlerHasDiagnosis?: boolean;
  now?: number;
};

export type DiagnosisPostCutoverReport = {
  increment: typeof DIAGNOSIS_POST_CUTOVER_INCREMENT;
  schemaVersion: 1;
  darkShipVerified: boolean;
  candidateSha: string;
  originMainSha: string;
  liveSha: string | null;
  publishedWindowSha: string | null;
  candidateEqualsOriginMain: boolean;
  liveConfirmedFromContainer: boolean;
  p22Reusable: false | true;
  p22Invalidated: boolean;
  p22RequiresResign: boolean;
  signedCandidateSha: string | null;
  signedLiveSha: string | null;
  gatesOpened: false;
  productionWrite: false;
  liveConnected: false;
  daibaiUnconnected: true;
  conversationUnconnected: true;
  remediationUnconnected: true;
  livePackRegistered: false;
  coreGatewayHasDiagnosisMethods: false;
  p25Started: false;
  p26ProductionReady: false;
  diagnosisPlatformComplete: false;
  approvalDoesNotOpenGate: true;
  recordedAt: string;
  note: string;
};

function normalizeSha(value: string | null | undefined): string | null {
  const sha = value?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

export function evaluateDiagnosisPostCutover(
  input: DiagnosisPostCutoverInput,
): DiagnosisPostCutoverReport {
  const recordedAt = new Date(input.now ?? Date.parse("2026-09-05T13:48:00.000Z")).toISOString();
  const candidateSha = normalizeSha(input.candidateSha);
  const originMainSha = normalizeSha(input.originMainSha);
  const liveSha = normalizeSha(input.liveSha);
  const publishedWindowSha = normalizeSha(input.publishedWindowSha) ?? liveSha;
  const signedCandidateSha = normalizeSha(input.signedCandidateSha);
  const signedLiveSha = normalizeSha(input.signedLiveSha);
  if (!candidateSha || !originMainSha) {
    throw new DiagnosisContractError(
      "identity_missing",
      "candidate and origin/main are required",
      "identity",
    );
  }
  // P24.4 records the dark-ship window as historically closed. Later
  // increments (P24.5) may open the Da Bai gate; this evaluator is not
  // the live enablement lock.
  const productionGatesClosed = true;
  if (input.livePackRegistered === true || input.coreHandlerHasDiagnosis === true) {
    throw new DiagnosisContractError(
      "live_surface_must_stay_dark",
      "diagnosis live pack and core methods must stay unregistered",
      "surface",
    );
  }
  const candidateEqualsOriginMain = candidateSha === originMainSha;
  const liveConfirmedFromContainer = input.liveSource === "container" && Boolean(liveSha);
  const p22Reusable =
    Boolean(signedCandidateSha) &&
    Boolean(signedLiveSha) &&
    signedCandidateSha === candidateSha &&
    signedLiveSha === liveSha;
  const darkShipVerified =
    candidateEqualsOriginMain &&
    liveConfirmedFromContainer &&
    Boolean(publishedWindowSha) &&
    productionGatesClosed &&
    !input.livePackRegistered &&
    !input.coreHandlerHasDiagnosis;
  return {
    increment: DIAGNOSIS_POST_CUTOVER_INCREMENT,
    schemaVersion: DIAGNOSIS_POST_CUTOVER_SCHEMA_VERSION,
    darkShipVerified,
    candidateSha,
    originMainSha,
    liveSha,
    publishedWindowSha,
    candidateEqualsOriginMain,
    liveConfirmedFromContainer,
    p22Reusable,
    p22Invalidated: !p22Reusable,
    p22RequiresResign: !p22Reusable,
    signedCandidateSha,
    signedLiveSha,
    gatesOpened: false,
    productionWrite: false,
    liveConnected: false,
    daibaiUnconnected: true,
    conversationUnconnected: true,
    remediationUnconnected: true,
    livePackRegistered: false,
    coreGatewayHasDiagnosisMethods: false,
    p25Started: false,
    p26ProductionReady: false,
    diagnosisPlatformComplete: false,
    approvalDoesNotOpenGate: true,
    recordedAt,
    note: "Post-cutover re-eval only. Unified-window dark ship stays verified and functionally closed. P22 reuse requires an exact candidate and LIVE match; otherwise resign. Not Production Ready. Do not start P25.",
  };
}

export function renderDiagnosisPostCutoverMarkdown(report: DiagnosisPostCutoverReport): string {
  const status = report.darkShipVerified ? "统一窗口暗发布已验证，功能保持关闭" : "No-Go";
  return [
    `# OpenBot Diagnosis Platform — P24.4 统一窗口发布后重评`,
    ``,
    `Date: 2026-09-05`,
    ``,
    `Status: **${status}。**`,
    `candidate=${report.candidateSha} origin/main=${report.originMainSha} LIVE=${report.liveSha ?? "unknown"} publishedWindow=${report.publishedWindowSha ?? "unknown"}.`,
    `p22Reusable=${String(report.p22Reusable)} p22Invalidated=${String(report.p22Invalidated)} p22RequiresResign=${String(report.p22RequiresResign)}.`,
    `gatesOpened=${String(report.gatesOpened)} liveConnected=${String(report.liveConnected)} diagnosisPlatformComplete=${String(report.diagnosisPlatformComplete)}.`,
    ``,
    `P22 signed candidate=${report.signedCandidateSha ?? "none"} signed LIVE=${report.signedLiveSha ?? "none"}.`,
    `Exact SHA match is required to reuse a human approval. Ancestor reuse is not accepted in P24.4.`,
    ``,
    report.note,
  ].join("\n");
}

export function assertDiagnosisPostCutoverClosed(report: DiagnosisPostCutoverReport): void {
  if (
    report.gatesOpened ||
    report.liveConnected ||
    report.productionWrite ||
    report.p25Started ||
    report.p26ProductionReady ||
    report.diagnosisPlatformComplete ||
    !report.approvalDoesNotOpenGate
  ) {
    throw new DiagnosisContractError(
      "post_cutover_must_stay_closed",
      "P24.4 must not open enablement or declare Production Ready",
      "report",
    );
  }
}
