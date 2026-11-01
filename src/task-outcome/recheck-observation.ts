/**
 * Recheck observations hang off one TaskOutcome version.
 * Reading them does not create a store. Writing one does not change taskJudgement.
 */
import fs from "node:fs";
import path from "node:path";
import { DurableTaskOutcomeStore, boundedOutcomePathSegment } from "./store.js";

export type RecheckObservationStatus = "not_checked" | "incomplete";

type StoredRecheckObservation = {
  taskId: string;
  outcomeVersion: number;
  status: "incomplete";
  reason: "not_completed";
};

type RecheckObservationFile = {
  observations: StoredRecheckObservation[];
};

function observationPath(rootDir: string, taskId: string): string {
  return path.join(rootDir, "recheck-observations", `${boundedOutcomePathSegment(taskId)}.json`);
}

function readFile(rootDir: string, taskId: string): StoredRecheckObservation[] {
  const filePath = observationPath(rootDir, taskId);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as RecheckObservationFile;
    return Array.isArray(parsed.observations) ? parsed.observations : [];
  } catch {
    return [];
  }
}

export function readRecheckStatus(
  rootDir: string,
  taskId: string,
  outcomeVersion: number,
): RecheckObservationStatus {
  const found = readFile(rootDir, taskId).some(
    (row) =>
      row.taskId === taskId && row.outcomeVersion === outcomeVersion && row.status === "incomplete",
  );
  return found ? "incomplete" : "not_checked";
}

/** Test and later executor seam. Does not run a scenario and does not edit the version snapshot. */
export function recordIncompleteRecheckObservation(params: {
  rootDir: string;
  taskId: string;
  outcomeVersion: number;
}): { ok: true } | { ok: false; code: "version_missing" } {
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
    const existing = readFile(params.rootDir, taskId);
    if (
      !existing.some((row) => row.taskId === taskId && row.outcomeVersion === params.outcomeVersion)
    ) {
      const next: RecheckObservationFile = {
        observations: [
          ...existing,
          {
            taskId,
            outcomeVersion: params.outcomeVersion,
            status: "incomplete",
            reason: "not_completed",
          },
        ],
      };
      const filePath = observationPath(params.rootDir, taskId);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    }
    const after = store.loadTaskVersion(taskId, params.outcomeVersion);
    if (!after || after.taskJudgement !== before.taskJudgement) {
      throw new Error("recheck observation changed taskJudgement");
    }
    return { ok: true };
  } finally {
    store.close();
  }
}
