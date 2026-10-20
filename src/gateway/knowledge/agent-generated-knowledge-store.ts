import type { DatabaseSync } from "node:sqlite";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "./kb-index.js";
import type { KnowledgeBase } from "./knowledge-base-store.js";
import { resolveKnowledgeIndexRootForBase } from "./knowledge-directory.js";
import {
  type KnowledgeLineageRecord,
  listGenerationLineageForKnowledgeBase,
} from "./knowledge-lineage-store.js";

/**
 * Agent-generated knowledge is a distinct, persisted model for knowledge the AI itself
 * produced — captured from two real substrates: in-index generation lineage
 * (knowledge_lineage) and auto-captured agent deliverables. It carries first-class types
 * so the 「Agent 知识」 tab can present what the agent learned/derived, not just a flat list.
 */
export type AgentGeneratedKnowledgeType =
  | "conversation_summary"
  | "long_term_memory"
  | "auto_sop"
  | "auto_relation"
  | "auto_analysis";

export type AgentGeneratedKnowledgeStatus = "pending" | "confirmed" | "archived";

export type AgentGeneratedKnowledgeRecord = {
  knowledgeId: string;
  kbId: string;
  agentId: string | null;
  type: AgentGeneratedKnowledgeType;
  title: string | null;
  summary: string | null;
  sourceLineageId: string | null;
  sourceDeliverableId: string | null;
  status: AgentGeneratedKnowledgeStatus;
  createdAtMs: number;
  updatedAtMs: number;
};

export type AgentGeneratedKnowledgeTypeCount = {
  type: AgentGeneratedKnowledgeType;
  count: number;
};

export function recordAgentGeneratedKnowledgeInIndex(
  db: DatabaseSync,
  params: {
    knowledgeId: string;
    kbId: string;
    type: AgentGeneratedKnowledgeType;
    agentId?: string | null;
    title?: string | null;
    summary?: string | null;
    sourceLineageId?: string | null;
    sourceDeliverableId?: string | null;
    status?: AgentGeneratedKnowledgeStatus;
    nowMs?: number;
  },
): void {
  const now = params.nowMs ?? Date.now();
  db.prepare(
    `INSERT INTO agent_generated_knowledge
       (knowledge_id, kb_id, agent_id, type, title, summary, source_lineage_id, source_deliverable_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(knowledge_id) DO UPDATE SET
       agent_id = COALESCE(excluded.agent_id, agent_generated_knowledge.agent_id),
       type = excluded.type,
       title = COALESCE(excluded.title, agent_generated_knowledge.title),
       summary = COALESCE(excluded.summary, agent_generated_knowledge.summary),
       source_lineage_id = COALESCE(excluded.source_lineage_id, agent_generated_knowledge.source_lineage_id),
       source_deliverable_id = COALESCE(excluded.source_deliverable_id, agent_generated_knowledge.source_deliverable_id),
       status = excluded.status,
       updated_at = excluded.updated_at`,
  ).run(
    params.knowledgeId,
    params.kbId,
    params.agentId ?? null,
    params.type,
    params.title ?? null,
    params.summary ?? null,
    params.sourceLineageId ?? null,
    params.sourceDeliverableId ?? null,
    params.status ?? "pending",
    now,
    now,
  );
}

type AgentKnowledgeRow = {
  knowledge_id: string;
  kb_id: string;
  agent_id: string | null;
  type: AgentGeneratedKnowledgeType;
  title: string | null;
  summary: string | null;
  source_lineage_id: string | null;
  source_deliverable_id: string | null;
  status: AgentGeneratedKnowledgeStatus;
  created_at: number;
  updated_at: number;
};

function rowToRecord(row: AgentKnowledgeRow): AgentGeneratedKnowledgeRecord {
  return {
    knowledgeId: row.knowledge_id,
    kbId: row.kb_id,
    agentId: row.agent_id,
    type: row.type,
    title: row.title,
    summary: row.summary,
    sourceLineageId: row.source_lineage_id,
    sourceDeliverableId: row.source_deliverable_id,
    status: row.status,
    createdAtMs: row.created_at,
    updatedAtMs: row.updated_at,
  };
}

export function listAgentGeneratedKnowledgeInIndex(
  db: DatabaseSync,
  kbId: string,
  limit = 100,
): AgentGeneratedKnowledgeRecord[] {
  const capped = Math.max(1, Math.min(limit, 200));
  const rows = db
    .prepare(
      `SELECT * FROM agent_generated_knowledge
        WHERE kb_id = ?
        ORDER BY updated_at DESC
        LIMIT ?`,
    )
    .all(kbId, capped) as AgentKnowledgeRow[];
  return rows.map(rowToRecord);
}

export function summarizeAgentGeneratedKnowledgeByType(
  db: DatabaseSync,
  kbId: string,
): AgentGeneratedKnowledgeTypeCount[] {
  const rows = db
    .prepare(
      `SELECT type, COUNT(*) AS count
         FROM agent_generated_knowledge
        WHERE kb_id = ?
        GROUP BY type`,
    )
    .all(kbId) as Array<{ type: AgentGeneratedKnowledgeType; count: number }>;
  return rows.map((row) => ({ type: row.type, count: row.count }));
}

/** Derive a distinct agent-knowledge type from a generation lineage record (real signals). */
export function deriveAgentKnowledgeTypeFromLineage(
  lineage: KnowledgeLineageRecord,
): AgentGeneratedKnowledgeType {
  if (lineage.sourceRelationIds.length > 0) {
    return "auto_relation";
  }
  if (lineage.taskId) {
    return "auto_sop";
  }
  if (lineage.sessionKey && lineage.messageId) {
    return "conversation_summary";
  }
  return "auto_analysis";
}

/** Narrow agent-deliverable shape needed to materialize a typed agent-knowledge row. */
export type AgentDeliverableInput = {
  deliverableId: string;
  title?: string | null;
  source?: string | null;
  sourceType?: string | null;
  artifactKind?: string | null;
  sourceLineageId?: string | null;
  agentId?: string | null;
  governanceStatus?: string | null;
  updatedAtMs?: number;
};

/** Derive a distinct agent-knowledge type from an auto-captured agent deliverable. */
export function deriveAgentKnowledgeTypeFromDeliverable(
  deliverable: AgentDeliverableInput,
): AgentGeneratedKnowledgeType {
  if (deliverable.artifactKind === "workflow_output" || deliverable.source === "task") {
    return "auto_sop";
  }
  if (deliverable.artifactKind === "note") {
    return "long_term_memory";
  }
  if (deliverable.source === "chat") {
    return "conversation_summary";
  }
  return "auto_analysis";
}

function deliverableStatusToKnowledgeStatus(
  status: string | null | undefined,
): AgentGeneratedKnowledgeStatus {
  if (status === "verified") {
    return "confirmed";
  }
  return "pending";
}

/**
 * Materialize typed agent-knowledge rows from a knowledge base's generation lineage.
 * Idempotent (keyed by `lin:<lineageId>`). Returns the number of rows captured.
 */
export function captureAgentGeneratedKnowledgeFromLineage(
  db: DatabaseSync,
  kbId: string,
  nowMs = Date.now(),
): number {
  const lineage = listGenerationLineageForKnowledgeBase(db, kbId);
  let captured = 0;
  for (const record of lineage) {
    recordAgentGeneratedKnowledgeInIndex(db, {
      knowledgeId: `lin:${record.lineageId}`,
      kbId,
      type: deriveAgentKnowledgeTypeFromLineage(record),
      agentId: record.agentId ?? record.sourceAgentIds[0] ?? null,
      title: record.deliverableId ?? record.lineageId,
      sourceLineageId: record.lineageId,
      sourceDeliverableId: record.deliverableId,
      status: "pending",
      nowMs,
    });
    captured += 1;
  }
  return captured;
}

/**
 * Materialize typed agent-knowledge rows from auto-captured agent deliverables attached
 * to a knowledge base. Only `sourceType === "agent"` deliverables are captured (genuine
 * AI output). Idempotent (keyed by `dlv:<deliverableId>`). Returns rows captured.
 */
export function captureAgentGeneratedKnowledgeFromDeliverables(
  db: DatabaseSync,
  kbId: string,
  deliverables: readonly AgentDeliverableInput[],
  nowMs = Date.now(),
): number {
  let captured = 0;
  for (const deliverable of deliverables) {
    if (deliverable.sourceType !== "agent") {
      continue;
    }
    recordAgentGeneratedKnowledgeInIndex(db, {
      knowledgeId: `dlv:${deliverable.deliverableId}`,
      kbId,
      type: deriveAgentKnowledgeTypeFromDeliverable(deliverable),
      agentId: deliverable.agentId ?? null,
      title: deliverable.title ?? deliverable.deliverableId,
      sourceDeliverableId: deliverable.deliverableId,
      sourceLineageId: deliverable.sourceLineageId ?? null,
      status: deliverableStatusToKnowledgeStatus(deliverable.governanceStatus),
      nowMs,
    });
    captured += 1;
  }
  return captured;
}

async function openKbIndex(params: { knowledgeBase: KnowledgeBase; indexRoot?: string }) {
  const indexRoot = resolveKnowledgeIndexRootForBase(params.knowledgeBase, {
    indexRoot: params.indexRoot,
  });
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: params.knowledgeBase.ownerId,
    tenantId: params.knowledgeBase.tenantId,
    indexRoot,
  });
  return openKnowledgeIndex({ dbPath, vectorEnabled: false });
}

export type AgentGeneratedKnowledgeListResult = {
  items: AgentGeneratedKnowledgeRecord[];
  summary: AgentGeneratedKnowledgeTypeCount[];
};

/**
 * Capture agent-generated knowledge for a base (from lineage + supplied agent
 * deliverables), then return the typed listing + per-type summary. This is the read-path
 * the 「Agent 知识」 tab uses; capture-on-read keeps the projection current with real data.
 */
export async function listKnowledgeBaseAgentKnowledgeFromIndex(params: {
  knowledgeBase: KnowledgeBase;
  deliverables?: readonly AgentDeliverableInput[];
  limit?: number;
  nowMs?: number;
  indexRoot?: string;
}): Promise<AgentGeneratedKnowledgeListResult> {
  const index = await openKbIndex(params);
  const now = params.nowMs ?? Date.now();
  try {
    captureAgentGeneratedKnowledgeFromLineage(index.db, params.knowledgeBase.id, now);
    if (params.deliverables && params.deliverables.length > 0) {
      captureAgentGeneratedKnowledgeFromDeliverables(
        index.db,
        params.knowledgeBase.id,
        params.deliverables,
        now,
      );
    }
    return {
      items: listAgentGeneratedKnowledgeInIndex(
        index.db,
        params.knowledgeBase.id,
        params.limit ?? 100,
      ),
      summary: summarizeAgentGeneratedKnowledgeByType(index.db, params.knowledgeBase.id),
    };
  } finally {
    index.close();
  }
}
