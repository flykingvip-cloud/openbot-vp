// @vitest-environment node
// Item 7 S09: knowledge-document-preview.ts empty Catalog synthesis retired; pins live in item7 tests.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  insertKnowledgeChunks,
  openKnowledgeIndex,
  resolveKnowledgeIndexDbPath,
  upsertKnowledgeDocument,
} from "./kb-index.js";
import {
  previewKnowledgeDocument,
  readKnowledgeDocumentContent,
} from "./knowledge-document-preview.js";
import { upsertLocalFolderBinding } from "./sources/local-folder-binding-store.js";
import { upsertSourceDocumentLink } from "./sources/source-document-link-store.js";

describe("previewKnowledgeDocument", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("previews local_index documents through resolver", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-kb-preview-local-"));
    roots.push(root);
    const bindingStorePath = path.join(root, "bindings.json");
    const linkStorePath = path.join(root, "links.json");
    const folder = path.join(root, "docs");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "guide.md"), "# Guide\n\nHello local index.");

    upsertLocalFolderBinding(
      {
        sourceDescriptorId: "src-folder",
        knowledgeBaseId: "kb-preview",
        deviceId: "dev-1",
        mode: "local_index",
        rootPath: folder,
        rootLabel: "docs",
      },
      bindingStorePath,
    );
    upsertSourceDocumentLink(
      {
        sourceDescriptorId: "src-folder",
        docId: "lfdoc-guide",
        relativePath: "guide.md",
        state: "active",
        lastSeenAt: Date.now(),
      },
      linkStorePath,
    );

    const payload = await previewKnowledgeDocument({
      knowledgeBaseId: "kb-preview",
      documentId: "lfdoc-guide",
      userId: "user-a",
      tenantId: null,
      bindingStorePath,
      linkStorePath,
    });
    expect(payload.source).toBe("local_index");
    expect(payload.filename).toBe("guide.md");
    expect(payload.textLike).toBe(true);
    expect(Buffer.from(String(payload.base64), "base64").toString("utf8")).toContain(
      "Hello local index",
    );
  });

  it("falls back to indexed chunk text when original and folder binding are gone", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-kb-preview-index-"));
    roots.push(root);
    const indexRoot = path.join(root, "index");
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-a",
      tenantId: "001",
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      upsertKnowledgeDocument({
        db: index.db,
        docId: "lfdoc-memory-for-llms-report",
        kbId: "kb-preview",
        title: "Memory for LLMs 论文翻译报告",
        contentType: "markdown",
      });
      insertKnowledgeChunks({
        index,
        chunks: [
          {
            id: "chunk-a",
            text: "Indexed memory section one.",
            model: "fts-only",
            kbId: "kb-preview",
            docId: "lfdoc-memory-for-llms-report",
            versionId: "v1",
            heading: "Intro",
            section: "Intro",
            startLine: 1,
            endLine: 4,
            visibility: "private",
            source: "memory.md",
          },
          {
            id: "chunk-b",
            text: "Indexed memory section two.",
            model: "fts-only",
            kbId: "kb-preview",
            docId: "lfdoc-memory-for-llms-report",
            versionId: "v1",
            heading: "Body",
            section: "Body",
            startLine: 5,
            endLine: 8,
            visibility: "private",
            source: "memory.md",
          },
        ],
      });
    } finally {
      index.close();
    }

    const payload = await previewKnowledgeDocument({
      knowledgeBaseId: "kb-preview",
      documentId: "lfdoc-memory-for-llms-report",
      userId: "user-a",
      tenantId: "001",
      indexRoot,
      originalsRoot: path.join(root, "missing-originals"),
      bindingStorePath: path.join(root, "missing-bindings.json"),
      linkStorePath: path.join(root, "missing-links.json"),
    });
    expect(payload.source).toBe("index_text");
    expect(payload.textLike).toBe(true);
    const text = Buffer.from(String(payload.base64), "base64").toString("utf8");
    expect(text).toContain("Indexed memory section one.");
    expect(text).toContain("Indexed memory section two.");

    const content = await readKnowledgeDocumentContent({
      knowledgeBaseId: "kb-preview",
      documentId: "lfdoc-memory-for-llms-report",
      userId: "user-a",
      tenantId: "001",
      indexRoot,
      originalsRoot: path.join(root, "missing-originals"),
      bindingStorePath: path.join(root, "missing-bindings.json"),
      linkStorePath: path.join(root, "missing-links.json"),
      textOnly: true,
    });
    expect(content?.source).toBe("index_text");
    expect(content?.chunkIds).toEqual(["chunk-a", "chunk-b"]);
  });

  it("previews a catalog card by matching another knowledge base original filename", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-kb-preview-alias-"));
    roots.push(root);
    const originalsRoot = path.join(root, "originals");
    const bindingStorePath = path.join(root, "bindings.json");
    const linkStorePath = path.join(root, "links.json");
    const { persistKnowledgeOriginal } = await import("./knowledge-original-store.js");
    persistKnowledgeOriginal({
      kbId: "kb-other",
      docId: "doc-other",
      fileName: "如何让“数字人”真正活着.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 recovered", "utf8"),
      originalsRoot,
    });
    upsertSourceDocumentLink(
      {
        sourceDescriptorId: "src-device",
        docId: "lfdoc-empty-card",
        relativePath: "如何让“数字人”真正活着.pdf",
        state: "active",
        lastSeenAt: Date.now(),
      },
      linkStorePath,
    );

    const payload = await previewKnowledgeDocument({
      knowledgeBaseId: "kb-preview",
      documentId: "lfdoc-empty-card",
      originalsRoot,
      bindingStorePath,
      linkStorePath,
      userId: "user-a",
      tenantId: "001",
    });
    expect(payload.source).toBe("original_store");
    expect(Buffer.from(String(payload.base64), "base64").toString("utf8")).toContain(
      "%PDF-1.4 recovered",
    );
  });

  it("previews reserved 个人成果 files from the folder SoT", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-kb-preview-reserved-"));
    roots.push(root);
    const { createKnowledgeBase } = await import("./knowledge-base-store.js");
    const { writeKnowledgeFolderFile, resolveKnowledgeDirectoryLayoutForBase } =
      await import("./knowledge-directory.js");
    const { knowledgeDocumentIdFromSkillRef } = await import("./document-display-title.js");
    const kbStorePath = path.join(root, "bases.json");
    const kb = createKnowledgeBase(
      {
        title: "个人成果",
        visibility: "private",
        ownerId: "user-a",
        tenantId: "acme",
      },
      kbStorePath,
    );
    const layout = resolveKnowledgeDirectoryLayoutForBase(kb, {
      tenantsRoot: path.join(root, "tenants"),
      configDir: root,
    });
    writeKnowledgeFolderFile({
      layout,
      filename: "OPENBOT-审计指导手册.md",
      buffer: Buffer.from("# 审计手册真源\n", "utf8"),
    });
    const documentId = knowledgeDocumentIdFromSkillRef(kb.id, "folder:OPENBOT-审计指导手册.md");
    const payload = await previewKnowledgeDocument({
      knowledgeBaseId: kb.id,
      documentId,
      kbStorePath,
      tenantsRoot: path.join(root, "tenants"),
      configDir: root,
      userId: "user-a",
      tenantId: "acme",
    });
    expect(payload.source).toBe("original_store");
    expect(payload.filename).toBe("OPENBOT-审计指导手册.md");
    expect(Buffer.from(String(payload.base64), "base64").toString("utf8")).toContain(
      "审计手册真源",
    );
  });
});
