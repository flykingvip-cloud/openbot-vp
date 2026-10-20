import type { DatabaseSync } from "node:sqlite";
import type { EmbeddingProvider } from "../../memory/embeddings.js";
import {
  bm25RankToScore,
  buildFtsQuery,
  mergeHybridResults,
  tokenizeFtsTerms,
} from "../../memory/hybrid.js";
import type { KnowledgeEvidence } from "../../retrieval/types.js";
import { truncateUtf16Safe } from "../../utils.js";
import {
  loadChunkGovernanceFactors,
  recordChunkRetrievalHits,
} from "./governance/chunk-governance-store.js";
import { loadChunkClaimConflictFlags } from "./governance/claims/claim-retrieval.js";
import {
  applyGovernanceMultiplier,
  shouldFilterGovernanceHit,
} from "./governance/retrieval-scoring.js";
import {
  ensureKnowledgeVectorTable,
  KB_CHUNKS_TABLE,
  KB_CHUNK_META_TABLE,
  KB_FTS_TABLE,
  KB_VECTOR_TABLE,
} from "./kb-index-schema.js";
import type { KnowledgeIndex } from "./kb-index.js";

export type KbRetrieveHit = {
  chunkId: string;
  chunkText: string;
  kbId: string;
  docId: string;
  docTitle: string;
  versionId: string;
  versionLabel: string;
  publishedAt: number;
  heading: string | null;
  section: string | null;
  startLine: number;
  endLine: number;
  vectorScore: number;
  textScore: number;
  score: number;
  governanceStatus?: import("./governance/types.js").GovernanceStatus | null;
  governanceConflict?: boolean;
  governanceClaimConflict?: boolean;
};

export type RetrieveKnowledgeIndexParams = {
  index: KnowledgeIndex;
  query: string;
  kbIds: string[];
  embeddingProvider: EmbeddingProvider | null;
  maxResults?: number;
  minScore?: number;
  hybridEnabled?: boolean;
  vectorWeight?: number;
  textWeight?: number;
  candidateMultiplier?: number;
  versionId?: string;
  docId?: string;
  governanceAware?: boolean;
  fallbackToCurrentChunks?: boolean;
};

const DEFAULT_MAX_RESULTS = 8;
const DEFAULT_CANDIDATE_MULTIPLIER = 4;
const SNIPPET_MAX_CHARS = 700;

const vectorToBlob = (embedding: number[]): Buffer =>
  Buffer.from(new Float32Array(embedding).buffer);

function buildKbIdFilter(kbIds: string[]): { sql: string; params: string[] } {
  if (kbIds.length === 0) {
    return { sql: " AND 1 = 0", params: [] };
  }
  const placeholders = kbIds.map(() => "?").join(", ");
  return { sql: ` AND m.kb_id IN (${placeholders})`, params: kbIds };
}

type RawKbRow = {
  chunk_id: string;
  text: string;
  kb_id: string;
  doc_id: string;
  doc_title: string;
  version_id: string;
  version_label: string;
  published_at: number;
  heading: string | null;
  section: string | null;
  start_line: number;
  end_line: number;
};

function mapRawRow(
  row: RawKbRow,
  scores: { vectorScore: number; textScore: number; score: number },
): KbRetrieveHit {
  return {
    chunkId: row.chunk_id,
    chunkText: truncateUtf16Safe(row.text, SNIPPET_MAX_CHARS),
    kbId: row.kb_id,
    docId: row.doc_id,
    docTitle: row.doc_title,
    versionId: row.version_id,
    versionLabel: row.version_label,
    publishedAt: row.published_at,
    heading: row.heading,
    section: row.section,
    startLine: row.start_line,
    endLine: row.end_line,
    ...scores,
  };
}

function buildDocIdFilter(docId?: string): { sql: string; params: string[] } {
  const trimmed = docId?.trim();
  if (!trimmed) {
    return { sql: "", params: [] };
  }
  return { sql: " AND m.doc_id = ?", params: [trimmed] };
}

function buildVersionIdFilter(versionId?: string): { sql: string; params: string[] } {
  const trimmed = versionId?.trim();
  if (!trimmed) {
    return { sql: "", params: [] };
  }
  return { sql: " AND m.version_id = ?", params: [trimmed] };
}

function buildMetaJoin(currentVersionOnly: boolean): string {
  const documentJoin = currentVersionOnly
    ? `JOIN documents d ON d.doc_id = m.doc_id AND m.version_id = d.current_version_id`
    : `JOIN documents d ON d.doc_id = m.doc_id`;
  return (
    `JOIN ${KB_CHUNK_META_TABLE} m ON m.chunk_id = c.id\n` +
    `${documentJoin}\n` +
    `JOIN document_versions dv ON dv.version_id = m.version_id`
  );
}

function finalizeKbRetrieveHits(params: {
  db: DatabaseSync;
  hits: KbRetrieveHit[];
  maxResults: number;
  minScore: number;
  governanceAware: boolean;
}): KbRetrieveHit[] {
  let hits = params.hits;
  if (params.governanceAware && hits.length > 0) {
    const factors = loadChunkGovernanceFactors(
      params.db,
      hits.map((hit) => hit.chunkId),
    );
    const claimConflictFlags = loadChunkClaimConflictFlags(
      params.db,
      hits.map((hit) => hit.chunkId),
    );
    hits = hits
      .filter((hit) => !shouldFilterGovernanceHit(factors.get(hit.chunkId)))
      .map((hit) => {
        const factor = factors.get(hit.chunkId);
        const claimConflict = claimConflictFlags.get(hit.chunkId) ?? false;
        return {
          ...hit,
          score: applyGovernanceMultiplier(hit.score, factor, { claimConflict }),
          governanceStatus: factor?.governanceStatus ?? null,
          governanceConflict: Boolean(factor?.conflictGroupId),
          governanceClaimConflict: claimConflict,
        };
      });
  }
  const ranked = hits
    .filter((hit) => hit.score >= params.minScore)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, params.maxResults);
  if (params.governanceAware && ranked.length > 0) {
    recordChunkRetrievalHits({
      db: params.db,
      chunkIds: ranked.map((hit) => hit.chunkId),
    });
  }
  return ranked;
}

function runKnowledgeKeywordMatch(params: {
  db: DatabaseSync;
  ftsQuery: string;
  kbIds: string[];
  model: string | null;
  limit: number;
  versionId?: string;
  docId?: string;
}): KbRetrieveHit[] {
  const kbFilter = buildKbIdFilter(params.kbIds);
  const docFilter = buildDocIdFilter(params.docId);
  const versionFilter = buildVersionIdFilter(params.versionId);
  const currentVersionOnly = !params.versionId?.trim();
  const metaJoin = buildMetaJoin(currentVersionOnly);
  const modelClause = params.model ? " AND f.model = ?" : "";
  const modelParams = params.model ? [params.model] : [];

  const rows = params.db
    .prepare(
      `SELECT c.id AS chunk_id, c.text, m.kb_id, m.doc_id, d.title AS doc_title,\n` +
        `       m.version_id, dv.version_label, dv.published_at,\n` +
        `       m.heading, m.section, m.start_line, m.end_line,\n` +
        `       bm25(${KB_FTS_TABLE}) AS rank\n` +
        `  FROM ${KB_FTS_TABLE} f\n` +
        `  JOIN ${KB_CHUNKS_TABLE} c ON c.id = f.id\n` +
        `  ${metaJoin}\n` +
        ` WHERE ${KB_FTS_TABLE} MATCH ?${modelClause}${kbFilter.sql}${docFilter.sql}${versionFilter.sql}\n` +
        ` ORDER BY rank ASC\n` +
        ` LIMIT ?`,
    )
    .all(
      params.ftsQuery,
      ...modelParams,
      ...kbFilter.params,
      ...docFilter.params,
      ...versionFilter.params,
      params.limit,
    ) as Array<RawKbRow & { rank: number }>;

  return rows.map((row) => {
    const textScore = bm25RankToScore(row.rank);
    return mapRawRow(row, { vectorScore: 0, textScore, score: textScore });
  });
}

function searchKnowledgeTitleOrText(params: {
  db: DatabaseSync;
  query: string;
  kbIds: string[];
  limit: number;
  versionId?: string;
  docId?: string;
}): KbRetrieveHit[] {
  const tokens = tokenizeFtsTerms(params.query).filter((token) => token.length >= 2);
  if (tokens.length === 0 || params.kbIds.length === 0 || params.limit <= 0) {
    return [];
  }
  const kbFilter = buildKbIdFilter(params.kbIds);
  const docFilter = buildDocIdFilter(params.docId);
  const versionFilter = buildVersionIdFilter(params.versionId);
  const currentVersionOnly = !params.versionId?.trim();
  const metaJoin = buildMetaJoin(currentVersionOnly);
  const likeClause = tokens.map(() => "(d.title LIKE ? OR c.text LIKE ?)").join(" OR ");
  const likeParams = tokens.flatMap((token) => {
    const needle = `%${token.replaceAll("%", "").replaceAll("_", "")}%`;
    return [needle, needle];
  });
  const rows = params.db
    .prepare(
      `SELECT c.id AS chunk_id, c.text, m.kb_id, m.doc_id, d.title AS doc_title,\n` +
        `       m.version_id, dv.version_label, dv.published_at,\n` +
        `       m.heading, m.section, m.start_line, m.end_line\n` +
        `  FROM ${KB_CHUNKS_TABLE} c\n` +
        `  ${metaJoin}\n` +
        ` WHERE (${likeClause})${kbFilter.sql}${docFilter.sql}${versionFilter.sql}\n` +
        ` ORDER BY dv.published_at DESC, m.start_line ASC\n` +
        ` LIMIT ?`,
    )
    .all(
      ...likeParams,
      ...kbFilter.params,
      ...docFilter.params,
      ...versionFilter.params,
      params.limit,
    ) as RawKbRow[];
  return rows.map((row) => mapRawRow(row, { vectorScore: 0, textScore: 0.4, score: 0.4 }));
}

export function listCurrentKnowledgeChunks(params: {
  db: DatabaseSync;
  kbIds: string[];
  limit: number;
  versionId?: string;
  docId?: string;
}): KbRetrieveHit[] {
  if (params.kbIds.length === 0 || params.limit <= 0) {
    return [];
  }
  const kbFilter = buildKbIdFilter(params.kbIds);
  const docFilter = buildDocIdFilter(params.docId);
  const versionFilter = buildVersionIdFilter(params.versionId);
  const currentVersionOnly = !params.versionId?.trim();
  const metaJoin = buildMetaJoin(currentVersionOnly);
  const rows = params.db
    .prepare(
      `SELECT c.id AS chunk_id, c.text, m.kb_id, m.doc_id, d.title AS doc_title,\n` +
        `       m.version_id, dv.version_label, dv.published_at,\n` +
        `       m.heading, m.section, m.start_line, m.end_line\n` +
        `  FROM ${KB_CHUNKS_TABLE} c\n` +
        `  ${metaJoin}\n` +
        ` WHERE 1 = 1${kbFilter.sql}${docFilter.sql}${versionFilter.sql}\n` +
        ` ORDER BY dv.published_at DESC, m.start_line ASC\n` +
        ` LIMIT ?`,
    )
    .all(
      ...kbFilter.params,
      ...docFilter.params,
      ...versionFilter.params,
      params.limit,
    ) as RawKbRow[];
  return rows.map((row) => mapRawRow(row, { vectorScore: 0, textScore: 0.2, score: 0.2 }));
}

export function searchKnowledgeKeyword(params: {
  db: DatabaseSync;
  ftsAvailable: boolean;
  query: string;
  kbIds: string[];
  model: string | null;
  limit: number;
  versionId?: string;
  docId?: string;
}): KbRetrieveHit[] {
  if (!params.ftsAvailable || params.limit <= 0 || params.kbIds.length === 0) {
    return [];
  }
  const andQuery = buildFtsQuery(params.query, "AND");
  const orQuery = buildFtsQuery(params.query, "OR");
  if (!andQuery) {
    return [];
  }

  const matchParams = {
    db: params.db,
    kbIds: params.kbIds,
    model: params.model,
    limit: params.limit,
    versionId: params.versionId,
    docId: params.docId,
  };
  const tryMatch = (ftsQuery: string, model: string | null): KbRetrieveHit[] => {
    try {
      return runKnowledgeKeywordMatch({ ...matchParams, model, ftsQuery });
    } catch {
      return [];
    }
  };
  const andHits = tryMatch(andQuery, params.model);
  if (andHits.length > 0) {
    return andHits;
  }
  if (orQuery && orQuery !== andQuery) {
    const orHits = tryMatch(orQuery, params.model);
    if (orHits.length > 0) {
      return orHits;
    }
  }
  if (params.model) {
    const unfiltered = tryMatch(andQuery, null);
    if (unfiltered.length > 0) {
      return unfiltered;
    }
  }
  return searchKnowledgeTitleOrText({
    db: params.db,
    query: params.query,
    kbIds: params.kbIds,
    limit: params.limit,
    versionId: params.versionId,
    docId: params.docId,
  });
}

export function searchKnowledgeVector(params: {
  db: DatabaseSync;
  vectorAvailable: boolean;
  queryVec: number[];
  kbIds: string[];
  model: string;
  limit: number;
  versionId?: string;
  docId?: string;
}): KbRetrieveHit[] {
  if (!params.vectorAvailable || params.queryVec.length === 0 || params.limit <= 0) {
    return [];
  }
  if (params.kbIds.length === 0) {
    return [];
  }

  ensureKnowledgeVectorTable(params.db, params.queryVec.length);
  const kbFilter = buildKbIdFilter(params.kbIds);
  const docFilter = buildDocIdFilter(params.docId);
  const versionFilter = buildVersionIdFilter(params.versionId);
  const currentVersionOnly = !params.versionId?.trim();
  const metaJoin = buildMetaJoin(currentVersionOnly);

  const rows = params.db
    .prepare(
      `SELECT c.id AS chunk_id, c.text, m.kb_id, m.doc_id, d.title AS doc_title,\n` +
        `       m.version_id, dv.version_label, dv.published_at,\n` +
        `       m.heading, m.section, m.start_line, m.end_line,\n` +
        `       vec_distance_cosine(v.embedding, ?) AS dist\n` +
        `  FROM ${KB_VECTOR_TABLE} v\n` +
        `  JOIN ${KB_CHUNKS_TABLE} c ON c.id = v.id\n` +
        `  ${metaJoin}\n` +
        ` WHERE c.model = ?${kbFilter.sql}${docFilter.sql}${versionFilter.sql}\n` +
        ` ORDER BY dist ASC\n` +
        ` LIMIT ?`,
    )
    .all(
      vectorToBlob(params.queryVec),
      params.model,
      ...kbFilter.params,
      ...docFilter.params,
      ...versionFilter.params,
      params.limit,
    ) as Array<RawKbRow & { dist: number }>;

  return rows.map((row) => {
    const vectorScore = 1 - row.dist;
    return mapRawRow(row, { vectorScore, textScore: 0, score: vectorScore });
  });
}

export async function retrieveKnowledgeFromIndex(
  params: RetrieveKnowledgeIndexParams,
): Promise<KbRetrieveHit[]> {
  const kbIds = [...new Set(params.kbIds.filter(Boolean))];
  if (kbIds.length === 0) {
    return [];
  }

  const maxResults = params.maxResults ?? DEFAULT_MAX_RESULTS;
  const minScore = params.minScore ?? 0;
  const governanceAware = params.governanceAware !== false;
  const candidateLimit = Math.max(
    maxResults,
    maxResults * (params.candidateMultiplier ?? DEFAULT_CANDIDATE_MULTIPLIER),
  );
  const hybridEnabled = params.hybridEnabled !== false;
  const vectorWeight = params.vectorWeight ?? 0.7;
  const textWeight = params.textWeight ?? 0.3;
  const keywordHits = searchKnowledgeKeyword({
    db: params.index.db,
    ftsAvailable: params.index.ftsAvailable,
    query: params.query,
    kbIds,
    model: null,
    limit: candidateLimit,
    versionId: params.versionId,
    docId: params.docId,
  });

  const finish = (hits: KbRetrieveHit[]) => {
    const finalized = finalizeKbRetrieveHits({
      db: params.index.db,
      hits,
      maxResults,
      minScore,
      governanceAware,
    });
    if (finalized.length > 0 || !params.fallbackToCurrentChunks) {
      return finalized;
    }
    return finalizeKbRetrieveHits({
      db: params.index.db,
      hits: listCurrentKnowledgeChunks({
        db: params.index.db,
        kbIds,
        limit: maxResults,
        versionId: params.versionId,
        docId: params.docId,
      }),
      maxResults,
      minScore,
      governanceAware,
    });
  };

  if (!params.embeddingProvider) {
    return finish(keywordHits);
  }

  let vectorHits: KbRetrieveHit[] = [];
  try {
    const queryVec = await params.embeddingProvider.embedQuery(params.query);
    vectorHits = searchKnowledgeVector({
      db: params.index.db,
      vectorAvailable: params.index.vectorAvailable,
      queryVec,
      kbIds,
      model: params.embeddingProvider.model,
      limit: candidateLimit,
      versionId: params.versionId,
      docId: params.docId,
    });
  } catch {
    // Keyword hits stay usable when the embedding provider is down.
  }

  if (!hybridEnabled || !params.index.ftsAvailable) {
    return finish(dedupeByChunkId([...vectorHits, ...keywordHits]));
  }

  const merged = await mergeHybridResults({
    vector: vectorHits.map((hit) => ({
      id: hit.chunkId,
      path: hit.docId,
      startLine: hit.startLine,
      endLine: hit.endLine,
      source: hit.kbId,
      snippet: hit.chunkText,
      vectorScore: hit.vectorScore,
    })),
    keyword: keywordHits.map((hit) => ({
      id: hit.chunkId,
      path: hit.docId,
      startLine: hit.startLine,
      endLine: hit.endLine,
      source: hit.kbId,
      snippet: hit.chunkText,
      textScore: hit.textScore,
    })),
    vectorWeight,
    textWeight,
  });

  const hitByKey = new Map<string, KbRetrieveHit>();
  for (const hit of [...vectorHits, ...keywordHits]) {
    hitByKey.set(`${hit.kbId}:${hit.docId}:${hit.startLine}:${hit.endLine}`, hit);
  }

  const hybridHits = merged
    .map((entry) => {
      const base = hitByKey.get(
        `${entry.source}:${entry.path}:${entry.startLine}:${entry.endLine}`,
      );
      if (!base) {
        return null;
      }
      return {
        ...base,
        chunkText: entry.snippet || base.chunkText,
        score: entry.score,
        vectorScore: entry.score,
        textScore: entry.score,
      } satisfies KbRetrieveHit;
    })
    .filter((entry): entry is KbRetrieveHit => entry !== null);

  return finish(hybridHits);
}

function dedupeByChunkId(hits: KbRetrieveHit[]): KbRetrieveHit[] {
  const byId = new Map<string, KbRetrieveHit>();
  for (const hit of hits) {
    const existing = byId.get(hit.chunkId);
    if (!existing || hit.score > existing.score) {
      byId.set(hit.chunkId, hit);
    }
  }
  return [...byId.values()];
}

export function buildKnowledgeEvidenceUri(params: {
  kbId: string;
  docId: string;
  versionId: string;
  section?: string | null;
}): string {
  const anchor =
    params.section && params.section.trim() ? `#${encodeURIComponent(params.section.trim())}` : "";
  return `ku://kb/${params.kbId}/doc/${params.docId}@${params.versionId}${anchor}`;
}

export type KnowledgeEvidenceUriParts = {
  kbId: string;
  docId: string;
  versionId: string;
  section?: string;
};

export function parseKnowledgeEvidenceUri(uri: string): KnowledgeEvidenceUriParts | null {
  const trimmed = uri.trim();
  const match = /^ku:\/\/kb\/([^/]+)\/doc\/([^@#]+)@([^#]+)(?:#(.*))?$/.exec(trimmed);
  if (!match) {
    return null;
  }
  try {
    const kbId = decodeURIComponent(match[1] ?? "").trim();
    const docId = decodeURIComponent(match[2] ?? "").trim();
    const versionId = decodeURIComponent(match[3] ?? "").trim();
    if (!kbId || !docId || !versionId) {
      return null;
    }
    const sectionRaw = match[4];
    const section =
      sectionRaw != null && sectionRaw.length > 0 ? decodeURIComponent(sectionRaw).trim() : "";
    return {
      kbId,
      docId,
      versionId,
      ...(section ? { section } : {}),
    };
  } catch {
    return null;
  }
}

export function kbRetrieveHitToEvidence(hit: KbRetrieveHit, kbTitle?: string): KnowledgeEvidence {
  return {
    sourceKind: "knowledge",
    chunkId: hit.chunkId,
    docId: hit.docId,
    docTitle: hit.docTitle,
    kbId: hit.kbId,
    ...(kbTitle ? { kbTitle } : undefined),
    versionId: hit.versionId,
    versionLabel: hit.versionLabel,
    publishedAt: hit.publishedAt,
    score: hit.score,
    chunkText: hit.chunkText,
    ...(hit.heading ? { heading: hit.heading } : undefined),
    ...(hit.section ? { section: hit.section } : undefined),
    ...(hit.governanceStatus ? { governanceStatus: hit.governanceStatus } : undefined),
    ...(hit.governanceConflict ? { governanceConflict: true } : undefined),
    ...(hit.governanceClaimConflict ? { governanceClaimConflict: true } : undefined),
    sourceUri: buildKnowledgeEvidenceUri({
      kbId: hit.kbId,
      docId: hit.docId,
      versionId: hit.versionId,
      section: hit.section,
    }),
  };
}
