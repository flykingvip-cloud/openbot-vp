import type { DatabaseSync } from "node:sqlite";
import {
  createGovernanceTask,
  ensureChunkGovernanceRows,
  listGovernanceTasks,
} from "../chunk-governance-store.js";

const STALE_FRESHNESS_THRESHOLD = 0.6;
const STALE_AGE_MS = 180 * 24 * 60 * 60 * 1000;

export type StaleScanResult = {
  staleCandidates: number;
  tasksCreated: number;
};

export function runStaleScan(params: {
  db: DatabaseSync;
  kbId: string;
  now?: number;
}): StaleScanResult {
  const now = params.now ?? Date.now();
  const rows = params.db
    .prepare(
      `SELECT cm.chunk_id
       FROM chunk_meta cm
       LEFT JOIN chunk_governance cg ON cg.chunk_id = cm.chunk_id
       JOIN document_versions dv ON dv.version_id = cm.version_id
       WHERE cm.kb_id = ?
         AND COALESCE(cg.governance_status, 'pending') != 'suppressed'
         AND (
           COALESCE(cg.freshness_score, 1) < ?
           OR dv.published_at < ?
         )`,
    )
    .all(params.kbId, STALE_FRESHNESS_THRESHOLD, now - STALE_AGE_MS) as Array<{
    chunk_id: string;
  }>;

  const openStale = new Set(
    listGovernanceTasks({ db: params.db, kbId: params.kbId, status: "open", limit: 200 })
      .filter((task) => task.taskType === "stale")
      .flatMap((task) => task.relatedChunkIds),
  );

  let tasksCreated = 0;
  for (const row of rows) {
    if (openStale.has(row.chunk_id)) {
      continue;
    }
    ensureChunkGovernanceRows({ db: params.db, kbId: params.kbId, chunkIds: [row.chunk_id] });
    createGovernanceTask({
      db: params.db,
      kbId: params.kbId,
      taskType: "stale",
      relatedChunkIds: [row.chunk_id],
      priority: 4,
      proposedResolution: { action: "review_stale" },
    });
    tasksCreated += 1;
  }
  return { staleCandidates: rows.length, tasksCreated };
}
