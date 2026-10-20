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

export type KnowledgeObject = {
  id: string;
  title: string;
  source: KnowledgeSource;
  kind: KnowledgeObjectKind;
  summary: string;
  tags: string[];
  updatedAt: number;
  relatedObjectIds?: string[];
  sourceSystem?: string;
  scopeLabel?: string;
  maskingSummary?: string;
  accessState?: KnowledgeAccessState;
  projectionId?: string;
  lineageId?: string;
  traceRefs?: string[];
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
   * Why this edge exists — machine reason tokens from the backend candidate builder
   * (e.g. `shared-tags:a,b`, `explicit-reference`). The relationship-insight panel humanizes
   * known tokens and falls back to a type-derived phrase. Optional/back-compat.
   */
  reasons?: string[];
};

export type RelationshipNodeGovernanceStatus = "healthy" | "attention" | "conflict" | "dormant";

/** Phase 2: per-node governance state; drives status-based node coloring. Optional/back-compat. */
export type RelationshipNodeGovernance = {
  status: RelationshipNodeGovernanceStatus;
  conflictCount?: number;
  freshness?: "fresh" | "stale" | "expired";
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

export type KnowledgeSourceSummary = {
  personal: { documentCount: number; recentUpdates: number };
  enterprise: { libraryCount: number; accessibleCount: number };
  data: { grantedCount: number; requestableCount: number; externalSourceCount: number };
};

export type GraphViewNodeCategory =
  | "knowledge"
  | "knowledge-base"
  | "deliverable"
  | "data"
  | "agent"
  | "project"
  | "owner";

export type GraphViewNode = {
  id: string;
  x: number;
  y: number;
  radius: number;
  label: string;
  category: GraphViewNodeCategory;
  objectId?: string;
  governance?: RelationshipNodeGovernance;
};

export type GraphViewEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  score: number;
  relationType: RelationshipEdgeType;
};

export type GraphViewModel = {
  width: number;
  height: number;
  nodes: GraphViewNode[];
  edges: GraphViewEdge[];
};

export type KnowledgeAgentProfile = {
  agentId: string;
  enabledSources: KnowledgeSource[];
  preferredKnowledgeKinds: KnowledgeObjectKind[];
  retrievalMode: "balanced" | "precision" | "breadth";
  allowDataCapabilities: string[];
  confidenceThreshold: number;
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

export type PersonalKnowledgeVersionSummary = {
  version: string;
  createdAt: number;
  summary: string;
};

export type PersonalKnowledgeVersionDiff = {
  skillId: string;
  fromVersion: string;
  toVersion: string;
  changedFields: Array<{
    field: string;
    before: unknown;
    after: unknown;
  }>;
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
  /** 供给记录新鲜度。stale 表示已写入记录过期，unknown 表示还没有供给记录。 */
  freshness?: KnowledgeCapabilityFreshness;
};

/** Stable id of the real, knowledge-index-backed data capability. */
export const KNOWLEDGE_INDEX_CAPABILITY_ID = "cap:knowledge-index-retrieval";

export type KnowledgeCapabilityPreviewItem = {
  docId: string;
  docTitle: string;
  kbId: string;
  section: string | null;
  snippet: string;
};

export type KnowledgeCapabilityPreviewState = {
  capabilityId: string;
  busy: boolean;
  items: KnowledgeCapabilityPreviewItem[];
  error: string | null;
};

/** Materialized result of a governed capability invoke (never a live connector call). */
export type KnowledgeCapabilityInvocationData = {
  title: string;
  summary: string;
  sourceSystems: string[];
  scenarios: string[];
  freshness: KnowledgeCapabilityFreshness;
};

export type KnowledgeCapabilityInvocationState = {
  capabilityId: string;
  busy: boolean;
  ok: boolean;
  /** Resolved seat access state for the capability (display-only). */
  accessState: string;
  reason: string | null;
  data: KnowledgeCapabilityInvocationData | null;
  auditId: string | null;
  error: string | null;
};

export type KnowledgeRecentVisit = {
  objectId: string;
  title: string;
  source: KnowledgeSource;
  visitedAt: number;
};

export type KnowledgeRecommendationItem = {
  object: KnowledgeObject;
  score: number;
  reason: string;
};

export type KnowledgeDiscoveryEventType =
  | "new_conflict"
  | "new_duplicate"
  | "new_claim_conflict"
  | "stale_detected"
  | "orphan_detected"
  | "knowledge_committed"
  | "deliverable_completed"
  | "new_relation"
  | "frequently_cited";

export type KnowledgeDiscoveryEvent = {
  eventId: string;
  eventType: KnowledgeDiscoveryEventType;
  eventSource: "governance" | "lineage" | "deliverable" | "relation" | "usage";
  title: string;
  summary: string;
  timestamp: number;
  relatedKnowledge: {
    kbId?: string;
    deliverableId?: string;
    taskId?: string;
    governanceTaskId?: string;
    chunkIds?: string[];
    relationId?: string;
    relationType?: string;
    referenceCount?: number;
  };
};

export type KnowledgeActionType =
  | "archive_deliverable"
  | "open_governance"
  | "merge_duplicate"
  | "review_conflict"
  | "establish_relation"
  | "update_knowledge"
  | "open_object";

export type KnowledgeActionTrustLabel = "high" | "medium" | "low";

export type KnowledgeActionSuggestion = {
  actionId: string;
  actionType: KnowledgeActionType;
  title: string;
  reason: string;
  score: number;
  context: {
    knowledgeBaseId?: string;
    deliverableId?: string;
    governanceTaskId?: string;
    objectId?: string;
    targetObjectId?: string;
  };
  executable: boolean;
  evidence?: string[];
  trustLabel?: KnowledgeActionTrustLabel;
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
  requestedSourceHints?: KnowledgeSource[];
  requestedKinds?: KnowledgeObjectKind[];
  requestedCapabilities?: string[];
  requestedObjectIds?: string[];
  knowledgeBaseId?: string | null;
};
