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
import { snapshotIdentityFingerprint, fullScopeEqual } from "./identity.js";
import {
  MODEL_CALL_FILE_CAP,
  listModelCalls,
  readCallFiles,
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
  reasons: string[];
};

type StoredCommand = {
  commandId?: string;
  digest?: string;
  taskId?: string;
  outcomeVersion?: number;
  commitId?: string | null;
};

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function listJson(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
}

function scopeMatches(candidate: { scope: TrustedScope }, scope: TrustedScope): boolean {
  return fullScopeEqual(candidate.scope, scope);
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
  const tip = readJson(tipFile) as TaskOutcomeRecord | undefined;
  if (!tip) {
    gaps.push("tip_absent");
    reasons.push("no task tip; the latest record was not invented");
  } else if (!scopeMatches(tip, query.scope) || tip.taskId !== query.taskId) {
    return emptyMismatch(projectedAt, "scope_mismatch");
  } else if (query.outcomeVersion != null) {
    const versionFile = path.join(
      query.storeRoot,
      "versions",
      `${boundedOutcomePathSegment(query.taskId)}__v${query.outcomeVersion}.json`,
    );
    const snapshot = readJson(versionFile) as TaskOutcomeRecord | undefined;
    if (!snapshot) {
      gaps.push("version_snapshot_missing");
    } else if (
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
    if (parsed === undefined) {
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
    if (query.outcomeVersion != null && stored.outcomeVersion !== query.outcomeVersion) {
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
    receipts.push({
      schemaVersion: 1,
      commandId: stored.commandId,
      taskId: stored.taskId,
      outcomeVersion: stored.outcomeVersion,
      requestDigest: stored.digest,
      disposition: "replayed",
      commitId,
    });
  }

  const callReport = readCallFiles(query.storeRoot);
  const associationReport = readAssociationFiles(query.storeRoot);
  gaps.push(...callReport.gaps, ...associationReport.gaps);
  let calls = callReport.rows.filter(
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
    const linked = new Set(
      associations.map((row) => row.callId).filter((id): id is string => Boolean(id)),
    );
    calls = calls.filter((call) => linked.has(call.callId));
  }
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
  const linkedIds = associations
    .map((row) => row.callId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const callIds = new Set(calls.map((call) => call.callId));
  const setClosed =
    linkedIds.length > 0 &&
    linkedIds.length === callIds.size &&
    linkedIds.every((id) => callIds.has(id));
  const callFiles = listJson(path.join(query.storeRoot, "executor-evidence", "calls")).length;
  const associationFiles = listJson(
    path.join(query.storeRoot, "executor-evidence", "associations"),
  ).length;
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
  const completeness =
    gaps.length === 0 && setClosed && associations.every((row) => row.completeness === "complete")
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
    reasons: [reason],
  };
}
