/**
 * Conversation full-text index + optional semantic layer (CL-P4-01).
 * Index is rebuildable under Data Root; never the message source of truth.
 */
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { OpenBotConfig } from "../config/config.js";
import { resolveDataRoot } from "../config/data-space.js";
import { resolveConversationFlags } from "./flags.js";

const require = createRequire(import.meta.url);

function requireNodeSqlite(): { DatabaseSync: typeof DatabaseSync } {
  return require("node:sqlite") as { DatabaseSync: typeof DatabaseSync };
}

export type IndexedConversationDocument = {
  conversationId: string;
  dataPlaneId: string;
  sessionId: string;
  bindingId: string;
  title: string;
  body: string;
  updatedAt: string;
  /** Optional embedding vector for semantic search (unit-length preferred). */
  embedding?: number[] | null;
};

export type SearchIndexHit = {
  conversationId: string;
  sessionId: string;
  snippet: string;
  score: number;
  kind: "keyword" | "semantic";
};

export function resolveConversationSearchIndexPath(params: {
  cfg?: OpenBotConfig;
  dataRoot?: string;
}): string {
  const dataRoot = params.dataRoot ?? resolveDataRoot(params.cfg);
  return join(dataRoot, ".meta", "conversations", "search-index.sqlite");
}

export class ConversationSearchIndex {
  readonly path: string;
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.path = dbPath;
    mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
    const { DatabaseSync: Db } = requireNodeSqlite();
    this.db = new Db(dbPath);
    this.db.exec("pragma journal_mode = wal;");
    this.db.exec("pragma busy_timeout = 5000;");
    this.bootstrap();
  }

  private bootstrap(): void {
    this.db.exec(`
      create table if not exists docs (
        conversation_id text not null,
        data_plane_id text not null,
        session_id text not null,
        binding_id text not null,
        title text not null,
        body text not null,
        updated_at text not null,
        body_hash text not null,
        embedding_json text,
        primary key (data_plane_id, conversation_id, session_id)
      );
      create index if not exists idx_docs_conv on docs(data_plane_id, conversation_id);
      create virtual table if not exists docs_fts using fts5(
        conversation_id,
        title,
        body,
        content='docs',
        content_rowid='rowid'
      );
      create trigger if not exists docs_ai after insert on docs begin
        insert into docs_fts(rowid, conversation_id, title, body)
        values (new.rowid, new.conversation_id, new.title, new.body);
      end;
      create trigger if not exists docs_ad after delete on docs begin
        insert into docs_fts(docs_fts, rowid, conversation_id, title, body)
        values ('delete', old.rowid, old.conversation_id, old.title, old.body);
      end;
      create trigger if not exists docs_au after update on docs begin
        insert into docs_fts(docs_fts, rowid, conversation_id, title, body)
        values ('delete', old.rowid, old.conversation_id, old.title, old.body);
        insert into docs_fts(rowid, conversation_id, title, body)
        values (new.rowid, new.conversation_id, new.title, new.body);
      end;
    `);
  }

  upsertDocument(doc: IndexedConversationDocument): void {
    const bodyHash = createHash("sha256").update(doc.body).digest("hex");
    const existing = this.db
      .prepare(
        `select body_hash from docs
         where data_plane_id = ? and conversation_id = ? and session_id = ?`,
      )
      .get(doc.dataPlaneId, doc.conversationId, doc.sessionId) as { body_hash: string } | undefined;
    if (existing?.body_hash === bodyHash) {
      return;
    }
    this.db
      .prepare(
        `insert into docs (
          conversation_id, data_plane_id, session_id, binding_id,
          title, body, updated_at, body_hash, embedding_json
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(data_plane_id, conversation_id, session_id) do update set
          binding_id = excluded.binding_id,
          title = excluded.title,
          body = excluded.body,
          updated_at = excluded.updated_at,
          body_hash = excluded.body_hash,
          embedding_json = excluded.embedding_json`,
      )
      .run(
        doc.conversationId,
        doc.dataPlaneId,
        doc.sessionId,
        doc.bindingId,
        doc.title,
        doc.body,
        doc.updatedAt,
        bodyHash,
        doc.embedding ? JSON.stringify(doc.embedding) : null,
      );
  }

  deleteConversation(dataPlaneId: string, conversationId: string): void {
    this.db
      .prepare(`delete from docs where data_plane_id = ? and conversation_id = ?`)
      .run(dataPlaneId, conversationId);
  }

  /** Remaining index rows for a conversation (VERIFY residual check). */
  countConversation(dataPlaneId: string, conversationId: string): number {
    const row = this.db
      .prepare(`select count(*) as n from docs where data_plane_id = ? and conversation_id = ?`)
      .get(dataPlaneId, conversationId) as { n: number } | undefined;
    return Number(row?.n ?? 0);
  }

  /** Keyword search via FTS5. */
  searchKeyword(params: { dataPlaneId: string; query: string; limit?: number }): SearchIndexHit[] {
    const q = params.query.trim();
    if (!q) {
      return [];
    }
    // Escape FTS special chars roughly.
    const ftsQuery = q
      .replace(/["']/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `"${t.replace(/"/g, "")}"`)
      .join(" ");
    if (!ftsQuery) {
      return [];
    }
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
    try {
      const rows = this.db
        .prepare(
          `select d.conversation_id, d.session_id, d.body, d.title,
                  bm25(docs_fts) as rank
           from docs_fts
           join docs d on d.rowid = docs_fts.rowid
           where docs_fts match ? and d.data_plane_id = ?
           order by rank
           limit ?`,
        )
        .all(ftsQuery, params.dataPlaneId, limit) as Array<{
        conversation_id: string;
        session_id: string;
        body: string;
        title: string;
        rank: number;
      }>;
      return rows.map((r) => ({
        conversationId: r.conversation_id,
        sessionId: r.session_id,
        snippet: buildSnippet(r.body || r.title, q),
        // bm25: lower is better — invert for higher-is-better score
        score: Math.max(0.1, 10 - Number(r.rank ?? 0)),
        kind: "keyword" as const,
      }));
    } catch {
      // Fallback LIKE when FTS query invalid
      const like = `%${q.replace(/%/g, "")}%`;
      const rows = this.db
        .prepare(
          `select conversation_id, session_id, body, title from docs
           where data_plane_id = ? and (body like ? or title like ?)
           limit ?`,
        )
        .all(params.dataPlaneId, like, like, limit) as Array<{
        conversation_id: string;
        session_id: string;
        body: string;
        title: string;
      }>;
      return rows.map((r) => ({
        conversationId: r.conversation_id,
        sessionId: r.session_id,
        snippet: buildSnippet(r.body || r.title, q),
        score: 1,
        kind: "keyword" as const,
      }));
    }
  }

  /**
   * Semantic search over stored embeddings (cosine). No network — uses provided query vector.
   */
  searchSemantic(params: {
    dataPlaneId: string;
    queryEmbedding: number[];
    limit?: number;
    minScore?: number;
  }): SearchIndexHit[] {
    if (!params.queryEmbedding.length) {
      return [];
    }
    const rows = this.db
      .prepare(
        `select conversation_id, session_id, body, title, embedding_json from docs
         where data_plane_id = ? and embedding_json is not null`,
      )
      .all(params.dataPlaneId) as Array<{
      conversation_id: string;
      session_id: string;
      body: string;
      title: string;
      embedding_json: string;
    }>;
    const minScore = params.minScore ?? 0.25;
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
    const scored: SearchIndexHit[] = [];
    for (const r of rows) {
      let emb: number[];
      try {
        emb = JSON.parse(r.embedding_json) as number[];
      } catch {
        continue;
      }
      const score = cosineSimilarity(params.queryEmbedding, emb);
      if (score < minScore) {
        continue;
      }
      scored.push({
        conversationId: r.conversation_id,
        sessionId: r.session_id,
        snippet: (r.body || r.title).slice(0, 180),
        score,
        kind: "semantic",
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  close(): void {
    this.db.close();
  }
}

function buildSnippet(body: string, query: string): string {
  const lower = body.toLowerCase();
  const term = query.toLowerCase().split(/\s+/)[0] ?? "";
  const idx = term ? lower.indexOf(term) : 0;
  const start = Math.max(0, idx - 40);
  const slice = body.slice(start, start + 180);
  return start > 0 ? `...${slice}` : slice;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) {
    return 0;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Deterministic bag-of-words embedding for offline semantic fallback (no external model). */
export function hashEmbedding(text: string, dims = 64): number[] {
  const vec = Array.from({ length: dims }, () => 0);
  const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
  for (const t of tokens) {
    const h = createHash("sha256").update(t).digest();
    const idx = h[0] % dims;
    const sign = h[1] & 1 ? 1 : -1;
    vec[idx] += sign;
  }
  // L2 normalize
  let norm = 0;
  for (const v of vec) {
    norm += v * v;
  }
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

const indexCache = new Map<string, ConversationSearchIndex>();

export function getConversationSearchIndex(params: {
  cfg?: OpenBotConfig;
  dataRoot?: string;
}): ConversationSearchIndex {
  const path = resolveConversationSearchIndexPath(params);
  const existing = indexCache.get(path);
  if (existing) {
    return existing;
  }
  const idx = new ConversationSearchIndex(path);
  indexCache.set(path, idx);
  return idx;
}

export function isSemanticSearchEnabled(cfg?: OpenBotConfig | null): boolean {
  return resolveConversationFlags(cfg).searchSemanticEnabled;
}
