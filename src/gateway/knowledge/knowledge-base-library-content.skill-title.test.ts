import { randomUUID } from "node:crypto";
// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpDir } = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-kb-skill-title-${Math.random().toString(36).slice(2)}`,
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

const { saveSkillAsset } = await import("../skill-lifecycle-store.js");
const { createKnowledgeBase, attachDocumentToKnowledgeBase, getKnowledgeBase } =
  await import("./knowledge-base-store.js");
const { listKnowledgeBaseDocumentsFromIndex } = await import("./knowledge-base-library-content.js");
const { ingestKnowledgeDocument } = await import("./kb-ingest.js");
const { upsertSourceDocumentLink } = await import("./sources/source-document-link-store.js");

describe("knowledge-base document title fallback", () => {
  const storeDir = path.join(tmpDir, "bases");
  const storePath = path.join(storeDir, `store-${randomUUID()}.json`);

  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not list skill assets as cabin-tree documents when the index is missing", async () => {
    const saved = saveSkillAsset({
      sourceAgentId: "main",
      profile: {
        name: "中医可以培育洞察力",
        summary: "uploaded doc",
        assetType: "knowledge",
        tags: [],
        category: "上传文档",
        visibility: "private",
        inputDescription: "知识宇宙文档上传: 中医可以培育洞察力.docx",
      },
    });
    const kb = createKnowledgeBase({ title: "中医宝典", ownerId: "user-a" }, storePath);
    attachDocumentToKnowledgeBase(kb.id, saved.skillId, storePath);

    const documents = await listKnowledgeBaseDocumentsFromIndex({
      knowledgeBase: { ...kb, documentIds: [saved.skillId] },
      indexRoot: path.join(tmpDir, "missing-index"),
    });

    expect(documents).toEqual([]);
    expect(getKnowledgeBase(kb.id, storePath)?.documentIds).toEqual([]);
  });

  it("does not list leftover skill-id membership even when the index still has that row", async () => {
    const kb = createKnowledgeBase({ title: "协作小组", ownerId: "user-a" }, storePath);
    attachDocumentToKnowledgeBase(kb.id, "skill_legacy123", storePath);

    await ingestKnowledgeDocument({
      kbId: kb.id,
      docId: "skill_legacy123",
      title: "skill_legacy123",
      fileName: "2023年-2025年银川市进出口阿拉伯国家数据.xlsx",
      mimeType: "text/plain",
      buffer: Buffer.from("Quarterly pipeline\nEMEA\n120", "utf8"),
      ownerId: "user-a",
      tenantId: null,
      indexRoot: path.join(tmpDir, "index"),
      embeddingProvider: null,
    });

    const documents = await listKnowledgeBaseDocumentsFromIndex({
      knowledgeBase: { ...kb, documentIds: ["skill_legacy123"] },
      indexRoot: path.join(tmpDir, "index"),
    });

    expect(documents).toEqual([]);
  });

  it("uses the local-folder filename when the catalog only has an lfdoc id", async () => {
    const kb = createKnowledgeBase({ title: "个人成果", ownerId: "user-a" }, storePath);
    const docId = "lfdoc-6ad9fbcbc7b63784231845b09b92";
    attachDocumentToKnowledgeBase(kb.id, docId, storePath);
    const linkStorePath = path.join(tmpDir, "source-document-links.json");
    upsertSourceDocumentLink(
      {
        sourceDescriptorId: "src:upbeyond",
        docId,
        relativePath: "中阿数字贸易平台可行性研究.pdf",
        state: "active",
        lastSeenAt: Date.now(),
      },
      linkStorePath,
    );

    const documents = await listKnowledgeBaseDocumentsFromIndex({
      knowledgeBase: { ...kb, documentIds: [docId] },
      indexRoot: path.join(tmpDir, "missing-index-lfdoc"),
      sourceDocumentLinkStorePath: linkStorePath,
    });

    expect(documents).toHaveLength(1);
    expect(documents[0]?.indexed).toBe(false);
    expect(documents[0]?.title).toBe("中阿数字贸易平台可行性研究");
  });
});
