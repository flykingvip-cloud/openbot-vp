import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { invalidateKnowledgeSourceBundleCache } from "../source-bundle-cache.js";
import type {
  ChunkGovernanceFactors,
  GovernanceJobPayload,
  GovernanceJobStatus,
  GovernanceJobType,
  GovernanceSummary,
  GovernanceTaskRecord,
  GovernanceTaskStatus,
  GovernanceTaskType,
} from "./types.js";
import { getGovernanceLlmUsageStats } from "./usage/governance-llm-usage-store.js";

function noteGovernanceWrite(): void {
  invalidateKnowledgeSourceBundleCache();
}

export function ensureChunkGovernanceRows(params: {
  db: DatabaseSync;
  kbId: string;
  chunkIds: string[];
}): void {
  if (params.chunkIds.length === 0) {
    return;
  }
  const insert = params.db.prepare(
    `INSERT INTO chunk_governance (chunk_id, kb_id, governance_status, reference_count)
     VALUES (?, ?, 'pending', 0)
     ON CONFLICT(chunk_id) DO NOTHING`,
  );
  for (const chunkId of params.chunkIds) {
    insert.run(chunkId, params.kbId);
  }
  noteGovernanceWrite();
}

export function upsertChunkSemanticHash(params: {
  db: DatabaseSync;
  kbId: string;
  chunkId: string;
  semanticHash: string;
  now?: number;
}): void {
  const now = params.now ?? Date.now();
  params.db
    .prepare(
      `INSERT INTO chunk_governance (chunk_id, kb_id, semantic_hash, governance_status, reference_count, last_analyzed_at)
       VALUES (?, ?, ?, 'pending', 0, ?)
       ON CONFLICT(chunk_id) DO UPDATE SET
         semantic_hash = excluded.semantic_hash,
         last_analyzed_at = excluded.last_analyzed_at`,
    )
    .run(params.chunkId, params.kbId, params.semanticHash, now);
  noteGovernanceWrite();
}

export function findChunkIdsBySemanticHash(params: {
  db: DatabaseSync;
  kbId: string;
  semanticHash: string;
  excludeChunkId?: string;
}): string[] {
  const rows = params.db
    .prepare(
      `SELECT chunk_id FROM chunk_governance
       WHERE kb_id = ? AND semantic_hash = ? AND chunk_id != ?`,
    )
    .all(params.kbId, params.semanticHash, params.excludeChunkId ?? "") as Array<{
    chunk_id: string;
  }>;
  return rows.map((row) => row.chunk_id);
}

export function assignDuplicateGroup(params: {
  db: DatabaseSync;
  kbId: string;
  chunkIds: string[];
  duplicateGroupId: string;
}): void {
  const stmt = params.db.prepare(
    `UPDATE chunk_governance SET duplicate_group_id = ? WHERE kb_id = ? AND chunk_id = ?`,
  );
  for (const chunkId of params.chunkIds) {
    stmt.run(params.duplicateGroupId, params.kbId, chunkId);
  }
  noteGovernanceWrite();
}

export function assignConflictGroup(params: {
  db: DatabaseSync;
  kbId: string;
  chunkIds: string[];
  conflictGroupId: string;
}): void {
  const stmt = params.db.prepare(
    `UPDATE chunk_governance SET conflict_group_id = ? WHERE kb_id = ? AND chunk_id = ?`,
  );
  for (const chunkId of params.chunkIds) {
    stmt.run(params.conflictGroupId, params.kbId, chunkId);
  }
  noteGovernanceWrite();
}

export function readExistingConflictGroupId(
  db: DatabaseSync,
  kbId: string,
  chunkId: string,
): string | null {
  const row = db
    .prepare(
      `SELECT conflict_group_id FROM chunk_governance
       WHERE kb_id = ? AND chunk_id = ? AND conflict_group_id IS NOT NULL`,
    )
    .get(kbId, chunkId) as { conflict_group_id: string | null } | undefined;
  return row?.conflict_group_id ?? null;
}

export function readExistingDuplicateGroupId(
  db: DatabaseSync,
  kbId: string,
  chunkId: string,
): string | null {
  const row = db
    .prepare(
      `SELECT duplicate_group_id FROM chunk_governance
       WHERE kb_id = ? AND chunk_id = ? AND duplicate_group_id IS NOT NULL`,
    )
    .get(kbId, chunkId) as { duplicate_group_id: string | null } | undefined;
  return row?.duplicate_group_id ?? null;
}

export function insertChunkRelation(params: {
  db: DatabaseSync;
  kbId: string;
  fromChunk: string;
  toChunk: string;
  relationType: "duplicate" | "conflict" | "reference";
  weight?: number;
  now?: number;
}): void {
  const now = params.now ?? Date.now();
  params.db
    .prepare(
      `INSERT OR IGNORE INTO chunk_relations (id, kb_id, from_chunk, to_chunk, relation_type, weight, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      params.kbId,
      params.fromChunk,
      params.toChunk,
      params.relationType,
      params.weight ?? 1,
      now,
    );
  noteGovernanceWrite();
}

export function recordChunkRetrievalHits(params: {
  db: DatabaseSync;
  chunkIds: string[];
  now?: number;
}): void {
  if (params.chunkIds.length === 0) {
    return;
  }
  const now = params.now ?? Date.now();
  const stmt = params.db.prepare(
    `UPDATE chunk_governance
     SET reference_count = COALESCE(reference_count, 0) + 1,
         last_hit_at = ?
     WHERE chunk_id = ?`,
  );
  for (const chunkId of params.chunkIds) {
    stmt.run(now, chunkId);
  }
}

export function loadChunkGovernanceFactors(
  db: DatabaseSync,
  chunkIds: string[],
): Map<string, ChunkGovernanceFactors> {
  const map = new Map<string, ChunkGovernanceFactors>();
  if (chunkIds.length === 0) {
    return map;
  }
  const placeholders = chunkIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT chunk_id, trust_score, freshness_score, governance_status, conflict_group_id
       FROM chunk_governance WHERE chunk_id IN (${placeholders})`,
    )
    .all(...chunkIds) as Array<{
    chunk_id: string;
    trust_score: number | null;
    freshness_score: number | null;
    governance_status: string | null;
    conflict_group_id: string | null;
  }>;
  for (const row of rows) {
    map.set(row.chunk_id, {
      trustScore: row.trust_score,
      freshnessScore: row.freshness_score,
      governanceStatus:
        (row.governance_status as ChunkGovernanceFactors["governanceStatus"]) ?? null,
      conflictGroupId: row.conflict_group_id,
    });
  }
  return map;
}

export function createGovernanceTask(params: {
  db: DatabaseSync;
  kbId: string;
  taskType: GovernanceTaskType;
  relatedChunkIds: string[];
  priority?: number;
  proposedResolution?: unknown;
  now?: number;
}): string {
  const now = params.now ?? Date.now();
  const id = randomUUID();
  params.db
    .prepare(
      `INSERT INTO governance_tasks (
         id, kb_id, task_type, status, priority, related_chunk_ids, proposed_resolution, created_at, updated_at
       ) VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      params.kbId,
      params.taskType,
      params.priority ?? 0,
      JSON.stringify(params.relatedChunkIds),
      params.proposedResolution ? JSON.stringify(params.proposedResolution) : null,
      now,
      now,
    );
  noteGovernanceWrite();
  return id;
}

export function listGovernanceTasks(params: {
  db: DatabaseSync;
  kbId?: string;
  status?: GovernanceTaskStatus;
  limit?: number;
}): GovernanceTaskRecord[] {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (params.kbId) {
    clauses.push("kb_id = ?");
    values.push(params.kbId);
  }
  if (params.status) {
    clauses.push("status = ?");
    values.push(params.status);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = params.db
    .prepare(
      `SELECT id, kb_id, task_type, status, priority, related_chunk_ids, proposed_resolution,
              assigned_to, created_at, updated_at
       FROM governance_tasks ${where}
       ORDER BY priority DESC, updated_at DESC
       LIMIT ?`,
    )
    .all(...values, limit) as Array<{
    id: string;
    kb_id: string;
    task_type: GovernanceTaskType;
    status: GovernanceTaskStatus;
    priority: number;
    related_chunk_ids: string;
    proposed_resolution: string | null;
    assigned_to: string | null;
    created_at: number;
    updated_at: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    kbId: row.kb_id,
    taskType: row.task_type,
    status: row.status,
    priority: row.priority,
    relatedChunkIds: parseJsonArray(row.related_chunk_ids),
    proposedResolution: row.proposed_resolution ? JSON.parse(row.proposed_resolution) : null,
    assignedTo: row.assigned_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function getGovernanceTaskById(
  db: DatabaseSync,
  taskId: string,
): GovernanceTaskRecord | null {
  const row = db
    .prepare(
      `SELECT id, kb_id, task_type, status, priority, related_chunk_ids, proposed_resolution,
              assigned_to, created_at, updated_at
       FROM governance_tasks WHERE id = ?`,
    )
    .get(taskId) as
    | {
        id: string;
        kb_id: string;
        task_type: GovernanceTaskType;
        status: GovernanceTaskStatus;
        priority: number;
        related_chunk_ids: string;
        proposed_resolution: string | null;
        assigned_to: string | null;
        created_at: number;
        updated_at: number;
      }
    | undefined;
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    kbId: row.kb_id,
    taskType: row.task_type,
    status: row.status,
    priority: row.priority,
    relatedChunkIds: parseJsonArray(row.related_chunk_ids),
    proposedResolution: row.proposed_resolution ? JSON.parse(row.proposed_resolution) : null,
    assignedTo: row.assigned_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function updateGovernanceTaskStatus(params: {
  db: DatabaseSync;
  taskId: string;
  status: GovernanceTaskStatus;
  now?: number;
}): boolean {
  const now = params.now ?? Date.now();
  const result = params.db
    .prepare(`UPDATE governance_tasks SET status = ?, updated_at = ? WHERE id = ?`)
    .run(params.status, now, params.taskId);
  noteGovernanceWrite();
  return result.changes > 0;
}

export function countIndexedChunks(db: DatabaseSync, kbId?: string): number {
  if (kbId) {
    const row = db
      .prepare(`SELECT COUNT(*) AS count FROM chunk_meta WHERE kb_id = ?`)
      .get(kbId) as { count: number };
    return row.count;
  }
  const row = db.prepare(`SELECT COUNT(*) AS count FROM chunks`).get() as { count: number };
  return row.count;
}

export function countChunkRelations(db: DatabaseSync, kbId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM chunk_relations WHERE kb_id = ?`)
    .get(kbId) as { count: number };
  return row.count;
}

export type ChunkRelationBreakdown = {
  reference: number;
  duplicate: number;
  conflict: number;
};

/**
 * Per-relation-type edge counts for a knowledge base (引用 / 重复 / 冲突), powering
 * the "关系构成" runtime card on the workspace sidebar. Real telemetry from
 * `chunk_relations` grouped by `relation_type`. The three counts sum to the
 * total relation count surfaced as the "关系数量" runtime metric.
 */
export function getChunkRelationBreakdown(db: DatabaseSync, kbId: string): ChunkRelationBreakdown {
  const rows = db
    .prepare(
      `SELECT relation_type, COUNT(*) AS count
         FROM chunk_relations WHERE kb_id = ?
        GROUP BY relation_type`,
    )
    .all(kbId) as Array<{ relation_type: string; count: number }>;
  const breakdown: ChunkRelationBreakdown = { reference: 0, duplicate: 0, conflict: 0 };
  for (const row of rows) {
    if (row.relation_type === "reference") {
      breakdown.reference = row.count;
    } else if (row.relation_type === "duplicate") {
      breakdown.duplicate = row.count;
    } else if (row.relation_type === "conflict") {
      breakdown.conflict = row.count;
    }
  }
  return breakdown;
}

export type ChunkScoreAverages = {
  quality: number | null;
  trust: number | null;
  freshness: number | null;
};

/**
 * Per-knowledge-base average governance scores (quality / trust / freshness),
 * each in 0..1 or null when no chunks have been scored yet. Powers the
 * "知识健康度详情" multi-dimension card. Real telemetry from `chunk_governance`,
 * written by the quality-refresh scoring pass.
 */
export function getChunkScoreAverages(db: DatabaseSync, kbId: string): ChunkScoreAverages {
  const row = db
    .prepare(
      `SELECT AVG(quality_score) AS quality,
              AVG(trust_score) AS trust,
              AVG(freshness_score) AS freshness
         FROM chunk_governance
        WHERE kb_id = ?`,
    )
    .get(kbId) as {
    quality: number | null;
    trust: number | null;
    freshness: number | null;
  };
  return {
    quality: typeof row.quality === "number" ? row.quality : null,
    trust: typeof row.trust === "number" ? row.trust : null,
    freshness: typeof row.freshness === "number" ? row.freshness : null,
  };
}

/**
 * Total retrieval citations across a knowledge base — the sum of every chunk's
 * `reference_count` telemetry written by {@link recordChunkRetrievalHits} on
 * each governance-aware retrieval. Powers the "引用次数" runtime metric on the
 * knowledge workspace header (how often agents have actually consumed the space).
 */
export function sumChunkReferenceCounts(db: DatabaseSync, kbId: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(reference_count), 0) AS total
       FROM chunk_governance WHERE kb_id = ?`,
    )
    .get(kbId) as { total: number };
  return row.total ?? 0;
}

/** SQLite variable cap is typically 999; stay well below it for batched IN lists. */
const KNOWLEDGE_BASE_IN_BATCH = 400;

function batchedKnowledgeBaseIds(kbIds: string[]): string[][] {
  const unique = [...new Set(kbIds.map((id) => id.trim()).filter(Boolean))];
  const batches: string[][] = [];
  for (let index = 0; index < unique.length; index += KNOWLEDGE_BASE_IN_BATCH) {
    batches.push(unique.slice(index, index + KNOWLEDGE_BASE_IN_BATCH));
  }
  return batches;
}

/**
 * One grouped scan for many knowledge bases, equivalent to calling
 * {@link getChunkRelationBreakdown} per id. Used by the home projection so a
 * 50-space library does not issue 50 separate scans.
 */
export function getChunkRelationBreakdownByKnowledgeBase(
  db: DatabaseSync,
  kbIds: string[],
): Map<string, ChunkRelationBreakdown> {
  const map = new Map<string, ChunkRelationBreakdown>();
  for (const id of kbIds) {
    if (id.trim()) {
      map.set(id, { reference: 0, duplicate: 0, conflict: 0 });
    }
  }
  for (const batch of batchedKnowledgeBaseIds(kbIds)) {
    const placeholders = batch.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT kb_id, relation_type, COUNT(*) AS count
           FROM chunk_relations
          WHERE kb_id IN (${placeholders})
          GROUP BY kb_id, relation_type`,
      )
      .all(...batch) as Array<{ kb_id: string; relation_type: string; count: number }>;
    for (const row of rows) {
      const breakdown = map.get(row.kb_id) ?? { reference: 0, duplicate: 0, conflict: 0 };
      if (row.relation_type === "reference") {
        breakdown.reference = row.count;
      } else if (row.relation_type === "duplicate") {
        breakdown.duplicate = row.count;
      } else if (row.relation_type === "conflict") {
        breakdown.conflict = row.count;
      }
      map.set(row.kb_id, breakdown);
    }
  }
  return map;
}

/**
 * One grouped scan for many knowledge bases, equivalent to calling
 * {@link sumChunkReferenceCounts} per id.
 */
export function sumChunkReferenceCountsByKnowledgeBase(
  db: DatabaseSync,
  kbIds: string[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const id of kbIds) {
    if (id.trim()) {
      map.set(id, 0);
    }
  }
  for (const batch of batchedKnowledgeBaseIds(kbIds)) {
    const placeholders = batch.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT kb_id, COALESCE(SUM(reference_count), 0) AS total
           FROM chunk_governance
          WHERE kb_id IN (${placeholders})
          GROUP BY kb_id`,
      )
      .all(...batch) as Array<{ kb_id: string; total: number }>;
    for (const row of rows) {
      map.set(row.kb_id, row.total ?? 0);
    }
  }
  return map;
}

export function listChunkKnowledgeBaseIds(
  db: DatabaseSync,
  chunkIds: string[],
): Map<string, string> {
  const map = new Map<string, string>();
  const unique = [...new Set(chunkIds.map((id) => id.trim()).filter(Boolean))];
  for (let index = 0; index < unique.length; index += KNOWLEDGE_BASE_IN_BATCH) {
    const batch = unique.slice(index, index + KNOWLEDGE_BASE_IN_BATCH);
    const placeholders = batch.map(() => "?").join(", ");
    const rows = db
      .prepare(`SELECT chunk_id, kb_id FROM chunk_meta WHERE chunk_id IN (${placeholders})`)
      .all(...batch) as Array<{ chunk_id: string; kb_id: string }>;
    for (const row of rows) {
      map.set(row.chunk_id, row.kb_id);
    }
  }
  return map;
}

/** Sum `reference_count` for a bounded set of chunk ids (governance action evidence). */
export function sumReferenceCountsForChunks(db: DatabaseSync, chunkIds: string[]): number {
  const ids = [...new Set(chunkIds.map((id) => id.trim()).filter(Boolean))].slice(0, 50);
  if (ids.length === 0) {
    return 0;
  }
  const placeholders = ids.map(() => "?").join(", ");
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(reference_count), 0) AS total
       FROM chunk_governance WHERE chunk_id IN (${placeholders})`,
    )
    .get(...ids) as { total: number };
  return row.total ?? 0;
}

export type ChunkRelationRecord = {
  id: string;
  kbId: string;
  fromChunk: string;
  toChunk: string;
  relationType: "duplicate" | "conflict" | "reference";
  weight: number | null;
  createdAt: number;
};

export function listRecentChunkRelations(
  db: DatabaseSync,
  params?: { limit?: number; sinceMs?: number; kbId?: string },
): ChunkRelationRecord[] {
  const limit = Math.min(Math.max(params?.limit ?? 20, 1), 100);
  const sinceMs = params?.sinceMs ?? 0;
  const kbId = params?.kbId?.trim();
  const rows = kbId
    ? (db
        .prepare(
          `SELECT id, kb_id, from_chunk, to_chunk, relation_type, weight, created_at
           FROM chunk_relations
           WHERE kb_id = ? AND created_at >= ?
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(kbId, sinceMs, limit) as Array<{
        id: string;
        kb_id: string;
        from_chunk: string;
        to_chunk: string;
        relation_type: "duplicate" | "conflict" | "reference";
        weight: number | null;
        created_at: number;
      }>)
    : (db
        .prepare(
          `SELECT id, kb_id, from_chunk, to_chunk, relation_type, weight, created_at
           FROM chunk_relations
           WHERE created_at >= ?
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(sinceMs, limit) as Array<{
        id: string;
        kb_id: string;
        from_chunk: string;
        to_chunk: string;
        relation_type: "duplicate" | "conflict" | "reference";
        weight: number | null;
        created_at: number;
      }>);
  return rows.map((row) => ({
    id: row.id,
    kbId: row.kb_id,
    fromChunk: row.from_chunk,
    toChunk: row.to_chunk,
    relationType: row.relation_type,
    weight: row.weight,
    createdAt: row.created_at,
  }));
}

export type FrequentlyCitedChunk = {
  chunkId: string;
  kbId: string;
  referenceCount: number;
  lastHitAt: number | null;
};

/**
 * Chunks that have crossed a retrieval-citation threshold within the lookback
 * window. Backed by the real `reference_count` / `last_hit_at` telemetry written
 * by `recordChunkRetrievalHits` on every governance-aware retrieval.
 */
export function listFrequentlyCitedChunks(
  db: DatabaseSync,
  params?: { minReferenceCount?: number; sinceMs?: number; limit?: number; kbId?: string },
): FrequentlyCitedChunk[] {
  const minReferenceCount = Math.max(params?.minReferenceCount ?? 5, 1);
  const sinceMs = params?.sinceMs ?? 0;
  const limit = Math.min(Math.max(params?.limit ?? 20, 1), 100);
  const kbId = params?.kbId?.trim();
  const rows = (
    kbId
      ? db
          .prepare(
            `SELECT chunk_id, kb_id, reference_count, last_hit_at
             FROM chunk_governance
             WHERE kb_id = ?
               AND COALESCE(reference_count, 0) >= ?
               AND COALESCE(last_hit_at, 0) >= ?
             ORDER BY reference_count DESC, last_hit_at DESC
             LIMIT ?`,
          )
          .all(kbId, minReferenceCount, sinceMs, limit)
      : db
          .prepare(
            `SELECT chunk_id, kb_id, reference_count, last_hit_at
             FROM chunk_governance
             WHERE COALESCE(reference_count, 0) >= ?
               AND COALESCE(last_hit_at, 0) >= ?
             ORDER BY reference_count DESC, last_hit_at DESC
             LIMIT ?`,
          )
          .all(minReferenceCount, sinceMs, limit)
  ) as Array<{
    chunk_id: string;
    kb_id: string;
    reference_count: number | null;
    last_hit_at: number | null;
  }>;
  return rows.map((row) => ({
    chunkId: row.chunk_id,
    kbId: row.kb_id,
    referenceCount: row.reference_count ?? 0,
    lastHitAt: row.last_hit_at,
  }));
}

export function computeKnowledgeHealthScore(
  summary: Pick<
    GovernanceSummary,
    | "openConflictCount"
    | "openClaimConflictCount"
    | "openDuplicateCount"
    | "openStaleCount"
    | "openOrphanCount"
  >,
): number {
  const penalties =
    summary.openConflictCount * 8 +
    summary.openClaimConflictCount * 6 +
    summary.openDuplicateCount * 4 +
    summary.openStaleCount * 3 +
    summary.openOrphanCount * 2;
  return Math.max(0, Math.min(100, 100 - penalties));
}

export function getGovernanceSummary(db: DatabaseSync, kbId?: string): GovernanceSummary {
  const kbClause = kbId ? " AND kb_id = ?" : "";
  const params = kbId ? [kbId] : [];
  const countOpen = (taskType: GovernanceTaskType) => {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count FROM governance_tasks
         WHERE status = 'open' AND task_type = ?${kbClause}`,
      )
      .get(taskType, ...params) as { count: number };
    return row.count;
  };
  const suppressedRow = (
    kbId
      ? db
          .prepare(
            `SELECT COUNT(*) AS count FROM chunk_governance
           WHERE governance_status = 'suppressed' AND kb_id = ?`,
          )
          .get(kbId)
      : db
          .prepare(
            `SELECT COUNT(*) AS count FROM chunk_governance WHERE governance_status = 'suppressed'`,
          )
          .get()
  ) as { count: number };
  return {
    openConflictCount: countOpen("conflict"),
    openClaimConflictCount: countOpen("claim_conflict"),
    openDuplicateCount: countOpen("duplicate"),
    openOrphanCount: countOpen("orphan"),
    openStaleCount: countOpen("stale"),
    suppressedChunkCount: suppressedRow.count,
    indexedChunkCount: countIndexedChunks(db, kbId),
    llmUsage: getGovernanceLlmUsageStats(db, kbId),
  };
}

export function enqueueGovernanceJob(params: {
  db: DatabaseSync;
  kbId: string;
  jobType: GovernanceJobType;
  payload: GovernanceJobPayload;
  priority?: number;
  now?: number;
}): string {
  const now = params.now ?? Date.now();
  const id = randomUUID();
  params.db
    .prepare(
      `INSERT INTO governance_jobs (
         id, kb_id, job_type, status, priority, attempts, max_attempts, payload, scheduled_at, created_at, updated_at
       ) VALUES (?, ?, ?, 'pending', ?, 0, 3, ?, ?, ?, ?)`,
    )
    .run(
      id,
      params.kbId,
      params.jobType,
      params.priority ?? 0,
      JSON.stringify(params.payload),
      now,
      now,
      now,
    );
  return id;
}

export type PendingGovernanceJob = {
  id: string;
  kbId: string;
  jobType: GovernanceJobType;
  status: GovernanceJobStatus;
  attempts: number;
  maxAttempts: number;
  payload: GovernanceJobPayload;
};

export function pickPendingGovernanceJobs(params: {
  db: DatabaseSync;
  limit: number;
}): PendingGovernanceJob[] {
  const rows = params.db
    .prepare(
      `SELECT id, kb_id, job_type, status, attempts, max_attempts, payload
       FROM governance_jobs
       WHERE status IN ('pending', 'retrying')
         AND (scheduled_at IS NULL OR scheduled_at <= ?)
       ORDER BY priority DESC, scheduled_at ASC, created_at ASC
       LIMIT ?`,
    )
    .all(Date.now(), params.limit) as Array<{
    id: string;
    kb_id: string;
    job_type: GovernanceJobType;
    status: GovernanceJobStatus;
    attempts: number;
    max_attempts: number;
    payload: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    kbId: row.kb_id,
    jobType: row.job_type,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    payload: JSON.parse(row.payload) as GovernanceJobPayload,
  }));
}

export function markGovernanceJobRunning(params: {
  db: DatabaseSync;
  jobId: string;
  now?: number;
}): void {
  const now = params.now ?? Date.now();
  params.db
    .prepare(
      `UPDATE governance_jobs
       SET status = 'running', started_at = ?, updated_at = ?, attempts = attempts + 1
       WHERE id = ?`,
    )
    .run(now, now, params.jobId);
}

export function markGovernanceJobResolved(params: {
  db: DatabaseSync;
  jobId: string;
  now?: number;
}): void {
  const now = params.now ?? Date.now();
  params.db
    .prepare(
      `UPDATE governance_jobs SET status = 'resolved', finished_at = ?, updated_at = ? WHERE id = ?`,
    )
    .run(now, now, params.jobId);
}

export function markGovernanceJobFailed(params: {
  db: DatabaseSync;
  jobId: string;
  error: string;
  now?: number;
}): void {
  const now = params.now ?? Date.now();
  const row = params.db
    .prepare(`SELECT attempts, max_attempts FROM governance_jobs WHERE id = ?`)
    .get(params.jobId) as { attempts: number; max_attempts: number } | undefined;
  if (!row) {
    return;
  }
  const nextStatus: GovernanceJobStatus =
    row.attempts >= row.max_attempts ? "dead_letter" : "retrying";
  params.db
    .prepare(
      `UPDATE governance_jobs
       SET status = ?, last_error = ?, finished_at = ?, updated_at = ?, scheduled_at = ?
       WHERE id = ?`,
    )
    .run(
      nextStatus,
      params.error.slice(0, 2000),
      nextStatus === "dead_letter" ? now : null,
      now,
      nextStatus === "retrying" ? now + 60_000 : null,
      params.jobId,
    );
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export function readChunkText(db: DatabaseSync, chunkId: string): string | null {
  const row = db.prepare(`SELECT text FROM chunks WHERE id = ?`).get(chunkId) as
    | { text: string }
    | undefined;
  return row?.text ?? null;
}
