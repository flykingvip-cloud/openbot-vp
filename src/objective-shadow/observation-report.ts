/**
 * Read-only Phase 2 shadow observation report.
 * Reads JSONL / window state only. Never writes coordination objects,
 * Ledger, Lease, Pointer, Contribution, or production shadow logs.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  defaultObjectiveShadowLogPath,
  defaultObjectiveShadowWindowPath,
  readShadowRecords,
} from "./log.js";
import { looksSensitive } from "./redact.js";
import {
  OBJECTIVE_SHADOW_SCHEMA,
  type ResolveStatus,
  type ShadowIngress,
  type ShadowObserveRecord,
} from "./types.js";
import {
  SHADOW_WINDOW_MS,
  SHADOW_WINDOW_N,
  emptyWindowState,
  readWindowState,
  type ShadowWindowState,
} from "./window.js";

export const OBSERVATION_REPORT_SCHEMA = "objective-shadow-observation/v1" as const;

const INGRESSES: ShadowIngress[] = [
  "cron_isolated",
  "chat",
  "collaboration_turn",
  "subagent",
  "heartbeat",
  "gateway_agent",
  "acp",
];

const RESOLVE_STATUSES: ResolveStatus[] = [
  "resolved",
  "conflict",
  "allowlist_rejected",
  "skipped",
  "out_of_scope",
];

const SESSION_KEY_PREFIX = /^(?:agent:|cron:|session:)/;

const UNEXPECTED_PLAINTEXT_KEYS = [
  "tenantId",
  "groupId",
  "tenant",
  "email",
  "prompt",
  "message",
  "goal",
  "instruction",
  "hmac",
  "hmacKey",
  "acceptance",
  "compiledInstruction",
];

export type IngressBucket = {
  records: number;
  proposedGenerated: number;
  proposedRejected: number;
  proposedDiscarded: number;
};

export type ObservationReport = {
  schemaVersion: typeof OBSERVATION_REPORT_SCHEMA;
  cycleStartedAtMs: number | null;
  reportGeneratedAtMs: number;
  landedSha: string | null;
  logCorrespondsToLandedSha: boolean | null;
  ingress: Record<ShadowIngress, IngressBucket>;
  resolveStatus: Record<ResolveStatus, number>;
  sourceConflictCount: number;
  sourceConflictRate: number;
  allowlistRejectedCount: number;
  allowlistRejectedRate: number;
  inheritViolationCount: number;
  inheritViolationRate: number;
  redactionDroppedCount: number;
  hmacKeyMissingCount: number;
  hmacKeyMissingNote: string;
  forbiddenWriteAttempts: number;
  duplicateRunIdCount: number;
  missingRunIdCount: number;
  leakCategories: string[];
  fabricatedIdentityFlags: string[];
  writesAfterWindowClose: number;
  runtimeResultChanged: boolean;
  coordinationWritesDetected: boolean;
  stopConditionsTriggered: string[];
  mustStop: boolean;
  windowStopped: boolean;
  windowClosedByClock: boolean;
  windowClosedByCount: boolean;
};

export type ObservationReportInput = {
  records: ShadowObserveRecord[];
  window?: ShadowWindowState;
  landedSha?: string | null;
  logCorrespondsToLandedSha?: boolean | null;
  nowMs?: number;
  /** Operator attestation: any live run result / prompt / completion / ledger change. */
  runtimeResultChanged?: boolean;
  coordinationWritesDetected?: boolean;
};

function emptyBucket(): IngressBucket {
  return { records: 0, proposedGenerated: 0, proposedRejected: 0, proposedDiscarded: 0 };
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : Number((count / total).toFixed(6));
}

function recordHasCode(record: ShadowObserveRecord, code: string): boolean {
  return record.conflictCodes.includes(code) || record.rejectOrDiscardCodes.includes(code);
}

function classifyString(value: string, categories: Set<string>): void {
  if (!value || /^[a-f0-9]{16,64}$/i.test(value)) {
    return;
  }
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(value)) {
    categories.add("email");
  }
  if (/(?:sk-|ghp_|gho_|xox[baprs]-)/.test(value) || looksSensitive(value)) {
    if (/^(?:sk-|ghp_|gho_|xox[baprs]-)/.test(value.trim()) || value.includes(".")) {
      categories.add("token");
    }
    if (
      /^(?:\/|~\/|[A-Za-z]:[\\/])/.test(value.trim()) ||
      value.includes("/Users/") ||
      value.includes("/home/")
    ) {
      categories.add("absolute_path");
    }
    if (value.includes("@")) {
      categories.add("email");
    }
    const digits = value.replace(/[\s-]/g, "");
    if (/^\+?\d{10,}$/.test(digits) && !/^\d{13,}$/.test(digits)) {
      categories.add("phone");
    }
  }
}

function walkForLeaks(value: unknown, categories: Set<string>, key?: string): void {
  if (key && UNEXPECTED_PLAINTEXT_KEYS.includes(key)) {
    categories.add("unexpected_plaintext_key");
  }
  if (typeof value === "string") {
    classifyString(value, categories);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      walkForLeaks(item, categories);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const [nextKey, nextValue] of Object.entries(value)) {
      walkForLeaks(nextValue, categories, nextKey);
    }
  }
}

export function scanShadowPayloadForLeaks(serialized: string): string[] {
  const categories = new Set<string>();
  try {
    walkForLeaks(JSON.parse(serialized), categories);
  } catch {
    classifyString(serialized, categories);
    for (const key of UNEXPECTED_PLAINTEXT_KEYS) {
      if (new RegExp(`"${key}"\\s*:`).test(serialized)) {
        categories.add("unexpected_plaintext_key");
      }
    }
  }
  return [...categories];
}

export function detectFabricatedIdentity(records: ShadowObserveRecord[]): string[] {
  const flags = new Set<string>();
  const cronRevisions = new Set<number>();
  for (const record of records) {
    const { runId, objectiveId, cronOccurrenceId, ingress } = record.correlation;
    if (objectiveId && objectiveId === runId) {
      flags.add("objective_equals_run_id");
    }
    if (objectiveId && cronOccurrenceId && objectiveId === cronOccurrenceId) {
      flags.add("objective_equals_occurrence");
    }
    if (objectiveId && SESSION_KEY_PREFIX.test(objectiveId)) {
      flags.add("objective_looks_like_session_key");
    }
    if (runId && SESSION_KEY_PREFIX.test(runId) && ingress !== "subagent") {
      flags.add("run_id_looks_like_session_key");
    }
    if (ingress === "cron_isolated" && record.resolveStatus === "resolved") {
      if (record.correlation.revision !== undefined) {
        cronRevisions.add(record.correlation.revision);
      }
      if (!cronOccurrenceId) {
        flags.add("cron_resolved_missing_occurrence");
      }
    }
    if (looksSensitive(runId) || (objectiveId && looksSensitive(objectiveId))) {
      flags.add("identity_looks_sensitive");
    }
  }
  const cronResolved = records.filter(
    (record) =>
      record.correlation.ingress === "cron_isolated" && record.resolveStatus === "resolved",
  );
  if (cronResolved.length >= 2 && cronRevisions.size === 1 && cronRevisions.has(1)) {
    flags.add("cron_constant_revision_one");
  }
  return [...flags];
}

function countDuplicateRunIds(records: ShadowObserveRecord[]): number {
  const seen = new Map<string, number>();
  for (const record of records) {
    const runId = record.correlation.runId;
    if (!runId) {
      continue;
    }
    seen.set(runId, (seen.get(runId) ?? 0) + 1);
  }
  let extras = 0;
  for (const count of seen.values()) {
    extras += Math.max(0, count - 1);
  }
  return extras;
}

function countWritesAfterWindowClose(
  records: ShadowObserveRecord[],
  window: ShadowWindowState,
): number {
  if (records.length === 0) {
    return 0;
  }
  const firstWriteAtMs =
    window.firstWriteAtMs ?? Math.min(...records.map((record) => record.observedAtMs));
  const clockCloseAt = firstWriteAtMs + SHADOW_WINDOW_MS;
  let count = 0;
  const ingressCounts: Partial<Record<ShadowIngress, number>> = {};
  const ordered = [...records].toSorted((a, b) => a.observedAtMs - b.observedAtMs);
  for (const record of ordered) {
    const ingress = record.correlation.ingress;
    const prior = ingressCounts[ingress] ?? 0;
    if (record.observedAtMs >= clockCloseAt || prior >= SHADOW_WINDOW_N) {
      count += 1;
    }
    ingressCounts[ingress] = prior + 1;
  }
  return count;
}

export function summarizeObservation(input: ObservationReportInput): ObservationReport {
  const records = input.records;
  const window = input.window ?? emptyWindowState();
  const nowMs = input.nowMs ?? Date.now();
  const total = records.length;
  const ingress = Object.fromEntries(INGRESSES.map((key) => [key, emptyBucket()])) as Record<
    ShadowIngress,
    IngressBucket
  >;
  const resolveStatus = Object.fromEntries(RESOLVE_STATUSES.map((key) => [key, 0])) as Record<
    ResolveStatus,
    number
  >;

  let sourceConflictCount = 0;
  let allowlistRejectedCount = 0;
  let inheritViolationCount = 0;
  let redactionDroppedCount = 0;
  let forbiddenWriteAttempts = 0;
  let missingRunIdCount = 0;
  const leakCategories = new Set<string>();

  for (const record of records) {
    const bucket = ingress[record.correlation.ingress] ?? emptyBucket();
    bucket.records += 1;
    bucket.proposedGenerated += record.metrics.proposedGenerated;
    bucket.proposedRejected += record.metrics.proposedRejected;
    bucket.proposedDiscarded += record.metrics.proposedDiscarded;
    ingress[record.correlation.ingress] = bucket;
    resolveStatus[record.resolveStatus] += 1;
    sourceConflictCount += record.metrics.sourceConflict;
    allowlistRejectedCount += record.metrics.allowlistRejected;
    inheritViolationCount += record.metrics.inheritViolation;
    if (recordHasCode(record, "redaction_dropped")) {
      redactionDroppedCount += 1;
    }
    forbiddenWriteAttempts += record.metrics.forbiddenWriteAttempts;
    if (!record.correlation.runId) {
      missingRunIdCount += 1;
    }
    for (const category of scanShadowPayloadForLeaks(JSON.stringify(record))) {
      leakCategories.add(category);
    }
    if (record.schemaVersion !== OBJECTIVE_SHADOW_SCHEMA) {
      leakCategories.add("schema_mismatch");
    }
  }

  const fabricatedIdentityFlags = detectFabricatedIdentity(records);
  const writesAfterWindowClose = countWritesAfterWindowClose(records, window);
  const windowClosedByClock =
    window.firstWriteAtMs !== null && nowMs - window.firstWriteAtMs >= SHADOW_WINDOW_MS;
  const windowClosedByCount = INGRESSES.some((key) => (window.counts[key] ?? 0) >= SHADOW_WINDOW_N);
  const runtimeResultChanged = input.runtimeResultChanged === true;
  const coordinationWritesDetected = input.coordinationWritesDetected === true;

  const stopConditionsTriggered: string[] = [];
  if (forbiddenWriteAttempts > 0) {
    stopConditionsTriggered.push("forbiddenWriteAttempts");
  }
  if (coordinationWritesDetected) {
    stopConditionsTriggered.push("coordination_writes");
  }
  if (runtimeResultChanged) {
    stopConditionsTriggered.push("runtime_result_changed");
  }
  if (leakCategories.size > 0) {
    stopConditionsTriggered.push("plaintext_leak");
  }
  if (missingRunIdCount > 0) {
    stopConditionsTriggered.push("missing_run_id");
  }
  if (writesAfterWindowClose > 0) {
    stopConditionsTriggered.push("write_after_window_close");
  }
  if (fabricatedIdentityFlags.length > 0) {
    stopConditionsTriggered.push("fabricated_identity");
  }
  const logCorrespondsToLandedSha = input.logCorrespondsToLandedSha ?? null;
  if (logCorrespondsToLandedSha === false) {
    stopConditionsTriggered.push("log_not_tied_to_landed_sha");
  }

  return {
    schemaVersion: OBSERVATION_REPORT_SCHEMA,
    cycleStartedAtMs: window.firstWriteAtMs,
    reportGeneratedAtMs: nowMs,
    landedSha: input.landedSha ?? null,
    logCorrespondsToLandedSha,
    ingress,
    resolveStatus,
    sourceConflictCount,
    sourceConflictRate: rate(sourceConflictCount, total),
    allowlistRejectedCount,
    allowlistRejectedRate: rate(allowlistRejectedCount, total),
    inheritViolationCount,
    inheritViolationRate: rate(inheritViolationCount, total),
    redactionDroppedCount,
    hmacKeyMissingCount: 0,
    hmacKeyMissingNote:
      "fail-closed hmac_key_missing events are not persisted; JSONL-derived count is 0 by design",
    forbiddenWriteAttempts,
    duplicateRunIdCount: countDuplicateRunIds(records),
    missingRunIdCount,
    leakCategories: [...leakCategories],
    fabricatedIdentityFlags,
    writesAfterWindowClose,
    runtimeResultChanged,
    coordinationWritesDetected,
    stopConditionsTriggered,
    mustStop: stopConditionsTriggered.length > 0,
    windowStopped: window.stopped,
    windowClosedByClock,
    windowClosedByCount,
  };
}

export function loadObservationInput(logPath: string, windowPath?: string): ObservationReportInput {
  return {
    records: readShadowRecords(logPath),
    window: readWindowState(windowPath ?? defaultObjectiveShadowWindowPath(logPath)),
  };
}

function isoOrPending(ms: number | null): string {
  return ms === null ? "pending_first_write" : new Date(ms).toISOString();
}

export function formatObservationReportMarkdown(report: ObservationReport): string {
  const lines = [
    "# Phase 2 Objective Shadow observation report",
    "",
    `- schema: \`${report.schemaVersion}\``,
    `- cycleStartedAt: ${isoOrPending(report.cycleStartedAtMs)}`,
    `- reportGeneratedAt: ${new Date(report.reportGeneratedAtMs).toISOString()}`,
    `- landedSha: ${report.landedSha ?? "not_landed"}`,
    `- logCorrespondsToLandedSha: ${String(report.logCorrespondsToLandedSha)}`,
    `- mustStop: ${String(report.mustStop)}`,
    `- stopConditionsTriggered: ${report.stopConditionsTriggered.join(", ") || "none"}`,
    "",
    "## Ingress counts",
    "",
    "| ingress | records | proposed generated | proposed rejected | proposed discarded |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const key of INGRESSES) {
    const bucket = report.ingress[key];
    lines.push(
      `| ${key} | ${bucket.records} | ${bucket.proposedGenerated} | ${bucket.proposedRejected} | ${bucket.proposedDiscarded} |`,
    );
  }
  lines.push(
    "",
    "## Resolve status",
    "",
    `| resolved | ${report.resolveStatus.resolved} |`,
    `| conflict | ${report.resolveStatus.conflict} |`,
    `| allowlist_rejected | ${report.resolveStatus.allowlist_rejected} |`,
    `| skipped | ${report.resolveStatus.skipped} |`,
    `| out_of_scope | ${report.resolveStatus.out_of_scope} |`,
    "",
    "## Rates and guards",
    "",
    `- sourceConflict: ${report.sourceConflictCount} (${report.sourceConflictRate})`,
    `- allowlistRejected: ${report.allowlistRejectedCount} (${report.allowlistRejectedRate})`,
    `- inheritViolation: ${report.inheritViolationCount} (${report.inheritViolationRate})`,
    `- redaction_dropped: ${report.redactionDroppedCount}`,
    `- hmac_key_missing: ${report.hmacKeyMissingCount} (${report.hmacKeyMissingNote})`,
    `- forbiddenWriteAttempts: ${report.forbiddenWriteAttempts}`,
    `- duplicateRunIdCount: ${report.duplicateRunIdCount}`,
    `- missingRunIdCount: ${report.missingRunIdCount}`,
    `- writesAfterWindowClose: ${report.writesAfterWindowClose}`,
    `- leakCategories: ${report.leakCategories.join(", ") || "none"}`,
    `- fabricatedIdentityFlags: ${report.fabricatedIdentityFlags.join(", ") || "none"}`,
    `- runtimeResultChanged: ${String(report.runtimeResultChanged)}`,
    `- coordinationWritesDetected: ${String(report.coordinationWritesDetected)}`,
    `- windowStopped: ${String(report.windowStopped)}`,
    `- windowClosedByClock: ${String(report.windowClosedByClock)}`,
    `- windowClosedByCount: ${String(report.windowClosedByCount)}`,
    "",
    "This report contains hashed identifiers and counts only. It must not include user text, tenant/group plaintext, prompts, model output, or secrets.",
    "",
  );
  return lines.join("\n");
}

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

export function runObservationReportCli(argvEnv: NodeJS.ProcessEnv = process.env): string {
  const logPath = parseArg("log") ?? defaultObjectiveShadowLogPath();
  const windowPath = parseArg("window") ?? defaultObjectiveShadowWindowPath(logPath);
  const landedSha =
    parseArg("landed") ?? argvEnv.OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_LANDED_SHA ?? null;
  const report = summarizeObservation({
    ...loadObservationInput(logPath, windowPath),
    landedSha,
    runtimeResultChanged: argvEnv.OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_RUNTIME_CHANGED === "1",
    coordinationWritesDetected: argvEnv.OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_COORD_WRITES === "1",
  });
  return formatObservationReportMarkdown(report);
}

const invokedAsMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsMain) {
  process.stdout.write(runObservationReportCli());
}

/** Kept for tests that want to assert the CLI does not read extra files. */
export function readRawLogOrEmpty(logPath: string): string {
  try {
    return readFileSync(logPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}
