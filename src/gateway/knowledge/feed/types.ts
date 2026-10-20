import type { KnowledgeAccessState, KnowledgeObjectKind, KnowledgeSource } from "../types.js";

export type KnowledgeFeedFreshnessStatus = "fresh" | "stale" | "expired";

/** Standardized feed item for enterprise / data supply (M4 adapters extend this). */
export type KnowledgeFeedItem = {
  objectId: string;
  source: Extract<KnowledgeSource, "enterprise" | "data">;
  title: string;
  kind: KnowledgeObjectKind;
  summary: string;
  category: string;
  sourceSystems: string[];
  scopeLabel: string;
  maskingSummary: string;
  projectionId?: string;
  capabilityId?: string;
  visibilityPolicyId?: string;
  lineageId?: string;
  traceRefs?: string[];
  freshnessStatus?: KnowledgeFeedFreshnessStatus;
  /** Copied from the enterprise feed item. Partial stays visible to consumers. */
  publication?: "complete" | "partial";
  accessState: KnowledgeAccessState;
  generatedAt: number;
};

export type KnowledgeFeedBundle = {
  feedItems: KnowledgeFeedItem[];
  objects: import("../types.js").KnowledgeObject[];
};
