import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ingestKnowledgeDocument } from "../knowledge/kb-ingest.js";
import {
  createKnowledgeBase,
  attachDocumentToKnowledgeBase,
} from "../knowledge/knowledge-base-store.js";
import { upsertLocalFolderBinding } from "../knowledge/sources/local-folder-binding-store.js";
import { bindKnowledgeSource } from "../knowledge/sources/source-binding-store.js";
import {
  buildContextScopeCatalog,
  loadContextScopeCatalogForActor,
  resolveContextScopeFileLabel,
} from "./catalog.js";

describe("context scope catalog", () => {
  test("builds capped knowledge, file, folder, and API entries without dumping contents", () => {
    const items = buildContextScopeCatalog({
      knowledgeBases: [{ id: "kb-1", title: "产品资料", visibility: "private" }],
      files: [
        { id: "doc-roadmap", title: "roadmap.md", knowledgeBaseId: "kb-1" },
        { id: "doc-ignored", title: "extra.md", knowledgeBaseId: "kb-1" },
      ],
      folders: [{ id: "lfb-1", label: "设计稿", knowledgeBaseId: "kb-1" }],
      apis: [{ id: "src-crm", title: "CRM", endpoint: "https://crm.example" }],
      limits: { files: 1 },
    });
    expect(items.map((item) => `${item.type}:${item.id}`)).toEqual([
      "knowledge:kb-1",
      "file:doc-roadmap",
      "folder:lfb-1",
      "api:src-crm",
    ]);
    expect(items.find((item) => item.type === "file")?.parentId).toBe("kb-1");
    expect(items.find((item) => item.type === "api")?.subtitle).toBe("https://crm.example");
    expect(items.find((item) => item.type === "knowledge")?.visibility).toBe("private");
    expect(items.find((item) => item.type === "file")?.visibility).toBe("private");
    expect(items.find((item) => item.type === "folder")?.visibility).toBe("private");
  });
});

describe("loadContextScopeCatalog visibility", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("only returns sources from knowledge bases the actor can read", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "csc-catalog-"));
    dirs.push(dir);
    const kbStore = path.join(dir, "bases.json");
    const bindingStore = path.join(dir, "bindings.json");
    const folderStore = path.join(dir, "folders.json");
    const own = createKnowledgeBase(
      { title: "我的库", ownerId: "user-a", visibility: "private" },
      kbStore,
    );
    const hidden = createKnowledgeBase(
      { title: "别人的库", ownerId: "user-b", visibility: "private" },
      kbStore,
    );
    attachDocumentToKnowledgeBase(own.id, "notes/plan.md", kbStore);
    attachDocumentToKnowledgeBase(hidden.id, "secret.md", kbStore);
    bindKnowledgeSource(
      { kind: "api", title: "公开接口", knowledgeBaseId: own.id, ownerId: "user-a" },
      bindingStore,
    );
    bindKnowledgeSource(
      { kind: "api", title: "隐藏接口", knowledgeBaseId: hidden.id, ownerId: "user-b" },
      bindingStore,
    );
    upsertLocalFolderBinding(
      {
        sourceDescriptorId: "src-folder",
        knowledgeBaseId: own.id,
        deviceId: "dev-1",
        rootPath: path.join(dir, "folder"),
        rootLabel: "工作目录",
      },
      folderStore,
    );

    const sources = await loadContextScopeCatalogForActor({
      actor: { userId: "user-a", tenantId: null, email: "a@example.com" },
      stores: {
        knowledgeBaseStorePath: kbStore,
        sourceBindingStorePath: bindingStore,
        localFolderStorePath: folderStore,
      },
    });

    expect(sources.some((item) => item.label === "我的库" && item.visibility === "private")).toBe(
      true,
    );
    expect(sources.some((item) => item.label === "别人的库")).toBe(false);
    expect(sources.some((item) => item.type === "file" && item.id === "notes/plan.md")).toBe(true);
    expect(sources.some((item) => item.type === "file" && item.id === "secret.md")).toBe(false);
    expect(sources.some((item) => item.type === "api" && item.label === "公开接口")).toBe(true);
    expect(sources.some((item) => item.type === "api" && item.label === "隐藏接口")).toBe(false);
    expect(sources.some((item) => item.type === "folder" && item.label === "工作目录")).toBe(true);
  });

  test("uses indexed document titles instead of Ifdoc storage ids", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "csc-catalog-title-"));
    dirs.push(dir);
    const kbStore = path.join(dir, "bases.json");
    const indexRoot = path.join(dir, "index");
    const own = createKnowledgeBase(
      { title: "个人资料", ownerId: "user-a", visibility: "private" },
      kbStore,
    );
    const docId = "Ifdoc_4e33d4d520d6b50a5e2af1035276";
    attachDocumentToKnowledgeBase(own.id, docId, kbStore);
    await ingestKnowledgeDocument({
      kbId: own.id,
      docId,
      title: "竞品分析报告",
      fileName: "竞品分析报告.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# 竞品分析报告\n\nQ2 对照。", "utf8"),
      ownerId: "user-a",
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    });

    const sources = await loadContextScopeCatalogForActor({
      actor: { userId: "user-a", tenantId: null, email: "a@example.com" },
      stores: {
        knowledgeBaseStorePath: kbStore,
        indexRoot,
      },
    });

    const file = sources.find((item) => item.type === "file" && item.id === docId);
    expect(file?.label).toBe("竞品分析报告");
    expect(file?.label).not.toContain("Ifdoc");
  });
});

describe("resolveContextScopeFileLabel", () => {
  test("prefers human titles and original filenames over storage ids", () => {
    expect(
      resolveContextScopeFileLabel({
        documentId: "Ifdoc:4e33d4d520d6b50a5e2af1035276",
        displayTitle: "Ifdoc:4e33d4d520d6b50a5e2af1035276",
        originalFileName: "合同扫描件.pdf",
      }),
    ).toBe("合同扫描件.pdf");
    expect(
      resolveContextScopeFileLabel({
        documentId: "Ifdoc:abc",
        displayTitle: "销售手册.docx",
      }),
    ).toBe("销售手册.docx");
  });
});
