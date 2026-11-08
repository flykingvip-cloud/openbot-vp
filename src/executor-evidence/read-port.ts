/**
 * Read-only evidence view for the observation agent.
 * File reads only: no task create, no resume, no config write, no compensation.
 * A bounded file log is not a complete history. In-memory calls are not durable.
 */
import fs from "node:fs";
import path from "node:path";
import { boundedOutcomePathSegment } from "../task-outcome/store.js";
import type { CommandReceipt, TaskOutcomeRecord, TrustedScope } from "../task-outcome/types.js";
import {
  listMemoryAssociations,
  readAssociationFiles,
  type EvidenceAssociation,
} from "./association.js";
import { snapshotIdentityFingerprint, snapshotStructureValid, fullScopeEqual } from "./identity.js";
import {
  MODEL_CALL_FILE_CAP,
  listModelCalls,
  readCallFiles,
  usageFingerprint,
  type ModelCallEvidence,
} from "./model-call-evidence.js";

export const EVIDENCE_READ_SCHEMA_VERSION = 1 as const;

export type EvidenceReadQuery = {
  agentId: string;
  scope: TrustedScope;
  taskId: string;
  outcomeVersion?: number;
  runId?: string;
  storeRoot: string;
  /** When true, answer from process memory and label it as not durable. */
  memoryOnly?: boolean;
};

export type EvidenceReadView = {
  schemaVersion: 1;
  source: "task-outcome-store+executor-evidence";
  projectedAt: number;
  readOnly: true;
  durableAcrossRestart: boolean;
  completeHistory: false;
  retention: {
    policy: "bounded_file_log" | "process_memory";
    maxCallFiles: number;
  };
  capacity: { callFiles: number; associationFiles: number; watermark: number | null };
  receipts: CommandReceipt[];
  calls: ModelCallEvidence[];
  associations: EvidenceAssociation[];
  gaps: string[];
  completeness: "complete" | "partial" | "unknown" | "mismatch";
  /** Call set closure, independent of budget attribution. */
  callChainCompleteness: "complete" | "partial" | "unknown";
  /**
   * Budget command receipts.
   * not_applicable only when association files were read and none carry a budget command.
   * partial when those files cannot be read, even if no budget row was parsed.
   */
  costAttributionCompleteness: "complete" | "partial" | "unknown" | "not_applicable";
  reasons: string[];
};

type StoredCommand = {
  commandId?: string;
  digest?: string;
  taskId?: string;
  outcomeVersion?: number;
  commitId?: string | null;
  commandDisposition?: string;
};

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function listJson(dir: string): { names: string[]; gap?: string } {
  if (!fs.existsSync(dir)) {
    return { names: [] };
  }
  try {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory()) {
      return { names: [], gap: "not_a_directory" };
    }
    return { names: fs.readdirSync(dir).filter((name) => name.endsWith(".json")) };
  } catch {
    return { names: [], gap: "directory_read_failed" };
  }
}

function isScope(value: unknown): value is TrustedScope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const scope = value as TrustedScope;
  if (scope.kind === "personal") {
    return (
      typeof scope.personalDomainId === "string" &&
      typeof scope.subjectRef === "string" &&
      typeof scope.authzScopeRef === "string"
    );
  }
  if (scope.kind === "enterprise") {
    return (
      typeof scope.enterpriseDomainId === "string" &&
      typeof scope.tenantId === "string" &&
      typeof scope.subjectRef === "string" &&
      typeof scope.authzScopeRef === "string"
    );
  }
  return false;
}

function scopeMatches(candidate: { scope?: TrustedScope }, scope: TrustedScope): boolean {
  return isScope(candidate.scope) && fullScopeEqual(candidate.scope, scope);
}

const CALL_PROVENANCE = new Set(["live", "seed", "injected", "unknown"]);

function tokenFieldOk(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

function finiteTimeOk(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function usageShapeOk(usage: unknown): boolean {
  if (!usage || typeof usage !== "object") {
    return false;
  }
  const row = usage as Record<string, unknown>;
  return ["input", "output", "cacheRead", "cacheWrite"].every((key) => tokenFieldOk(row[key]));
}

/** Reader schema for a call. The snapshot fingerprint does not cover these fields. */
function callRecordSchemaOk(call: ModelCallEvidence | undefined): call is ModelCallEvidence {
  if (!call || typeof call.callId !== "string" || call.callId.length === 0) {
    return false;
  }
  if (typeof call.evidenceId !== "string" || call.evidenceId.length === 0) {
    return false;
  }
  if (typeof call.attemptId !== "string" || call.attemptId.length === 0) {
    return false;
  }
  if (!CALL_PROVENANCE.has(call.provenance)) {
    return false;
  }
  if (
    !finiteTimeOk(call.startedAt) ||
    !finiteTimeOk(call.observedAt) ||
    call.observedAt < call.startedAt
  ) {
    return false;
  }
  if (!isScope(call.scope) || !usageShapeOk(call.usage)) {
    return false;
  }
  const completed = call.completedAt;
  if (call.status === "unknown" || call.status == null) {
    if (completed != null) {
      return false;
    }
  } else if (
    call.status === "completed" ||
    call.status === "failed" ||
    call.status === "cancelled"
  ) {
    if (!finiteTimeOk(completed) || completed < call.startedAt || completed > call.observedAt) {
      return false;
    }
  } else if (call.status != null) {
    return false;
  }
  return true;
}

export function readExecutorEvidence(query: EvidenceReadQuery): EvidenceReadView {
  const projectedAt = Date.now();
  const gaps: string[] = [];
  const reasons: string[] = [];
  if (query.memoryOnly) {
    return readMemory(query, projectedAt);
  }

  const tipFile = path.join(
    query.storeRoot,
    "tips",
    `${boundedOutcomePathSegment(query.taskId)}.json`,
  );
  const tipRaw = readJson(tipFile);
  const tip =
    tipRaw && typeof tipRaw === "object" && isScope((tipRaw as TaskOutcomeRecord).scope)
      ? (tipRaw as TaskOutcomeRecord)
      : undefined;
  if (fs.existsSync(tipFile) && !tip) {
    gaps.push("tip_schema_invalid");
    reasons.push("tip JSON is missing a trusted scope");
  } else if (!tip) {
    gaps.push("tip_absent");
    reasons.push("no task tip; the latest record was not invented");
  } else if (!scopeMatches(tip, query.scope) || tip.taskId !== query.taskId) {
    return emptyMismatch(projectedAt, "scope_mismatch");
  }
  if (query.outcomeVersion != null) {
    const versionFile = path.join(
      query.storeRoot,
      "versions",
      `${boundedOutcomePathSegment(query.taskId)}__v${query.outcomeVersion}.json`,
    );
    const snapshot = readJson(versionFile) as TaskOutcomeRecord | undefined;
    if (!snapshot) {
      gaps.push("version_snapshot_missing");
    } else if (
      !isScope(snapshot.scope) ||
      snapshot.taskId !== query.taskId ||
      snapshot.outcomeVersion !== query.outcomeVersion ||
      !scopeMatches(snapshot, query.scope)
    ) {
      gaps.push("snapshot_identity_mismatch");
      reasons.push("version file content does not match the requested task, version, and scope");
    }
  }

  const receipts: CommandReceipt[] = [];
  const commandDir = path.join(query.storeRoot, "command-log");
  if (tip && !fs.existsSync(commandDir)) {
    gaps.push("command_log_absent");
    reasons.push("a tip without a command log is not a complete chain");
  }
  let commandNames: string[] = [];
  if (fs.existsSync(commandDir)) {
    try {
      commandNames = fs.readdirSync(commandDir).filter((name) => name.endsWith(".json"));
    } catch {
      gaps.push("command_log_read_failed");
      commandNames = [];
    }
  }
  for (const name of commandNames) {
    const file = path.join(commandDir, name);
    const parsed = readJson(file);
    if (parsed == null || typeof parsed !== "object") {
      gaps.push("command_log_corrupt");
      continue;
    }
    const stored = parsed as StoredCommand;
    if (stored.taskId !== query.taskId) {
      continue;
    }
    if (
      typeof stored.outcomeVersion !== "number" ||
      typeof stored.commandId !== "string" ||
      typeof stored.digest !== "string"
    ) {
      gaps.push("command_log_field_invalid");
      continue;
    }
    const versionFile = path.join(
      query.storeRoot,
      "versions",
      `${boundedOutcomePathSegment(query.taskId)}__v${stored.outcomeVersion}.json`,
    );
    const snapshot = readJson(versionFile) as
      | (TaskOutcomeRecord & { snapshotFingerprint?: string })
      | undefined;
    if (!snapshot) {
      gaps.push("version_snapshot_missing");
      reasons.push(`command ${stored.commandId} has no immutable version ${stored.outcomeVersion}`);
      continue;
    }
    const fingerprint = snapshotIdentityFingerprint(snapshot);
    const loggedFingerprint =
      typeof (stored as { snapshotFingerprint?: string }).snapshotFingerprint === "string"
        ? (stored as { snapshotFingerprint?: string }).snapshotFingerprint
        : undefined;
    if (
      snapshot.taskId !== stored.taskId ||
      snapshot.outcomeVersion !== stored.outcomeVersion ||
      !scopeMatches(snapshot, query.scope) ||
      (loggedFingerprint != null && loggedFingerprint !== fingerprint)
    ) {
      gaps.push("snapshot_identity_mismatch");
      reasons.push(`command ${stored.commandId} snapshot body does not match the log`);
      continue;
    }
    if (!loggedFingerprint) {
      gaps.push("snapshot_fingerprint_absent");
      reasons.push(`command ${stored.commandId} has no snapshot fingerprint`);
      continue;
    }
    const commitId =
      typeof stored.commitId === "string" && stored.commitId ? stored.commitId : null;
    if (commitId == null) {
      gaps.push("legacy_commit_id_absent");
      reasons.push(`command ${stored.commandId} predates commit ids and was not backfilled`);
    }
    const disposition = stored.commandDisposition;
    if (disposition !== "applied" && disposition !== "replayed" && disposition !== "no_effect") {
      gaps.push("command_disposition_absent");
      reasons.push(`command ${stored.commandId} has no stored disposition`);
      continue;
    }
    receipts.push({
      schemaVersion: 1,
      commandId: stored.commandId,
      taskId: stored.taskId,
      outcomeVersion: stored.outcomeVersion,
      requestDigest: stored.digest,
      disposition,
      commitId,
    });
  }

  const callReport = readCallFiles(query.storeRoot);
  const schemaCalls = callReport.rows.filter((call) => {
    if (!callRecordSchemaOk(call)) {
      gaps.push("call_schema_invalid");
      return false;
    }
    return true;
  });
  const associationReport = readAssociationFiles(query.storeRoot);
  gaps.push(...callReport.gaps, ...associationReport.gaps);
  let calls = schemaCalls.filter(
    (call) =>
      call.agentId === query.agentId &&
      call.taskId === query.taskId &&
      scopeMatches(call, query.scope),
  );
  const validAssociations: EvidenceAssociation[] = [];
  for (const row of associationReport.rows) {
    if (
      row?.schemaVersion !== 1 ||
      typeof row.agentId !== "string" ||
      !row.trustedScope ||
      (row.trustedScope.kind !== "personal" && row.trustedScope.kind !== "enterprise") ||
      typeof row.runId !== "string"
    ) {
      gaps.push("association_field_invalid");
      continue;
    }
    validAssociations.push(row);
  }
  let associations = validAssociations.filter(
    (row) =>
      row.agentId === query.agentId &&
      row.chain?.taskId === query.taskId &&
      row.trustedScope != null &&
      fullScopeEqual(row.trustedScope, query.scope),
  );
  if (query.runId) {
    const before = calls.length + associations.length;
    calls = calls.filter((call) => call.runId === query.runId);
    associations = associations.filter((row) => row.runId === query.runId);
    if (before > calls.length + associations.length) {
      reasons.push("run filter hid other calls; this view is not the whole task");
    }
  }
  if (query.outcomeVersion != null) {
    associations = associations.filter((row) => row.finalOutcomeVersion === query.outcomeVersion);
  }
  const checkedAssociations: EvidenceAssociation[] = [];
  for (const row of associations) {
    if (row.finalOutcomeVersion == null) {
      checkedAssociations.push(row);
      continue;
    }
    if (!row.finalSnapshotFingerprint) {
      gaps.push("association_fingerprint_absent");
      continue;
    }
    if (row.callId && !row.usageFingerprint) {
      gaps.push("association_usage_fingerprint_absent");
      continue;
    }
    const versionFile = path.join(
      query.storeRoot,
      "versions",
      `${boundedOutcomePathSegment(query.taskId)}__v${row.finalOutcomeVersion}.json`,
    );
    const snapshot = readJson(versionFile) as TaskOutcomeRecord | undefined;
    if (!snapshot || !isScope(snapshot.scope)) {
      gaps.push("association_snapshot_mismatch");
      continue;
    }
    if (
      !snapshotStructureValid(snapshot) ||
      !Array.isArray(snapshot.attempts) ||
      !Array.isArray(snapshot.runs)
    ) {
      gaps.push("association_structure_invalid");
      continue;
    }
    if (snapshotIdentityFingerprint(snapshot) !== row.finalSnapshotFingerprint) {
      gaps.push("association_fingerprint_mismatch");
      continue;
    }
    const attempt = snapshot.attempts.find((item) => item.attemptId === row.taskAttemptId);
    const run = snapshot.runs.find((item) => item.runId === row.runId);
    if (!attempt || attempt.runId !== row.runId || !row.taskAttemptId) {
      gaps.push("association_attempt_mismatch");
      continue;
    }
    if (!run || !run.attemptIds.includes(row.taskAttemptId)) {
      gaps.push("association_run_mismatch");
      continue;
    }
    if (run.effectiveAttemptId && run.effectiveAttemptId !== row.taskAttemptId) {
      gaps.push("association_attempt_mismatch");
      continue;
    }
    if (row.callId) {
      const call = calls.find((item) => item.callId === row.callId);
      if (!call || call.evidenceId !== row.callEvidenceId) {
        gaps.push("association_call_mismatch");
        continue;
      }
      if (call.runId !== row.runId) {
        gaps.push("association_run_mismatch");
        continue;
      }
      if (call.attemptId !== row.candidateAttemptId) {
        gaps.push("association_attempt_mismatch");
        continue;
      }
      if (usageFingerprint(call.usage) !== row.usageFingerprint) {
        gaps.push("association_usage_mismatch");
        continue;
      }
    }
    checkedAssociations.push(row);
  }
  associations = checkedAssociations;
  if (gaps.includes("snapshot_identity_mismatch") || gaps.includes("version_snapshot_missing")) {
    receipts.length = 0;
    calls = [];
    associations = [];
    reasons.push("untrusted snapshot facts were withheld");
  }
  if (associations.length === 0) {
    gaps.push("associations_absent");
    reasons.push("an empty association set is not complete evidence");
  }
  const callDir = listJson(path.join(query.storeRoot, "executor-evidence", "calls"));
  const associationDir = listJson(path.join(query.storeRoot, "executor-evidence", "associations"));
  if (callDir.gap) {
    gaps.push(callDir.gap);
  }
  if (associationDir.gap) {
    gaps.push(associationDir.gap);
  }
  const finalAssociations = associations.filter(
    (row) => typeof row.finalOutcomeVersion === "number",
  );
  if (
    associations.some((row) => row.finalOutcomeVersion == null && row.completeness === "complete")
  ) {
    gaps.push("association_final_version_absent");
    reasons.push(
      "a self-reported complete association without a final version is not in the closure set",
    );
  }
  const linkedIds = finalAssociations
    .map((row) => row.callId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const uniqueLinks = new Set(linkedIds);
  const callIds = new Set(calls.map((call) => call.callId));
  const setClosed =
    uniqueLinks.size > 0 &&
    uniqueLinks.size === linkedIds.length &&
    uniqueLinks.size === callIds.size &&
    [...callIds].every((id) => uniqueLinks.has(id));
  const callFiles = callDir.names.length;
  const associationFiles = associationDir.names.length;
  if (callFiles >= MODEL_CALL_FILE_CAP) {
    gaps.push("call_capacity_reached");
    reasons.push("the call log is capped and is not a complete history");
  }
  const watermark = calls.reduce<number | null>((max, call) => {
    if (max == null || call.observedAt > max) {
      return call.observedAt;
    }
    return max;
  }, null);
  const budgetRows = finalAssociations.filter((row) => row.budgetCommandId);
  const callChainBlocked = gaps.some((gap) =>
    [
      "call_schema_invalid",
      "corrupt_call",
      "call_read_failed",
      "not_a_directory",
      "directory_read_failed",
      "corrupt_association",
      "association_read_failed",
      "association_field_invalid",
      "association_final_version_absent",
      "association_fingerprint_mismatch",
      "association_fingerprint_absent",
      "association_usage_mismatch",
      "association_usage_fingerprint_absent",
      "association_attempt_mismatch",
      "association_run_mismatch",
      "association_call_mismatch",
      "association_snapshot_mismatch",
      "association_structure_invalid",
      "call_capacity_reached",
    ].includes(gap),
  );
  const costBlocked = gaps.some((gap) =>
    [
      "command_log_corrupt",
      "command_log_absent",
      "command_log_field_invalid",
      "command_log_read_failed",
      "command_disposition_absent",
      "snapshot_identity_mismatch",
      "version_snapshot_missing",
      "snapshot_fingerprint_absent",
      "legacy_commit_id_absent",
      "corrupt_association",
      "association_read_failed",
      "association_field_invalid",
      "directory_read_failed",
    ].includes(gap),
  );
  const associationUnreadable =
    associationReport.gaps.length > 0 ||
    associationDir.gap != null ||
    gaps.includes("association_field_invalid");
  const callChainCompleteness =
    !callChainBlocked && setClosed ? "complete" : calls.length > 0 ? "partial" : "unknown";
  const costAttributionCompleteness = associationUnreadable
    ? "partial"
    : budgetRows.length === 0
      ? "not_applicable"
      : !costBlocked &&
          budgetRows.every((row) =>
            receipts.some(
              (receipt) =>
                receipt.commandId === row.budgetCommandId &&
                receipt.commitId != null &&
                receipt.commitId === row.commitId &&
                receipt.requestDigest === row.requestDigest &&
                receipt.outcomeVersion === row.chargeOutcomeVersion &&
                receipt.disposition === row.disposition,
            ),
          )
        ? "complete"
        : "partial";
  const completeness =
    gaps.length === 0 &&
    callChainCompleteness === "complete" &&
    (costAttributionCompleteness === "complete" ||
      costAttributionCompleteness === "not_applicable") &&
    finalAssociations.every((row) => row.completeness === "complete")
      ? "complete"
      : tip
        ? "partial"
        : "unknown";
  return {
    schemaVersion: 1,
    source: "task-outcome-store+executor-evidence",
    projectedAt,
    readOnly: true,
    durableAcrossRestart: true,
    completeHistory: false,
    retention: { policy: "bounded_file_log", maxCallFiles: MODEL_CALL_FILE_CAP },
    capacity: { callFiles, associationFiles, watermark },
    receipts,
    calls,
    associations,
    gaps,
    completeness,
    callChainCompleteness,
    costAttributionCompleteness,
    reasons,
  };
}

function readMemory(query: EvidenceReadQuery, projectedAt: number): EvidenceReadView {
  const taskCalls = listModelCalls().filter(
    (call) => call.agentId === query.agentId && call.taskId === query.taskId,
  );
  const scoped = taskCalls.filter((call) => fullScopeEqual(call.scope, query.scope));
  const scopedAssociations = listMemoryAssociations().filter(
    (row) =>
      row.agentId === query.agentId &&
      row.chain.taskId === query.taskId &&
      row.trustedScope != null &&
      fullScopeEqual(row.trustedScope, query.scope),
  );
  if (
    taskCalls.some((call) => !fullScopeEqual(call.scope, query.scope)) &&
    scopedAssociations.length === 0
  ) {
    return emptyMismatch(projectedAt, "scope_mismatch");
  }
  if (taskCalls.length > 0 && scoped.length === 0) {
    return emptyMismatch(projectedAt, "scope_mismatch");
  }
  let associations = scopedAssociations.filter(
    (row) =>
      row.agentId === query.agentId &&
      row.chain.taskId === query.taskId &&
      row.trustedScope != null &&
      fullScopeEqual(row.trustedScope, query.scope) &&
      (!query.runId || row.runId === query.runId) &&
      (query.outcomeVersion == null || row.finalOutcomeVersion === query.outcomeVersion),
  );
  let calls = scoped;
  if (query.runId) {
    calls = calls.filter((call) => call.runId === query.runId);
  }
  if (query.outcomeVersion != null) {
    const linked = new Set(
      associations.map((row) => row.callId).filter((id): id is string => Boolean(id)),
    );
    calls = calls.filter((call) => linked.has(call.callId));
  }
  const gaps = ["memory_is_not_durable_history"];
  if (associations.length === 0) {
    gaps.push("associations_absent");
  }
  return {
    schemaVersion: 1,
    source: "task-outcome-store+executor-evidence",
    projectedAt,
    readOnly: true,
    durableAcrossRestart: false,
    completeHistory: false,
    retention: { policy: "process_memory", maxCallFiles: 0 },
    capacity: { callFiles: calls.length, associationFiles: associations.length, watermark: null },
    receipts: [],
    calls,
    associations,
    gaps,
    completeness: "partial",
    callChainCompleteness: "partial",
    costAttributionCompleteness: "unknown",
    reasons: ["in-memory calls disappear on restart and are not a historical record"],
  };
}

function emptyMismatch(projectedAt: number, reason: string): EvidenceReadView {
  return {
    schemaVersion: 1,
    source: "task-outcome-store+executor-evidence",
    projectedAt,
    readOnly: true,
    durableAcrossRestart: true,
    completeHistory: false,
    retention: { policy: "bounded_file_log", maxCallFiles: MODEL_CALL_FILE_CAP },
    capacity: { callFiles: 0, associationFiles: 0, watermark: null },
    receipts: [],
    calls: [],
    associations: [],
    gaps: [reason],
    completeness: "mismatch",
    callChainCompleteness: "unknown",
    costAttributionCompleteness: "unknown",
    reasons: [reason],
  };
}
