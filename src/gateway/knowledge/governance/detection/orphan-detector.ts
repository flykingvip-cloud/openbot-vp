import type { DatabaseSync } from "node:sqlite";
import {
  createGovernanceTask,
  ensureChunkGovernanceRows,
  listGovernanceTasks,
} from "../chunk-governance-store.js";

const ORPHAN_REFERENCE_THRESHOLD = 0;
const ORPHAN_ANALYSIS_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type OrphanScanResult = {
  orphanCandidates: number;
  tasksCreated: number;
};

export function runOrphanScan(params: {
  db: DatabaseSync;
  kbId: string;
  now?: number;
}): OrphanScanResult {
  const now = params.now ?? Date.now();
  const rows = params.db
    .prepare(
      `SELECT cg.chunk_id
       FROM chunk_governance cg
       WHERE cg.kb_id = ?
         AND COALESCE(cg.reference_count, 0) <= ?
         AND (cg.last_hit_at IS NULL OR cg.last_hit_at < ?)
         AND (cg.last_analyzed_at IS NULL OR cg.last_analyzed_at < ?)`,
    )
    .all(
      params.kbId,
      ORPHAN_REFERENCE_THRESHOLD,
      now - ORPHAN_ANALYSIS_AGE_MS,
      now - ORPHAN_ANALYSIS_AGE_MS,
    ) as Array<{
    chunk_id: string;
  }>;

  const openOrphans = new Set(
    listGovernanceTasks({ db: params.db, kbId: params.kbId, status: "open", limit: 200 })
      .filter((task) => task.taskType === "orphan")
      .flatMap((task) => task.relatedChunkIds),
  );

  let tasksCreated = 0;
  for (const row of rows) {
    if (openOrphans.has(row.chunk_id)) {
      continue;
    }
    ensureChunkGovernanceRows({ db: params.db, kbId: params.kbId, chunkIds: [row.chunk_id] });
    createGovernanceTask({
      db: params.db,
      kbId: params.kbId,
      taskType: "orphan",
      relatedChunkIds: [row.chunk_id],
      priority: 3,
      proposedResolution: { action: "review_orphan" },
    });
    tasksCreated += 1;
  }
  return { orphanCandidates: rows.length, tasksCreated };
}
