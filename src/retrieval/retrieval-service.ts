/**
 * Knowledge Retrieval Service — the platform orchestrator.
 *
 * Mounts one or more {@link RetrievalSource}s and federates a query across them,
 * merging results into a single ranked {@link KnowledgeEvidence} list. Later phases
 * will add rerank()/synthesize() refinement; for now ordering is score-descending.
 */
import {
  allowsEmptyRetrievalQuery,
  DEFAULT_MAX_RESULTS,
  type KnowledgeEvidence,
  type KnowledgeRetrievalService,
  type RetrievalContext,
  type RetrievalOpts,
  type RetrievalSource,
  type RetrievalSourceKind,
} from "./types.js";

class RetrievalService implements KnowledgeRetrievalService {
  private readonly sources = new Map<RetrievalSourceKind, RetrievalSource>();

  registerSource(source: RetrievalSource): void {
    this.sources.set(source.id, source);
  }

  listSources(): RetrievalSourceKind[] {
    return [...this.sources.keys()];
  }

  async search(
    query: string,
    ctx: RetrievalContext,
    opts?: RetrievalOpts,
  ): Promise<KnowledgeEvidence[]> {
    const trimmed = query.trim();
    if (this.sources.size === 0) {
      return [];
    }
    if (!trimmed && !allowsEmptyRetrievalQuery(opts)) {
      return [];
    }
    const maxResults = opts?.maxResults ?? DEFAULT_MAX_RESULTS;
    const minScore = opts?.minScore ?? 0;

    const perSource = await Promise.all(
      [...this.sources.values()].map(async (source) => {
        try {
          return await source.search(trimmed, ctx, opts);
        } catch {
          // A single failing source must never break federated retrieval.
          return [] as KnowledgeEvidence[];
        }
      }),
    );

    const bySourceUri = new Map<string, KnowledgeEvidence>();
    for (const evidence of perSource.flat()) {
      if (evidence.score < minScore) {
        continue;
      }
      const existing = bySourceUri.get(evidence.sourceUri);
      if (!existing || evidence.score > existing.score) {
        bySourceUri.set(evidence.sourceUri, evidence);
      }
    }

    return [...bySourceUri.values()].toSorted((a, b) => b.score - a.score).slice(0, maxResults);
  }
}

let singleton: RetrievalService | null = null;

export function getKnowledgeRetrievalService(): KnowledgeRetrievalService {
  singleton ??= new RetrievalService();
  return singleton;
}

/** Test seam: drop the singleton so each test starts from a clean platform. */
export function resetKnowledgeRetrievalServiceForTests(): void {
  singleton = null;
}
