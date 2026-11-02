import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToolInputError } from "./common.js";

const knowledgeSearch = vi.hoisted(() => vi.fn());
const knowledgeObject = vi.hoisted(() => vi.fn());
const searchKnowledgeEvidence = vi.hoisted(() => vi.fn());
const resolveKnowledgeToolGatewayClient = vi.hoisted(() => vi.fn());

vi.mock("../../gateway/knowledge/agent-run-gateway-client.js", () => ({
  resolveKnowledgeToolGatewayClient,
}));

vi.mock("../../gateway/knowledge/context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(async () => ({
    userId: "user-1",
    seatId: "seat-1",
    tenantId: "tenant-1",
  })),
}));

vi.mock("../../gateway/knowledge/router.js", () => ({
  knowledgeSearch,
  knowledgeObject,
}));

vi.mock("../../gateway/knowledge/knowledge-retrieval-runtime.js", () => ({
  retrievalContextFromKnowledgeSourceContext: vi.fn(() => ({
    userId: "user-1",
    seatId: "seat-1",
    tenantId: "tenant-1",
  })),
  searchKnowledgeEvidence,
}));

const { createKnowledgeGetTool, createKnowledgeSearchTool } =
  await import("./knowledge-consume-tool.js");

function evidence(
  overrides?: Partial<{
    docId: string;
    docTitle: string;
    kbId: string;
    chunkText: string;
    sourceUri: string;
    section: string;
  }>,
) {
  const docId = overrides?.docId ?? "doc-resume";
  return {
    sourceKind: "knowledge" as const,
    docId,
    docTitle: overrides?.docTitle ?? "王婧简历",
    kbId: overrides?.kbId ?? "kb-personal",
    versionId: "ver-1",
    score: 0.9,
    chunkText: overrides?.chunkText ?? "基本信息：王婧，大学生优才计划。",
    section: overrides?.section ?? "基本信息",
    sourceUri:
      overrides?.sourceUri ??
      `ku://kb/kb-personal/doc/${docId}@ver-1#${encodeURIComponent("基本信息")}`,
  };
}

describe("knowledge consume tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveKnowledgeToolGatewayClient.mockResolvedValue({ user: "user@example.com" });
    knowledgeSearch.mockResolvedValue({
      searchMode: "indexed",
      evidence: [evidence()],
      results: [],
    });
    knowledgeObject.mockResolvedValue({
      id: "obj:doc:doc-resume",
      title: "王婧简历",
      source: "personal",
      kind: "document",
      summary: "优才计划信息表",
      tags: ["简历"],
    });
    searchKnowledgeEvidence.mockResolvedValue([evidence()]);
  });

  it("search maps indexed evidence to followable objectId and ku://", async () => {
    const tool = createKnowledgeSearchTool({ gatewayClientUser: "user@example.com" });
    const result = await tool.execute("call-1", { query: "王婧 简历" });
    const details = result.details as {
      searchMode: string;
      hits: Array<{ objectId: string; sourceUri: string; excerpt: string }>;
    };
    expect(knowledgeSearch).toHaveBeenCalledWith(expect.anything(), {
      query: "王婧 简历",
      limit: 8,
    });
    expect(details.searchMode).toBe("indexed");
    expect(details.hits[0]?.objectId).toBe("obj:doc:doc-resume");
    expect(details.hits[0]?.sourceUri).toContain("ku://kb/kb-personal/doc/doc-resume@ver-1");
    expect(details.hits[0]?.excerpt).toContain("王婧");
  });

  it("search scoped to a knowledge base uses the same evidence retriever", async () => {
    const tool = createKnowledgeSearchTool({ gatewayClientUser: "user@example.com" });
    await tool.execute("call-2", { query: "优才", knowledgeBaseId: "kb-personal", limit: 4 });
    expect(knowledgeSearch).not.toHaveBeenCalled();
    expect(searchKnowledgeEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "优才",
        kbScope: ["kb-personal"],
        maxResults: 4,
      }),
    );
  });

  it("search keeps enterprise feed rows ahead of indexed library hits", async () => {
    knowledgeSearch.mockResolvedValue({
      searchMode: "indexed",
      evidence: [evidence()],
      results: [
        {
          id: "obj:enterprise:feed:warehouse",
          title: "001-用友T+仓库",
          source: "enterprise",
          kind: "document",
          summary: 'warehouse {"items":[{"Name":"京扇子仓"}]}',
          tags: ["erp-yonyou-tplus"],
        },
      ],
    });
    const tool = createKnowledgeSearchTool({ gatewayClientUser: "user@example.com" });
    const details = (await tool.execute("call-feed", { query: "用友仓库" })).details as {
      searchMode: string;
      note?: string;
      hits: Array<{ objectId: string; title: string; excerpt: string }>;
    };
    expect(details.searchMode).toBe("enterprise_feed");
    expect(details.hits[0]?.objectId).toBe("obj:enterprise:feed:warehouse");
    expect(details.hits[0]?.excerpt).toContain("京扇子仓");
    expect(details.hits[1]?.objectId).toBe("obj:doc:doc-resume");
    expect(details.note).toContain("云电脑");
  });

  it("search substring fallback returns object ids and not_indexed", async () => {
    knowledgeSearch.mockResolvedValue({
      searchMode: "substring",
      evidence: [],
      results: [
        {
          id: "obj:personal:skill-1",
          title: "内部手册",
          source: "personal",
          kind: "document",
          summary: "产品备忘",
          tags: [],
        },
      ],
    });
    const tool = createKnowledgeSearchTool({ gatewayClientUser: "user@example.com" });
    const details = (await tool.execute("call-3", { query: "手册" })).details as {
      searchMode: string;
      hint?: string;
      hits: Array<{ objectId: string; sourceUri: string | null }>;
    };
    expect(details.searchMode).toBe("substring");
    expect(details.hint).toBe("not_indexed");
    expect(details.hits[0]?.objectId).toBe("obj:personal:skill-1");
    expect(details.hits[0]?.sourceUri).toBeNull();
  });

  it("get follows objectId through knowledgeObject and document chunks", async () => {
    const tool = createKnowledgeGetTool({ gatewayClientUser: "user@example.com" });
    const details = (await tool.execute("call-4", { objectId: "obj:doc:doc-resume" })).details as {
      ok: boolean;
      object: { id: string };
      chunks: Array<{ sourceUri: string; text: string }>;
    };
    expect(knowledgeObject).toHaveBeenCalledWith(expect.anything(), {
      objectId: "obj:doc:doc-resume",
      knowledgeBaseId: undefined,
    });
    expect(searchKnowledgeEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: "doc-resume",
        fallbackToCurrentChunks: true,
      }),
    );
    expect(details.ok).toBe(true);
    expect(details.object.id).toBe("obj:doc:doc-resume");
    expect(details.chunks[0]?.text).toContain("王婧");
  });

  it("get parses ku:// sourceUri", async () => {
    const tool = createKnowledgeGetTool({ gatewayClientUser: "user@example.com" });
    await tool.execute("call-5", {
      sourceUri: "ku://kb/kb-personal/doc/doc-resume@ver-1#%E5%9F%BA%E6%9C%AC%E4%BF%A1%E6%81%AF",
    });
    expect(knowledgeObject).toHaveBeenCalledWith(expect.anything(), {
      objectId: "obj:doc:doc-resume",
      knowledgeBaseId: "kb-personal",
    });
    expect(searchKnowledgeEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: "doc-resume",
        kbScope: ["kb-personal"],
        versionId: "ver-1",
        fallbackToCurrentChunks: true,
      }),
    );
  });

  it("get refuses an unparseable sourceUri and missing target", async () => {
    const tool = createKnowledgeGetTool({ gatewayClientUser: "user@example.com" });
    await expect(
      tool.execute("call-6", { sourceUri: "file:///tmp/resume.docx" }),
    ).rejects.toBeInstanceOf(ToolInputError);
    await expect(tool.execute("call-7", {})).rejects.toBeInstanceOf(ToolInputError);
  });

  it("get returns not_found when the object and doc cannot be resolved", async () => {
    knowledgeObject.mockResolvedValue(null);
    const tool = createKnowledgeGetTool({ gatewayClientUser: "user@example.com" });
    const details = (await tool.execute("call-8", { objectId: "obj:personal:missing" }))
      .details as {
      ok: boolean;
      error?: string;
    };
    expect(details).toEqual({ ok: false, error: "not_found" });
    expect(searchKnowledgeEvidence).not.toHaveBeenCalled();
  });

  it("requires a signed-in employee session", async () => {
    resolveKnowledgeToolGatewayClient.mockResolvedValue(null);
    const tool = createKnowledgeSearchTool();
    await expect(tool.execute("call-9", { query: "简历" })).rejects.toThrow(
      /Signed-in employee session/,
    );
  });

  const tcmRefs = [
    { type: "knowledge-file" as const, id: "skill_c0550e28c46b", parentId: "kb_personal" },
  ];

  it("focused search never calls unscoped knowledgeSearch and stays on the selected file", async () => {
    searchKnowledgeEvidence.mockResolvedValue([]);
    knowledgeObject.mockImplementation(async (_client: unknown, params: { objectId: string }) =>
      params.objectId === "obj:personal:skill_c0550e28c46b"
        ? {
            id: "obj:personal:skill_c0550e28c46b",
            title: "中医诊断学完整笔记",
            source: "personal",
            kind: "document",
            summary: "上传文档",
            tags: ["pdf"],
          }
        : null,
    );
    const tool = createKnowledgeSearchTool({
      gatewayClientUser: "user@example.com",
      consumeRefs: tcmRefs,
    });
    const details = (await tool.execute("call-10", { query: "中医诊断学 完整笔记" })).details as {
      searchMode: string;
      hint?: string;
      hits: Array<{ objectId: string; title: string }>;
    };
    expect(knowledgeSearch).not.toHaveBeenCalled();
    expect(searchKnowledgeEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "中医诊断学 完整笔记",
        docId: "skill_c0550e28c46b",
        kbScope: ["kb_personal"],
        fallbackToCurrentChunks: true,
      }),
    );
    expect(details.searchMode).toBe("substring");
    expect(details.hint).toBe("not_indexed");
    expect(details.hits).toEqual([
      expect.objectContaining({
        objectId: "obj:personal:skill_c0550e28c46b",
        title: "中医诊断学完整笔记",
      }),
    ]);
  });

  it("focused get refuses documents outside the selected file", async () => {
    const tool = createKnowledgeGetTool({
      gatewayClientUser: "user@example.com",
      consumeRefs: tcmRefs,
    });
    const details = (await tool.execute("call-11", { objectId: "obj:doc:doc-resume" })).details as {
      ok: boolean;
      error?: string;
    };
    expect(details).toEqual({ ok: false, error: "out_of_scope" });
    expect(knowledgeObject).not.toHaveBeenCalled();
    expect(searchKnowledgeEvidence).not.toHaveBeenCalled();
  });

  it("focused get reads the selected personal file without a target", async () => {
    knowledgeObject.mockImplementation(async (_client: unknown, params: { objectId: string }) =>
      params.objectId === "obj:personal:skill_c0550e28c46b"
        ? {
            id: "obj:personal:skill_c0550e28c46b",
            title: "中医诊断学完整笔记",
            source: "personal",
            kind: "document",
            summary: "上传文档",
            tags: ["pdf"],
          }
        : null,
    );
    searchKnowledgeEvidence.mockResolvedValue([]);
    const tool = createKnowledgeGetTool({
      gatewayClientUser: "user@example.com",
      consumeRefs: tcmRefs,
    });
    const details = (await tool.execute("call-12", {})).details as {
      ok: boolean;
      object: { id: string; title: string };
      hint?: string;
    };
    expect(details.ok).toBe(true);
    expect(details.object).toEqual(
      expect.objectContaining({
        id: "obj:personal:skill_c0550e28c46b",
        title: "中医诊断学完整笔记",
      }),
    );
    expect(details.hint).toBe("not_indexed");
    expect(searchKnowledgeEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: "skill_c0550e28c46b",
        kbScope: ["kb_personal"],
        fallbackToCurrentChunks: true,
      }),
    );
  });
});
