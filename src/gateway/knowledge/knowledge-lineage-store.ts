import type { DatabaseSync } from "node:sqlite";
import { KB_LINEAGE_TABLE } from "./kb-index-schema.js";

export type KnowledgeLineageKind = "generation" | "commit";

export type KnowledgeLineageRecord = {
  lineageId: string;
  kind: KnowledgeLineageKind;
  deliverableId: string | null;
  sessionKey: string | null;
  messageId: string | null;
  agentId: string | null;
  taskId: string | null;
  groupId: string | null;
  generationPromptHash: string | null;
  sourceChunkIds: string[];
  sourceKnowledgeBaseIds: string[];
  sourceAgentIds: string[];
  sourceTaskIds: string[];
  sourceRelationIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type UpsertKnowledgeLineageParams = {
  db: DatabaseSync;
  lineageId: string;
  kind: KnowledgeLineageKind;
  deliverableId?: string | null;
  sessionKey?: string | null;
  messageId?: string | null;
  agentId?: string | null;
  taskId?: string | null;
  groupId?: string | null;
  generationPromptHash?: string | null;
  sourceChunkIds?: string[];
  sourceKnowledgeBaseIds?: string[];
  sourceAgentIds?: string[];
  sourceTaskIds?: string[];
  sourceRelationIds?: string[];
  now?: number;
};

function normalizeId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function normalizeArray(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function encodeArray(values: string[] | undefined): string {
  return JSON.stringify(normalizeArray(values));
}

function parseArray(value: string | null): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? normalizeArray(parsed.filter((entry): entry is string => typeof entry === "string"))
      : [];
  } catch {
    return [];
  }
}

function rowToLineage(row: {
  lineage_id: string;
  kind: KnowledgeLineageKind;
  deliverable_id: string | null;
  session_key: string | null;
  message_id: string | null;
  agent_id: string | null;
  task_id: string | null;
  group_id: string | null;
  generation_prompt_hash: string | null;
  source_chunk_ids: string | null;
  source_kb_ids: string | null;
  source_agent_ids: string | null;
  source_task_ids: string | null;
  source_relation_ids: string | null;
  created_at: number;
  updated_at: number;
}): KnowledgeLineageRecord {
  return {
    lineageId: row.lineage_id,
    kind: row.kind,
    deliverableId: row.deliverable_id,
    sessionKey: row.session_key,
    messageId: row.message_id,
    agentId: row.agent_id,
    taskId: row.task_id,
    groupId: row.group_id,
    generationPromptHash: row.generation_prompt_hash,
    sourceChunkIds: parseArray(row.source_chunk_ids),
    sourceKnowledgeBaseIds: parseArray(row.source_kb_ids),
    sourceAgentIds: parseArray(row.source_agent_ids),
    sourceTaskIds: parseArray(row.source_task_ids),
    sourceRelationIds: parseArray(row.source_relation_ids),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function upsertKnowledgeLineage(params: UpsertKnowledgeLineageParams): void {
  const lineageId = params.lineageId.trim();
  if (!lineageId) {
    return;
  }
  const now = params.now ?? Date.now();
  params.db
    .prepare(
      `INSERT INTO ${KB_LINEAGE_TABLE} (
         lineage_id, kind, deliverable_id, session_key, message_id, agent_id, task_id, group_id,
         generation_prompt_hash, source_chunk_ids, source_kb_ids, source_agent_ids,
         source_task_ids, source_relation_ids, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(lineage_id, kind) DO UPDATE SET
         deliverable_id = COALESCE(excluded.deliverable_id, deliverable_id),
         session_key = COALESCE(excluded.session_key, session_key),
         message_id = COALESCE(excluded.message_id, message_id),
         agent_id = COALESCE(excluded.agent_id, agent_id),
         task_id = COALESCE(excluded.task_id, task_id),
         group_id = COALESCE(excluded.group_id, group_id),
         generation_prompt_hash = COALESCE(excluded.generation_prompt_hash, generation_prompt_hash),
         source_chunk_ids = excluded.source_chunk_ids,
         source_kb_ids = excluded.source_kb_ids,
         source_agent_ids = excluded.source_agent_ids,
         source_task_ids = excluded.source_task_ids,
         source_relation_ids = excluded.source_relation_ids,
         updated_at = excluded.updated_at`,
    )
    .run(
      lineageId,
      params.kind,
      normalizeId(params.deliverableId),
      normalizeId(params.sessionKey),
      normalizeId(params.messageId),
      normalizeId(params.agentId),
      normalizeId(params.taskId),
      normalizeId(params.groupId),
      normalizeId(params.generationPromptHash),
      encodeArray(params.sourceChunkIds),
      encodeArray(params.sourceKnowledgeBaseIds),
      encodeArray(params.sourceAgentIds),
      encodeArray(params.sourceTaskIds),
      encodeArray(params.sourceRelationIds),
      now,
      now,
    );
}

export function listKnowledgeLineageByDeliverable(
  db: DatabaseSync,
  deliverableId: string,
): KnowledgeLineageRecord[] {
  const trimmed = deliverableId.trim();
  if (!trimmed) {
    return [];
  }
  const rows = db
    .prepare(
      `SELECT * FROM ${KB_LINEAGE_TABLE}
       WHERE deliverable_id = ?
       ORDER BY updated_at DESC`,
    )
    .all(trimmed) as Parameters<typeof rowToLineage>[0][];
  return rows.map(rowToLineage);
}

export function listKnowledgeLineageByLineageId(
  db: DatabaseSync,
  lineageId: string,
): KnowledgeLineageRecord[] {
  const trimmed = lineageId.trim();
  if (!trimmed) {
    return [];
  }
  const rows = db
    .prepare(
      `SELECT * FROM ${KB_LINEAGE_TABLE}
       WHERE lineage_id = ?
       ORDER BY kind ASC`,
    )
    .all(trimmed) as Parameters<typeof rowToLineage>[0][];
  return rows.map(rowToLineage);
}

/**
 * Generation-kind lineage rows whose `source_kb_ids` include the given kb — the real
 * in-index record of knowledge the agent generated against this base. Mirrors the
 * JSON-quoted LIKE match used by countActiveAgentsForKnowledgeBase.
 */
export function listGenerationLineageForKnowledgeBase(
  db: DatabaseSync,
  kbId: string,
  params?: { limit?: number },
): KnowledgeLineageRecord[] {
  const trimmed = kbId.trim();
  if (!trimmed) {
    return [];
  }
  const limit = Math.min(Math.max(params?.limit ?? 200, 1), 500);
  const kbPattern = `%${JSON.stringify(trimmed)}%`;
  const rows = db
    .prepare(
      `SELECT * FROM ${KB_LINEAGE_TABLE}
       WHERE kind = 'generation' AND source_kb_ids LIKE ?
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(kbPattern, limit) as Parameters<typeof rowToLineage>[0][];
  return rows.map(rowToLineage);
}

export function listRecentKnowledgeLineageCommits(
  db: DatabaseSync,
  params?: { limit?: number; sinceMs?: number },
): KnowledgeLineageRecord[] {
  const limit = Math.min(Math.max(params?.limit ?? 20, 1), 100);
  const sinceMs = params?.sinceMs ?? 0;
  const rows = db
    .prepare(
      `SELECT * FROM ${KB_LINEAGE_TABLE}
       WHERE kind = 'commit' AND updated_at >= ?
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(sinceMs, limit) as Parameters<typeof rowToLineage>[0][];
  return rows.map(rowToLineage);
}

/**
 * Distinct agents that have consumed a knowledge base — counted from lineage
 * rows whose `source_kb_ids` include the given kb. Both the producing
 * `agent_id` and any `source_agent_ids` are treated as "active" consumers.
 * Powers the "活跃 Agent" runtime metric on the knowledge workspace header.
 *
 * `source_kb_ids` is stored as a JSON array (e.g. `["kb-a","kb-b"]`), so we
 * match the JSON-quoted id with LIKE and then parse rows to union agent ids.
 */
export function countActiveAgentsForKnowledgeBase(
  db: DatabaseSync,
  kbId: string,
  params?: { sinceMs?: number; scanLimit?: number },
): number {
  const trimmed = kbId.trim();
  if (!trimmed) {
    return 0;
  }
  const sinceMs = params?.sinceMs ?? 0;
  const scanLimit = Math.min(Math.max(params?.scanLimit ?? 500, 1), 2000);
  // JSON.stringify wraps the id in quotes so we match a whole array element,
  // not an accidental substring of a different id.
  const kbPattern = `%${JSON.stringify(trimmed)}%`;
  const rows = db
    .prepare(
      `SELECT agent_id, source_agent_ids
       FROM ${KB_LINEAGE_TABLE}
       WHERE source_kb_ids LIKE ?
         AND updated_at >= ?
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(kbPattern, sinceMs, scanLimit) as Array<{
    agent_id: string | null;
    source_agent_ids: string | null;
  }>;
  const agents = new Set<string>();
  for (const row of rows) {
    const direct = normalizeId(row.agent_id);
    if (direct) {
      agents.add(direct);
    }
    for (const id of parseArray(row.source_agent_ids)) {
      agents.add(id);
    }
  }
  return agents.size;
}
