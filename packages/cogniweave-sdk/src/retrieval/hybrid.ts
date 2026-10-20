import type { MemoryAtom, RelationRecord } from "../models.js";

/**
 * CW2-P4-02 hybrid retrieval — lexical FTS + optional vector + relation boost.
 * Pure helpers; engine owns ACL/lifecycle gates.
 */

export type HybridChannelScores = {
  fts: number;
  vector?: number;
  graphBoost?: number;
};

export type HybridScoredAtom = {
  atomId: string;
  score: number;
  channels: HybridChannelScores;
  matchedTokens: string[];
};

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 || /[\u4e00-\u9fff]/.test(token));
}

/** Lexical FTS score over atom claim/trigger/applicability text. */
export function scoreAtomLexical(
  query: string,
  atom: MemoryAtom,
): { score: number; matchedTokens: string[] } {
  const tokens = [...new Set(tokenize(query))];
  if (tokens.length === 0) {
    return { score: 0, matchedTokens: [] };
  }
  const haystack = [
    atom.claim.statement,
    atom.atomType,
    ...atom.trigger.conditions,
    ...atom.trigger.contextTags,
    ...atom.applicability.include,
  ]
    .join("\n")
    .toLowerCase();
  const matchedTokens = tokens.filter((token) => haystack.includes(token));
  const normalizedQuery = query.trim().toLowerCase();
  const exactPhraseMatch = normalizedQuery.length >= 4 && haystack.includes(normalizedQuery);
  if (!exactPhraseMatch && matchedTokens.length === 0) {
    return { score: 0, matchedTokens: [] };
  }
  const coverage = matchedTokens.length / tokens.length;
  const score = Math.min(
    0.99,
    (exactPhraseMatch ? 0.45 : 0) + coverage * 0.5 + Math.min(0.15, atom.metrics.confidence * 0.15),
  );
  return { score, matchedTokens };
}

/** Lexical stub for VectorStore.search when embeddings are unavailable. */
export function scoreDocumentLexical(query: string, content: string): number {
  const tokens = [...new Set(tokenize(query))];
  if (tokens.length === 0 || !content.trim()) {
    return 0;
  }
  const haystack = content.toLowerCase();
  const hits = tokens.filter((token) => haystack.includes(token));
  if (hits.length === 0) {
    return 0;
  }
  return Math.min(0.95, hits.length / tokens.length);
}

/**
 * 1-hop graph boost: neighbors of seed atom ids via active relations.
 * Boost is additive (capped) — does not invent new candidates outside the pool.
 */
export function applyRelationBoost(params: {
  seedAtomIds: ReadonlyArray<string>;
  relations: ReadonlyArray<RelationRecord>;
  candidateAtomIds: ReadonlySet<string>;
  maxBoost?: number;
}): Map<string, number> {
  const maxBoost = params.maxBoost ?? 0.15;
  const seeds = new Set(params.seedAtomIds);
  const boosts = new Map<string, number>();
  for (const relation of params.relations) {
    if (relation.status !== "active") {
      continue;
    }
    const neighbor =
      seeds.has(relation.fromId) && params.candidateAtomIds.has(relation.toId)
        ? relation.toId
        : seeds.has(relation.toId) && params.candidateAtomIds.has(relation.fromId)
          ? relation.fromId
          : null;
    if (!neighbor || seeds.has(neighbor)) {
      continue;
    }
    const next = Math.min(
      maxBoost,
      (boosts.get(neighbor) ?? 0) + 0.05 + relation.confidence * 0.05,
    );
    boosts.set(neighbor, next);
  }
  return boosts;
}

/** Merge FTS / vector / graph channels into a single ranked list. */
export function mergeHybridScores(params: {
  fts: ReadonlyArray<{ atomId: string; score: number; matchedTokens: string[] }>;
  vector?: ReadonlyArray<{ atomId: string; score: number }>;
  graphBoost?: ReadonlyMap<string, number>;
  weights?: { fts: number; vector: number; graph: number };
}): HybridScoredAtom[] {
  const weights = params.weights ?? { fts: 0.65, vector: 0.25, graph: 0.1 };
  const byId = new Map<string, HybridScoredAtom>();

  for (const row of params.fts) {
    byId.set(row.atomId, {
      atomId: row.atomId,
      score: row.score * weights.fts,
      channels: { fts: row.score },
      matchedTokens: row.matchedTokens,
    });
  }
  for (const row of params.vector ?? []) {
    const existing = byId.get(row.atomId);
    if (existing) {
      existing.channels.vector = row.score;
      existing.score += row.score * weights.vector;
    } else if (row.score > 0) {
      byId.set(row.atomId, {
        atomId: row.atomId,
        score: row.score * weights.vector,
        channels: { fts: 0, vector: row.score },
        matchedTokens: [],
      });
    }
  }
  for (const [atomId, boost] of params.graphBoost ?? []) {
    const existing = byId.get(atomId);
    if (!existing) {
      continue;
    }
    existing.channels.graphBoost = boost;
    existing.score += boost * weights.graph;
  }

  return [...byId.values()].toSorted((left, right) => {
    const delta = right.score - left.score;
    if (delta !== 0) {
      return delta;
    }
    return left.atomId.localeCompare(right.atomId);
  });
}

export function rerankHybridHits(
  hits: ReadonlyArray<HybridScoredAtom>,
  opts?: { maxResults?: number; minScore?: number },
): HybridScoredAtom[] {
  const minScore = opts?.minScore ?? 0.05;
  const maxResults = opts?.maxResults ?? 10;
  return hits.filter((hit) => hit.score >= minScore).slice(0, maxResults);
}
