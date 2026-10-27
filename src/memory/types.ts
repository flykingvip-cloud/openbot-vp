export type MemorySource = "memory" | "sessions";

export type MemorySearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: MemorySource;
  citation?: string;
  explainability?: {
    whySummary: string;
    matchedPatterns: string[];
    supportingAtoms: string[];
    selectedPathIds?: string[];
    pathSummaries?: string[];
    evidenceRefs: string[];
  };
  evidence?: Array<{
    id: string;
    uri: string;
    snippet: string;
    trustScore: number;
  }>;
};

export type MemoryEmbeddingProbeResult = {
  ok: boolean;
  error?: string;
};

export type MemorySyncProgressUpdate = {
  completed: number;
  total: number;
  label?: string;
};

export type MemoryProviderStatus = {
  backend: "builtin" | "qmd" | "cogniweave";
  provider: string;
  model?: string;
  requestedProvider?: string;
  files?: number;
  chunks?: number;
  dirty?: boolean;
  workspaceDir?: string;
  dbPath?: string;
  extraPaths?: string[];
  sources?: MemorySource[];
  sourceCounts?: Array<{ source: MemorySource; files: number; chunks: number }>;
  cache?: { enabled: boolean; entries?: number; maxEntries?: number };
  fts?: { enabled: boolean; available: boolean; error?: string };
  fallback?: { from: string; reason?: string };
  vector?: {
    enabled: boolean;
    available?: boolean;
    extensionPath?: string;
    loadError?: string;
    dims?: number;
  };
  batch?: {
    enabled: boolean;
    failures: number;
    limit: number;
    wait: boolean;
    concurrency: number;
    pollIntervalMs: number;
    timeoutMs: number;
    lastError?: string;
    lastProvider?: string;
  };
  custom?: Record<string, unknown>;
};

export interface MemorySearchManager {
  search(
    query: string,
    opts?: { maxResults?: number; minScore?: number; sessionKey?: string },
  ): Promise<MemorySearchResult[]>;
  readFile(params: {
    relPath: string;
    from?: number;
    lines?: number;
  }): Promise<{ text: string; path: string }>;
  status(): MemoryProviderStatus;
  sync?(params?: {
    reason?: string;
    force?: boolean;
    progress?: (update: MemorySyncProgressUpdate) => void;
  }): Promise<void>;
  probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult>;
  probeVectorAvailability(): Promise<boolean>;
  close?(): Promise<void>;
  /**
   * Optional CogniWeave / transcript source lifecycle (archive/restore/forget/purge).
   * Absent on backends that do not own sealed source identities.
   */
  applyTranscriptSourceLifecycle?(input: {
    mode: "archive" | "restore" | "purge" | "forget";
    sourceIdentityId?: string;
    sourceLocator?: string;
    operationId: string;
    reasonCode?: string;
  }): Promise<{ ok: boolean; skipped?: boolean; error?: string; status?: string }>;
  /**
   * Forget/purge memory artifacts that are already indexed in canonical (no speculative bindings).
   * Data Space file deletion stays in `src/data/memory-lifecycle.ts`.
   */
  applyMemoryArtifactLifecycle?(input: {
    memoryKey: string;
    operationId: string;
    reasonCode?: string;
    /** When true, also purge after forget (hard delete). Default true. */
    purgeAfterForget?: boolean;
  }): Promise<{
    ok: boolean;
    applied: string[];
    skipped: boolean;
    error?: string;
  }>;
  /**
   * Optional CogniWeave Memory Center atom listing (ACL + lifecycle gated).
   * Absent on non-CogniWeave backends.
   */
  listMemoryCenterAtoms?(opts?: { limit?: number }): Promise<
    Array<{
      id: string;
      summary: string;
      atomType: string;
      whyHint?: string;
      scope: {
        kind: "agent" | "space" | "group";
        visibility: "private" | "shared";
        agentId?: string;
        spaceId?: string;
        groupKey?: string;
      };
      botId: string;
      privacyLevel?: "private" | "shared" | "org" | "public";
      syncEligible: boolean;
      shared: boolean;
      status: string;
      updatedAtMs: number;
      confidence?: number;
    }>
  >;
  /**
   * O4 isolated readonly foundation — optional; absent on non-CogniWeave backends.
   * See `memory-center-o4-readonly.ts`. Wired via data.memory.list statusView.
   */
  listMemoryCenterAtomsReadonly?(opts?: {
    statusView?: "active" | "tentative";
    limit?: number;
  }): Promise<import("./memory-center-o4-readonly.js").MemoryCenterReadonlyListResult>;
}
