// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeEvidence } from "../../../retrieval/types.js";
import { buildDefaultKnowledgeSourceSummary } from "../mock-graph.js";
import type { KnowledgeSourceBundle } from "../sources/types.js";
import { classifyKnowledgeIntent } from "./intent-classifier.js";
import {
  filterKnowledgeEvidenceForPrompt,
  filterRelationshipGraphBySources,
  runKnowledgeResolveEngine,
  runKnowledgeRuntimeEngine,
  type KnowledgeResolveSourcePolicy,
} from "./resolve-engine.js";
import { selectKnowledgeSources, selectKnowledgeSourcesWithPolicy } from "./source-selector.js";

const reviewState = vi.hoisted(() => ({
  knowledgeBaseId: "kb-local",
  otherTenantKbId: "kb-other-tenant",
  invokeApiSourceMock: vi.fn(
    async (
      sourceId: string,
      _path: string,
      _ctx: unknown,
      options?: { abortSignal?: AbortSignal },
    ): Promise<{ sourceId: string; fetchedAtMs: number; data: unknown }> => {
      if (options?.abortSignal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      return {
        sourceId,
        fetchedAtMs: 1_786_000_000_000,
        data: { provider: "xueqiu-live", items: [{ title: "Market update" }] },
      };
    },
  ),
  searchMock: vi.fn(async () => [
    {
      sourceKind: "knowledge" as const,
      docId: "doc-local",
      docTitle: "Travel Policy",
      kbId: "kb-local",
      versionId: "v1",
      score: 0.9,
      chunkText: "Local travel policy excerpt.",
      sourceUri: "ku://kb/kb-local/doc/doc-local@v1",
    } satisfies KnowledgeEvidence,
  ]),
  loadBundleMock: vi.fn(),
  listVisitsMock: vi.fn(
    (): Array<{
      objectId: string;
      title: string;
      source: "personal" | "enterprise" | "data";
      visitedAt: number;
    }> => [],
  ),
  recentVisits: [] as Array<{
    objectId: string;
    title: string;
    source: "personal" | "enterprise" | "data";
    visitedAt: number;
  }>,
  readable: new Set<string>(["kb-local"]),
  bases: {
    "kb-local": {
      id: "kb-local",
      tenantId: "tenant-a",
      backendKind: "personal",
      documentIds: ["doc-selected"],
    },
    "kb-enterprise": {
      id: "kb-enterprise",
      tenantId: "tenant-a",
      backendKind: "enterprise",
      documentIds: [],
    },
    "kb-other-tenant": {
      id: "kb-other-tenant",
      tenantId: "tenant-b",
      backendKind: "enterprise",
      documentIds: [],
    },
  } as Record<
    string,
    { id: string; tenantId: string | null; backendKind: string; documentIds: string[] }
  >,
  bindings: [] as Array<Record<string, unknown>>,
}));

vi.mock("../context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(async () => ({
    userId: "user-a",
    seatId: null,
    tenantId: "tenant-a",
    hasEnterpriseScope: true,
  })),
}));

vi.mock("../knowledge-retrieval-runtime.js", () => ({
  retrievalContextFromKnowledgeSourceContext: (context: unknown) => context,
  searchKnowledgeEvidence: reviewState.searchMock,
}));

vi.mock("../knowledge-base-store.js", () => ({
  getKnowledgeBase: (id: string) => reviewState.bases[id],
  listKnowledgeBases: () => Object.values(reviewState.bases),
}));

vi.mock("../knowledge-base-permissions.js", () => ({
  buildKnowledgeBasePermissionActor: vi.fn(() => ({})),
  canReadKnowledgeBase: vi.fn(({ knowledgeBase }: { knowledgeBase: { id: string } }) =>
    reviewState.readable.has(knowledgeBase.id),
  ),
}));

vi.mock("../sources/source-binding-store.js", () => ({
  listKnowledgeSourceBindings: vi.fn(() => reviewState.bindings),
}));

vi.mock("../sources/source-api-runtime.js", () => ({
  getApiSourceCatalog: vi.fn(() => null),
  invokeApiSource: reviewState.invokeApiSourceMock,
}));

vi.mock("../knowledge-document-preview.js", () => ({
  readKnowledgeDocumentContent: vi.fn(async () => ({
    filename: "selected.md",
    buffer: Buffer.from("Exact selected document body.", "utf8"),
    source: "index_text",
    chunkIds: ["chunk-selected"],
  })),
}));

vi.mock("../source-bundle.js", () => ({
  loadKnowledgeSourceBundle: (...args: unknown[]) => reviewState.loadBundleMock(...args),
}));

vi.mock("../recent-visits.js", () => ({
  listKnowledgeRecentVisits: reviewState.listVisitsMock,
}));

const retrievePolicy: KnowledgeResolveSourcePolicy = {
  liveSourcesAllowed: false,
  allowedSources: ["personal", "enterprise"],
  hasExplicitLiveIntent: false,
};

const liveAllowedPolicy: KnowledgeResolveSourcePolicy = {
  liveSourcesAllowed: true,
  allowedSources: ["personal", "enterprise", "data"],
  hasExplicitLiveIntent: true,
};

function mockBundle(): KnowledgeSourceBundle {
  return {
    objects: [
      {
        id: "obj-personal",
        title: "Travel notes",
        source: "personal",
        kind: "document",
        summary: "差旅政策笔记",
        tags: ["travel"],
        updatedAt: 1,
      },
      {
        id: "obj-enterprise",
        title: "Corp policy",
        source: "enterprise",
        kind: "policy",
        summary: "企业成交政策",
        tags: ["corp"],
        updatedAt: 1,
      },
      {
        id: "obj-enterprise-2",
        title: "Corp playbook",
        source: "enterprise",
        kind: "document",
        summary: "企业知识手册",
        tags: ["corp"],
        updatedAt: 1,
      },
      {
        id: "obj-data",
        title: "Live metrics",
        source: "data",
        kind: "metric",
        summary: "实时指标",
        tags: ["live"],
        updatedAt: 1,
      },
      {
        id: "obj-restricted",
        title: "Secret playbook",
        source: "enterprise",
        kind: "policy",
        summary: "受限企业手册",
        tags: ["secret"],
        updatedAt: 1,
        accessState: "restricted",
      },
    ],
    dataCapabilities: [],
    sourceSummary: buildDefaultKnowledgeSourceSummary(),
    sourceBrowse: { personal: [], enterprise: [], enterpriseRestricted: [] },
    externalDataSources: [],
    feedItems: [],
    graph: {
      nodes: [
        { id: "node:me", kind: "owner", title: "我" },
        {
          id: "node:hub:personal",
          kind: "knowledge-object",
          title: "我的知识",
          objectId: "obj:hub:personal",
        },
        {
          id: "node:hub:enterprise",
          kind: "knowledge-object",
          title: "企业知识",
          objectId: "obj:hub:enterprise",
        },
        {
          id: "node:hub:data",
          kind: "data-capability",
          title: "数据能力",
          objectId: "obj:hub:data",
        },
        {
          id: "node:obj-personal",
          kind: "knowledge-object",
          title: "Travel notes",
          objectId: "obj-personal",
        },
        {
          id: "node:obj-enterprise",
          kind: "knowledge-object",
          title: "Corp policy",
          objectId: "obj-enterprise",
        },
        {
          id: "node:obj-enterprise-2",
          kind: "knowledge-object",
          title: "Corp playbook",
          objectId: "obj-enterprise-2",
        },
        {
          id: "node:obj-data",
          kind: "data-capability",
          title: "Live metrics",
          objectId: "obj-data",
        },
        {
          id: "node:obj-orphan",
          kind: "knowledge-object",
          title: "Orphan leak",
          objectId: "obj-orphan",
        },
      ],
      edges: [
        { sourceId: "node:me", targetId: "node:hub:personal", relationType: "owned-by", score: 1 },
        {
          sourceId: "node:me",
          targetId: "node:hub:enterprise",
          relationType: "owned-by",
          score: 1,
        },
        { sourceId: "node:me", targetId: "node:hub:data", relationType: "owned-by", score: 1 },
        {
          sourceId: "node:hub:personal",
          targetId: "node:obj-personal",
          relationType: "related",
          score: 40,
        },
        {
          sourceId: "node:hub:enterprise",
          targetId: "node:obj-enterprise",
          relationType: "related",
          score: 40,
        },
        {
          sourceId: "node:hub:data",
          targetId: "node:obj-data",
          relationType: "related",
          score: 40,
        },
        {
          sourceId: "node:obj-personal",
          targetId: "node:obj-enterprise",
          relationType: "related",
          score: 50,
        },
        {
          sourceId: "node:obj-enterprise",
          targetId: "node:obj-enterprise-2",
          relationType: "recommended-for",
          score: 80,
        },
        {
          sourceId: "node:obj-enterprise",
          targetId: "node:obj-data",
          relationType: "derived-from",
          score: 70,
        },
        {
          sourceId: "node:obj-personal",
          targetId: "node:obj-data",
          relationType: "related",
          score: 60,
        },
        {
          sourceId: "node:obj-orphan",
          targetId: "node:obj-enterprise",
          relationType: "related",
          score: 90,
        },
      ],
    },
  };
}

const PERSONAL_PLANE_IDS = [
  "obj-personal",
  "obj:hub:personal",
  "node:hub:personal",
  "node:obj-personal",
];
const ENTERPRISE_PLANE_IDS = [
  "obj-enterprise",
  "obj-enterprise-2",
  "obj:hub:enterprise",
  "node:hub:enterprise",
  "node:obj-enterprise",
  "node:obj-enterprise-2",
];
const DATA_PLANE_IDS = ["obj-data", "obj:hub:data", "node:hub:data", "node:obj-data"];

function graphMentions(
  graph: {
    nodes: Array<{ id: string; objectId?: string }>;
    edges: Array<{ sourceId: string; targetId: string }>;
  },
  ids: string[],
): boolean {
  const seen = new Set<string>();
  for (const node of graph.nodes) {
    seen.add(node.id);
    if (node.objectId) {
      seen.add(node.objectId);
    }
  }
  for (const edge of graph.edges) {
    seen.add(edge.sourceId);
    seen.add(edge.targetId);
  }
  return ids.some((id) => seen.has(id));
}

describe("inbound knowledge source policy", () => {
  beforeEach(() => {
    reviewState.invokeApiSourceMock.mockReset();
    reviewState.invokeApiSourceMock.mockImplementation(
      async (
        sourceId: string,
        _path: string,
        _ctx: unknown,
        options?: { abortSignal?: AbortSignal },
      ): Promise<{ sourceId: string; fetchedAtMs: number; data: unknown }> => {
        if (options?.abortSignal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        return {
          sourceId,
          fetchedAtMs: 1_786_000_000_000,
          data: { provider: "xueqiu-live", items: [{ title: "Market update" }] },
        };
      },
    );
    reviewState.searchMock.mockClear();
    reviewState.searchMock.mockResolvedValue([
      {
        sourceKind: "knowledge",
        docId: "doc-local",
        docTitle: "Travel Policy",
        kbId: "kb-local",
        versionId: "v1",
        score: 0.9,
        chunkText: "Local travel policy excerpt.",
        sourceUri: "ku://kb/kb-local/doc/doc-local@v1",
      },
    ]);
    reviewState.readable = new Set(["kb-local", "kb-enterprise"]);
    reviewState.bindings = [
      {
        id: "xueqiu-source",
        kind: "api",
        plane: "active",
        title: "雪球实时数据 API",
        endpoint: "https://api.example.test",
        ownerId: "user-a",
        knowledgeBaseId: reviewState.knowledgeBaseId,
        metadata: {
          "request.method": "GET",
          "request.path": "/api/s?id=xueqiu-live&latest=true",
        },
        createdAtMs: 1,
      },
    ];
    reviewState.loadBundleMock.mockReset();
    reviewState.loadBundleMock.mockImplementation(async () => mockBundle());
    reviewState.recentVisits = [
      {
        objectId: "obj-personal",
        title: "Travel notes",
        source: "personal",
        visitedAt: 4,
      },
      {
        objectId: "obj-enterprise",
        title: "Corp policy",
        source: "enterprise",
        visitedAt: 3,
      },
      {
        objectId: "obj-data",
        title: "Live metrics",
        source: "data",
        visitedAt: 2,
      },
      {
        objectId: "obj-missing",
        title: "Ghost visit",
        source: "enterprise",
        visitedAt: 1,
      },
      {
        objectId: "obj-restricted",
        title: "Secret playbook",
        source: "enterprise",
        visitedAt: 1,
      },
      {
        objectId: "obj-personal",
        title: "Mismatched personal",
        source: "enterprise",
        visitedAt: 1,
      },
    ];
    reviewState.listVisitsMock.mockReset();
    reviewState.listVisitsMock.mockImplementation(() => reviewState.recentVisits);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not let general grant three source planes when policy is on", () => {
    const intent = classifyKnowledgeIntent({
      query: "晚上好",
      taskContext: { taskType: "general" },
      sourcePolicyEnabled: true,
    });
    expect(intent.intentType).toBe("general");
    expect(intent.suggestedSources).toEqual([]);
  });

  it("keeps the three-source general default when policy is off", () => {
    const intent = classifyKnowledgeIntent({
      query: "晚上好",
      taskContext: { taskType: "general" },
    });
    expect(intent.suggestedSources).toEqual(["personal", "enterprise", "data"]);
  });

  it("treats requested hints as shrink-only under policy", () => {
    const intent = classifyKnowledgeIntent({
      query: "帮我整理这个项目复盘",
      taskContext: {
        taskType: "retrospective",
        requestedSourceHints: ["personal", "enterprise", "data"],
      },
      sourcePolicyEnabled: true,
    });
    expect(intent.suggestedSources).toEqual(["personal", "enterprise"]);
    const selected = selectKnowledgeSourcesWithPolicy({
      intent,
      taskContext: {
        taskType: "retrospective",
        requestedSourceHints: ["data"],
      },
      sourcePolicy: {
        liveSourcesAllowed: false,
        allowedSources: ["personal", "enterprise"],
        aclAllowedSources: ["personal", "enterprise", "data"],
      },
    });
    expect(selected.selected).toEqual([]);
    expect(selected.excludedReasons).toContain("hint_narrowed");
    expect(selected.selected).not.toContain("data");
  });

  it("does not let hints expand the baseline-incompatible policy set", () => {
    const selected = selectKnowledgeSources({
      intent: {
        intentType: "research",
        confidence: 0.8,
        signals: [],
        suggestedSources: ["personal"],
      },
      taskContext: {
        taskType: "research",
        requestedSourceHints: ["personal", "data"],
      },
      profile: {
        agentId: "employee-agent",
        enabledSources: ["personal", "enterprise", "data"],
        preferredKnowledgeKinds: ["document"],
        retrievalMode: "balanced",
        allowDataCapabilities: [],
        confidenceThreshold: 0.6,
      },
      sourcePolicy: {
        liveSourcesAllowed: false,
        allowedSources: ["personal", "enterprise"],
        aclAllowedSources: ["personal", "enterprise", "data"],
      },
    });
    expect(selected).toEqual(["personal"]);
    expect(selected).not.toContain("data");
  });

  it("drops expired, cross-tenant, and policy-mismatch evidence from the prompt set", () => {
    const filtered = filterKnowledgeEvidenceForPrompt({
      sourcePolicy: { liveSourcesAllowed: false, allowedSources: ["personal", "enterprise"] },
      selectedSources: ["personal", "enterprise"],
      tenantId: "tenant-a",
      readableKnowledgeBaseIds: new Set(["kb-local", "kb-other-tenant"]),
      lookupKnowledgeBase: (kbId) => reviewState.bases[kbId],
      evidence: [
        {
          sourceKind: "knowledge",
          docId: "doc-archived",
          docTitle: "Old",
          kbId: "kb-local",
          versionId: "v0",
          score: 1,
          chunkText: "expired archived body",
          sourceUri: "ku://kb/kb-local/doc/doc-archived@v0",
          governanceStatus: "archived",
        },
        {
          sourceKind: "knowledge",
          docId: "doc-other",
          docTitle: "Other tenant",
          kbId: "kb-other-tenant",
          versionId: "v1",
          score: 1,
          chunkText: "cross tenant body",
          sourceUri: "ku://kb/kb-other-tenant/doc/doc-other@v1",
        },
        {
          sourceKind: "knowledge",
          docId: "source:xueqiu-source",
          docTitle: "Live",
          kbId: "kb-local",
          versionId: "v1",
          score: 1,
          chunkText: "live body",
          sourceUri: "ku://active/xueqiu-source/api",
        },
        {
          sourceKind: "knowledge",
          docId: "doc-local",
          docTitle: "Travel Policy",
          kbId: "kb-local",
          versionId: "v1",
          score: 0.9,
          chunkText: "Local travel policy excerpt.",
          sourceUri: "ku://kb/kb-local/doc/doc-local@v1",
        },
      ],
    });
    expect(filtered.kept.map((item) => item.docId)).toEqual(["doc-local"]);
    expect(filtered.excludedReasons).toEqual(
      ["cross_tenant", "live_gated", "policy_mismatch"].toSorted(),
    );
  });

  it("enforces governance + isolation invariants even without a sourcePolicy", () => {
    // Non-bypassable: a policy-less caller must still never receive suppressed/archived
    // evidence, cross-tenant rows, or ACL-disallowed bases.
    const filtered = filterKnowledgeEvidenceForPrompt({
      tenantId: "tenant-a",
      readableKnowledgeBaseIds: new Set(["kb-local", "kb-other-tenant"]),
      lookupKnowledgeBase: (kbId) => reviewState.bases[kbId],
      evidence: [
        {
          sourceKind: "knowledge",
          docId: "doc-archived",
          docTitle: "Old",
          kbId: "kb-local",
          versionId: "v0",
          score: 1,
          chunkText: "archived body",
          sourceUri: "ku://kb/kb-local/doc/doc-archived@v0",
          governanceStatus: "archived",
        },
        {
          sourceKind: "knowledge",
          docId: "doc-suppressed",
          docTitle: "Suppressed",
          kbId: "kb-local",
          versionId: "v0",
          score: 1,
          chunkText: "suppressed body",
          sourceUri: "ku://kb/kb-local/doc/doc-suppressed@v0",
          governanceStatus: "suppressed",
        },
        {
          sourceKind: "knowledge",
          docId: "doc-other",
          docTitle: "Other tenant",
          kbId: "kb-other-tenant",
          versionId: "v1",
          score: 1,
          chunkText: "cross tenant body",
          sourceUri: "ku://kb/kb-other-tenant/doc/doc-other@v1",
        },
        {
          sourceKind: "knowledge",
          docId: "doc-local",
          docTitle: "Travel Policy",
          kbId: "kb-local",
          versionId: "v1",
          score: 0.9,
          chunkText: "Local travel policy excerpt.",
          sourceUri: "ku://kb/kb-local/doc/doc-local@v1",
        },
      ],
    });
    expect(filtered.kept.map((item) => item.docId)).toEqual(["doc-local"]);
    expect(filtered.excludedReasons).toContain("policy_mismatch");
    expect(filtered.excludedReasons).toContain("cross_tenant");
  });

  it("keeps only enterprise evidence when selectedSources is enterprise", () => {
    const filtered = filterKnowledgeEvidenceForPrompt({
      sourcePolicy: {
        liveSourcesAllowed: true,
        allowedSources: ["personal", "enterprise", "data"],
      },
      selectedSources: ["enterprise"],
      tenantId: "tenant-a",
      readableKnowledgeBaseIds: new Set(["kb-local", "kb-enterprise"]),
      lookupKnowledgeBase: (kbId) => reviewState.bases[kbId],
      evidence: [
        {
          sourceKind: "knowledge",
          docId: "doc-local",
          docTitle: "Travel Policy",
          kbId: "kb-local",
          versionId: "v1",
          score: 0.9,
          chunkText: "personal excerpt",
          sourceUri: "ku://kb/kb-local/doc/doc-local@v1",
        },
        {
          sourceKind: "knowledge",
          docId: "doc-enterprise",
          docTitle: "Corp Policy",
          kbId: "kb-enterprise",
          versionId: "v1",
          score: 0.8,
          chunkText: "enterprise excerpt",
          sourceUri: "ku://kb/kb-enterprise/doc/doc-enterprise@v1",
        },
        {
          sourceKind: "knowledge",
          docId: "source:xueqiu-source",
          docTitle: "Live",
          kbId: "kb-local",
          versionId: "v1",
          score: 1,
          chunkText: "live body",
          sourceUri: "ku://active/xueqiu-source/api",
        },
      ],
    });
    expect(filtered.kept.map((item) => item.docId)).toEqual(["doc-enterprise"]);
  });

  it("keeps only personal evidence when selectedSources is personal", () => {
    const filtered = filterKnowledgeEvidenceForPrompt({
      sourcePolicy: {
        liveSourcesAllowed: true,
        allowedSources: ["personal", "enterprise", "data"],
      },
      selectedSources: ["personal"],
      tenantId: "tenant-a",
      readableKnowledgeBaseIds: new Set(["kb-local", "kb-enterprise"]),
      lookupKnowledgeBase: (kbId) => reviewState.bases[kbId],
      evidence: [
        {
          sourceKind: "knowledge",
          docId: "doc-local",
          docTitle: "Travel Policy",
          kbId: "kb-local",
          versionId: "v1",
          score: 0.9,
          chunkText: "personal excerpt",
          sourceUri: "ku://kb/kb-local/doc/doc-local@v1",
        },
        {
          sourceKind: "knowledge",
          docId: "doc-enterprise",
          docTitle: "Corp Policy",
          kbId: "kb-enterprise",
          versionId: "v1",
          score: 0.8,
          chunkText: "enterprise excerpt",
          sourceUri: "ku://kb/kb-enterprise/doc/doc-enterprise@v1",
        },
        {
          sourceKind: "knowledge",
          docId: "source:xueqiu-source",
          docTitle: "Live",
          kbId: "kb-local",
          versionId: "v1",
          score: 1,
          chunkText: "live body",
          sourceUri: "ku://active/xueqiu-source/api",
        },
      ],
    });
    expect(filtered.kept.map((item) => item.docId)).toEqual(["doc-local"]);
    expect(filtered.kept.some((item) => item.docId === "doc-enterprise")).toBe(false);
    expect(filtered.kept.some((item) => item.docId.startsWith("source:"))).toBe(false);
  });

  it("does not fallback-inject other sources when selectedSources is empty", () => {
    const filtered = filterKnowledgeEvidenceForPrompt({
      sourcePolicy: {
        liveSourcesAllowed: true,
        allowedSources: ["personal", "enterprise", "data"],
      },
      selectedSources: [],
      tenantId: "tenant-a",
      readableKnowledgeBaseIds: new Set(["kb-local", "kb-enterprise"]),
      lookupKnowledgeBase: (kbId) => reviewState.bases[kbId],
      evidence: [
        {
          sourceKind: "knowledge",
          docId: "doc-local",
          docTitle: "Travel Policy",
          kbId: "kb-local",
          versionId: "v1",
          score: 0.9,
          chunkText: "personal excerpt",
          sourceUri: "ku://kb/kb-local/doc/doc-local@v1",
        },
        {
          sourceKind: "knowledge",
          docId: "source:xueqiu-source",
          docTitle: "Live",
          kbId: "kb-local",
          versionId: "v1",
          score: 1,
          chunkText: "live body",
          sourceUri: "ku://active/xueqiu-source/api",
        },
      ],
    });
    expect(filtered.kept).toEqual([]);
  });

  it("retrieve default policy keeps local evidence and does not invoke live sources", async () => {
    const result = await runKnowledgeRuntimeEngine(null, {
      taskContext: { taskType: "research", agentId: "employee-agent" },
      query: "查询雪球最新实时数据",
      sourcePolicy: { ...retrievePolicy },
    });
    expect(reviewState.invokeApiSourceMock).not.toHaveBeenCalled();
    expect(result.diagnostics.liveSkipped).toBe(true);
    expect(result.diagnostics.liveInvoked).toBe(false);
    expect(result.resolve.selectedSources).not.toContain("data");
    expect(result.context.evidence.some((item) => item.docId.startsWith("source:"))).toBe(false);
    expect(result.context.evidence.some((item) => item.docId === "doc-local")).toBe(true);
    expect(result.context.promptBlock).toContain("untrusted content");
  });

  it("reads an explicitly selected file by parent scope and emits one receipt", async () => {
    const result = await runKnowledgeRuntimeEngine(null, {
      taskContext: { taskType: "research", agentId: "employee-agent" },
      query: "selected",
      sourcePolicy: { ...retrievePolicy },
      selection: {
        refs: [{ type: "knowledge-file", id: "doc-selected", parentId: "kb-local" }],
      },
    });

    expect(result.context.evidence).toEqual([
      expect.objectContaining({
        kbId: "kb-local",
        docId: "doc-selected",
        chunkText: "Exact selected document body.",
      }),
    ]);
    expect(result.receipts).toEqual([
      expect.objectContaining({
        ref: { type: "knowledge-file", id: "doc-selected", parentId: "kb-local" },
        status: "consumed",
        evidenceKind: "index-chunk",
        chunkIds: ["chunk-selected"],
      }),
    ]);
  });

  it("invokes live sources when explicit live intent, ACL, and policy allow it", async () => {
    const result = await runKnowledgeRuntimeEngine(null, {
      taskContext: { taskType: "analysis", agentId: "employee-agent" },
      query: "查询雪球最新实时数据",
      sourcePolicy: { ...liveAllowedPolicy },
      selection: { refs: [{ type: "api", id: "xueqiu-source", parentId: "kb-local" }] },
    });
    expect(reviewState.invokeApiSourceMock).toHaveBeenCalledTimes(1);
    expect(result.diagnostics.liveSkipped).toBe(false);
    expect(result.diagnostics.liveInvoked).toBe(true);
    expect(result.context.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          docId: "source:xueqiu-source",
        }),
      ]),
    );
  });

  it("does not invoke an explicit API ref when liveSourcesAllowed is false", async () => {
    const result = await runKnowledgeRuntimeEngine(null, {
      taskContext: { taskType: "analysis", agentId: "employee-agent" },
      query: "查询雪球最新实时数据",
      sourcePolicy: { ...retrievePolicy },
      selection: { refs: [{ type: "api", id: "xueqiu-source", parentId: "kb-local" }] },
    });
    expect(reviewState.invokeApiSourceMock).not.toHaveBeenCalled();
    expect(result.diagnostics.liveInvoked).toBe(false);
    expect(result.context.evidence.some((item) => item.docId.startsWith("source:"))).toBe(false);
    expect(result.receipts).toEqual([
      expect.objectContaining({
        ref: { type: "api", id: "xueqiu-source", parentId: "kb-local" },
        status: "denied",
        reasonCode: "live_api_not_allowed",
      }),
    ]);
  });

  it("does not put personal evidence in the prompt when selectedSources is enterprise", async () => {
    reviewState.searchMock.mockResolvedValue([
      {
        sourceKind: "knowledge",
        docId: "doc-local",
        docTitle: "Travel Policy",
        kbId: "kb-local",
        versionId: "v1",
        score: 0.9,
        chunkText: "personal excerpt",
        sourceUri: "ku://kb/kb-local/doc/doc-local@v1",
      },
      {
        sourceKind: "knowledge",
        docId: "doc-enterprise",
        docTitle: "Corp Policy",
        kbId: "kb-enterprise",
        versionId: "v1",
        score: 0.8,
        chunkText: "enterprise excerpt",
        sourceUri: "ku://kb/kb-enterprise/doc/doc-enterprise@v1",
      },
    ]);
    const result = await runKnowledgeRuntimeEngine(null, {
      taskContext: { taskType: "analysis", agentId: "employee-agent" },
      query: "客户成交率为什么下降",
      sourcePolicy: { ...retrievePolicy },
    });
    expect(result.resolve.selectedSources).toEqual(["enterprise"]);
    expect(result.context.evidence.map((item) => item.docId)).toEqual(["doc-enterprise"]);
    expect(result.context.promptBlock).not.toContain("personal excerpt");
  });

  it("does not put enterprise or data evidence in the prompt when selectedSources is personal", async () => {
    reviewState.searchMock.mockResolvedValue([
      {
        sourceKind: "knowledge",
        docId: "doc-local",
        docTitle: "Travel Policy",
        kbId: "kb-local",
        versionId: "v1",
        score: 0.9,
        chunkText: "personal excerpt",
        sourceUri: "ku://kb/kb-local/doc/doc-local@v1",
      },
      {
        sourceKind: "knowledge",
        docId: "doc-enterprise",
        docTitle: "Corp Policy",
        kbId: "kb-enterprise",
        versionId: "v1",
        score: 0.8,
        chunkText: "enterprise excerpt",
        sourceUri: "ku://kb/kb-enterprise/doc/doc-enterprise@v1",
      },
    ]);
    const result = await runKnowledgeRuntimeEngine(null, {
      taskContext: {
        taskType: "research",
        agentId: "employee-agent",
        requestedSourceHints: ["personal"],
      },
      query: "查询知识库里的差旅政策",
      sourcePolicy: { ...retrievePolicy },
    });
    expect(result.resolve.selectedSources).toEqual(["personal"]);
    expect(result.context.evidence.map((item) => item.docId)).toEqual(["doc-local"]);
    expect(result.context.promptBlock).not.toContain("enterprise excerpt");
  });

  it("does not fallback-inject evidence when selectedSources is empty", async () => {
    const result = await runKnowledgeRuntimeEngine(null, {
      taskContext: { taskType: "general", agentId: "employee-agent" },
      query: "晚上好",
      sourcePolicy: { ...retrievePolicy },
    });
    expect(result.resolve.selectedSources).toEqual([]);
    expect(result.context.evidence).toEqual([]);
    expect(reviewState.invokeApiSourceMock).not.toHaveBeenCalled();
  });

  it("drops unselected and unmapped graph nodes when source policy is on", () => {
    const bundle = mockBundle();
    const enterpriseGraph = filterRelationshipGraphBySources({
      graph: bundle.graph,
      objects: bundle.objects,
      selectedSources: ["enterprise"],
    });
    expect(graphMentions(enterpriseGraph, PERSONAL_PLANE_IDS)).toBe(false);
    expect(graphMentions(enterpriseGraph, DATA_PLANE_IDS)).toBe(false);
    expect(graphMentions(enterpriseGraph, ["obj-orphan", "node:obj-orphan"])).toBe(false);
    expect(graphMentions(enterpriseGraph, ["obj-enterprise", "obj-enterprise-2"])).toBe(true);

    const emptyGraph = filterRelationshipGraphBySources({
      graph: bundle.graph,
      objects: bundle.objects,
      selectedSources: [],
    });
    expect(emptyGraph).toEqual({ nodes: [], edges: [] });
  });

  it("does not put personal or data graph nodes, edges, or recommendations in enterprise-only resolve", async () => {
    const result = await runKnowledgeRuntimeEngine(null, {
      taskContext: { taskType: "analysis", agentId: "employee-agent" },
      query: "客户成交率为什么下降",
      sourcePolicy: { ...retrievePolicy },
    });
    expect(result.resolve.selectedSources).toEqual(["enterprise"]);
    expect(graphMentions(result.resolve.graph, PERSONAL_PLANE_IDS)).toBe(false);
    expect(graphMentions(result.resolve.graph, DATA_PLANE_IDS)).toBe(false);
    expect(graphMentions(result.resolve.graph, ["obj-orphan", "node:obj-orphan"])).toBe(false);
    expect(result.resolve.graph.nodes.some((node) => node.objectId === "obj-enterprise")).toBe(
      true,
    );
    expect(result.resolve.recommendations.map((item) => item.object.source)).toEqual([
      "enterprise",
    ]);
    expect(result.resolve.recommendations.map((item) => item.object.id)).not.toContain(
      "obj-personal",
    );
    expect(result.resolve.recommendations.map((item) => item.object.id)).not.toContain("obj-data");
    expect(result.context.relatedObjects.every((item) => item.source === "enterprise")).toBe(true);
    expect(result.context.recommendedCapabilities).toEqual([]);
  });

  it("does not put enterprise or data graph nodes, edges, or recommendations in personal-only resolve", async () => {
    const result = await runKnowledgeRuntimeEngine(null, {
      taskContext: {
        taskType: "research",
        agentId: "employee-agent",
        requestedSourceHints: ["personal"],
      },
      query: "查询知识库里的差旅政策",
      sourcePolicy: { ...retrievePolicy },
    });
    expect(result.resolve.selectedSources).toEqual(["personal"]);
    expect(graphMentions(result.resolve.graph, ENTERPRISE_PLANE_IDS)).toBe(false);
    expect(graphMentions(result.resolve.graph, DATA_PLANE_IDS)).toBe(false);
    expect(result.resolve.graph.nodes.some((node) => node.objectId === "obj-personal")).toBe(true);
    expect(result.resolve.recommendations.every((item) => item.object.source === "personal")).toBe(
      true,
    );
    expect(result.resolve.recommendations.map((item) => item.object.id)).not.toContain(
      "obj-enterprise",
    );
    expect(result.resolve.recommendations.map((item) => item.object.id)).not.toContain("obj-data");
    expect(result.context.relatedObjects.every((item) => item.source === "personal")).toBe(true);
    expect(result.context.recommendedCapabilities).toEqual([]);
  });

  it("does not fallback to the full graph or recommendations when selectedSources is empty", async () => {
    const result = await runKnowledgeRuntimeEngine(null, {
      taskContext: { taskType: "general", agentId: "employee-agent" },
      query: "晚上好",
      sourcePolicy: { ...retrievePolicy },
    });
    expect(result.resolve.selectedSources).toEqual([]);
    expect(result.resolve.graph).toEqual({ nodes: [], edges: [] });
    expect(result.resolve.recommendations).toEqual([]);
    expect(result.context.relatedObjects).toEqual([]);
    expect(result.context.recommendedCapabilities).toEqual([]);
    expect(result.context.graph).toEqual({ nodes: [], edges: [] });
  });

  it("keeps only enterprise recent-visit memory hints in enterprise-only runtime context", async () => {
    const result = await runKnowledgeRuntimeEngine(null, {
      taskContext: { taskType: "analysis", agentId: "employee-agent" },
      query: "客户成交率为什么下降",
      sourcePolicy: { ...retrievePolicy },
    });
    expect(result.resolve.selectedSources).toEqual(["enterprise"]);
    expect(result.memoryHints).toEqual(["Corp policy"]);
    expect(result.context.promptBlock).toContain(
      "Recent knowledge visits (titles only, not body): Corp policy",
    );
    expect(result.context.promptBlock).not.toContain("Travel notes");
    expect(result.context.promptBlock).not.toContain("Live metrics");
    expect(result.context.promptBlock).not.toContain("Ghost visit");
    expect(result.context.promptBlock).not.toContain("Secret playbook");
    expect(result.context.promptBlock).not.toContain("Mismatched personal");
  });

  it("keeps only personal recent-visit memory hints in personal-only runtime context", async () => {
    const result = await runKnowledgeRuntimeEngine(null, {
      taskContext: {
        taskType: "research",
        agentId: "employee-agent",
        requestedSourceHints: ["personal"],
      },
      query: "查询知识库里的差旅政策",
      sourcePolicy: { ...retrievePolicy },
    });
    expect(result.resolve.selectedSources).toEqual(["personal"]);
    expect(result.memoryHints).toEqual(["Travel notes"]);
    expect(result.context.promptBlock).toContain(
      "Recent knowledge visits (titles only, not body): Travel notes",
    );
    expect(result.context.promptBlock).not.toContain("Corp policy");
    expect(result.context.promptBlock).not.toContain("Live metrics");
    expect(result.context.promptBlock).not.toContain("Ghost visit");
    expect(result.context.promptBlock).not.toContain("Secret playbook");
    expect(result.context.promptBlock).not.toContain("Mismatched personal");
  });

  it("clears recent-visit memory hints when selectedSources is empty", async () => {
    const result = await runKnowledgeRuntimeEngine(null, {
      taskContext: { taskType: "general", agentId: "employee-agent" },
      query: "晚上好",
      sourcePolicy: { ...retrievePolicy },
    });
    expect(result.resolve.selectedSources).toEqual([]);
    expect(result.memoryHints).toEqual([]);
    expect(result.context.promptBlock).not.toContain("Recent knowledge visits");
    expect(result.context.promptBlock).not.toContain("Travel notes");
    expect(result.context.promptBlock).not.toContain("Corp policy");
    expect(result.context.promptBlock).not.toContain("Live metrics");
    expect(result.context.promptBlock).not.toContain("Ghost visit");
  });

  it("still falls back to the full bundle graph when source policy is off", async () => {
    const resolved = await runKnowledgeResolveEngine(null, {
      taskContext: { taskType: "general" },
      query: "xyz-no-node-match",
    });
    expect(graphMentions(resolved.graph, PERSONAL_PLANE_IDS)).toBe(true);
    expect(graphMentions(resolved.graph, ENTERPRISE_PLANE_IDS)).toBe(true);
    expect(graphMentions(resolved.graph, DATA_PLANE_IDS)).toBe(true);
  });

  it("does not call invokeApiSource for live bindings excluded by selectedSources", async () => {
    reviewState.bindings.push({
      id: "second-live-source",
      kind: "api",
      plane: "active",
      title: "备用实时数据 API",
      endpoint: "https://api.example.test",
      ownerId: "user-a",
      knowledgeBaseId: reviewState.knowledgeBaseId,
      metadata: {
        "request.method": "GET",
        "request.path": "/api/backup",
      },
      createdAtMs: 1,
    });
    await runKnowledgeRuntimeEngine(null, {
      taskContext: {
        taskType: "analysis",
        agentId: "employee-agent",
        requestedSourceHints: ["enterprise"],
      },
      query: "查询雪球最新实时数据",
      sourcePolicy: { ...liveAllowedPolicy },
      selection: { refs: [{ type: "api", id: "xueqiu-source", parentId: "kb-local" }] },
    });
    expect(reviewState.invokeApiSourceMock).not.toHaveBeenCalled();
    expect(reviewState.invokeApiSourceMock).not.toHaveBeenCalledWith(
      "xueqiu-source",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(reviewState.invokeApiSourceMock).not.toHaveBeenCalledWith(
      "second-live-source",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("does not invoke live sources when ACL denies the binding", async () => {
    reviewState.readable = new Set();
    const result = await runKnowledgeRuntimeEngine(null, {
      taskContext: { taskType: "analysis", agentId: "employee-agent" },
      query: "查询雪球最新实时数据",
      sourcePolicy: { ...liveAllowedPolicy },
      selection: { refs: [{ type: "api", id: "xueqiu-source", parentId: "kb-local" }] },
    });
    expect(reviewState.invokeApiSourceMock).not.toHaveBeenCalled();
    expect(result.context.evidence.some((item) => item.docId.startsWith("source:"))).toBe(false);
  });

  it("does not invoke expired live sources", async () => {
    reviewState.bindings[0] = {
      ...reviewState.bindings[0],
      metadata: {
        ...(reviewState.bindings[0]?.metadata as Record<string, string>),
        expiresAt: "2000-01-01T00:00:00.000Z",
      },
    };
    await runKnowledgeRuntimeEngine(null, {
      taskContext: { taskType: "analysis", agentId: "employee-agent" },
      query: "查询雪球最新实时数据",
      sourcePolicy: { ...liveAllowedPolicy },
      selection: { refs: [{ type: "api", id: "xueqiu-source", parentId: "kb-local" }] },
    });
    expect(reviewState.invokeApiSourceMock).not.toHaveBeenCalled();
  });

  it("still returns local evidence when a single live source times out", async () => {
    reviewState.searchMock.mockResolvedValue([
      {
        sourceKind: "knowledge",
        docId: "doc-enterprise",
        docTitle: "Corp Policy",
        kbId: "kb-enterprise",
        versionId: "v1",
        score: 0.8,
        chunkText: "enterprise excerpt",
        sourceUri: "ku://kb/kb-enterprise/doc/doc-enterprise@v1",
      },
    ]);
    reviewState.invokeApiSourceMock.mockImplementation(async (_id, _path, _ctx, options) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 5_000);
        options?.abortSignal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
      return {
        sourceId: "xueqiu-source",
        fetchedAtMs: Date.now(),
        data: { leaked: true },
      };
    });
    const started = Date.now();
    const result = await runKnowledgeRuntimeEngine(null, {
      taskContext: { taskType: "analysis", agentId: "employee-agent" },
      query: "查询雪球最新实时数据",
      sourcePolicy: { ...liveAllowedPolicy },
      selection: { refs: [{ type: "api", id: "xueqiu-source", parentId: "kb-local" }] },
    });
    expect(Date.now() - started).toBeLessThan(2_500);
    expect(result.diagnostics.timeoutReason).toBe("live_source");
    expect(result.context.evidence.some((item) => item.docId === "doc-enterprise")).toBe(true);
    expect(result.context.evidence.some((item) => item.chunkText.includes("leaked"))).toBe(false);
  });

  it("times out the local knowledge stage without blocking a result", async () => {
    reviewState.searchMock.mockImplementation(
      async () =>
        await new Promise((resolve) => {
          setTimeout(
            () =>
              resolve([
                {
                  sourceKind: "knowledge",
                  docId: "doc-late",
                  docTitle: "Late",
                  kbId: "kb-local",
                  versionId: "v1",
                  score: 1,
                  chunkText: "should not be written after timeout",
                  sourceUri: "ku://kb/kb-local/doc/doc-late@v1",
                },
              ]),
            2_000,
          );
        }),
    );
    const started = Date.now();
    const result = await runKnowledgeRuntimeEngine(null, {
      taskContext: { taskType: "research", agentId: "employee-agent" },
      query: "查询知识库里的差旅政策",
      sourcePolicy: { ...retrievePolicy },
    });
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(result.diagnostics.timeoutReason).toBe("stage");
    expect(result.diagnostics.degraded).toBe(true);
    expect(result.context.evidence.some((item) => item.docId === "doc-late")).toBe(false);
    expect(result.context.promptBlock).toContain("Knowledge Universe context");
  });

  it("does not write live results after abort", async () => {
    const parent = new AbortController();
    reviewState.invokeApiSourceMock.mockImplementation(async (_id, _path, _ctx, options) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 1_000);
        options?.abortSignal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
      return {
        sourceId: "xueqiu-source",
        fetchedAtMs: Date.now(),
        data: { leaked: true },
      };
    });
    const pending = runKnowledgeRuntimeEngine(null, {
      taskContext: { taskType: "analysis", agentId: "employee-agent" },
      query: "查询雪球最新实时数据",
      sourcePolicy: { ...liveAllowedPolicy },
      selection: { refs: [{ type: "api", id: "xueqiu-source", parentId: "kb-local" }] },
      abortSignal: parent.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    parent.abort("stop");
    const result = await pending;
    expect(result.context.evidence.some((item) => item.chunkText.includes("leaked"))).toBe(false);
  });

  it("loads the knowledge bundle once per runtime turn", async () => {
    await runKnowledgeRuntimeEngine(null, {
      taskContext: { taskType: "research", agentId: "employee-agent" },
      query: "查询知识库里的差旅政策",
      sourcePolicy: { ...retrievePolicy },
    });
    expect(reviewState.loadBundleMock).toHaveBeenCalledTimes(1);
  });

  it("loads the knowledge bundle once when policy is off", async () => {
    await runKnowledgeRuntimeEngine(null, {
      taskContext: { taskType: "analysis", agentId: "employee-agent" },
      query: "查询雪球最新实时数据",
    });
    expect(reviewState.loadBundleMock).toHaveBeenCalledTimes(1);
  });

  it("keeps live invocation disabled when no typed selection or policy is passed", async () => {
    await runKnowledgeRuntimeEngine(null, {
      taskContext: { taskType: "analysis", agentId: "employee-agent" },
      query: "查询雪球最新实时数据",
    });
    expect(reviewState.invokeApiSourceMock).not.toHaveBeenCalled();
  });

  it("resolve engine with retrieve policy excludes data even when analysis keywords match", async () => {
    const resolved = await runKnowledgeResolveEngine(null, {
      taskContext: { taskType: "analysis" },
      query: "客户成交率为什么下降",
      sourcePolicy: { ...retrievePolicy },
    });
    expect(resolved.selectedSources).not.toContain("data");
    expect(resolved.objects.some((item) => item.source === "data")).toBe(false);
  });
});
