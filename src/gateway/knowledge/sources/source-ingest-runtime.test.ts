import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "../../../memory/embeddings.js";
import { ownershipProofFromTenantUser } from "../../data-governance/ownership-proof.js";
import {
  getKnowledgeDocument,
  openKnowledgeIndex,
  resolveKnowledgeIndexDbPath,
} from "../kb-index.js";
import { listKnowledgeBaseSources } from "../knowledge-base-sources-list.js";
import { createKnowledgeBase } from "../knowledge-base-store.js";
import { bindKnowledgeSource } from "./source-binding-store.js";
import { ingestKnowledgeSourceBinding } from "./source-ingest-runtime.js";
import type { KnowledgeSourceContext } from "./types.js";

const mockProvider: EmbeddingProvider = {
  id: "openai",
  model: "mock-embed",
  embedQuery: async (text) => [text.length % 7, 0.2, 0.4],
  embedBatch: async (texts) => texts.map((text) => [text.length % 7, 0.2, 0.4]),
};

describe("source-ingest-runtime", () => {
  let tmpDir = "";
  let indexRoot = "";
  let bindingsStorePath = "";
  let kbStorePath = "";
  let linkStorePath = "";
  const context: KnowledgeSourceContext = {
    tenantId: "tenant-1",
    seatId: "seat-1",
    userId: "user-1",
    hasEnterpriseScope: true,
  };
  const governanceOwnershipProof = ownershipProofFromTenantUser({
    tenantId: "tenant-1",
    userId: "user-1",
  });

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `source-ingest-${randomUUID()}`);
    indexRoot = path.join(tmpDir, "index");
    bindingsStorePath = path.join(tmpDir, "bindings.json");
    kbStorePath = path.join(tmpDir, "kb-store.json");
    linkStorePath = path.join(tmpDir, "links.json");
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ingests an api binding into kb-index and surfaces documentId on sources.list", async () => {
    const kb = createKnowledgeBase(
      {
        title: "Enterprise space",
        visibility: "enterprise",
        ownerId: "user-1",
        tenantId: "tenant-1",
      },
      kbStorePath,
    );
    const binding = bindKnowledgeSource(
      {
        kind: "api",
        title: "雪球行情",
        knowledgeBaseId: kb.id,
        ownerId: "user-1",
        endpoint: "https://api.example.test",
        visibility: "enterprise",
      },
      bindingsStorePath,
    );

    const fetchApi = vi.fn(async () => ({
      sourceId: binding.id,
      fetchedAtMs: Date.now(),
      data: { symbol: "AAPL", price: 190.2, note: "雪球 mock quote" },
    }));

    const result = await ingestKnowledgeSourceBinding({
      sourceDescriptorId: binding.id,
      knowledgeBase: kb,
      context,
      ownerId: "user-1",
      governanceOwnershipProof,
      options: {
        bindingsStorePath,
        kbStorePath,
        sourceDocumentLinkStorePath: linkStorePath,
        indexRoot,
        embeddingProvider: mockProvider,
        fetchApi: fetchApi as never,
        authorizedKnowledgeBaseIds: new Set([kb.id]),
      },
    });

    expect(result.ok).toBe(true);
    expect(result.documentId).toMatch(/^srcdir-/);
    expect(result.ingest?.skipped).toBe(false);
    expect(fetchApi).toHaveBeenCalledOnce();

    const sources = await listKnowledgeBaseSources({
      knowledgeBase: { ...kb, documentIds: [result.documentId!] },
      bindingsStorePath,
      sourceDocumentLinkStorePath: linkStorePath,
      indexRoot,
    });
    const row = sources.find((item) => item.sourceDescriptorId === binding.id);
    expect(row?.documentId).toBe(result.documentId);

    const index = await openKnowledgeIndex({
      dbPath: resolveKnowledgeIndexDbPath({
        ownerId: "user-1",
        tenantId: "tenant-1",
        indexRoot,
      }),
    });
    try {
      const doc = getKnowledgeDocument(index.db, result.documentId!);
      expect(doc?.title).toBe("雪球行情");
      expect(doc?.kbId).toBe(kb.id);
    } finally {
      index.close();
    }
  });

  it("ingests an external binding via the enterprise-data fetch bridge mock", async () => {
    const kb = createKnowledgeBase(
      {
        title: "Enterprise space",
        visibility: "enterprise",
        ownerId: "user-1",
        tenantId: "tenant-1",
      },
      kbStorePath,
    );
    const binding = bindKnowledgeSource(
      {
        kind: "external",
        title: "雪球连接器",
        knowledgeBaseId: kb.id,
        ownerId: "user-1",
        endpoint: "enterprise-data://tenant/tenant-1/source/src-xueqiu?connectorId=conn-xueqiu",
        visibility: "enterprise",
      },
      bindingsStorePath,
    );

    const fetchExternal = vi.fn(async () => ({
      ok: true as const,
      sourceId: "src-xueqiu",
      capabilityId: "cap-xueqiu",
      payload: { rows: [{ name: "雪球外部源沉淀" }] },
    }));

    const result = await ingestKnowledgeSourceBinding({
      sourceDescriptorId: binding.id,
      knowledgeBase: kb,
      context,
      ownerId: "user-1",
      governanceOwnershipProof,
      options: {
        bindingsStorePath,
        kbStorePath,
        sourceDocumentLinkStorePath: linkStorePath,
        indexRoot,
        embeddingProvider: mockProvider,
        fetchExternal: fetchExternal as never,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.documentId).toMatch(/^srcdir-/);
    expect(fetchExternal).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: binding.endpoint,
      }),
    );
    expect(result.binding?.metadata?.documentId).toBe(result.documentId);
  });

  it("fail-closes tenant-scoped ingest without governanceOwnershipProof", async () => {
    const kb = createKnowledgeBase(
      {
        title: "Enterprise space",
        visibility: "enterprise",
        ownerId: "user-1",
        tenantId: "tenant-1",
      },
      kbStorePath,
    );
    const binding = bindKnowledgeSource(
      {
        kind: "api",
        title: "Denied source",
        knowledgeBaseId: kb.id,
        ownerId: "user-1",
        endpoint: "https://api.example.test",
        visibility: "enterprise",
      },
      bindingsStorePath,
    );
    const fetchApi = vi.fn(async () => ({
      sourceId: binding.id,
      fetchedAtMs: Date.now(),
      data: { note: "should not land" },
    }));

    const result = await ingestKnowledgeSourceBinding({
      sourceDescriptorId: binding.id,
      knowledgeBase: kb,
      context,
      ownerId: "user-1",
      options: {
        bindingsStorePath,
        kbStorePath,
        sourceDocumentLinkStorePath: linkStorePath,
        indexRoot,
        embeddingProvider: mockProvider,
        fetchApi: fetchApi as never,
        authorizedKnowledgeBaseIds: new Set([kb.id]),
      },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("governance_write_denied:missing_ownership_proof");
    expect(result.ingest?.skipped).toBe(true);
    expect(result.ingest?.error).toBe("governance_write_denied:missing_ownership_proof");
  });
});
