// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "../../../memory/embeddings.js";
import { resetKnowledgeRetrievalServiceForTests } from "../../../retrieval/retrieval-service.js";
import {
  ensureKnowledgeRetrievalSourceRegistered,
  resetKnowledgeRetrievalSourceRegistrationForTests,
} from "../../../retrieval/sources/knowledge-source.js";
import { ingestKnowledgeDocument } from "../kb-ingest.js";
import { createKnowledgeBase } from "../knowledge-base-store.js";
import {
  runKnowledgeContextEngine,
  runKnowledgeRuntimeEngine,
  type KnowledgeResolveSourcePolicy,
} from "./resolve-engine.js";

const reviewState = vi.hoisted(() => ({
  knowledgeBaseId: "",
  invokeApiSourceMock: vi.fn(async (sourceId: string) => ({
    sourceId,
    fetchedAtMs: 1_786_000_000_000,
    data:
      sourceId === "ffd-source"
        ? { code: "600519.SH", close: 1418.5 }
        : { provider: "xueqiu-live", items: [{ title: "Market update" }] },
  })),
  tmpDir: `/tmp/openbot-kb-context-evidence-${Math.random().toString(36).slice(2)}`,
}));

const { invokeApiSourceMock, tmpDir } = reviewState;

vi.mock("../../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: reviewState.tmpDir,
  };
});

vi.mock("../context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(async () => ({
    userId: "user-a",
    seatId: null,
    tenantId: null,
    hasEnterpriseScope: false,
  })),
}));

vi.mock("../sources/source-binding-store.js", () => ({
  listKnowledgeSourceBindings: vi.fn(() => [
    {
      id: "ffd-source",
      kind: "api",
      plane: "active",
      title: "FFD Market Data",
      endpoint: "https://ffd.findesk.cn",
      ownerId: "user-a",
      knowledgeBaseId: reviewState.knowledgeBaseId,
      createdAtMs: 1,
    },
    {
      id: "xueqiu-source",
      kind: "api",
      plane: "active",
      title: "雪球实时数据 API",
      endpoint: "http://124.223.180.129:3220",
      ownerId: "another-user",
      knowledgeBaseId: reviewState.knowledgeBaseId,
      metadata: {
        "request.method": "GET",
        "request.path": "/api/s?id=xueqiu-live&latest=true",
      },
      createdAtMs: 1,
    },
  ]),
}));

vi.mock("../sources/source-api-runtime.js", () => ({
  getApiSourceCatalog: vi.fn(() => null),
  invokeApiSource: reviewState.invokeApiSourceMock,
}));

const mockProvider: EmbeddingProvider = {
  id: "openai",
  model: "mock-embed",
  embedQuery: async (text: string) => [text.length % 7, 0.2, 0.4],
  embedBatch: async (texts: string[]) => texts.map((text: string) => [text.length % 7, 0.2, 0.4]),
};

const liveAllowedPolicy: KnowledgeResolveSourcePolicy = {
  liveSourcesAllowed: true,
  allowedSources: ["personal", "enterprise", "data"],
};

function cleanStore() {
  fs.rmSync(path.join(tmpDir, "skill-assets"), { recursive: true, force: true });
  fs.rmSync(path.join(tmpDir, "knowledge"), { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

describe("runKnowledgeContextEngine evidence injection", () => {
  let storePath: string;
  let indexRoot: string;

  beforeEach(async () => {
    invokeApiSourceMock.mockClear();
    cleanStore();
    resetKnowledgeRetrievalServiceForTests();
    resetKnowledgeRetrievalSourceRegistrationForTests();
    storePath = path.join(tmpDir, "knowledge", "bases.json");
    indexRoot = path.join(tmpDir, "knowledge", "index");
    const kb = createKnowledgeBase(
      { title: "Agent KB", ownerId: "user-a", tenantId: null },
      storePath,
    );
    reviewState.knowledgeBaseId = kb.id;
    ensureKnowledgeRetrievalSourceRegistered({
      embeddingProvider: mockProvider,
      storePath,
      indexRoot,
    });
    await ingestKnowledgeDocument({
      kbId: kb.id,
      docId: "doc-agent-1",
      title: "Escalation Guide",
      fileName: "escalation.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Escalation Guide\n\nRestart gateway after deploy.", "utf8"),
      ownerId: "user-a",
      tenantId: null,
      indexRoot,
      embeddingProvider: mockProvider,
    });
  });

  afterEach(() => {
    cleanStore();
    fs.rmSync(indexRoot, { recursive: true, force: true });
    resetKnowledgeRetrievalServiceForTests();
    resetKnowledgeRetrievalSourceRegistrationForTests();
  });

  it("injects indexed evidence into agent prompt block", async () => {
    const context = await runKnowledgeContextEngine(null, {
      taskContext: { taskType: "analysis", agentId: "employee-agent" },
      query: "Restart gateway",
    });
    expect(context.evidence.length).toBeGreaterThan(0);
    expect(context.promptBlock).toContain("Retrieved knowledge evidence");
    expect(context.promptBlock).toContain("ku://kb/");
    expect(context.promptBlock).toMatch(/《Escalation Guide/);
  });

  it("does not invoke a live connector from query keywords alone", async () => {
    const context = await runKnowledgeContextEngine(null, {
      taskContext: { taskType: "analysis", agentId: "employee-agent" },
      query: "查询 600519.SH 在 2026-06-01 到 2026-06-04 的开盘和收盘价",
    });

    expect(invokeApiSourceMock).not.toHaveBeenCalled();
    expect(context.evidence.some((item) => item.docId.startsWith("source:"))).toBe(false);
  });

  it("does not invoke an explicit API ref without an authorizing live policy", async () => {
    const result = await runKnowledgeRuntimeEngine(null, {
      taskContext: { taskType: "analysis", agentId: "employee-agent" },
      query: "查询雪球最新实时数据",
      selection: {
        refs: [{ type: "api", id: "xueqiu-source", parentId: reviewState.knowledgeBaseId }],
      },
    });

    expect(invokeApiSourceMock).not.toHaveBeenCalled();
    expect(result.context.evidence.some((item) => item.docId.startsWith("source:"))).toBe(false);
    expect(result.receipts).toEqual([
      expect.objectContaining({
        ref: {
          type: "api",
          id: "xueqiu-source",
          parentId: reviewState.knowledgeBaseId,
        },
        status: "denied",
        reasonCode: "live_api_not_allowed",
      }),
    ]);
  });

  it("plans and injects live FFD evidence for an explicit typed API ref when live policy allows it", async () => {
    const result = await runKnowledgeRuntimeEngine(null, {
      taskContext: { taskType: "analysis", agentId: "employee-agent" },
      query: "查询 600519.SH 在 2026-06-01 到 2026-06-04 的开盘和收盘价",
      sourcePolicy: { ...liveAllowedPolicy },
      selection: {
        refs: [{ type: "api", id: "ffd-source", parentId: reviewState.knowledgeBaseId }],
      },
    });
    const context = result.context;

    expect(invokeApiSourceMock).toHaveBeenCalledWith(
      "ffd-source",
      "/api/query",
      expect.objectContaining({ userId: "user-a" }),
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          function: "history",
          codes: "600519.SH",
          start_date: "2026-06-01",
          end_date: "2026-06-04",
        }),
      }),
    );
    expect(context.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          docId: "source:ffd-source",
          sourceUri: "ku://active/ffd-source/api/query",
        }),
      ]),
    );
    expect(context.promptBlock).toContain("600519.SH");
    expect(context.promptBlock).toContain("ku://active/ffd-source/api/query");
    expect(result.receipts).toEqual([
      expect.objectContaining({
        ref: {
          type: "api",
          id: "ffd-source",
          parentId: reviewState.knowledgeBaseId,
        },
        status: "consumed",
        evidenceKind: "live-api",
      }),
    ]);
  });

  it("invokes only the explicitly selected fixed-path API when live policy allows it", async () => {
    const result = await runKnowledgeRuntimeEngine(null, {
      taskContext: { taskType: "analysis", agentId: "employee-agent" },
      query: "查询雪球最新实时数据",
      sourcePolicy: { ...liveAllowedPolicy },
      selection: {
        refs: [{ type: "api", id: "xueqiu-source", parentId: reviewState.knowledgeBaseId }],
      },
    });
    const context = result.context;

    expect(invokeApiSourceMock).toHaveBeenCalledWith(
      "xueqiu-source",
      "/api/s?id=xueqiu-live&latest=true",
      expect.objectContaining({ userId: "user-a" }),
      expect.objectContaining({
        method: "GET",
        authorizedKnowledgeBaseIds: expect.any(Set),
      }),
    );
    // The live HTTP call keeps its query string, but the citation URI must be redacted
    // so tokens/account ids in query params never reach the prompt, logs or responses.
    expect(context.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          docId: "source:xueqiu-source",
          sourceUri: "ku://active/xueqiu-source/api/s",
        }),
      ]),
    );
    const xueqiuEvidence = context.evidence.find((item) => item.docId === "source:xueqiu-source");
    expect(xueqiuEvidence?.sourceUri).not.toContain("?");
    expect(xueqiuEvidence?.sourceUri).not.toContain("xueqiu-live");
    expect(context.promptBlock).not.toContain("id=xueqiu-live");
  });
});
