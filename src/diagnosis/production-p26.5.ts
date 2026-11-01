/**
 * P26.5 — readonly diagnosis admission (projection snapshot + surfaces).
 * Validates live pack wiring, snapshot reader, and UI/API readonly path.
 * Does not approve production cutover, live executor, Doctor --fix, or channel restart.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { coreGatewayHandlers } from "../gateway/server-methods.js";
import { GATEWAY_METHOD_PACKS } from "../gateway/server-methods/packs/registry.js";
import { isProductionRemediationLiveExecutorUndeployed } from "./production-cutover.js";
import { DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED } from "./production-cutover.js";
import { isUnapprovedProductionGateOpen } from "./production-gate-contract.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import {
  createDefaultDiagnosisReportApiDeps,
  createLiveDiagnosisReportApiDeps,
} from "./report-query-gateway.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";
import { createFileProjectionAuthoritySource } from "./report-query-projection-snapshot.js";
import { DiagnosisContractError } from "./types.js";

export const DIAGNOSIS_PRODUCTION_P26_5_INCREMENT = "P26.5" as const;
export const DIAGNOSIS_PRODUCTION_P26_5_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_P26_5_NEXT_OFFICIAL_STEP = "soak_internal_single_tenant" as const;
export const DIAGNOSIS_P26_5_FROZEN_CANDIDATE_SHA =
  "cea1591224f80effdc2616eaa8b0d349d35da7f0" as const;
export const DIAGNOSIS_P26_5_FROZEN_LIVE_SHA = "7e41fecc4241e46a1336f65185a5cf257e5f2ae4" as const;

export type DiagnosisProductionP26_5Report = {
  increment: typeof DIAGNOSIS_PRODUCTION_P26_5_INCREMENT;
  schemaVersion: typeof DIAGNOSIS_PRODUCTION_P26_5_SCHEMA_VERSION;
  candidateSha: string;
  liveSha: string | null;
  readonlyAdmissionReady: boolean;
  packRegistered: boolean;
  queryHandlerPresent: boolean;
  getHandlerPresent: boolean;
  snapshotReaderWired: boolean;
  liveExecutorUndeployed: boolean;
  doctorFixBound: boolean;
  channelRestartBound: boolean;
  approvedForProductionCutover: false;
  nextOfficialStep: typeof DIAGNOSIS_P26_5_NEXT_OFFICIAL_STEP;
  blockers: string[];
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

function scanRepoForForbiddenBindings(): { doctorFixBound: boolean; channelRestartBound: boolean } {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const targets = [
    path.join(repoRoot, "src/gateway/server-methods/diagnosis-reports.pack.ts"),
    path.join(repoRoot, "src/diagnosis/report-query-gateway.ts"),
    path.join(repoRoot, "src/diagnosis/report-query-projection-snapshot.ts"),
  ];
  let doctorFixBound = false;
  let channelRestartBound = false;
  for (const filePath of targets) {
    const body = fs.readFileSync(filePath, "utf8");
    doctorFixBound ||= body.includes("--fix") || body.includes("doctorCommand");
    channelRestartBound ||= body.includes("startChannel");
  }
  return { doctorFixBound, channelRestartBound };
}

export function evaluateDiagnosisProductionP26_5(
  input: {
    candidateSha?: string | null;
    liveSha?: string | null;
    now?: number;
  } = {},
): DiagnosisProductionP26_5Report {
  const recordedAt = new Date(input.now ?? Date.now()).toISOString();
  const candidateSha = normalizeSha(input.candidateSha) ?? DIAGNOSIS_P26_5_FROZEN_CANDIDATE_SHA;
  const liveSha = normalizeSha(input.liveSha);
  const packRegistered = Boolean(
    DIAGNOSIS_REPORT_API_DEPLOYED &&
    GATEWAY_METHOD_PACKS.some((pack) => pack.id === "diagnosis-reports"),
  );
  const queryHandlerPresent = typeof coreGatewayHandlers["diagnosis.reports.query"] === "function";
  const getHandlerPresent = typeof coreGatewayHandlers["diagnosis.reports.get"] === "function";
  const liveDeps = createLiveDiagnosisReportApiDeps();
  const defaultDeps = createDefaultDiagnosisReportApiDeps();
  const snapshotReaderWired =
    liveDeps.reader !== defaultDeps.reader &&
    typeof createFileProjectionAuthoritySource === "function";
  const liveExecutorUndeployed = isProductionRemediationLiveExecutorUndeployed();
  const { doctorFixBound, channelRestartBound } = scanRepoForForbiddenBindings();
  // Readonly diagnosis admission: adapters + report API on, remediation closed.
  // Da Bai is an orthogonal product-first knife and may already be open (P24.5/P26).
  const gatesOpen =
    DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED &&
    DIAGNOSIS_REPORT_API_DEPLOYED &&
    !DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED &&
    !isUnapprovedProductionGateOpen();
  const blockers = [
    ...(packRegistered ? [] : ["live_pack_unregistered"]),
    ...(queryHandlerPresent ? [] : ["query_handler_missing"]),
    ...(getHandlerPresent ? [] : ["get_handler_missing"]),
    ...(snapshotReaderWired ? [] : ["snapshot_reader_not_wired"]),
    ...(liveExecutorUndeployed ? [] : ["live_executor_deployed"]),
    ...(doctorFixBound ? ["doctor_fix_bound"] : []),
    ...(channelRestartBound ? ["channel_restart_bound"] : []),
    ...(gatesOpen ? [] : ["production_gates_not_open"]),
  ];
  const readonlyAdmissionReady = blockers.length === 0;
  return {
    increment: DIAGNOSIS_PRODUCTION_P26_5_INCREMENT,
    schemaVersion: DIAGNOSIS_PRODUCTION_P26_5_SCHEMA_VERSION,
    candidateSha,
    liveSha,
    readonlyAdmissionReady,
    packRegistered,
    queryHandlerPresent,
    getHandlerPresent,
    snapshotReaderWired,
    liveExecutorUndeployed,
    doctorFixBound,
    channelRestartBound,
    approvedForProductionCutover: false,
    nextOfficialStep: DIAGNOSIS_P26_5_NEXT_OFFICIAL_STEP,
    blockers,
    recordedAt,
    note: "P26.5 readonly admission: projection snapshots feed diagnosis.reports.*; UI surfaces mount query/get. No cutover, no live executor, no Doctor --fix.",
  };
}

export function assertDiagnosisProductionP26_5Evaluated(
  report: DiagnosisProductionP26_5Report,
): void {
  if (!report.readonlyAdmissionReady) {
    fail(
      "p26_5_not_ready",
      `P26.5 readonly admission blockers: ${report.blockers.join(", ")}`,
      "p26.5",
    );
  }
  if (report.approvedForProductionCutover) {
    fail("p26_5_cutover_forbidden", "P26.5 must not approve production cutover", "p26.5");
  }
}

export function renderDiagnosisProductionP26_5Markdown(
  report: DiagnosisProductionP26_5Report,
): string {
  return [
    `# OpenBot Diagnosis Platform — P26.5 只读接入`,
    ``,
    `Status: **${report.readonlyAdmissionReady ? "Readonly admission ready" : "No-Go"}**`,
    ``,
    `- candidate: \`${report.candidateSha}\``,
    `- LIVE: \`${report.liveSha ?? "unknown"}\``,
    `- packRegistered: ${String(report.packRegistered)}`,
    `- snapshotReaderWired: ${String(report.snapshotReaderWired)}`,
    `- liveExecutorUndeployed: ${String(report.liveExecutorUndeployed)}`,
    `- approvedForProductionCutover: ${String(report.approvedForProductionCutover)}`,
    ``,
    `## Blockers`,
    ``,
    ...(report.blockers.length > 0 ? report.blockers.map((row) => `- ${row}`) : ["- none"]),
    ``,
    report.note,
    ``,
  ].join("\n");
}
