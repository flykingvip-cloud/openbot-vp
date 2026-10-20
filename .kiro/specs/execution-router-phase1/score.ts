import type { CatalogEntry, ScoredCandidate, TaskEnvelope } from "./types.ts";

/** Declared design constants. Not fitted from the P2-C 20-sample baseline. */
export const SCORE_WEIGHTS = Object.freeze({
  classMatch: 0.5,
  tagOverlap: 0.3,
  riskAlign: 0.2,
});

export const LOW_CONFIDENCE_TOP1 = 0.55;
export const LOW_CONFIDENCE_GAP = 0.08;
export const DEFAULT_K = 8;

export function tagOverlap(envelope: TaskEnvelope, entry: CatalogEntry): number {
  const tags = envelope.tagDigests ?? [];
  if (tags.length === 0 || entry.tagDigests.length === 0) {
    return 0;
  }
  const wanted = new Set(tags);
  const hits = entry.tagDigests.filter((tag) => wanted.has(tag)).length;
  return hits / Math.max(tags.length, entry.tagDigests.length);
}

export function classMatch(envelope: TaskEnvelope, kind: "skill" | "tool"): number {
  if (envelope.taskClass === "unknown") {
    return 0;
  }
  if (kind === "skill") {
    return envelope.taskClass === "skill_dense_readonly" ? 1 : 0.25;
  }
  return envelope.taskClass === "plain_text_qa" ? 0.15 : 1;
}

export function riskAlign(envelope: TaskEnvelope, entry: CatalogEntry): number {
  if (envelope.riskClass === "unknown") {
    return 0.5;
  }
  if (envelope.riskClass === "read_only") {
    return entry.sideEffect ? 0 : 1;
  }
  return 0.5;
}

export function scoreEntry(
  envelope: TaskEnvelope,
  entry: CatalogEntry,
  kind: "skill" | "tool",
): number {
  const raw =
    SCORE_WEIGHTS.classMatch * classMatch(envelope, kind) +
    SCORE_WEIGHTS.tagOverlap * tagOverlap(envelope, entry) +
    SCORE_WEIGHTS.riskAlign * riskAlign(envelope, entry);
  return Math.max(0, Math.min(1, raw));
}

export function rankCandidates(
  envelope: TaskEnvelope,
  catalog: CatalogEntry[],
  kind: "skill" | "tool",
  k = DEFAULT_K,
): ScoredCandidate[] {
  return catalog
    .map((entry) => ({
      nameDigest: entry.nameDigest,
      score: scoreEntry(envelope, entry, kind),
      rank: 0,
    }))
    .toSorted(
      (left, right) => right.score - left.score || left.nameDigest.localeCompare(right.nameDigest),
    )
    .slice(0, k)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function confidenceOf(candidates: ScoredCandidate[]): number {
  if (candidates.length === 0) {
    return 0;
  }
  const top1 = candidates[0]?.score ?? 0;
  const top2 = candidates[1]?.score ?? 0;
  if (top1 < LOW_CONFIDENCE_TOP1 || top1 - top2 < LOW_CONFIDENCE_GAP) {
    return top1 * 0.5;
  }
  return top1;
}
