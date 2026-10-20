// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "../../memory/embeddings.js";
import { ensureKnowledgeDocumentIndexed } from "./ensure-indexed-document.js";
import {
  knowledgeBaseHasIndexedChunks,
  openKnowledgeIndex,
  resolveKnowledgeIndexDbPath,
} from "./kb-index.js";
import { attachDocumentToKnowledgeBase, createKnowledgeBase } from "./knowledge-base-store.js";
import { persistKnowledgeOriginal } from "./knowledge-original-store.js";
import { UNPARSED_DOCUMENT_PLACEHOLDER } from "./personal-document-upload.js";

const { tmpDir } = vi.hoisted(() => {
  const dir = `/tmp/openbot-kb-ensure-index-${Math.random().toString(36).slice(2)}`;
  return { tmpDir: dir };
});

vi.mock("../utils.js", () => ({ CONFIG_DIR: tmpDir }));
vi.mock("../../utils.js", () => ({ CONFIG_DIR: tmpDir }));

const mockProvider: EmbeddingProvider = {
  id: "openai",
  model: "mock-embed",
  embedQuery: async (text) => [text.length % 7, 0.2, 0.4],
  embedBatch: async (texts) => texts.map((text) => [text.length % 7, 0.2, 0.4]),
};

function cleanStore() {
  fs.rmSync(path.join(tmpDir, "knowledge"), { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

describe("ensureKnowledgeDocumentIndexed", () => {
  let storePath: string;
  let indexRoot: string;
  let originalsRoot: string;

  beforeEach(() => {
    cleanStore();
    storePath = path.join(tmpDir, "knowledge", "bases.json");
    indexRoot = path.join(tmpDir, "knowledge", "index");
    originalsRoot = path.join(tmpDir, "knowledge", "originals");
  });

  afterEach(() => {
    cleanStore();
  });

  it("builds the index on first reference and reuses it afterwards", async () => {
    const kb = createKnowledgeBase(
      { title: "Patterns", ownerId: "user-a", tenantId: null },
      storePath,
    );
    attachDocumentToKnowledgeBase(kb.id, "doc-patterns", storePath);
    persistKnowledgeOriginal({
      kbId: kb.id,
      docId: "doc-patterns",
      fileName: "智能体设计模式.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# 智能体设计模式\n\nReAct 与工具调用。", "utf8"),
      originalsRoot,
    });

    const context = {
      userId: "user-a",
      tenantId: null,
      seatId: null,
      hasEnterpriseScope: false,
    };
    const first = await ensureKnowledgeDocumentIndexed({
      knowledgeBaseId: kb.id,
      documentId: "doc-patterns",
      context,
      storePath,
      indexRoot,
      originalsRoot,
      embeddingProvider: mockProvider,
    });
    expect(first.status).toBe("indexed");

    const second = await ensureKnowledgeDocumentIndexed({
      knowledgeBaseId: kb.id,
      documentId: "doc-patterns",
      context,
      storePath,
      indexRoot,
      originalsRoot,
      embeddingProvider: mockProvider,
    });
    expect(second.status).toBe("reused");

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

  it("does not treat a catalog placeholder as indexable source bytes", async () => {
    const kb = createKnowledgeBase(
      { title: "中医宝典", ownerId: "user-a", tenantId: null },
      storePath,
    );
    attachDocumentToKnowledgeBase(kb.id, "kbdoc-d752b10fc4fc000000000000", storePath);
    persistKnowledgeOriginal({
      kbId: kb.id,
      docId: "kbdoc-d752b10fc4fc000000000000",
      fileName: "智能体设计模式.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(
        `文档：智能体设计模式.pdf (application/pdf, 5.5 MB)\n\n${UNPARSED_DOCUMENT_PLACEHOLDER}`,
        "utf8",
      ),
      originalsRoot,
    });

    const result = await ensureKnowledgeDocumentIndexed({
      knowledgeBaseId: kb.id,
      documentId: "kbdoc-d752b10fc4fc000000000000",
      context: {
        userId: "user-a",
        tenantId: null,
        seatId: null,
        hasEnterpriseScope: false,
      },
      storePath,
      indexRoot,
      originalsRoot,
    });
    expect(result).toEqual({ status: "unavailable", reason: "not_indexed" });
  });

  it("reports not_indexed when the document is catalogued but has no recoverable bytes", async () => {
    const kb = createKnowledgeBase(
      { title: "Empty originals", ownerId: "user-a", tenantId: null },
      storePath,
    );
    attachDocumentToKnowledgeBase(kb.id, "doc-missing", storePath);
    const result = await ensureKnowledgeDocumentIndexed({
      knowledgeBaseId: kb.id,
      documentId: "doc-missing",
      context: {
        userId: "user-a",
        tenantId: null,
        seatId: null,
        hasEnterpriseScope: false,
      },
      storePath,
      indexRoot,
      originalsRoot,
    });
    expect(result).toEqual({ status: "unavailable", reason: "not_indexed" });
  });
});
