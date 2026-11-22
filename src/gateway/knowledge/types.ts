import type { KnowledgeEvidence } from "../../retrieval/types.js";

export type KnowledgeSource = "personal" | "enterprise" | "data";

export type KnowledgeObjectKind =
  | "document"
  | "policy"
  | "template"
  | "project"
  | "contract"
  | "metric"
  | "insight";

export type RelationshipEdgeType =
  | "related"
  | "supports"
  | "conflicts"
  | "derived-from"
  | "archived-into"
  | "owned-by"
  | "used-by"
  | "recommended-for";

export type RelationshipNodeKind =
  | "knowledge-object"
  | "knowledge-base"
  | "deliverable"
  | "data-capability"
  | "agent"
  | "owner"
  | "project";

export type KnowledgeAccessState = "accessible" | "restricted";

export type KnowledgeFreshnessStatus = "fresh" | "stale" | "expired";

export type KnowledgeObject = {
  id: string;
  title: string;
  source: KnowledgeSource;
  kind: KnowledgeObjectKind;
  summary: string;
  retrievalNavigation?: { docId: string; kbId: string; sourceUri: string; score: number };
  tags: string[];
  updatedAt: number;
  relatedObjectIds?: string[];
  sourceSystem?: string;
  scopeLabel?: string;
  maskingSummary?: string;
  accessState?: KnowledgeAccessState;
  freshnessStatus?: KnowledgeFreshnessStatus;
  projectionId?: string;
  lineageId?: string;
  traceRefs?: string[];
  /** Present when supply marked the object. `partial` is incomplete and must stay visible. */
  publication?: "complete" | "partial";
  relationshipSummary?: {
    relatedCount: number;
    conflictCount: number;
    supportingCount: number;
  };
};

export type RelationshipEdge = {
  sourceId: string;
  targetId: string;
  relationType: RelationshipEdgeType;
  score: number;
  /**
   * Why this edge exists — machine reason tokens carried from the candidate builder
   * (e.g. `shared-tags:a,b`, `explicit-reference`, `shared-scope:X`). Optional/back-compat;
   * the UI humanizes known tokens for the relationship-insight panel and falls back to a
   * type-derived phrase otherwise.
   */
  reasons?: string[];
};

export type RelationshipNodeGovernanceStatus = "healthy" | "attention" | "conflict" | "dormant";

/** Phase 2: per-node governance state; drives status-based node coloring. Optional/back-compat. */
export type RelationshipNodeGovernance = {
  status: RelationshipNodeGovernanceStatus;
  conflictCount?: number;
  freshness?: KnowledgeFreshnessStatus;
  qualityScore?: number;
  usageCount?: number;
};

export type RelationshipNode = {
  id: string;
  kind: RelationshipNodeKind;
  title: string;
  summary?: string;
  objectId?: string;
  governance?: RelationshipNodeGovernance;
};

export type RelationshipGraph = {
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
};

export type ExternalDataSourceSummary = {
  id: string;
  title: string;
  category: string;
  status: string;
  connectorId: string;
};

export type KnowledgeSourceBrowse = {
  personal: KnowledgeObject[];
  enterprise: KnowledgeObject[];
  enterpriseRestricted: KnowledgeObject[];
};

export type KnowledgeSourceSummary = {
  personal: { documentCount: number; recentUpdates: number };
  enterprise: { libraryCount: number; accessibleCount: number };
  data: { grantedCount: number; requestableCount: number; externalSourceCount: number };
};

export type KnowledgeCapabilityFreshness = "fresh" | "stale" | "unknown";

export type DataCapabilityDescriptor = {
  id: string;
  title: string;
  summary: string;
  sourceSystems: string[];
  scenarios: string[];
  visibleAgents: string[];
  scopeLabel?: string;
  accessState: "granted" | "requestable" | "external" | "pending";
  /** True when this capability is demo/sample seed data (UI shows a 示例 badge). */
  isSample?: boolean;
  /**
   * Freshness copied from persisted FeedItem supply metadata for this capability.
   * Unknown when supply has not written a feed item. Not derived from live
   * DataSource connection state.
   */
  freshness?: KnowledgeCapabilityFreshness;
};

export type KnowledgeAgentProfile = {
  agentId: string;
  enabledSources: KnowledgeSource[];
  preferredKnowledgeKinds: KnowledgeObjectKind[];
  retrievalMode: "balanced" | "precision" | "breadth";
  allowDataCapabilities: string[];
  confidenceThreshold: number;
};

export type KnowledgeRecentVisit = {
  objectId: string;
  title: string;
  source: KnowledgeSource;
  visitedAt: number;
};

export type KnowledgeRecommendation = {
  object: KnowledgeObject;
  score: number;
  reason: string;
};

export type KnowledgeRelatedGroups = {
  object: KnowledgeObject | null;
  knowledge: KnowledgeObject[];
  dataCapabilities: KnowledgeObject[];
  agents: RelationshipNode[];
  owners: RelationshipNode[];
  conflicts: KnowledgeObject[];
  graph: RelationshipGraph;
};

export type KnowledgeTaskContext = {
  taskType: string;
  sessionKey?: string | null;
  seatId?: string | null;
  agentId?: string | null;
  agentType?: import("../enterprise-data/types.js").KnowledgeAgentType | null;
  requestedSourceHints?: KnowledgeSource[];
  requestedKinds?: KnowledgeObjectKind[];
  requestedCapabilities?: string[];
  /** Cron / 任务绑定的知识对象 ID，解析时优先纳入上下文 */
  requestedObjectIds?: string[];
  /** When set, agent retrieval and resolve prefer this knowledge base scope. */
  knowledgeBaseId?: string | null;
};

export type KnowledgeLineageExplainLayer =
  | "feed_item"
  | "projection"
  | "capability"
  | "data_source"
  | "connector_action"
  | "invocation_trace";

export type KnowledgeLineageExplainNode = {
  layer: KnowledgeLineageExplainLayer;
  id: string;
  label: string;
};

export type KnowledgeLineageReverseExplainRole =
  | "insight"
  | "metric"
  | "projection"
  | "connector_action"
  | "source_data";

export type KnowledgeLineageReverseExplainNode = {
  role: KnowledgeLineageReverseExplainRole;
  id: string;
  label: string;
};

export type KnowledgeLineageExplain = {
  lineageId: string;
  objectId: string;
  projectionId: string;
  chain: KnowledgeLineageExplainNode[];
  /** Read-only copy of the §8.7 reverse chain. Never invokes Gateway. */
  reverseChain: KnowledgeLineageReverseExplainNode[];
};

export type KnowledgeCognitiveBundle = {
  profile: KnowledgeAgentProfile;
  resolved: {
    objects: KnowledgeObject[];
    graph: RelationshipGraph;
  };
  context: {
    primaryObjects: KnowledgeObject[];
    relatedObjects: KnowledgeObject[];
    recommendedCapabilities: KnowledgeObject[];
    graph: RelationshipGraph;
  };
  feedSummary: {
    enterpriseAccessible: number;
    enterpriseRestricted: number;
    dataCapabilityCount: number;
    feedItemCount: number;
  };
};

export type KnowledgeResolveIntentType =
  | "analysis"
  | "retrospective"
  | "research"
  | "operations"
  | "general";

export type KnowledgeResolveIntent = {
  intentType: KnowledgeResolveIntentType;
  confidence: number;
  signals: string[];
  suggestedSources: KnowledgeSource[];
};

export type KnowledgeResolveResult = {
  intent: KnowledgeResolveIntent;
  selectedSources: KnowledgeSource[];
  objects: KnowledgeObject[];
  graph: RelationshipGraph;
  profile: KnowledgeAgentProfile;
  recommendations: KnowledgeRecommendation[];
};

export type KnowledgeGovernanceSignals = {
  /** Evidence confirmed/verified by governance. */
  confirmed: number;
  /** Evidence carrying an unresolved chunk or claim conflict. */
  conflicts: number;
  /** Evidence suppressed by governance (deduped / low trust). */
  suppressed: number;
  /** Primary or related knowledge objects flagged stale or expired. */
  stale: number;
};

export type KnowledgeAgentContext = {
  primaryObjects: KnowledgeObject[];
  relatedObjects: KnowledgeObject[];
  recommendedCapabilities: KnowledgeObject[];
  recommendedAgents: RelationshipNode[];
  recommendedOwners: RelationshipNode[];
  graph: RelationshipGraph;
  evidence: KnowledgeEvidence[];
  promptBlock: string;
  /**
   * Aggregate governance picture of the consumed evidence/objects, so the AI
   * consumption layer can reason about trust at a glance. Optional to keep
   * existing context literals valid.
   */
  governanceSignals?: KnowledgeGovernanceSignals;
};
