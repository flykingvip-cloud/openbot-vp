// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "../../memory/embeddings.js";
import { ownershipProofFromTenantUser } from "../data-governance/ownership-proof.js";
import { getPersonalSkillAssetDetail } from "../skill-lifecycle-store.js";
import { getDatasetSchemasForKb } from "./dataset-schema-store.js";
import { knowledgeDocumentIdFromSkillRef } from "./document-display-title.js";
import {
  knowledgeBaseHasIndexedChunks,
  openKnowledgeIndex,
  resolveKnowledgeIndexDbPath,
} from "./kb-index.js";
import { createKnowledgeBase, getKnowledgeBase } from "./knowledge-base-store.js";
import { hasKnowledgeOriginal } from "./knowledge-original-store.js";
import { UNPARSED_DOCUMENT_PLACEHOLDER } from "./personal-document-upload.js";
import {
  attachmentToIngestBuffer,
  collectedKnowledgeToIngestBuffer,
  fetchWebPageForKnowledge,
  htmlToPlainText,
  importDatasetPersonalKnowledge,
  ingestCollectedPersonalKnowledge,
  ingestKnowledgePayloadToBase,
  ingestUploadedPersonalKnowledge,
  ingestWebReferencePersonalKnowledge,
  normalizePersonalDocumentId,
  skillDetailToIngestPayload,
} from "./personal-knowledge-ingest.js";
import { collectPersonalKnowledge, uploadPersonalKnowledge } from "./personal-mutations.js";

const { tmpDir } = vi.hoisted(() => {
  const dir = `/tmp/openbot-kb-ingest-hook-${Math.random().toString(36).slice(2)}`;
  return { tmpDir: dir };
});

vi.mock("../utils.js", () => ({ CONFIG_DIR: tmpDir }));

const mockProvider: EmbeddingProvider = {
  id: "openai",
  model: "mock-embed",
  embedQuery: async (text) => [text.length % 7, 0.2, 0.4],
  embedBatch: async (texts) => texts.map((text) => [text.length % 7, 0.2, 0.4]),
};

function cleanStore() {
  fs.rmSync(path.join(tmpDir, "skill-assets"), { recursive: true, force: true });
  fs.rmSync(path.join(tmpDir, "knowledge"), { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

describe("personal-knowledge-ingest helpers", () => {
  beforeEach(() => {
    cleanStore();
  });

  afterEach(() => {
    cleanStore();
  });

  it("normalizes obj:personal document ids to skill ids", () => {
    expect(normalizePersonalDocumentId("obj:personal:skill-1")).toBe("skill-1");
    expect(normalizePersonalDocumentId("skill-2")).toBe("skill-2");
  });

  it("builds ingest buffers from text attachments and collected knowledge", () => {
    const attachment = attachmentToIngestBuffer({
      fileName: "notes.md",
      mimeType: "text/markdown",
      size: 12,
      kind: "text",
      textContent: "# Notes\nBody",
    });
    expect(attachment?.buffer.toString("utf8")).toContain("Body");

    const collected = collectedKnowledgeToIngestBuffer({
      title: "会议纪要",
      summary: "结论与待办",
    });
    expect(collected.buffer.toString("utf8")).toContain("会议纪要");
  });

  it("maps uploaded skill detail outputDescription into ingest payload", () => {
    const uploaded = uploadPersonalKnowledge({
      attachment: {
        fileName: "guide.md",
        mimeType: "text/markdown",
        size: 64,
        kind: "text",
        textContent: "# Guide\nSearchable body",
      },
    });
    const detail = getPersonalSkillAssetDetail(uploaded.skillId);
    const payload = skillDetailToIngestPayload(detail);
    expect(payload?.buffer.toString("utf8")).toContain("Searchable body");
  });

  it("strips html markup down to readable plain text", () => {
    const text = htmlToPlainText(
      "<html><head><title>T</title><style>.x{color:red}</style></head>" +
        "<body><h1>Hi</h1><script>bad()</script><p>Body&nbsp;text &amp; more</p></body></html>",
    );
    expect(text).toContain("Hi");
    expect(text).toContain("Body text & more");
    expect(text).not.toContain("bad()");
    expect(text).not.toContain("<");
  });
});

describe("personal-knowledge-ingest hooks", () => {
  let indexRoot: string;
  let storePath: string;

  beforeEach(() => {
    cleanStore();
    indexRoot = `/tmp/kb-ingest-hook-${Math.random().toString(36).slice(2)}`;
    storePath = path.join(tmpDir, "knowledge", "bases.json");
  });

  afterEach(() => {
    cleanStore();
    fs.rmSync(indexRoot, { recursive: true, force: true });
  });

  it("fail-closes tenant-scoped ingest without governanceOwnershipProof", async () => {
    const kb = createKnowledgeBase(
      { title: "Tenant KB", ownerId: "user-a", tenantId: "tenant-1" },
      storePath,
    );
    const outcome = await ingestKnowledgePayloadToBase({
      knowledgeBase: kb,
      documentId: "doc-missing-proof",
      title: "Denied",
      fileName: "denied.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Denied\n\nshould not index", "utf8"),
      ownerId: "user-a",
      indexRoot,
      embeddingProvider: mockProvider,
    });
    expect(outcome.attempted).toBe(true);
    expect(outcome.skipped).toBe(true);
    expect(outcome.error).toBe("governance_write_denied:missing_ownership_proof");
  });

  it("ingests uploaded markdown into an owned knowledge base", async () => {
    const kb = createKnowledgeBase(
      { title: "Personal KB", ownerId: "user-a", tenantId: null },
      storePath,
    );
    const uploaded = uploadPersonalKnowledge({
      attachment: {
        fileName: "policy.md",
        mimeType: "text/markdown",
        size: 128,
        kind: "text",
        textContent: "# Refund Policy\nRefund within 30 days.",
      },
    });
    const outcome = await ingestUploadedPersonalKnowledge({
      knowledgeBaseId: kb.id,
      skillId: uploaded.skillId,
      title: uploaded.object.title,
      ownerId: "user-a",
      attachment: {
        fileName: "policy.md",
        mimeType: "text/markdown",
        size: 128,
        kind: "text",
        textContent: "# Refund Policy\nRefund within 30 days.",
      },
      storePath,
      indexRoot,
      embeddingProvider: mockProvider,
    });
    expect(outcome.attempted).toBe(true);
    expect(outcome.skipped).toBe(false);
    expect(outcome.chunkCount).toBeGreaterThan(0);
    expect(getKnowledgeBase(kb.id, storePath)?.documentIds ?? []).not.toContain(uploaded.skillId);

    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-a",
      tenantId: null,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      expect(knowledgeBaseHasIndexedChunks(index.db, kb.id)).toBe(true);
    } finally {
      index.close();
    }
  });

  it("extracts a dataset schema when an uploaded file is tabular", async () => {
    const kb = createKnowledgeBase(
      { title: "Dataset Upload KB", ownerId: "user-a", tenantId: null },
      storePath,
    );
    const csv = "region,revenue,active\nEMEA,120,true\nAPAC,90,false\n";
    const uploaded = uploadPersonalKnowledge({
      attachment: {
        fileName: "metrics.csv",
        mimeType: "text/csv",
        size: csv.length,
        kind: "text",
        textContent: csv,
      },
    });
    const outcome = await ingestUploadedPersonalKnowledge({
      knowledgeBaseId: kb.id,
      skillId: uploaded.skillId,
      title: uploaded.object.title,
      ownerId: "user-a",
      attachment: {
        fileName: "metrics.csv",
        mimeType: "text/csv",
        size: csv.length,
        kind: "text",
        textContent: csv,
      },
      storePath,
      indexRoot,
      embeddingProvider: mockProvider,
    });
    expect(outcome.attempted).toBe(true);

    const dbPath = resolveKnowledgeIndexDbPath({ ownerId: "user-a", tenantId: null, indexRoot });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const schema = getDatasetSchemasForKb(index.db, kb.id).get(
        knowledgeDocumentIdFromSkillRef(kb.id, uploaded.skillId),
      );
      expect(schema?.format).toBe("csv");
      expect(schema?.columnCount).toBe(3);
      expect(schema?.rowCount).toBe(2);
      expect(schema?.columns.map((column) => column.name)).toEqual(["region", "revenue", "active"]);
    } finally {
      index.close();
    }
  });

  it("ingests collected knowledge summary into an owned knowledge base", async () => {
    const kb = createKnowledgeBase(
      { title: "Collect KB", ownerId: "user-a", tenantId: null },
      storePath,
    );
    const collected = collectPersonalKnowledge({
      title: "竞品分析",
      summary: "竞品 A 在定价上更激进",
    });
    const outcome = await ingestCollectedPersonalKnowledge({
      knowledgeBaseId: kb.id,
      skillId: collected.skillId,
      title: collected.object.title,
      summary: "竞品 A 在定价上更激进",
      ownerId: "user-a",
      storePath,
      indexRoot,
      embeddingProvider: mockProvider,
    });
    expect(outcome.skipped).toBe(false);
    expect(outcome.chunkCount).toBeGreaterThan(0);
  });

  it("fetches a web page via an injectable fetcher and chunk-indexes the full content", async () => {
    const kb = createKnowledgeBase(
      { title: "Web KB", ownerId: "user-a", tenantId: null },
      storePath,
    );
    const fetched = await fetchWebPageForKnowledge({
      url: "https://example.com/pricing",
      fetcher: async () => ({
        title: "Pricing",
        text: "Enterprise plan includes SSO and priority support.",
      }),
    });
    expect(fetched.title).toBe("Pricing");
    const outcome = await ingestWebReferencePersonalKnowledge({
      knowledgeBaseId: kb.id,
      skillId: "web-skill-1",
      title: fetched.title ?? "Pricing",
      url: "https://example.com/pricing",
      text: fetched.text,
      ownerId: "user-a",
      storePath,
      indexRoot,
      embeddingProvider: mockProvider,
    });
    expect(outcome.attempted).toBe(true);
    expect(outcome.skipped).toBe(false);
    expect(outcome.chunkCount).toBeGreaterThan(0);

    const dbPath = resolveKnowledgeIndexDbPath({ ownerId: "user-a", tenantId: null, indexRoot });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      expect(knowledgeBaseHasIndexedChunks(index.db, kb.id)).toBe(true);
    } finally {
      index.close();
    }
  });

  it("skips web ingest when the fetched text is empty", async () => {
    const kb = createKnowledgeBase(
      { title: "Empty Web KB", ownerId: "user-a", tenantId: null },
      storePath,
    );
    const outcome = await ingestWebReferencePersonalKnowledge({
      knowledgeBaseId: kb.id,
      skillId: "web-skill-2",
      title: "Empty",
      url: "https://example.com/empty",
      text: "   ",
      ownerId: "user-a",
      storePath,
      indexRoot,
      embeddingProvider: mockProvider,
    });
    expect(outcome.skipped).toBe(true);
  });

  it("bulk-imports a dataset as attached, chunk-indexed documents", async () => {
    const kb = createKnowledgeBase(
      { title: "Dataset KB", ownerId: "user-a", tenantId: null },
      storePath,
    );
    const outcome = await importDatasetPersonalKnowledge({
      knowledgeBaseId: kb.id,
      datasetTitle: "竞品FAQ",
      records: [
        { title: "定价", text: "企业版按席位计费，包含 SSO 与优先支持。" },
        { text: "支持 SAML 单点登录与自动对账导出能力。" },
        { text: "   " },
      ],
      ownerId: "user-a",
      storePath,
      indexRoot,
      embeddingProvider: mockProvider,
    });
    expect(outcome.attempted).toBe(true);
    expect(outcome.imported).toBe(2);
    expect(outcome.skipped).toBe(1);
    expect(outcome.documentIds).toHaveLength(2);
    expect(outcome.chunkCount).toBeGreaterThan(0);

    const updated = getKnowledgeBase(kb.id, storePath);
    expect(updated?.documentIds.length).toBe(2);

    const dbPath = resolveKnowledgeIndexDbPath({ ownerId: "user-a", tenantId: null, indexRoot });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      expect(knowledgeBaseHasIndexedChunks(index.db, kb.id)).toBe(true);
    } finally {
      index.close();
    }
  });

  it("re-imports the same dataset title into stable documents (no duplication)", async () => {
    const kb = createKnowledgeBase(
      { title: "Dataset KB2", ownerId: "user-a", tenantId: null },
      storePath,
    );
    const records = [
      { text: "记录一的内容足够长，用于生成可检索的索引分块。" },
      { text: "记录二的内容也足够长，用于生成可检索的索引分块。" },
    ];
    const first = await importDatasetPersonalKnowledge({
      knowledgeBaseId: kb.id,
      datasetTitle: "FAQ",
      records,
      ownerId: "user-a",
      storePath,
      indexRoot,
      embeddingProvider: mockProvider,
    });
    const second = await importDatasetPersonalKnowledge({
      knowledgeBaseId: kb.id,
      datasetTitle: "FAQ",
      records,
      ownerId: "user-a",
      storePath,
      indexRoot,
      embeddingProvider: mockProvider,
    });
    expect(first.documentIds).toEqual(second.documentIds);
    const updated = getKnowledgeBase(kb.id, storePath);
    expect(updated?.documentIds.length).toBe(2);
  });

  it("persists original bytes before a tenant ingest is denied", async () => {
    const kb = createKnowledgeBase(
      { title: "Tenant KB", ownerId: "user-a", tenantId: "tenant-1" },
      storePath,
    );
    const originalsRoot = path.join(tmpDir, "knowledge", "originals-denied");
    const outcome = await ingestKnowledgePayloadToBase({
      knowledgeBase: kb,
      documentId: "doc-keep-bytes",
      title: "Kept",
      fileName: "kept.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Kept\n\nfirst-reference can retry", "utf8"),
      ownerId: "user-a",
      indexRoot,
      originalsRoot,
      embeddingProvider: mockProvider,
    });
    expect(outcome.error).toBe("governance_write_denied:missing_ownership_proof");
    expect(
      hasKnowledgeOriginal({
        kbId: kb.id,
        docId: "doc-keep-bytes",
        originalsRoot,
      }),
    ).toBe(true);
  });

  it("indexes persisted originals on a later first-reference with proof", async () => {
    const kb = createKnowledgeBase(
      { title: "Tenant retry KB", ownerId: "user-a", tenantId: "tenant-1" },
      storePath,
    );
    const originalsRoot = path.join(tmpDir, "knowledge", "originals-retry");
    await ingestKnowledgePayloadToBase({
      knowledgeBase: kb,
      documentId: "doc-retry",
      title: "Retry",
      fileName: "retry.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Retry\n\nbody for first reference", "utf8"),
      ownerId: "user-a",
      indexRoot,
      originalsRoot,
      embeddingProvider: mockProvider,
    });
    const retried = await ingestKnowledgePayloadToBase({
      knowledgeBase: kb,
      documentId: "doc-retry",
      title: "Retry",
      fileName: "retry.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Retry\n\nbody for first reference", "utf8"),
      ownerId: "user-a",
      indexRoot,
      originalsRoot,
      embeddingProvider: mockProvider,
      governanceOwnershipProof: ownershipProofFromTenantUser({
        tenantId: "tenant-1",
        userId: "user-a",
      }),
    });
    expect(retried.attempted).toBe(true);
    expect(retried.error).toBeUndefined();
    expect(retried.chunkCount).toBeGreaterThan(0);
  });

  it("does not ingest catalog placeholder text as document content", async () => {
    const kb = createKnowledgeBase(
      { title: "Stub KB", ownerId: "user-a", tenantId: null },
      storePath,
    );
    const outcome = await ingestKnowledgePayloadToBase({
      knowledgeBase: kb,
      documentId: "doc-stub",
      title: "智能体设计模式",
      fileName: "智能体设计模式.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(
        `文档：智能体设计模式.pdf (application/pdf, 5.5 MB)\n\n${UNPARSED_DOCUMENT_PLACEHOLDER}`,
        "utf8",
      ),
      ownerId: "user-a",
      indexRoot,
      embeddingProvider: mockProvider,
    });
    expect(outcome.attempted).toBe(false);
    expect(outcome.reason).toBe("unparsed placeholder");
  });
});
