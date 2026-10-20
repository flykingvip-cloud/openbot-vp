import type { DatabaseSync } from "node:sqlite";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "./kb-index.js";
import type { KnowledgeBase } from "./knowledge-base-store.js";

/**
 * Opt-in queue that backs the auto-trigger for the LLM summarizer / auto-SOP generator.
 * Producers (e.g. deliverable commit) enqueue a {kbId, sessionKey} job; a bounded
 * maintenance tick consumes pending jobs out-of-band so a paid LLM call never runs on the
 * user's synchronous commit path. Disabled by default — only enqueues/consumes when
 * OPENBOT_KNOWLEDGE_AUTO_GENERATE (or legacy OPENCLAW_KNOWLEDGE_AUTO_GENERATE) is truthy.
 */

export const MAX_AGENT_KNOWLEDGE_GENERATION_ATTEMPTS = 3;

export type AgentKnowledgeGenerationStatus = "pending" | "done" | "error";

export type AgentKnowledgeGenerationJob = {
  kbId: string;
  sessionKey: string;
  agentId: string | null;
};

export type AgentKnowledgeGenerationQueueRow = {
  kbId: string;
  sessionKey: string;
  agentId: string | null;
  status: AgentKnowledgeGenerationStatus;
  attempts: number;
  lastError: string | null;
  enqueuedAtMs: number;
  processedAtMs: number | null;
  updatedAtMs: number;
};

function envFlag(name: string): boolean {
  const value = process.env[name];
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

/** Whether the auto-generation subsystem is enabled (opt-in; default off). */
export function isAgentKnowledgeAutoGenerateEnabled(): boolean {
  return envFlag("OPENBOT_KNOWLEDGE_AUTO_GENERATE") || envFlag("OPENCLAW_KNOWLEDGE_AUTO_GENERATE");
}

/**
 * Enqueue a generation job for a session. Re-enqueuing an existing job resets it to
 * pending (a fresh archive of the same session should regenerate). Returns false when the
 * session key is empty.
 */
export function enqueueAgentKnowledgeGenerationInIndex(
  db: DatabaseSync,
  params: { kbId: string; sessionKey: string; agentId?: string | null; nowMs?: number },
): boolean {
  const sessionKey = params.sessionKey.trim();
  if (!sessionKey) {
    return false;
  }
  const now = params.nowMs ?? Date.now();
  db.prepare(
    `INSERT INTO agent_knowledge_generation_queue
       (kb_id, session_key, agent_id, status, attempts, last_error, enqueued_at, processed_at, updated_at)
     VALUES (?, ?, ?, 'pending', 0, NULL, ?, NULL, ?)
     ON CONFLICT(kb_id, session_key) DO UPDATE SET
       agent_id = COALESCE(excluded.agent_id, agent_knowledge_generation_queue.agent_id),
       status = 'pending',
       attempts = 0,
       last_error = NULL,
       processed_at = NULL,
       updated_at = excluded.updated_at`,
  ).run(params.kbId, sessionKey, params.agentId ?? null, now, now);
  return true;
}

type QueueRow = {
  kb_id: string;
  session_key: string;
  agent_id: string | null;
  status: AgentKnowledgeGenerationStatus;
  attempts: number;
  last_error: string | null;
  enqueued_at: number;
  processed_at: number | null;
  updated_at: number;
};

function rowToQueueRow(row: QueueRow): AgentKnowledgeGenerationQueueRow {
  return {
    kbId: row.kb_id,
    sessionKey: row.session_key,
    agentId: row.agent_id,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    enqueuedAtMs: row.enqueued_at,
    processedAtMs: row.processed_at,
    updatedAtMs: row.updated_at,
  };
}

/** Pending jobs that have not exhausted their retry budget, oldest first. */
export function listPendingAgentKnowledgeGenerationInIndex(
  db: DatabaseSync,
  params?: { limit?: number },
): AgentKnowledgeGenerationJob[] {
  const limit = Math.max(1, Math.min(params?.limit ?? 20, 100));
  const rows = db
    .prepare(
      `SELECT kb_id, session_key, agent_id
         FROM agent_knowledge_generation_queue
        WHERE status = 'pending' AND attempts < ?
        ORDER BY updated_at ASC
        LIMIT ?`,
    )
    .all(MAX_AGENT_KNOWLEDGE_GENERATION_ATTEMPTS, limit) as Array<{
    kb_id: string;
    session_key: string;
    agent_id: string | null;
  }>;
  return rows.map((row) => ({
    kbId: row.kb_id,
    sessionKey: row.session_key,
    agentId: row.agent_id,
  }));
}

export function getAgentKnowledgeGenerationQueueRow(
  db: DatabaseSync,
  kbId: string,
  sessionKey: string,
): AgentKnowledgeGenerationQueueRow | null {
  const row = db
    .prepare(`SELECT * FROM agent_knowledge_generation_queue WHERE kb_id = ? AND session_key = ?`)
    .get(kbId, sessionKey) as QueueRow | undefined;
  return row ? rowToQueueRow(row) : null;
}

export function markAgentKnowledgeGenerationDoneInIndex(
  db: DatabaseSync,
  params: { kbId: string; sessionKey: string; nowMs?: number },
): void {
  const now = params.nowMs ?? Date.now();
  db.prepare(
    `UPDATE agent_knowledge_generation_queue
        SET status = 'done', attempts = attempts + 1, last_error = NULL,
            processed_at = ?, updated_at = ?
      WHERE kb_id = ? AND session_key = ?`,
  ).run(now, now, params.kbId, params.sessionKey);
}

/**
 * Record a failed attempt. Stays `pending` (retryable) until the attempt count reaches
 * MAX_AGENT_KNOWLEDGE_GENERATION_ATTEMPTS, then flips to `error` so it stops being picked up.
 */
export function markAgentKnowledgeGenerationErrorInIndex(
  db: DatabaseSync,
  params: { kbId: string; sessionKey: string; error: string; nowMs?: number },
): void {
  const now = params.nowMs ?? Date.now();
  db.prepare(
    `UPDATE agent_knowledge_generation_queue
        SET attempts = attempts + 1,
            last_error = ?,
            status = CASE WHEN attempts + 1 >= ? THEN 'error' ELSE 'pending' END,
            updated_at = ?
      WHERE kb_id = ? AND session_key = ?`,
  ).run(
    params.error.slice(0, 500),
    MAX_AGENT_KNOWLEDGE_GENERATION_ATTEMPTS,
    now,
    params.kbId,
    params.sessionKey,
  );
}

/**
 * Open the base's knowledge index and enqueue a generation job. Best-effort + opt-in:
 * a no-op (returns false) when auto-generation is disabled, so producers can call it
 * unconditionally without gating logic at every call site.
 */
export async function enqueueAgentKnowledgeGeneration(params: {
  knowledgeBase: KnowledgeBase;
  sessionKey: string;
  agentId?: string | null;
  indexRoot?: string;
  nowMs?: number;
}): Promise<boolean> {
  if (!isAgentKnowledgeAutoGenerateEnabled()) {
    return false;
  }
  if (!params.sessionKey.trim()) {
    return false;
  }
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: params.knowledgeBase.ownerId,
    tenantId: params.knowledgeBase.tenantId,
    indexRoot: params.indexRoot,
  });
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    return enqueueAgentKnowledgeGenerationInIndex(index.db, {
      kbId: params.knowledgeBase.id,
      sessionKey: params.sessionKey,
      agentId: params.agentId ?? null,
      ...(params.nowMs != null ? { nowMs: params.nowMs } : {}),
    });
  } finally {
    index.close();
  }
}
