import type {
  DataCapabilityDescriptor,
  KnowledgeObject,
  RelationshipEdge,
  RelationshipEdgeType,
  RelationshipGraph,
  RelationshipNode,
} from "../types.js";

export type CandidateRelationship = {
  sourceObjectId: string;
  targetObjectId: string;
  relationType: RelationshipEdgeType;
  reasons: string[];
  baseScore: number;
};

export type RelationshipRuntimeInput = {
  objects: KnowledgeObject[];
  dataCapabilities?: DataCapabilityDescriptor[];
  /** Per-object retrieval citation totals (e.g. KB-space nodes keyed by object id). */
  usageCountByObjectId?: Record<string, number>;
};

export type RelationshipRuntimeResult = {
  graph: RelationshipGraph;
  objects: KnowledgeObject[];
  conflicts: Array<{ leftId: string; rightId: string; reason: string }>;
};

export type KnowledgeRecommendationItem = {
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

export type ScoredEdge = RelationshipEdge & { reasons?: string[] };
