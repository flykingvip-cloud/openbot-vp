import { authorizeConversationAction } from "./acl.js";
/**
 * Conversation search (CL-P4-01) — ACL first, then rank.
 * Metadata filter + keyword over title/projection; optional transcript keyword scan.
 */
import type { ConversationCatalogRepository } from "./catalog/repository.js";
import type { ConversationProjection } from "./projection.js";
import type { ProjectionStore } from "./projection.js";
import type { ConversationLifecycleStatus, ConversationTenantContext } from "./types.js";

export type ConversationSearchQuery = {
  query?: string;
  agentId?: string;
  groupId?: string;
  lifecycleStatus?: ConversationLifecycleStatus | ConversationLifecycleStatus[];
  /** ISO lower bound on updatedAt */
  updatedAfter?: string;
  updatedBefore?: string;
  participantId?: string;
  hasDecision?: boolean;
  hasPendingTask?: boolean;
  includeArchived?: boolean;
  /**
   * From RetentionPolicy.archiveSearchEnabled. When false, ARCHIVED rows are
   * excluded even if includeArchived/lifecycle lists them (plan CL-P4-01).
   */
  archiveSearchEnabled?: boolean;
  limit?: number;
  /** Optional transcript keyword hits (sessionId → snippet). Pre-filtered by caller ACL. */
  transcriptHits?: Array<{
    conversationId: string;
    sessionId: string;
    snippet: string;
    score: number;
  }>;
};

export type ConversationSearchHit = {
  conversationId: string;
  title: string;
  lifecycleStatus: ConversationLifecycleStatus;
  agentId: string | null;
  groupId: string | null;
  updatedAt: string;
  score: number;
  matchReasons: string[];
  shortSummary?: string | null;
  evidenceSnippet?: string | null;
  /** Product deep link — no filesystem paths. */
  deepLink?: {
    conversationId: string;
    sessionId?: string;
  };
};

function normalizeQuery(q: string | undefined): string[] {
  if (!q?.trim()) {
    return [];
  }
  return q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function scoreTitle(title: string, terms: string[]): number {
  if (terms.length === 0) {
    return 0;
  }
  const hay = title.toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (hay === t) {
      score += 5;
    } else if (hay.includes(t)) {
      score += 2;
    }
  }
  return score;
}

function scoreProjection(
  projection: ConversationProjection | null | undefined,
  terms: string[],
): { score: number; reasons: string[]; snippet: string | null } {
  if (!projection || terms.length === 0) {
    return { score: 0, reasons: [], snippet: null };
  }
  const reasons: string[] = [];
  let score = 0;
  const summary = projection.shortSummary.toLowerCase();
  for (const t of terms) {
    if (summary.includes(t)) {
      score += 1.5;
      reasons.push("summary");
    }
  }
  for (const d of projection.decisions) {
    const text = d.text.toLowerCase();
    if (terms.some((t) => text.includes(t))) {
      score += d.status === "APPROVED" ? 3 : 1;
      reasons.push("decision");
    }
  }
  for (const task of projection.pendingTasks) {
    if (terms.some((t) => task.text.toLowerCase().includes(t))) {
      score += 2;
      reasons.push("task");
    }
  }
  return {
    score,
    reasons: [...new Set(reasons)],
    snippet: projection.shortSummary.slice(0, 200) || null,
  };
}

/**
 * Search conversations. Authorization runs per candidate before ranking.
 */
export async function searchConversations(params: {
  catalog: ConversationCatalogRepository;
  ctx: ConversationTenantContext;
  query: ConversationSearchQuery;
  projectionStore?: ProjectionStore | null;
}): Promise<{ hits: ConversationSearchHit[]; scanned: number }> {
  const terms = normalizeQuery(params.query.query);
  const lifecycle =
    params.query.lifecycleStatus ??
    (params.query.includeArchived
      ? (["ACTIVE", "CLOSED", "ARCHIVED"] as ConversationLifecycleStatus[])
      : (["ACTIVE", "CLOSED"] as ConversationLifecycleStatus[]));

  const page = await params.catalog.listConversations({
    dataPlaneId: params.ctx.dataPlaneId,
    tenantId: params.ctx.tenantId,
    agentId: params.query.agentId,
    groupId: params.query.groupId,
    lifecycleStatus: lifecycle,
    updatedAfter: params.query.updatedAfter,
    updatedBefore: params.query.updatedBefore,
    limit: 200,
  });

  const transcriptByConv = new Map<
    string,
    { snippet: string; score: number; sessionId?: string }
  >();
  for (const hit of params.query.transcriptHits ?? []) {
    const prev = transcriptByConv.get(hit.conversationId);
    if (!prev || hit.score > prev.score) {
      transcriptByConv.set(hit.conversationId, {
        snippet: hit.snippet,
        score: hit.score,
        sessionId: hit.sessionId,
      });
    }
  }

  // Default archiveSearchEnabled=false: ARCHIVED rows never rank unless policy opts in.
  const allowArchivedHits = params.query.archiveSearchEnabled === true;

  const hits: ConversationSearchHit[] = [];
  for (const record of page.rows) {
    // ACL before any ranking or snippet exposure.
    const auth = authorizeConversationAction({
      ctx: params.ctx,
      record,
      action: "read",
    });
    if (!auth.allowed) {
      continue;
    }
    if (record.lifecycleStatus === "ARCHIVED" && !allowArchivedHits) {
      continue;
    }
    if (params.query.participantId) {
      if (!record.participantIds.includes(params.query.participantId)) {
        continue;
      }
    }

    let projection: ConversationProjection | null = null;
    if (params.projectionStore) {
      projection = await params.projectionStore.get(record.conversationId);
    }

    if (params.query.hasDecision && !projection?.decisions.some((d) => d.status === "APPROVED")) {
      continue;
    }
    if (params.query.hasPendingTask && !projection?.pendingTasks.length) {
      continue;
    }

    const titleScore = scoreTitle(record.title, terms);
    const proj = scoreProjection(projection, terms);
    const transcript = transcriptByConv.get(record.conversationId);
    const transcriptScore = transcript?.score ?? 0;

    // Content channels (projection + transcript) share underlying sources —
    // take max + light secondary so the same source does not double-count.
    const contentPrimary = Math.max(proj.score, transcriptScore);
    const contentSecondary = Math.min(proj.score, transcriptScore) * 0.15;
    const contentScore = contentPrimary + contentSecondary;

    // Metadata-only match when no query terms.
    let score = terms.length === 0 ? 1 : titleScore + contentScore;
    if (terms.length > 0 && score <= 0) {
      continue;
    }

    const matchReasons: string[] = [];
    if (titleScore > 0) {
      matchReasons.push("title");
    }
    matchReasons.push(...proj.reasons);
    if (transcriptScore > 0) {
      matchReasons.push("transcript");
    }
    if (terms.length === 0) {
      matchReasons.push("metadata");
    }

    hits.push({
      conversationId: record.conversationId,
      title: record.title,
      lifecycleStatus: record.lifecycleStatus,
      agentId: record.agentId,
      groupId: record.groupId,
      updatedAt: record.updatedAt,
      score,
      matchReasons: [...new Set(matchReasons)],
      shortSummary: projection?.shortSummary ?? null,
      // Prefer transcript snippet; never invent paths.
      evidenceSnippet: transcript?.snippet ?? proj.snippet,
      deepLink: {
        conversationId: record.conversationId,
        sessionId: transcript?.sessionId,
      },
    });
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  const limit = Math.min(Math.max(params.query.limit ?? 20, 1), 100);
  return { hits: hits.slice(0, limit), scanned: page.rows.length };
}

/** Simple in-memory keyword scan of message texts (caller supplies authorized messages). */
export function keywordScanMessages(params: {
  conversationId: string;
  sessionId: string;
  messages: Array<{ text?: string }>;
  query: string;
  maxHits?: number;
}): Array<{ conversationId: string; sessionId: string; snippet: string; score: number }> {
  const terms = normalizeQuery(params.query);
  if (terms.length === 0) {
    return [];
  }
  const hits: Array<{
    conversationId: string;
    sessionId: string;
    snippet: string;
    score: number;
  }> = [];
  for (const msg of params.messages) {
    const text = msg.text?.trim() ?? "";
    if (!text) {
      continue;
    }
    const lower = text.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (lower.includes(t)) {
        score += 1;
      }
    }
    if (score > 0) {
      hits.push({
        conversationId: params.conversationId,
        sessionId: params.sessionId,
        snippet: text.length > 180 ? `${text.slice(0, 177)}...` : text,
        score,
      });
    }
    if (hits.length >= (params.maxHits ?? 20)) {
      break;
    }
  }
  return hits;
}
