/**
 * Recheck observations hang off one TaskOutcome version.
 * Each execution is its own attempt. A later result does not erase an earlier one.
 * Reading them does not create a store. Writing one does not change taskJudgement.
 * A missing file is "not checked". A broken file is a read failure, not "未复验".
 */
import path from "node:path";
import {
  readDurableJsonSync,
  withDurableJsonLock,
  writeDurableJsonAtomic,
} from "./durable-json-file.js";
import type { RecheckDisplayStatus } from "./recheck-label.js";
import { DurableTaskOutcomeStore, boundedOutcomePathSegment } from "./store.js";

export type RecheckObservationStatus = RecheckDisplayStatus;

type StoredAttempt = {
  taskId: string;
  outcomeVersion: number;
  attempt: number;
  status: "incomplete" | "completed";
  reason: "not_completed" | "recorded";
};

type AttemptFile = {
  schemaVersion: 2;
  attempts: StoredAttempt[];
};

export type RecheckAttemptView = {
  attempt: number;
  status: "incomplete" | "completed";
};

export type RecheckObservationView =
  | { ok: true; status: "not_checked"; attempt: null; attempts: [] }
  | {
      ok: true;
      status: "incomplete" | "completed";
      attempt: number;
      attempts: RecheckAttemptView[];
    }
  | { ok: false; code: "read_failed" };

export type RecordRecheckResult =
  | { ok: true; attempt: number; status: "incomplete" | "completed" }
  | { ok: false; code: "version_missing" | "storage_failed" };

export function recheckObservationFilePath(rootDir: string, taskId: string): string {
  return path.join(rootDir, "recheck-observations", `${boundedOutcomePathSegment(taskId)}.json`);
}

function reasonFor(status: "incomplete" | "completed"): StoredAttempt["reason"] {
  return status === "incomplete" ? "not_completed" : "recorded";
}

function parseAttempt(value: unknown, taskId: string): StoredAttempt | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const rowTaskId = typeof row.taskId === "string" ? row.taskId : "";
  const outcomeVersion = row.outcomeVersion;
  const attempt = row.attempt;
  const status = row.status;
  if (rowTaskId !== taskId) {
    return null;
  }
  if (
    typeof outcomeVersion !== "number" ||
    !Number.isInteger(outcomeVersion) ||
    outcomeVersion < 1
  ) {
    return null;
  }
  if (typeof attempt !== "number" || !Number.isInteger(attempt) || attempt < 1) {
    return null;
  }
  if (status !== "incomplete" && status !== "completed") {
    return null;
  }
  if (row.reason !== reasonFor(status)) {
    return null;
  }
  return {
    taskId,
    outcomeVersion,
    attempt,
    status,
    reason: reasonFor(status),
  };
}

function hasDuplicateAttempts(attempts: StoredAttempt[]): boolean {
  const seen = new Set<string>();
  for (const row of attempts) {
    const key = `${row.outcomeVersion}:${row.attempt}`;
    if (seen.has(key)) {
      return true;
    }
    seen.add(key);
  }
  return false;
}

function parseLegacy(rows: unknown[], taskId: string): StoredAttempt[] | null {
  const counters = new Map<number, number>();
  const attempts: StoredAttempt[] = [];
  for (const value of rows) {
    if (!value || typeof value !== "object") {
      return null;
    }
    const row = value as Record<string, unknown>;
    const status = row.status;
    if (status !== "incomplete" && status !== "completed") {
      return null;
    }
    const withAttempt = parseAttempt(
      {
        ...row,
        attempt:
          (counters.get(typeof row.outcomeVersion === "number" ? row.outcomeVersion : 0) ?? 0) + 1,
      },
      taskId,
    );
    if (!withAttempt) {
      return null;
    }
    counters.set(withAttempt.outcomeVersion, withAttempt.attempt);
    attempts.push(withAttempt);
  }
  return attempts;
}

function parseFile(value: unknown, taskId: string): StoredAttempt[] | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion === 2) {
    if (!Array.isArray(record.attempts)) {
      return null;
    }
    const attempts: StoredAttempt[] = [];
    for (const row of record.attempts) {
      const parsed = parseAttempt(row, taskId);
      if (!parsed) {
        return null;
      }
      attempts.push(parsed);
    }
    return hasDuplicateAttempts(attempts) ? null : attempts;
  }
  if (record.schemaVersion !== undefined || record.attempts !== undefined) {
    return null;
  }
  if (!Array.isArray(record.observations)) {
    return null;
  }
  const legacy = parseLegacy(record.observations, taskId);
  if (!legacy || hasDuplicateAttempts(legacy)) {
    return null;
  }
  return legacy;
}

function viewForVersion(attempts: StoredAttempt[], outcomeVersion: number): RecheckObservationView {
  const rows = attempts
    .filter((row) => row.outcomeVersion === outcomeVersion)
    .toSorted((left, right) => left.attempt - right.attempt);
  if (rows.length === 0) {
    return { ok: true, status: "not_checked", attempt: null, attempts: [] };
  }
  const latest = rows[rows.length - 1];
  if (!latest) {
    return { ok: true, status: "not_checked", attempt: null, attempts: [] };
  }
  return {
    ok: true,
    status: latest.status,
    attempt: latest.attempt,
    attempts: rows.map((row) => ({ attempt: row.attempt, status: row.status })),
  };
}

export function readRecheckObservation(
  rootDir: string,
  taskId: string,
  outcomeVersion: number,
): RecheckObservationView {
  const loaded = readDurableJsonSync(recheckObservationFilePath(rootDir, taskId));
  if (!loaded.ok) {
    return { ok: false, code: "read_failed" };
  }
  if (loaded.missing) {
    return { ok: true, status: "not_checked", attempt: null, attempts: [] };
  }
  const attempts = parseFile(loaded.value, taskId);
  if (!attempts) {
    return { ok: false, code: "read_failed" };
  }
  return viewForVersion(attempts, outcomeVersion);
}

export function readRecheckStatus(
  rootDir: string,
  taskId: string,
  outcomeVersion: number,
): RecheckObservationStatus {
  const view = readRecheckObservation(rootDir, taskId, outcomeVersion);
  if (!view.ok) {
    return "read_failed";
  }
  return view.status;
}

/** Test and later executor seam. Does not run a scenario and does not edit the version snapshot. */
export function recordIncompleteRecheckObservation(params: {
  rootDir: string;
  taskId: string;
  outcomeVersion: number;
}): Promise<RecordRecheckResult> {
  return recordRecheckObservation({ ...params, status: "incomplete" });
}

export async function recordRecheckObservation(params: {
  rootDir: string;
  taskId: string;
  outcomeVersion: number;
  status: "incomplete" | "completed";
}): Promise<RecordRecheckResult> {
  const taskId = params.taskId.trim();
  if (!taskId || !Number.isInteger(params.outcomeVersion) || params.outcomeVersion < 1) {
    return { ok: false, code: "version_missing" };
  }
  const store = new DurableTaskOutcomeStore(params.rootDir);
  try {
    const before = store.loadTaskVersion(taskId, params.outcomeVersion);
    if (!before) {
      return { ok: false, code: "version_missing" };
    }
    const filePath = recheckObservationFilePath(params.rootDir, taskId);
    let recorded: RecordRecheckResult;
    try {
      recorded = await withDurableJsonLock(filePath, async () => {
        const loaded = readDurableJsonSync(filePath);
        if (!loaded.ok) {
          return { ok: false, code: "storage_failed" };
        }
        const existing = loaded.missing ? [] : parseFile(loaded.value, taskId);
        if (!existing) {
          return { ok: false, code: "storage_failed" };
        }
        const nextAttempt =
          existing
            .filter((row) => row.outcomeVersion === params.outcomeVersion)
            .reduce((max, row) => Math.max(max, row.attempt), 0) + 1;
        const attempt: StoredAttempt = {
          taskId,
          outcomeVersion: params.outcomeVersion,
          attempt: nextAttempt,
          status: params.status,
          reason: reasonFor(params.status),
        };
        const next: AttemptFile = {
          schemaVersion: 2,
          attempts: [...existing, attempt],
        };
        await writeDurableJsonAtomic(filePath, next);
        return { ok: true, attempt: nextAttempt, status: params.status };
      });
    } catch {
      return { ok: false, code: "storage_failed" };
    }
    const after = store.loadTaskVersion(taskId, params.outcomeVersion);
    if (!after || after.taskJudgement !== before.taskJudgement) {
      throw new Error("recheck observation changed taskJudgement");
    }
    return recorded;
  } finally {
    store.close();
  }
}
