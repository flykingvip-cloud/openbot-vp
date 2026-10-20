import type { DatabaseSync } from "node:sqlite";
import { bm25RankToScore, buildFtsQuery } from "../../../../memory/hybrid.js";
import {
  KB_CHUNKS_TABLE,
  KB_CHUNK_META_TABLE,
  KB_FTS_TABLE,
  KB_VECTOR_TABLE,
} from "../../kb-index-schema.js";

export type ChunkPeerCandidate = {
  chunkId: string;
  text: string;
  recallScore: number;
  recallSource: "vector" | "fts";
};

export type ChunkPeerRecallBudget = {
  maxSimilarityQueries: number;
  similarityQueriesUsed: number;
};

const DEFAULT_PEER_LIMIT = 12;
const DEFAULT_MIN_COSINE = 0.82;

function vectorToBlob(embedding: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(embedding) ? embedding : Buffer.from(embedding);
}

export function isChunkVectorRecallAvailable(db: DatabaseSync): boolean {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${KB_VECTOR_TABLE}`).get() as {
      count: number;
    };
    return row.count > 0;
  } catch {
    return false;
  }
}

function isFtsRecallAvailable(db: DatabaseSync): boolean {
  try {
    db.prepare(`SELECT id FROM ${KB_FTS_TABLE} LIMIT 1`).get();
    return true;
  } catch {
    return false;
  }
}

function recallVectorPeers(params: {
  db: DatabaseSync;
  kbId: string;
  chunkId: string;
  limit: number;
  minCosine: number;
}): ChunkPeerCandidate[] {
  const source = params.db
    .prepare(`SELECT embedding FROM ${KB_VECTOR_TABLE} WHERE id = ?`)
    .get(params.chunkId) as { embedding: Buffer } | undefined;
  if (!source?.embedding) {
    return [];
  }
  const rows = params.db
    .prepare(
      `SELECT c.id AS chunk_id, c.text,
              vec_distance_cosine(v.embedding, ?) AS dist
       FROM ${KB_VECTOR_TABLE} v
       JOIN ${KB_CHUNKS_TABLE} c ON c.id = v.id
       JOIN ${KB_CHUNK_META_TABLE} m ON m.chunk_id = c.id
       WHERE m.kb_id = ? AND c.id != ?
       ORDER BY dist ASC
       LIMIT ?`,
    )
    .all(vectorToBlob(source.embedding), params.kbId, params.chunkId, params.limit) as Array<{
    chunk_id: string;
    text: string;
    dist: number;
  }>;
  return rows
    .map((row) => ({
      chunkId: row.chunk_id,
      text: row.text,
      recallScore: 1 - row.dist,
      recallSource: "vector" as const,
    }))
    .filter((row) => row.recallScore >= params.minCosine);
}

function recallFtsPeers(params: {
  db: DatabaseSync;
  kbId: string;
  chunkId: string;
  text: string;
  limit: number;
}): ChunkPeerCandidate[] {
  const ftsQuery = buildFtsQuery(params.text.slice(0, 240));
  if (!ftsQuery) {
    return [];
  }
  const rows = params.db
    .prepare(
      `SELECT c.id AS chunk_id, c.text, bm25(${KB_FTS_TABLE}) AS rank
       FROM ${KB_FTS_TABLE} f
       JOIN ${KB_CHUNKS_TABLE} c ON c.id = f.id
       JOIN ${KB_CHUNK_META_TABLE} m ON m.chunk_id = c.id
       WHERE ${KB_FTS_TABLE} MATCH ? AND m.kb_id = ? AND c.id != ?
       ORDER BY rank ASC
       LIMIT ?`,
    )
    .all(ftsQuery, params.kbId, params.chunkId, params.limit) as Array<{
    chunk_id: string;
    text: string;
    rank: number;
  }>;
  return rows.map((row) => ({
    chunkId: row.chunk_id,
    text: row.text,
    recallScore: bm25RankToScore(row.rank),
    recallSource: "fts" as const,
  }));
}

export function recallChunkPeers(params: {
  db: DatabaseSync;
  kbId: string;
  chunkId: string;
  text: string;
  limit?: number;
  minCosineSimilarity?: number;
  budget?: ChunkPeerRecallBudget;
}): ChunkPeerCandidate[] {
  const limit = params.limit ?? DEFAULT_PEER_LIMIT;
  const minCosine = params.minCosineSimilarity ?? DEFAULT_MIN_COSINE;
  const peers = new Map<string, ChunkPeerCandidate>();

  const canQueryVector =
    isChunkVectorRecallAvailable(params.db) &&
    (!params.budget || params.budget.similarityQueriesUsed < params.budget.maxSimilarityQueries);

  if (canQueryVector) {
    if (params.budget) {
      params.budget.similarityQueriesUsed += 1;
    }
    for (const peer of recallVectorPeers({
      db: params.db,
      kbId: params.kbId,
      chunkId: params.chunkId,
      limit,
      minCosine,
    })) {
      peers.set(peer.chunkId, peer);
    }
  }

  if (peers.size < limit && isFtsRecallAvailable(params.db)) {
    for (const peer of recallFtsPeers({
      db: params.db,
      kbId: params.kbId,
      chunkId: params.chunkId,
      text: params.text,
      limit,
    })) {
      const existing = peers.get(peer.chunkId);
      if (!existing || peer.recallScore > existing.recallScore) {
        peers.set(peer.chunkId, peer);
      }
    }
  }

  return [...peers.values()]
    .toSorted((left, right) => right.recallScore - left.recallScore)
    .slice(0, limit);
}

export function recallApproximateDuplicatePeers(params: {
  db: DatabaseSync;
  kbId: string;
  chunkId: string;
  text: string;
  budget?: ChunkPeerRecallBudget;
  minCosineSimilarity?: number;
}): ChunkPeerCandidate[] {
  return recallChunkPeers({
    db: params.db,
    kbId: params.kbId,
    chunkId: params.chunkId,
    text: params.text,
    limit: 8,
    minCosineSimilarity: params.minCosineSimilarity ?? 0.95,
    budget: params.budget,
  });
}
