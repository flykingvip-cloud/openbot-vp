import type { GatewayClient } from "../../server-methods/types.js";
import type { KnowledgeFeedItem } from "../feed/types.js";
import type {
  DataCapabilityDescriptor,
  ExternalDataSourceSummary,
  KnowledgeObject,
  KnowledgeSourceSummary,
  RelationshipGraph,
} from "../types.js";

export type KnowledgeSourceBrowse = {
  personal: KnowledgeObject[];
  enterprise: KnowledgeObject[];
  enterpriseRestricted: KnowledgeObject[];
};

export type KnowledgeSourceContext = {
  tenantId: string | null;
  seatId: string | null;
  userId: string | null;
  teamLabel?: string | null;
  roleCode?: string | null;
  departmentId?: string | null;
  agentType?: import("../../enterprise-data/types.js").KnowledgeAgentType | null;
  hasEnterpriseScope: boolean;
};

export type KnowledgeSourceBundle = {
  objects: KnowledgeObject[];
  dataCapabilities: DataCapabilityDescriptor[];
  sourceSummary: KnowledgeSourceSummary;
  sourceBrowse: KnowledgeSourceBrowse;
  externalDataSources: ExternalDataSourceSummary[];
  feedItems: KnowledgeFeedItem[];
  graph: RelationshipGraph;
};

export type KnowledgeSourceLoadParams = {
  client: GatewayClient | null;
  context: KnowledgeSourceContext;
};
