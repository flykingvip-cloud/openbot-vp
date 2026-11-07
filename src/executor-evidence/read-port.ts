/**
 * Read-only evidence view for the observation agent.
 * File reads only: no task create, no resume, no config write, no compensation.
 * A bounded file log is not a complete history. In-memory calls are not durable.
 */
import fs from "node:fs";
import path from "node:path";
import { boundedOutcomePathSegment } from "../task-outcome/store.js";
import { scopeIdOf } from "../task-outcome/transitions.js";
import type { CommandReceipt, TaskOutcomeRecord, TrustedScope } from "../task-outcome/types.js";
import { loadPersistedAssociations, type EvidenceAssociation } from "./association.js";
import {
  MODEL_CALL_FILE_CAP,
  listModelCalls,
  loadPersistedModelCalls,
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
  return (
    candidate.scope.kind === scope.kind &&
    scopeIdOf(candidate.scope) === scopeIdOf(scope) &&
    candidate.scope.subjectRef === scope.subjectRef
  );
}

export function readExecutorEvidence(query: EvidenceReadQuery): EvidenceReadView {
  const projectedAt = Date.now();
  const gaps: string[] = [];
  const reasons: string[] = [];
  if (query.memoryOnly) {
    const calls = listModelCalls().filter(
      (call) => call.agentId === query.agentId && call.taskId === query.taskId,
    );
    return {
      schemaVersion: 1,
      source: "task-outcome-store+executor-evidence",
      projectedAt,
      readOnly: true,
      durableAcrossRestart: false,
      completeHistory: false,
      retention: { policy: "process_memory", maxCallFiles: 0 },
      capacity: { callFiles: calls.length, associationFiles: 0, watermark: null },
      receipts: [],
      calls,
      associations: [],
      gaps: ["memory_is_not_durable_history"],
      completeness: "partial",
      reasons: ["in-memory calls disappear on restart and are not a historical record"],
    };
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
  }

  const receipts: CommandReceipt[] = [];
  for (const name of listJson(path.join(query.storeRoot, "command-log"))) {
    const stored = readJson(path.join(query.storeRoot, "command-log", name)) as
      | StoredCommand
      | undefined;
    if (!stored || stored.taskId !== query.taskId || typeof stored.outcomeVersion !== "number") {
      continue;
    }
    if (typeof stored.commandId !== "string" || typeof stored.digest !== "string") {
      gaps.push("legacy_command_identity_absent");
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
    if (!fs.existsSync(versionFile)) {
      gaps.push("version_snapshot_missing");
      reasons.push(`command ${stored.commandId} has no immutable version ${stored.outcomeVersion}`);
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

  let calls = loadPersistedModelCalls(query.storeRoot).filter(
    (call) =>
      call.agentId === query.agentId &&
      call.taskId === query.taskId &&
      scopeMatches(call, query.scope),
  );
  let associations = loadPersistedAssociations(query.storeRoot).filter(
    (row) =>
      row.agentId === query.agentId &&
      row.chain.taskId === query.taskId &&
      row.scopeId === scopeIdOf(query.scope),
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
    gaps.length === 0 &&
    calls.length > 0 &&
    associations.every((row) => row.completeness === "complete")
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
