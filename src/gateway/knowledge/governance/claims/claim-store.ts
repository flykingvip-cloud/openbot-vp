import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ClaimGovernanceStatus, ClaimRelationType, KnowledgeClaimRecord } from "../types.js";

export function upsertClaimsForChunk(params: {
  db: DatabaseSync;
  kbId: string;
  chunkId: string;
  claims: Array<{
    subject: string;
    predicate: string;
    objectValue: string;
    claimText: string;
    normalizedKey: string;
    extractionMethod?: string;
  }>;
  now?: number;
}): number {
  const now = params.now ?? Date.now();
  const insert = params.db.prepare(
    `INSERT INTO claims (
       id, kb_id, chunk_id, subject, predicate, object_value, normalized_key, claim_text,
       extraction_method, governance_status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       object_value = excluded.object_value,
       claim_text = excluded.claim_text,
       updated_at = excluded.updated_at`,
  );
  let written = 0;
  for (const claim of params.claims) {
    const id = `claim:${params.kbId}:${params.chunkId}:${claim.normalizedKey}`;
    insert.run(
      id,
      params.kbId,
      params.chunkId,
      claim.subject,
      claim.predicate,
      claim.objectValue,
      claim.normalizedKey,
      claim.claimText,
      claim.extractionMethod ?? "heuristic",
      now,
      now,
    );
    written += 1;
  }
  return written;
}

export function listClaimsForChunks(db: DatabaseSync, chunkIds: string[]): KnowledgeClaimRecord[] {
  if (chunkIds.length === 0) {
    return [];
  }
  const placeholders = chunkIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT id, kb_id, chunk_id, subject, predicate, object_value, normalized_key, claim_text,
              extraction_method, governance_status, conflict_group_id, created_at, updated_at
       FROM claims WHERE chunk_id IN (${placeholders})
       ORDER BY updated_at DESC`,
    )
    .all(...chunkIds) as Array<{
    id: string;
    kb_id: string;
    chunk_id: string;
    subject: string;
    predicate: string | null;
    object_value: string;
    normalized_key: string;
    claim_text: string;
    extraction_method: string;
    governance_status: string | null;
    conflict_group_id: string | null;
    created_at: number;
    updated_at: number;
  }>;
  return rows.map(mapClaimRow);
}

export function listClaimsByKb(params: {
  db: DatabaseSync;
  kbId: string;
  normalizedKey?: string;
  limit?: number;
}): KnowledgeClaimRecord[] {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const rows = (
    params.normalizedKey
      ? params.db
          .prepare(
            `SELECT id, kb_id, chunk_id, subject, predicate, object_value, normalized_key, claim_text,
                    extraction_method, governance_status, conflict_group_id, created_at, updated_at
             FROM claims WHERE kb_id = ? AND normalized_key = ?
             ORDER BY updated_at DESC LIMIT ?`,
          )
          .all(params.kbId, params.normalizedKey, limit)
      : params.db
          .prepare(
            `SELECT id, kb_id, chunk_id, subject, predicate, object_value, normalized_key, claim_text,
                    extraction_method, governance_status, conflict_group_id, created_at, updated_at
             FROM claims WHERE kb_id = ?
             ORDER BY updated_at DESC LIMIT ?`,
          )
          .all(params.kbId, limit)
  ) as Array<{
    id: string;
    kb_id: string;
    chunk_id: string;
    subject: string;
    predicate: string | null;
    object_value: string;
    normalized_key: string;
    claim_text: string;
    extraction_method: string;
    governance_status: string | null;
    conflict_group_id: string | null;
    created_at: number;
    updated_at: number;
  }>;
  return rows.map(mapClaimRow);
}

export function insertClaimRelation(params: {
  db: DatabaseSync;
  kbId: string;
  fromClaim: string;
  toClaim: string;
  relationType: ClaimRelationType;
  weight?: number;
  now?: number;
}): void {
  const now = params.now ?? Date.now();
  params.db
    .prepare(
      `INSERT OR IGNORE INTO claim_relations (id, kb_id, from_claim, to_claim, relation_type, weight, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      params.kbId,
      params.fromClaim,
      params.toClaim,
      params.relationType,
      params.weight ?? 1,
      now,
    );
}

export function assignClaimConflictGroup(params: {
  db: DatabaseSync;
  kbId: string;
  claimIds: string[];
  conflictGroupId: string;
}): void {
  const stmt = params.db.prepare(
    `UPDATE claims SET conflict_group_id = ? WHERE kb_id = ? AND id = ?`,
  );
  for (const claimId of params.claimIds) {
    stmt.run(params.conflictGroupId, params.kbId, claimId);
  }
}

export function updateClaimGovernanceStatus(params: {
  db: DatabaseSync;
  claimIds: string[];
  governanceStatus: ClaimGovernanceStatus;
  now?: number;
}): void {
  if (params.claimIds.length === 0) {
    return;
  }
  const now = params.now ?? Date.now();
  const placeholders = params.claimIds.map(() => "?").join(", ");
  params.db
    .prepare(
      `UPDATE claims SET governance_status = ?, updated_at = ? WHERE id IN (${placeholders})`,
    )
    .run(params.governanceStatus, now, ...params.claimIds);
}

function mapClaimRow(row: {
  id: string;
  kb_id: string;
  chunk_id: string;
  subject: string;
  predicate: string | null;
  object_value: string;
  normalized_key: string;
  claim_text: string;
  extraction_method: string;
  governance_status: string | null;
  conflict_group_id: string | null;
  created_at: number;
  updated_at: number;
}): KnowledgeClaimRecord {
  return {
    id: row.id,
    kbId: row.kb_id,
    chunkId: row.chunk_id,
    subject: row.subject,
    predicate: row.predicate,
    objectValue: row.object_value,
    normalizedKey: row.normalized_key,
    claimText: row.claim_text,
    extractionMethod: row.extraction_method,
    governanceStatus: (row.governance_status as ClaimGovernanceStatus) ?? "pending",
    conflictGroupId: row.conflict_group_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
