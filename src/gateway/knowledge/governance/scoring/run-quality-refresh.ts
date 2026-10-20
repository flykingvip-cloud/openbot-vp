import type { DatabaseSync } from "node:sqlite";
import { resolveExpertWeight } from "../expert-authority-store.js";
import {
  computeFreshnessScore,
  computeQualityScore,
  computeTrustScore,
  type ChunkQualityInput,
} from "./quality-scorer.js";

type ChunkGovernanceRow = {
  chunk_id: string;
  kb_id: string;
  governance_status: string | null;
  conflict_group_id: string | null;
  reference_count: number | null;
  last_hit_at: number | null;
  trust_score: number | null;
  published_at: number | null;
  latest_expert_id: string | null;
};

export type QualityRefreshResult = {
  refreshed: number;
};

function loadChunkRows(db: DatabaseSync, kbId: string, chunkIds?: string[]): ChunkGovernanceRow[] {
  if (chunkIds && chunkIds.length > 0) {
    const placeholders = chunkIds.map(() => "?").join(", ");
    return db
      .prepare(
        `SELECT cg.chunk_id, cg.kb_id, cg.governance_status, cg.conflict_group_id,
                cg.reference_count, cg.last_hit_at, cg.trust_score,
                dv.published_at,
                (
                  SELECT ga.expert_id
                  FROM governance_annotations ga
                  JOIN governance_tasks gt ON gt.id = ga.task_id
                  WHERE ga.action = 'confirm'
                    AND gt.related_chunk_ids LIKE '%' || cg.chunk_id || '%'
                  ORDER BY ga.created_at DESC
                  LIMIT 1
                ) AS latest_expert_id
         FROM chunk_governance cg
         LEFT JOIN chunk_meta m ON m.chunk_id = cg.chunk_id
         LEFT JOIN document_versions dv ON dv.version_id = m.version_id
         WHERE cg.kb_id = ? AND cg.chunk_id IN (${placeholders})`,
      )
      .all(kbId, ...chunkIds) as ChunkGovernanceRow[];
  }
  return db
    .prepare(
      `SELECT cg.chunk_id, cg.kb_id, cg.governance_status, cg.conflict_group_id,
              cg.reference_count, cg.last_hit_at, cg.trust_score,
              dv.published_at,
              (
                SELECT ga.expert_id
                FROM governance_annotations ga
                JOIN governance_tasks gt ON gt.id = ga.task_id
                WHERE ga.action = 'confirm'
                  AND gt.related_chunk_ids LIKE '%' || cg.chunk_id || '%'
                ORDER BY ga.created_at DESC
                LIMIT 1
              ) AS latest_expert_id
       FROM chunk_governance cg
       LEFT JOIN chunk_meta m ON m.chunk_id = cg.chunk_id
       LEFT JOIN document_versions dv ON dv.version_id = m.version_id
       WHERE cg.kb_id = ?`,
    )
    .all(kbId) as ChunkGovernanceRow[];
}

export function runQualityRefresh(params: {
  db: DatabaseSync;
  kbId: string;
  chunkIds?: string[];
  now?: number;
}): QualityRefreshResult {
  const now = params.now ?? Date.now();
  const rows = loadChunkRows(params.db, params.kbId, params.chunkIds);
  const update = params.db.prepare(
    `UPDATE chunk_governance
     SET freshness_score = ?, trust_score = ?, quality_score = ?, last_analyzed_at = ?
     WHERE chunk_id = ?`,
  );
  let refreshed = 0;
  for (const row of rows) {
    const expertWeight = row.latest_expert_id
      ? resolveExpertWeight({
          db: params.db,
          expertId: row.latest_expert_id,
          domainScope: params.kbId,
        })
      : 1;
    const input: ChunkQualityInput = {
      publishedAt: row.published_at,
      referenceCount: row.reference_count ?? 0,
      lastHitAt: row.last_hit_at,
      governanceStatus: (row.governance_status as ChunkQualityInput["governanceStatus"]) ?? null,
      conflictGroupId: row.conflict_group_id,
      trustScore: row.trust_score,
      expertWeight,
    };
    const freshness = computeFreshnessScore(input.publishedAt, now);
    const trust = computeTrustScore(input);
    const quality = computeQualityScore(input, now);
    update.run(freshness, trust, quality, now, row.chunk_id);
    refreshed += 1;
  }
  return { refreshed };
}
