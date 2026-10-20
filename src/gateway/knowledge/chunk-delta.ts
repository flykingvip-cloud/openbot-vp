/**
 * P4 chunk-level delta: stable anchors + per-chunk hash patch rules.
 *
 * Anchor (stable across document versions):
 *   hash(kbId|docId|section|heading|ordinalWithinSection)
 *
 * Does NOT include versionId or textHash, so the same logical slot can be reused
 * when section structure is stable and only some chunk bodies change.
 */
import { hashText } from "../../memory/internal.js";
import type { HierarchicalChunk } from "./chunkers/hierarchical.js";

export type AnchoredChunk = HierarchicalChunk & {
  /** Stable id for the logical chunk slot (also used as chunk_id in the index). */
  anchorId: string;
  sectionKey: string;
  ordinal: number;
};

export type PreviousChunkSnapshot = {
  chunkId: string;
  text: string;
  textHash: string;
  model: string;
  heading: string | null;
  section: string | null;
  startLine: number;
  endLine: number;
  /** Derived the same way as AnchoredChunk.sectionKey + ordinal when possible. */
  sectionKey: string;
  ordinal: number;
  anchorId: string;
};

export type ChunkDeltaPlan = {
  keep: Array<{ prev: PreviousChunkSnapshot; next: AnchoredChunk }>;
  update: Array<{ prev: PreviousChunkSnapshot; next: AnchoredChunk }>;
  add: AnchoredChunk[];
  remove: PreviousChunkSnapshot[];
};

export function sectionKeyOf(heading: string | null, section: string | null): string {
  return `${section ?? ""}\u0000${heading ?? ""}`;
}

export function buildStableKnowledgeChunkAnchor(params: {
  kbId: string;
  docId: string;
  sectionKey: string;
  ordinal: number;
}): string {
  return `lfchk:${hashText(
    `${params.kbId}\0${params.docId}\0${params.sectionKey}\0${params.ordinal}`,
  ).slice(0, 40)}`;
}

/** Assign stable anchors to hierarchical chunks by section order. */
export function anchorHierarchicalChunks(params: {
  kbId: string;
  docId: string;
  chunks: HierarchicalChunk[];
}): AnchoredChunk[] {
  const ordinalBySection = new Map<string, number>();
  return params.chunks.map((chunk) => {
    const sectionKey = sectionKeyOf(chunk.heading, chunk.section);
    const ordinal = ordinalBySection.get(sectionKey) ?? 0;
    ordinalBySection.set(sectionKey, ordinal + 1);
    const anchorId = buildStableKnowledgeChunkAnchor({
      kbId: params.kbId,
      docId: params.docId,
      sectionKey,
      ordinal,
    });
    return {
      ...chunk,
      sectionKey,
      ordinal,
      anchorId,
    };
  });
}

/** Reconstruct anchors for previous version rows ordered by start_line. */
export function anchorPreviousChunkSnapshots(params: {
  kbId: string;
  docId: string;
  chunks: Array<{
    chunkId: string;
    text: string;
    model: string;
    heading: string | null;
    section: string | null;
    startLine: number;
    endLine: number;
  }>;
}): PreviousChunkSnapshot[] {
  const sorted = [...params.chunks].toSorted((a, b) => a.startLine - b.startLine);
  const ordinalBySection = new Map<string, number>();
  return sorted.map((chunk) => {
    const sectionKey = sectionKeyOf(chunk.heading, chunk.section);
    const ordinal = ordinalBySection.get(sectionKey) ?? 0;
    ordinalBySection.set(sectionKey, ordinal + 1);
    const anchorId = buildStableKnowledgeChunkAnchor({
      kbId: params.kbId,
      docId: params.docId,
      sectionKey,
      ordinal,
    });
    return {
      ...chunk,
      textHash: hashText(chunk.text),
      sectionKey,
      ordinal,
      anchorId,
    };
  });
}

/**
 * Plan keep / update / add / remove.
 * Match primary by anchorId; fallback by exact textHash (handles section renames that keep body).
 */
export function planChunkDelta(params: {
  previous: PreviousChunkSnapshot[];
  next: AnchoredChunk[];
  model: string;
}): ChunkDeltaPlan {
  const prevByAnchor = new Map(params.previous.map((item) => [item.anchorId, item]));
  const prevByHash = new Map<string, PreviousChunkSnapshot[]>();
  for (const item of params.previous) {
    const list = prevByHash.get(item.textHash) ?? [];
    list.push(item);
    prevByHash.set(item.textHash, list);
  }

  const usedPrev = new Set<string>();
  const keep: ChunkDeltaPlan["keep"] = [];
  const update: ChunkDeltaPlan["update"] = [];
  const add: AnchoredChunk[] = [];

  for (const next of params.next) {
    let prev = prevByAnchor.get(next.anchorId);
    if (prev && usedPrev.has(prev.chunkId)) {
      prev = undefined;
    }
    if (!prev) {
      // Fallback: exact text match free previous chunk (content moved slots).
      const candidates = prevByHash.get(next.hash) ?? [];
      prev = candidates.find((item) => !usedPrev.has(item.chunkId));
    }
    if (!prev) {
      add.push(next);
      continue;
    }
    usedPrev.add(prev.chunkId);
    const sameText = prev.textHash === next.hash;
    const sameModel = prev.model === params.model;
    if (sameText && sameModel) {
      keep.push({ prev, next });
    } else {
      update.push({ prev, next });
    }
  }

  const remove = params.previous.filter((item) => !usedPrev.has(item.chunkId));
  return { keep, update, add, remove };
}

export type ChunkDeltaStats = {
  kept: number;
  updated: number;
  added: number;
  removed: number;
  /** Chunks that need embedding (update + add). */
  embedCount: number;
};

export function summarizeChunkDelta(plan: ChunkDeltaPlan): ChunkDeltaStats {
  return {
    kept: plan.keep.length,
    updated: plan.update.length,
    added: plan.add.length,
    removed: plan.remove.length,
    embedCount: plan.update.length + plan.add.length,
  };
}
