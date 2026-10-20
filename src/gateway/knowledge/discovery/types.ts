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

export type KnowledgeDiscoveryEventSource =
  | "governance"
  | "lineage"
  | "deliverable"
  | "relation"
  | "usage";

export type KnowledgeDiscoveryRelatedKnowledge = {
  kbId?: string;
  deliverableId?: string;
  taskId?: string;
  governanceTaskId?: string;
  chunkIds?: string[];
  relationId?: string;
  relationType?: string;
  /** For frequently_cited events: how many retrieval hits the chunk has accrued. */
  referenceCount?: number;
};

export type KnowledgeDiscoveryEvent = {
  eventId: string;
  eventType: KnowledgeDiscoveryEventType;
  eventSource: KnowledgeDiscoveryEventSource;
  title: string;
  summary: string;
  timestamp: number;
  relatedKnowledge: KnowledgeDiscoveryRelatedKnowledge;
};
