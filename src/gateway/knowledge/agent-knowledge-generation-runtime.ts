import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import { CONFIG_DIR } from "../../utils.js";
import { loadPlatformAuthStore, resolvePlatformAuthConfig } from "../platform-auth.js";
import { findMembershipByUserId } from "../platform-auth/memberships.js";
import type { GatewayClient } from "../server-methods/types.js";
import { readSessionMessages } from "../session-utils.js";
import { loadSessionEntryForClient } from "../tenant-context.js";
import {
  isAgentKnowledgeAutoGenerateEnabled,
  listPendingAgentKnowledgeGenerationInIndex,
  markAgentKnowledgeGenerationDoneInIndex,
  markAgentKnowledgeGenerationErrorInIndex,
} from "./agent-knowledge-generation-queue-store.js";
import {
  createAgentKnowledgeLlmCaller,
  extractTranscriptMessages,
  generateAndRecordAgentKnowledge,
  type AgentKnowledgeLlmCaller,
  type TranscriptMessage,
} from "./agent-knowledge-generator.js";
import { openKnowledgeIndex } from "./kb-index.js";
import { getKnowledgeBase } from "./knowledge-base-store.js";

export type AgentKnowledgeGenerationTickResult = {
  databases: number;
  processed: number;
  generated: number;
  failed: number;
};

export type AgentKnowledgeGenerationTranscriptContext = {
  dbPath: string;
  kbId: string;
};

function sanitizeIndexKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "unknown";
  }
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function buildGatewayClientForOwnerUserId(
  ownerUserId: string,
): Promise<GatewayClient | null> {
  const userId = ownerUserId.trim();
  if (!userId) {
    return null;
  }
  const authConfig = resolvePlatformAuthConfig(loadConfig().gateway?.auth?.trustedProxy);
  if (!authConfig?.enabled) {
    return null;
  }
  try {
    const store = await loadPlatformAuthStore(authConfig);
    const user =
      store.users[userId] ?? Object.values(store.users).find((entry) => entry.id === userId);
    if (!user?.email?.trim()) {
      return null;
    }
    const membership = findMembershipByUserId(store, user.id);
    return {
      connect: {} as GatewayClient["connect"],
      user: user.email,
      sessionDomain: membership ? "employee" : "platform",
      ...(membership ? { sessionTenantId: membership.enterpriseId } : {}),
    };
  } catch {
    return null;
  }
}

async function resolveOwnerUserIdForIndexDb(dbPath: string, kbId: string): Promise<string | null> {
  const scope = path.basename(path.dirname(dbPath));
  if (scope === "personal") {
    const sanitizedKey = path.basename(dbPath, ".db");
    const authConfig = resolvePlatformAuthConfig(loadConfig().gateway?.auth?.trustedProxy);
    if (!authConfig?.enabled) {
      return sanitizedKey;
    }
    try {
      const store = await loadPlatformAuthStore(authConfig);
      for (const user of Object.values(store.users)) {
        if (user.id === sanitizedKey || sanitizeIndexKey(user.id) === sanitizedKey) {
          return user.id;
        }
      }
    } catch {
      return null;
    }
    return null;
  }
  const knowledgeBase = getKnowledgeBase(kbId);
  return knowledgeBase?.ownerId?.trim() || null;
}

/** Load a session's transcript as {role,text} turns; empty on any failure. */
async function defaultLoadTranscript(
  sessionKey: string,
  ctx?: AgentKnowledgeGenerationTranscriptContext,
): Promise<TranscriptMessage[]> {
  try {
    const ownerUserId =
      ctx?.dbPath && ctx.kbId ? await resolveOwnerUserIdForIndexDb(ctx.dbPath, ctx.kbId) : null;
    const client = ownerUserId ? await buildGatewayClientForOwnerUserId(ownerUserId) : null;
    const session = await loadSessionEntryForClient(sessionKey, client);
    const sessionId = session.entry?.sessionId;
    if (!sessionId || !session.storePath) {
      return [];
    }
    const raw = readSessionMessages(sessionId, session.storePath, session.entry?.sessionFile);
    return extractTranscriptMessages(raw);
  } catch {
    return [];
  }
}

/**
 * The auto-generation consumer: drain pending generation jobs across every owner/tenant
 * knowledge index, loading each session's transcript and running the LLM summarizer/SOP
 * generator out-of-band. Bounded per round; opt-in (no-op unless enabled). The LLM caller
 * and transcript loader are injectable for tests. Errors are captured per-job with a retry
 * cap so a bad session never wedges the queue or breaks the maintenance tick.
 */
export async function tickAgentKnowledgeGeneration(params?: {
  indexRoot?: string;
  maxDatabasesPerRound?: number;
  limitPerDb?: number;
  nowMs?: number;
  llm?: AgentKnowledgeLlmCaller | null;
  loadTranscript?: (
    sessionKey: string,
    ctx?: AgentKnowledgeGenerationTranscriptContext,
  ) => Promise<TranscriptMessage[]>;
}): Promise<AgentKnowledgeGenerationTickResult> {
  const empty: AgentKnowledgeGenerationTickResult = {
    databases: 0,
    processed: 0,
    generated: 0,
    failed: 0,
  };
  if (!isAgentKnowledgeAutoGenerateEnabled()) {
    return empty;
  }
  const root = params?.indexRoot ?? path.join(CONFIG_DIR, "knowledge", "index");
  if (!fs.existsSync(root)) {
    return empty;
  }
  const llm = params?.llm !== undefined ? params.llm : createAgentKnowledgeLlmCaller();
  if (!llm) {
    return empty;
  }
  const loadTranscript = params?.loadTranscript ?? defaultLoadTranscript;

  const dbPaths: string[] = [];
  for (const scope of ["personal", "tenant"] as const) {
    const dir = path.join(root, scope);
    if (!fs.existsSync(dir)) {
      continue;
    }
    for (const entry of fs.readdirSync(dir)) {
      if (entry.endsWith(".db")) {
        dbPaths.push(path.join(dir, entry));
      }
    }
  }

  const dbLimit = params?.maxDatabasesPerRound ?? 8;
  const limitPerDb = params?.limitPerDb ?? 5;
  const now = params?.nowMs ?? Date.now();
  const result: AgentKnowledgeGenerationTickResult = { ...empty };

  for (const dbPath of dbPaths.slice(0, dbLimit)) {
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const jobs = listPendingAgentKnowledgeGenerationInIndex(index.db, { limit: limitPerDb });
      if (jobs.length === 0) {
        continue;
      }
      result.databases += 1;
      for (const job of jobs) {
        result.processed += 1;
        try {
          const messages = await loadTranscript(job.sessionKey, { dbPath, kbId: job.kbId });
          if (messages.length === 0) {
            // No transcript to summarize — mark done so it is not retried forever.
            markAgentKnowledgeGenerationDoneInIndex(index.db, {
              kbId: job.kbId,
              sessionKey: job.sessionKey,
              nowMs: now,
            });
            continue;
          }
          const generated = await generateAndRecordAgentKnowledge({
            db: index.db,
            kbId: job.kbId,
            sessionKey: job.sessionKey,
            agentId: job.agentId,
            messages,
            llm,
            nowMs: now,
          });
          result.generated += generated.length;
          markAgentKnowledgeGenerationDoneInIndex(index.db, {
            kbId: job.kbId,
            sessionKey: job.sessionKey,
            nowMs: now,
          });
        } catch (error) {
          result.failed += 1;
          markAgentKnowledgeGenerationErrorInIndex(index.db, {
            kbId: job.kbId,
            sessionKey: job.sessionKey,
            error: error instanceof Error ? error.message : "generation failed",
            nowMs: now,
          });
        }
      }
    } finally {
      index.close();
    }
  }
  return result;
}
