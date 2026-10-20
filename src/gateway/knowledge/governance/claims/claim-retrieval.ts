import type { DatabaseSync } from "node:sqlite";

const CLAIM_CONFLICT_MULTIPLIER = 0.85;

export function loadChunkClaimConflictFlags(
  db: DatabaseSync,
  chunkIds: string[],
): Map<string, boolean> {
  const flags = new Map<string, boolean>();
  if (chunkIds.length === 0) {
    return flags;
  }
  const placeholders = chunkIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT DISTINCT chunk_id
       FROM claims
       WHERE chunk_id IN (${placeholders})
         AND governance_status = 'pending'
         AND conflict_group_id IS NOT NULL`,
    )
    .all(...chunkIds) as Array<{ chunk_id: string }>;
  for (const row of rows) {
    flags.set(row.chunk_id, true);
  }
  return flags;
}

export function applyClaimConflictMultiplier(
  score: number,
  hasUnresolvedClaimConflict: boolean,
): number {
  if (!hasUnresolvedClaimConflict) {
    return score;
  }
  return score * CLAIM_CONFLICT_MULTIPLIER;
}
