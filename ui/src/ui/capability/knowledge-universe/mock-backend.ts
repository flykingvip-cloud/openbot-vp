import type {
  KnowledgeAgentProfileResponse,
  KnowledgeObjectResponse,
  KnowledgeRecommendationsResponse,
  KnowledgeRelationshipsResponse,
  KnowledgeSearchResponse,
} from "./endpoints.ts";
import { buildHomeGraphViewModel } from "./graph-layout.ts";
import type {
  KnowledgeObject,
  KnowledgeRelatedGroups,
  KnowledgeRecentVisit,
  KnowledgeSourceSummary,
  RelationshipGraph,
} from "./types.ts";

const mockRecentVisits: KnowledgeRecentVisit[] = [];

const MOCK_SOURCE_SUMMARY: KnowledgeSourceSummary = {
  personal: { documentCount: 128, recentUpdates: 8 },
  enterprise: { libraryCount: 42, accessibleCount: 17 },
  data: { grantedCount: 12, requestableCount: 5, externalSourceCount: 3 },
};

const MOCK_GRAPH: RelationshipGraph = {
  nodes: [
    { id: "node:me", kind: "owner", title: "我" },
    {
      id: "node:personal",
      kind: "knowledge-object",
      title: "我的知识",
      objectId: "obj:personal",
      governance: {
        status: "healthy",
        conflictCount: 0,
        freshness: "fresh",
        qualityScore: 88,
        usageCount: 24,
      },
    },
    {
      id: "node:enterprise",
      kind: "knowledge-object",
      title: "企业知识",
      objectId: "obj:enterprise",
      governance: {
        status: "conflict",
        conflictCount: 2,
        freshness: "fresh",
        qualityScore: 71,
        usageCount: 12,
      },
    },
    {
      id: "node:data",
      kind: "data-capability",
      title: "数据能力",
      objectId: "obj:data",
      governance: {
        status: "attention",
        conflictCount: 0,
        freshness: "stale",
        qualityScore: 64,
        usageCount: 8,
      },
    },
    {
      id: "node:project-a",
      kind: "project",
      title: "项目 A",
      objectId: "obj:project-a",
      governance: {
        status: "healthy",
        conflictCount: 0,
        freshness: "fresh",
        qualityScore: 82,
        usageCount: 15,
      },
    },
    {
      id: "node:sales-bot",
      kind: "agent",
      title: "销售机器人",
      objectId: "obj:sales-bot",
      governance: {
        status: "dormant",
        conflictCount: 0,
        freshness: "fresh",
        qualityScore: 60,
        usageCount: 0,
      },
    },
    { id: "node:owner", kind: "owner", title: "负责人", objectId: "obj:owner" },
  ],
  edges: [
    { sourceId: "node:me", targetId: "node:personal", relationType: "related", score: 90 },
    { sourceId: "node:me", targetId: "node:enterprise", relationType: "related", score: 88 },
    { sourceId: "node:me", targetId: "node:data", relationType: "related", score: 86 },
    { sourceId: "node:personal", targetId: "node:project-a", relationType: "supports", score: 82 },
    { sourceId: "node:data", targetId: "node:sales-bot", relationType: "used-by", score: 84 },
    { sourceId: "node:sales-bot", targetId: "node:owner", relationType: "owned-by", score: 85 },
  ],
};

const MOCK_OBJECTS: KnowledgeObject[] = [
  {
    id: "obj:personal",
    title: "我的知识",
    source: "personal",
    kind: "document",
    summary: "个人文档、会话收录与机器人产出沉淀。",
    tags: ["个人"],
    updatedAt: Date.now(),
    scopeLabel: "仅本人",
    relationshipSummary: { relatedCount: 4, conflictCount: 0, supportingCount: 2 },
  },
  {
    id: "obj:enterprise",
    title: "企业知识",
    source: "enterprise",
    kind: "policy",
    summary: "企业制度、流程与最佳实践的可访问投影。",
    tags: ["企业"],
    updatedAt: Date.now() - 86_400_000,
    scopeLabel: "本岗位可见",
    relationshipSummary: { relatedCount: 5, conflictCount: 0, supportingCount: 3 },
  },
  {
    id: "obj:data",
    title: "数据能力",
    source: "data",
    kind: "insight",
    summary: "已授权与可申请的企业数据能力入口。",
    tags: ["数据能力"],
    updatedAt: Date.now() - 172_800_000,
    scopeLabel: "岗位授权",
    maskingSummary: "敏感字段已脱敏展示",
    relationshipSummary: { relatedCount: 3, conflictCount: 0, supportingCount: 1 },
  },
  {
    id: "obj:project-a",
    title: "项目 A",
    source: "personal",
    kind: "project",
    summary: "当前重点跟进项目及其关联文档。",
    tags: ["项目"],
    updatedAt: Date.now() - 43_200_000,
    scopeLabel: "协作空间",
    relationshipSummary: { relatedCount: 2, conflictCount: 0, supportingCount: 1 },
  },
  {
    id: "obj:sales-bot",
    title: "销售机器人",
    source: "data",
    kind: "insight",
    summary: "承接销售分析与客户跟进任务的数字员工。",
    tags: ["机器人"],
    updatedAt: Date.now() - 3_600_000,
    scopeLabel: "本岗位机器人",
    relationshipSummary: { relatedCount: 4, conflictCount: 0, supportingCount: 2 },
  },
  {
    id: "obj:owner",
    title: "负责人",
    source: "enterprise",
    kind: "document",
    summary: "当前项目与销售流程的业务负责人。",
    tags: ["负责人"],
    updatedAt: Date.now() - 1_800_000,
    scopeLabel: "组织内可见",
    relationshipSummary: { relatedCount: 1, conflictCount: 0, supportingCount: 0 },
  },
];

function normalizeQuery(query: string | undefined): string {
  return (query ?? "").trim().toLowerCase();
}

function filterObjects(query: string): KnowledgeObject[] {
  if (!query) {
    return MOCK_OBJECTS;
  }
  return MOCK_OBJECTS.filter((item) =>
    [item.title, item.summary, item.tags.join(" "), item.source, item.kind]
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
}

const MOCK_DATA_CAPABILITIES: KnowledgeSearchResponse["dataCapabilities"] = [
  {
    id: "mock-sales-analysis",
    title: "销售分析能力",
    summary: "基于 CRM 与订单数据生成销售洞察",
    sourceSystems: ["Salesforce CRM"],
    scenarios: ["销售分析", "客户分析", "销售预测"],
    visibleAgents: [],
    scopeLabel: "已授权",
    accessState: "granted",
  },
  {
    id: "mock-customer-profile",
    title: "客户画像能力",
    summary: "从客户摘要构建画像视图",
    sourceSystems: ["Salesforce CRM"],
    scenarios: ["客户画像", "销售跟进"],
    visibleAgents: [],
    scopeLabel: "待申请",
    accessState: "requestable",
  },
];

export function mockKnowledgeSearch(req: {
  query?: string;
  limit?: number;
}): KnowledgeSearchResponse {
  const results = filterObjects(normalizeQuery(req.query)).slice(0, req.limit ?? 20);
  return {
    results,
    sourceSummary: MOCK_SOURCE_SUMMARY,
    dataCapabilities: MOCK_DATA_CAPABILITIES,
    sourceBrowse: {
      personal: MOCK_OBJECTS.filter((item) => item.source === "personal").slice(0, 6),
      enterprise: MOCK_OBJECTS.filter((item) => item.source === "enterprise").slice(0, 6),
      enterpriseRestricted: [
        {
          id: "obj:enterprise:hr-handbook",
          title: "HR 制度手册",
          source: "enterprise",
          kind: "policy",
          summary: "当前席位暂无访问权限，可申请开通后查看完整内容。",
          tags: ["HR"],
          updatedAt: Date.now(),
          scopeLabel: "HR 知识空间",
          accessState: "restricted",
          projectionId: "hr-handbook",
          maskingSummary: "需申请访问权限",
        },
      ],
    },
    externalDataSources: [
      {
        id: "ds-external-crm",
        title: "外部 CRM 连接器",
        category: "external",
        status: "disconnected",
        connectorId: "crm-connector",
      },
    ],
  };
}

export function mockKnowledgeRelationships(req: {
  query?: string;
  focusNodeId?: string | null;
  focusDocumentId?: string | null;
  knowledgeBaseId?: string | null;
}): KnowledgeRelationshipsResponse {
  const focusDocumentId = req.focusDocumentId?.trim() || null;
  if (focusDocumentId) {
    const objectId = `obj:doc:${focusDocumentId}`;
    const nodeId = `node:${objectId}`;
    return {
      graph: {
        nodes: [
          {
            id: nodeId,
            kind: "knowledge-object",
            title: focusDocumentId,
            objectId,
            summary: "暂无跨文档关系",
            governance: { status: "healthy", conflictCount: 0 },
          },
        ],
        edges: [],
      },
    };
  }
  const query = normalizeQuery(req.query);
  if (!query && !req.focusNodeId) {
    return { graph: MOCK_GRAPH };
  }
  const nodes = MOCK_GRAPH.nodes.filter((node) => {
    if (req.focusNodeId) {
      const connected =
        node.id === req.focusNodeId ||
        MOCK_GRAPH.edges.some(
          (edge) =>
            (edge.sourceId === req.focusNodeId && edge.targetId === node.id) ||
            (edge.targetId === req.focusNodeId && edge.sourceId === node.id),
        );
      if (!connected) {
        return false;
      }
    }
    return !query || `${node.title} ${node.kind}`.toLowerCase().includes(query);
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    graph: {
      nodes,
      edges: MOCK_GRAPH.edges.filter(
        (edge) => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId),
      ),
    },
  };
}

export function mockKnowledgeObject(req: {
  objectId?: string;
  nodeId?: string;
}): KnowledgeObjectResponse | null {
  if (req.objectId) {
    const object = MOCK_OBJECTS.find((item) => item.id === req.objectId);
    return object ? { object } : null;
  }
  if (req.nodeId) {
    const node = MOCK_GRAPH.nodes.find((entry) => entry.id === req.nodeId);
    if (!node?.objectId) {
      return null;
    }
    const object = MOCK_OBJECTS.find((item) => item.id === node.objectId);
    return object ? { object } : null;
  }
  return null;
}

export function mockKnowledgeRecommendations(req: {
  limit?: number;
  focusObjectId?: string | null;
}): KnowledgeRecommendationsResponse {
  const focus = req.focusObjectId
    ? MOCK_OBJECTS.find((item) => item.id === req.focusObjectId)
    : null;
  const candidates = MOCK_OBJECTS.filter((item) => item.id !== focus?.id);
  return {
    recommendations: candidates.slice(0, req.limit ?? 4).map((object, index) => ({
      object,
      score: 90 - index * 6,
      reason:
        object.source === "data"
          ? "高相关数据能力"
          : object.source === "enterprise"
            ? "企业知识关联推荐"
            : "个人知识关联推荐",
    })),
  };
}

export function mockKnowledgeRelated(req: { objectId: string }): KnowledgeRelatedGroups {
  const object = MOCK_OBJECTS.find((item) => item.id === req.objectId) ?? null;
  const node = MOCK_GRAPH.nodes.find((entry) => entry.objectId === req.objectId);
  if (!node) {
    return {
      object,
      knowledge: [],
      dataCapabilities: [],
      agents: [],
      owners: [],
      conflicts: [],
      graph: { nodes: [], edges: [] },
    };
  }
  const neighborIds = new Set<string>([node.id]);
  for (const edge of MOCK_GRAPH.edges) {
    if (edge.sourceId === node.id || edge.targetId === node.id) {
      neighborIds.add(edge.sourceId);
      neighborIds.add(edge.targetId);
    }
  }
  const graph = {
    nodes: MOCK_GRAPH.nodes.filter((entry) => neighborIds.has(entry.id)),
    edges: MOCK_GRAPH.edges.filter(
      (edge) => neighborIds.has(edge.sourceId) && neighborIds.has(edge.targetId),
    ),
  };
  const knowledge: KnowledgeObject[] = [];
  const dataCapabilities: KnowledgeObject[] = [];
  const agents = graph.nodes.filter((entry) => entry.kind === "agent");
  const owners = graph.nodes.filter((entry) => entry.kind === "owner" && entry.id !== "node:me");
  for (const entry of graph.nodes) {
    if (!entry.objectId || entry.objectId === req.objectId) {
      continue;
    }
    const relatedObject = MOCK_OBJECTS.find((item) => item.id === entry.objectId);
    if (!relatedObject) {
      continue;
    }
    if (relatedObject.source === "data" || entry.kind === "data-capability") {
      dataCapabilities.push(relatedObject);
    } else if (entry.kind !== "agent" && entry.kind !== "owner") {
      knowledge.push(relatedObject);
    }
  }
  return {
    object,
    knowledge,
    dataCapabilities,
    agents,
    owners,
    conflicts: [],
    graph,
  };
}

export function mockKnowledgeRecent(): { visits: KnowledgeRecentVisit[] } {
  return { visits: [...mockRecentVisits] };
}

export function mockKnowledgeRecordRecent(req: { objectId: string }): {
  visits: KnowledgeRecentVisit[];
} {
  const object = MOCK_OBJECTS.find((item) => item.id === req.objectId);
  if (object) {
    const nextVisit: KnowledgeRecentVisit = {
      objectId: object.id,
      title: object.title,
      source: object.source,
      visitedAt: Date.now(),
    };
    const filtered = mockRecentVisits.filter((item) => item.objectId !== object.id);
    mockRecentVisits.length = 0;
    mockRecentVisits.push(nextVisit, ...filtered);
    if (mockRecentVisits.length > 8) {
      mockRecentVisits.length = 8;
    }
  }
  return { visits: [...mockRecentVisits] };
}

export function mockKnowledgeAgentProfile(): KnowledgeAgentProfileResponse {
  return {
    profile: {
      agentId: "default-agent",
      enabledSources: ["personal", "enterprise", "data"],
      preferredKnowledgeKinds: ["document", "policy", "insight", "project"],
      retrievalMode: "balanced",
      allowDataCapabilities: ["sales-analysis"],
      confidenceThreshold: 0.65,
    },
  };
}

export function buildMockKnowledgeHomeSnapshot(query = ""): {
  sourceSummary: KnowledgeSourceSummary;
  graph: RelationshipGraph;
  graphViewModel: ReturnType<typeof buildHomeGraphViewModel>;
  searchResults: KnowledgeObject[];
  recommendations: KnowledgeRecommendationsResponse["recommendations"];
  recentVisits: KnowledgeRecentVisit[];
} {
  const search = mockKnowledgeSearch({ query });
  const relationships = mockKnowledgeRelationships({ query });
  const recommendations = mockKnowledgeRecommendations({ limit: 4 });
  return {
    sourceSummary: search.sourceSummary,
    graph: relationships.graph,
    graphViewModel: buildHomeGraphViewModel(relationships.graph),
    searchResults: search.results,
    recommendations: recommendations.recommendations,
    recentVisits: mockKnowledgeRecent().visits,
  };
}
