import fs from "node:fs/promises";
import { exactMember, isRecord } from "../records.js";
import {
  COLLABORATION_LEDGER_KINDS,
  HANDOFF_FACT_TYPES,
  type CollaborationLedgerArchiveQuery,
  type CollaborationLedgerArchiveResult,
  type CollaborationLedgerRecord,
} from "./types.js";
import { resolveCanonicalLedgerPath } from "./writer.js";

/**
 * Known ledger kinds only. Unknown `kind` values (future writers, partial deploys)
 * are skipped so a reader never throws on a kind it does not understand.
 */
function isLedgerRecord(value: unknown): value is CollaborationLedgerRecord {
  if (!isRecord(value)) {
    return false;
  }
  const kind = exactMember(value.kind, COLLABORATION_LEDGER_KINDS);
  if (!kind) {
    return false;
  }
  // P1-B③: only the handoff fact types are known. Any other `fact` line stays skipped.
  if (kind === "fact") {
    return exactMember(value.type, HANDOFF_FACT_TYPES) !== null;
  }
  return true;
}

async function readLedgerFile(filePath: string): Promise<CollaborationLedgerRecord[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown)
      .filter(isLedgerRecord);
  } catch {
    return [];
  }
}

export async function readCollaborationLedgerArchive(
  params: CollaborationLedgerArchiveQuery,
): Promise<CollaborationLedgerArchiveResult> {
  const groupId = params.groupId.trim();
  const limit = Math.max(1, Math.min(params.limit ?? 200, 1000));
  const fromMs = params.fromMs ?? 0;
  const kinds = params.kinds?.length ? new Set(params.kinds) : null;
  const sources = [resolveCanonicalLedgerPath(groupId, params.tenantId)];

  const records = (await readLedgerFile(sources[0]))
    .filter((record) => {
      if (record.recordedAtMs < fromMs) {
        return false;
      }
      if (kinds && !kinds.has(record.kind)) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => left.recordedAtMs - right.recordedAtMs);

  const truncated = records.length > limit;
  return {
    groupId,
    records: truncated ? records.slice(records.length - limit) : records,
    totalRead: records.length,
    truncated,
    sources,
  };
}
