/**
 * Durable journal for the existing exec-approval domain (v4.1 §9 gate 3).
 *
 * Local-file approvals and channel prompt maps stay on their own lifecycles.
 * This file is not a shared approval center. A missing or expired record does
 * not become an allow.
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomicSync } from "../infra/json-files.js";
import { CONFIG_DIR } from "../utils.js";

export const EXEC_APPROVAL_JOURNAL_STATES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type ExecApprovalJournalState = (typeof EXEC_APPROVAL_JOURNAL_STATES)[number];

export type ExecApprovalJournalDecision = "allow-once" | "allow-always" | "deny";

export type ExecApprovalJournalRecord = {
  id: string;
  state: ExecApprovalJournalState;
  expiresAt: string;
  createdAtMs: number;
  request: unknown;
  decision?: ExecApprovalJournalDecision;
  resolvedAtMs?: number;
  consumed?: boolean;
};

export type ExecApprovalJournalRecoverResult = {
  resumed: ExecApprovalJournalRecord[];
  grantable: ExecApprovalJournalRecord[];
  closed: ExecApprovalJournalRecord[];
};

type JournalFile = {
  version: 1;
  records: Record<string, ExecApprovalJournalRecord>;
};

const TERMINAL: ReadonlySet<ExecApprovalJournalState> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
]);

export function resolveExecApprovalJournalPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENBOT_EXEC_APPROVAL_JOURNAL?.trim();
  if (override) {
    return override;
  }
  return path.join(CONFIG_DIR, "exec-approval-journal.json");
}

export function readExecApprovalJournal(
  filePath: string,
): Record<string, ExecApprovalJournalRecord> {
  return readFile(filePath).records;
}

export function upsertExecApprovalJournal(
  filePath: string,
  next: ExecApprovalJournalRecord,
): ExecApprovalJournalRecord {
  const file = readFile(filePath);
  const existing = file.records[next.id];
  if (!existing) {
    file.records[next.id] = next;
    writeJsonAtomicSync(filePath, file);
    return next;
  }
  if (TERMINAL.has(existing.state) && !TERMINAL.has(next.state)) {
    return existing;
  }
  if (TERMINAL.has(existing.state) && TERMINAL.has(next.state) && existing.state !== next.state) {
    return existing;
  }
  if (
    existing.state === next.state &&
    existing.decision === next.decision &&
    existing.consumed === next.consumed &&
    existing.expiresAt === next.expiresAt
  ) {
    return existing;
  }
  const updated: ExecApprovalJournalRecord = { ...existing, ...next, id: existing.id };
  file.records[next.id] = updated;
  writeJsonAtomicSync(filePath, file);
  return updated;
}

export function recoverExecApprovalJournal(
  filePath: string,
  nowMs: number,
): ExecApprovalJournalRecoverResult {
  const file = readFile(filePath);
  const resumed: ExecApprovalJournalRecord[] = [];
  const grantable: ExecApprovalJournalRecord[] = [];
  const closed: ExecApprovalJournalRecord[] = [];
  let changed = false;
  for (const record of Object.values(file.records)) {
    if ((record.state === "PENDING" || record.state === "RUNNING") && isExpired(record, nowMs)) {
      record.state = "EXPIRED";
      record.decision = undefined;
      changed = true;
      closed.push(record);
      continue;
    }
    if (record.state === "PENDING" || record.state === "RUNNING") {
      resumed.push(record);
      continue;
    }
    if (record.state === "COMPLETED" && record.decision && !record.consumed) {
      if (isExpired(record, nowMs)) {
        record.state = "EXPIRED";
        record.decision = undefined;
        changed = true;
        closed.push(record);
        continue;
      }
      grantable.push(record);
      continue;
    }
    closed.push(record);
  }
  if (changed) {
    writeJsonAtomicSync(filePath, file);
  }
  return { resumed, grantable, closed };
}

/** Explicit prior decision only. Pending, missing, and expired grant nothing. */
export function approvalGrantFromJournal(record: ExecApprovalJournalRecord | undefined): {
  grant: ExecApprovalJournalDecision | null;
  state: ExecApprovalJournalState;
} {
  if (!record) {
    return { grant: null, state: "FAILED" };
  }
  if (record.state === "COMPLETED" && record.decision && !record.consumed) {
    return { grant: record.decision, state: "COMPLETED" };
  }
  if (record.state === "PENDING" || record.state === "RUNNING") {
    return { grant: null, state: record.state };
  }
  return { grant: null, state: record.state };
}

function isExpired(record: ExecApprovalJournalRecord, nowMs: number): boolean {
  const expiresAt = Date.parse(record.expiresAt);
  return !Number.isFinite(expiresAt) || nowMs >= expiresAt;
}

function readFile(filePath: string): JournalFile {
  if (!fs.existsSync(filePath)) {
    return { version: 1, records: {} };
  }
  const raw = fs.readFileSync(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`exec approval journal is unreadable: ${filePath}`);
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as JournalFile).version !== 1 ||
    typeof (parsed as JournalFile).records !== "object" ||
    (parsed as JournalFile).records === null
  ) {
    throw new Error(`exec approval journal is unreadable: ${filePath}`);
  }
  return parsed as JournalFile;
}
