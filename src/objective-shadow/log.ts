import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FrozenSnapshot, ShadowObserveRecord } from "./types.js";

export function defaultObjectiveShadowLogPath(): string {
  return path.join(os.homedir(), ".openbot", "logs", "objective-shadow.jsonl");
}

export function defaultObjectiveShadowWindowPath(
  logPath = defaultObjectiveShadowLogPath(),
): string {
  return logPath.replace(/\.jsonl$/i, ".window.json");
}

export function readShadowRecords(logPath: string): ShadowObserveRecord[] {
  try {
    const raw = fs.readFileSync(logPath, "utf8");
    if (!raw.trim()) {
      return [];
    }
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as ShadowObserveRecord);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function findRecordByRunId(logPath: string, runId: string): ShadowObserveRecord | undefined {
  return readShadowRecords(logPath).find((record) => record.correlation.runId === runId);
}

export function findSnapshotByRunId(logPath: string, runId: string): FrozenSnapshot | undefined {
  const record = findRecordByRunId(logPath, runId);
  if (!record?.correlation.objectiveId || record.correlation.revision === undefined) {
    return undefined;
  }
  if (!record.correlation.source) {
    return undefined;
  }
  return {
    objectiveId: record.correlation.objectiveId,
    revision: record.correlation.revision,
    source: record.correlation.source,
  };
}

export function appendShadowRecord(logPath: string, record: ShadowObserveRecord): void {
  if (!record.correlation.runId || !record.correlation.ingress) {
    return;
  }
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`, "utf8");
}
