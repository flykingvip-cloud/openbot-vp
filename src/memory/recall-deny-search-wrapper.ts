import {
  extractMemorySearchDenyMeta,
  filterSearchHitsByDeny,
  loadRecallDenySets,
} from "./recall-deny-filter.js";
/**
 * Production wrapper: every MemorySearchManager.search applies recall-deny (B6).
 */
import type {
  MemoryEmbeddingProbeResult,
  MemorySearchManager,
  MemorySearchResult,
  MemorySyncProgressUpdate,
} from "./types.js";

export class RecallDenyMemorySearchManager implements MemorySearchManager {
  constructor(
    private readonly inner: MemorySearchManager,
    private readonly dataRoot: string | null,
  ) {}

  async search(
    query: string,
    opts?: { maxResults?: number; minScore?: number; sessionKey?: string },
  ): Promise<MemorySearchResult[]> {
    const results = await this.inner.search(query, opts);
    if (!this.dataRoot || results.length === 0) {
      return results;
    }
    const sets = await loadRecallDenySets(this.dataRoot);
    return filterSearchHitsByDeny(results, sets, extractMemorySearchDenyMeta);
  }

  readFile(params: { relPath: string; from?: number; lines?: number }) {
    return this.inner.readFile(params);
  }

  status() {
    return this.inner.status();
  }

  async sync(params?: {
    reason?: string;
    force?: boolean;
    progress?: (update: MemorySyncProgressUpdate) => void;
  }) {
    await this.inner.sync?.(params);
  }

  probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult> {
    return this.inner.probeEmbeddingAvailability();
  }

  probeVectorAvailability(): Promise<boolean> {
    return this.inner.probeVectorAvailability();
  }

  async close(): Promise<void> {
    await this.inner.close?.();
  }

  async applyTranscriptSourceLifecycle(
    input: Parameters<NonNullable<MemorySearchManager["applyTranscriptSourceLifecycle"]>>[0],
  ): Promise<{ ok: boolean; skipped?: boolean; error?: string; status?: string }> {
    return (
      (await this.inner.applyTranscriptSourceLifecycle?.(input)) ?? {
        ok: true,
        skipped: true,
        status: "unsupported",
      }
    );
  }

  async applyMemoryArtifactLifecycle(
    input: Parameters<NonNullable<MemorySearchManager["applyMemoryArtifactLifecycle"]>>[0],
  ): Promise<{ ok: boolean; applied: string[]; skipped: boolean; error?: string }> {
    return (
      (await this.inner.applyMemoryArtifactLifecycle?.(input)) ?? {
        ok: true,
        applied: [],
        skipped: true,
      }
    );
  }
}

export function wrapMemorySearchManagerWithRecallDeny(
  manager: MemorySearchManager | null,
  dataRoot: string | null,
): MemorySearchManager | null {
  if (!manager) {
    return null;
  }
  if (!dataRoot) {
    return manager;
  }
  if (manager instanceof RecallDenyMemorySearchManager) {
    return manager;
  }
  return new RecallDenyMemorySearchManager(manager, dataRoot);
}
