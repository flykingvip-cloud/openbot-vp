/**
 * Read-only view of M0 conversation evaluations for Diagnosis Job filters.
 * Does not append, enable OPENBOT_CONVERSATION_EVALUATION, or copy rows into
 * diagnosis-schedules / projections / evolution prescriptions.
 *
 * M0 records have no groupId. The group filter matches roundId, the collab
 * round container and the only group-scoped id on the evaluation row.
 */
import fs from "node:fs";
import path from "node:path";
import { tenantHash16 } from "../conversation-evaluation/identity.js";
import { CONVERSATION_EVALUATIONS_DIR } from "../conversation-evaluation/store.js";
import type { DiagnosisJobEvidenceRow } from "./diagnosis-job-model.js";

export function readTenantEvaluationEvidence(input: {
  configDir: string;
  tenantId: string;
}): DiagnosisJobEvidenceRow[] {
  const root = path.join(
    input.configDir,
    CONVERSATION_EVALUATIONS_DIR,
    tenantHash16(input.tenantId),
  );
  const files: string[] = [];
  collectJsonlFiles(root, files);
  const rows: DiagnosisJobEvidenceRow[] = [];
  for (const filePath of files) {
    let raw = "";
    try {
      if (fs.lstatSync(filePath).isSymbolicLink()) {
        continue;
      }
      raw = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const row = evidenceRowFromUnknown(JSON.parse(line) as unknown);
        if (row && row.tenantId.trim() === input.tenantId) {
          rows.push(row);
        }
      } catch {
        // skip corrupt evaluation lines; do not rewrite them
      }
    }
  }
  return rows;
}

function collectJsonlFiles(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsonlFiles(full, out);
      continue;
    }
    if (
      entry.isFile() &&
      entry.name.endsWith(".jsonl") &&
      entry.name !== "lifecycle-denominator.jsonl"
    ) {
      out.push(full);
    }
  }
}

function evidenceRowFromUnknown(value: unknown): DiagnosisJobEvidenceRow | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.tenantId !== "string" ||
    typeof row.runId !== "string" ||
    typeof row.eventId !== "string"
  ) {
    return null;
  }
  const groupId =
    typeof row.groupId === "string" && row.groupId.trim()
      ? row.groupId.trim()
      : typeof row.roundId === "string" && row.roundId.trim()
        ? row.roundId.trim()
        : null;
  return {
    tenantId: row.tenantId,
    runId: row.runId,
    eventId: row.eventId,
    agentId: typeof row.agentId === "string" ? row.agentId : null,
    groupId,
    execution: typeof row.execution === "string" ? row.execution : "unknown",
    correctness: typeof row.correctness === "string" ? row.correctness : "unassessed",
    failureAttribution:
      typeof row.failureAttribution === "string" ? row.failureAttribution : "unknown",
    totalMs: typeof row.totalMs === "number" ? row.totalMs : null,
    ttftMs: ttftFromUnknown(row.ttftMs),
    evidenceRefs: Array.isArray(row.evidenceRefs)
      ? row.evidenceRefs.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0,
        )
      : [],
  };
}

function ttftFromUnknown(value: unknown): number | "n/a" | null {
  if (typeof value === "number") {
    return value;
  }
  if (value === "n/a" || value === null) {
    return value;
  }
  return null;
}
