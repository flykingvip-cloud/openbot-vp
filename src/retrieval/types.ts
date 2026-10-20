/**
 * Retrieval Platform — shared contracts.
 *
 * This module is intentionally domain-agnostic: knowledge bases, agent memory,
 * deliverables/artifacts, web and database search all implement {@link RetrievalSource}
 * and mount onto the {@link KnowledgeRetrievalService}. Higher layers (RPC, agent
 * prompt injection) depend only on these contracts, never on a concrete source.
 */

/** Caller identity + scope used for permission-aware retrieval. */
export type RetrievalContext = {
  userId: string | null;
  seatId: string | null;
  tenantId: string | null;
  departmentId?: string | null;
  roleCodes?: string[];
  /** Bound robot/agent id — used for knowledgeBase.robotIds reads. */
  agentId?: string | null;
  /**
   * Reserved for document/section-level visibility. Only knowledge-base-level
   * scoping is enforced in the current phase; finer scopes are schema-reserved.
   */
  accessibleScopes?: string[];
};

export type RetrievalSourceKind = "knowledge" | "memory" | "artifact" | "web" | "database";

/** A single retrieved, citable piece of evidence (version + provenance aware). */
export type KnowledgeEvidence = {
  sourceKind: RetrievalSourceKind;
  chunkId?: string;
  docId: string;
  docTitle: string;
  kbId: string;
  kbTitle?: string;
  versionId: string;
  versionLabel?: string;
  publishedAt?: number;
  score: number;
  chunkText: string;
  heading?: string;
  section?: string;
  /** Stable citation URI, e.g. ku://kb/<kbId>/doc/<docId>@<versionId>#<section> */
  sourceUri: string;
  governanceStatus?: "pending" | "confirmed" | "merged" | "archived" | "suppressed";
  governanceConflict?: boolean;
  governanceClaimConflict?: boolean;
};

export type RetrievalOpts = {
  maxResults?: number;
  minScore?: number;
  /** Restrict to specific knowledge bases (after visibility resolution). */
  kbScope?: string[];
  /** When set, search chunks for this document version (includes non-current versions). */
  versionId?: string;
  /** Restrict retrieval to a single document id. */
  docId?: string;
  /**
   * When the caller already authorized a kbScope (explicit consume), empty FTS
   * may fall back to current-version chunks instead of returning nothing.
   */
  fallbackToCurrentChunks?: boolean;
};

/** Empty FTS is allowed only when a document id is already scoped and fallback is on. */
export function allowsEmptyRetrievalQuery(opts?: RetrievalOpts): boolean {
  return Boolean(opts?.docId?.trim() && opts.fallbackToCurrentChunks);
}

/** A mountable retrieval backend (knowledge base, memory, artifacts, web, ...). */
export interface RetrievalSource {
  readonly id: RetrievalSourceKind;
  search(query: string, ctx: RetrievalContext, opts?: RetrievalOpts): Promise<KnowledgeEvidence[]>;
}

/** Unified retrieval platform: mounts sources and federates queries. */
export interface KnowledgeRetrievalService {
  registerSource(source: RetrievalSource): void;
  listSources(): RetrievalSourceKind[];
  search(query: string, ctx: RetrievalContext, opts?: RetrievalOpts): Promise<KnowledgeEvidence[]>;
  // Reserved for later phases: synthesize(evidence, budget), retrieve(docId, ctx), cite(evidence).
}

export const DEFAULT_MAX_RESULTS = 8;
