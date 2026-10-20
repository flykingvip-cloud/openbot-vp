// @vitest-environment node
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listKnowledgeBaseSources } from "./knowledge-base-sources-list.js";
import type { KnowledgeBase } from "./knowledge-base-store.js";
import { bindKnowledgeSource } from "./sources/source-binding-store.js";

function baseKnowledgeBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: "kb-test",
    title: "Test KB",
    description: "",
    ownerId: "user-a",
    tenantId: null,
    visibility: "private",
    backendKind: "personal",
    documentIds: ["doc-plain", "doc-note", "doc-upload"],
    recycledDocumentIds: [],
    documentCount: 3,
    robotIds: [],
    tags: [],
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides,
  };
}

describe("listKnowledgeBaseSources", () => {
  it("maps passive documents and active bindings with plane/kind filters", async () => {
    const storePath = `/tmp/openbot-kb-sources-${Date.now()}.json`;
    bindKnowledgeSource(
      {
        kind: "api",
        title: "CRM API",
        knowledgeBaseId: "kb-test",
        ownerId: "user-a",
      },
      storePath,
    );
    bindKnowledgeSource(
      {
        kind: "web",
        title: "Marketing site",
        knowledgeBaseId: "kb-test",
        ownerId: "user-a",
      },
      storePath,
    );

    const sources = await listKnowledgeBaseSources({
      knowledgeBase: baseKnowledgeBase(),
      bindingsStorePath: storePath,
    });

    const api = sources.find((item) => item.title === "CRM API");
    expect(api?.plane).toBe("active");
    expect(api?.kind).toBe("api");
    expect(api?.sourceDescriptorId).toBeTruthy();
    expect(api?.visibility).toBe("private");

    const passiveBinding = sources.find((item) => item.title === "Marketing site");
    expect(passiveBinding?.plane).toBe("passive");
    expect(passiveBinding?.kind).toBe("web");

    const passiveOnly = await listKnowledgeBaseSources({
      knowledgeBase: baseKnowledgeBase(),
      plane: "passive",
      bindingsStorePath: storePath,
    });
    expect(passiveOnly.every((item) => item.plane === "passive")).toBe(true);
    expect(passiveOnly.some((item) => item.title === "CRM API")).toBe(false);

    const activeOnly = await listKnowledgeBaseSources({
      knowledgeBase: baseKnowledgeBase(),
      plane: "active",
      bindingsStorePath: storePath,
    });
    expect(activeOnly.every((item) => item.plane === "active")).toBe(true);
    expect(activeOnly.some((item) => item.title === "CRM API")).toBe(true);
  });

  it("hides leftover skill catalog and lineage-uuid agent stubs from the cabin tree", async () => {
    const indexRoot = mkdtempSync(join(tmpdir(), "openbot-kb-sources-index-"));
    const sources = await listKnowledgeBaseSources({
      knowledgeBase: baseKnowledgeBase({ documentIds: [] }),
      indexRoot,
      deliverables: [
        {
          deliverableId: "skill:skill_9b2c46eaedd4",
          title: "skill:skill_9b2c46eaedd4",
          source: "chat",
          sourceType: "agent",
          artifactKind: "note",
          updatedAtMs: 10,
        },
        {
          deliverableId: "5d56ea0c-e52f-40ba-a200-babb4f2ebe54",
          title: "5d56ea0c-e52f-40ba-a200-babb4f2ebe54",
          source: "chat",
          sourceType: "agent",
          artifactKind: "note",
          updatedAtMs: 11,
        },
        {
          deliverableId: "dlv-human",
          title: "市场周报",
          source: "chat",
          sourceType: "agent",
          artifactKind: "note",
          updatedAtMs: 12,
        },
      ],
    });

    expect(sources.some((item) => /skill_/i.test(item.title) || /skill_/i.test(item.id))).toBe(
      false,
    );
    expect(sources.some((item) => item.title.includes("5d56ea0c"))).toBe(false);
    expect(sources.some((item) => item.title === "市场周报")).toBe(true);
  });

  it("hides UUID-named catalog files from the cabin tree", async () => {
    const sources = await listKnowledgeBaseSources({
      knowledgeBase: baseKnowledgeBase({
        documentIds: ["5d56ea0c-e52f-40ba-a200-babb4f2ebe54"],
      }),
      indexRoot: mkdtempSync(join(tmpdir(), "openbot-kb-sources-uuid-")),
    });
    expect(sources.some((item) => item.title.includes("5d56ea0c"))).toBe(false);
    expect(sources.some((item) => item.documentId === "5d56ea0c-e52f-40ba-a200-babb4f2ebe54")).toBe(
      false,
    );
  });

  it("lists reserved 个人成果 folder files as previewable kbdoc entries", async () => {
    const root = mkdtempSync(join(tmpdir(), "openbot-kb-sources-reserved-"));
    const { createKnowledgeBase } = await import("./knowledge-base-store.js");
    const { writeKnowledgeFolderFile, resolveKnowledgeDirectoryLayoutForBase } =
      await import("./knowledge-directory.js");
    const kbStorePath = join(root, "bases.json");
    const kb = createKnowledgeBase(
      {
        title: "个人成果",
        visibility: "private",
        ownerId: "user-a",
        tenantId: "acme",
      },
      kbStorePath,
    );
    const tenantsRoot = join(root, "tenants");
    const layout = resolveKnowledgeDirectoryLayoutForBase(kb, { tenantsRoot, configDir: root });
    writeKnowledgeFolderFile({
      layout,
      filename: "grok-bot-openbot-能力对标与优化建议.md",
      buffer: Buffer.from("# 对标\n", "utf8"),
    });

    const sources = await listKnowledgeBaseSources({
      knowledgeBase: kb,
      indexRoot: join(root, "index"),
      tenantsRoot,
      configDir: root,
    });
    const reserved = sources.find((item) => item.title.includes("能力对标"));
    expect(reserved?.documentId?.startsWith("kbdoc-")).toBe(true);
    expect(reserved?.canPreviewOriginal).toBe(true);
    expect(reserved?.kind).toBe("note");
  });

  it("repairs placeholder titles when reserved folder shares documentId", async () => {
    const root = mkdtempSync(join(tmpdir(), "openbot-kb-sources-title-repair-"));
    const { createKnowledgeBase } = await import("./knowledge-base-store.js");
    const {
      writeKnowledgeFolderFile,
      resolveKnowledgeDirectoryLayoutForBase,
      resolveKnowledgeIndexRootForBase,
    } = await import("./knowledge-directory.js");
    const { reservedDeliverableDocumentId } = await import("./reserved-deliverable-original.js");
    const { openKnowledgeIndex, upsertKnowledgeDocument } = await import("./kb-index.js");
    const { resolveKnowledgeIndexDbPath } = await import("./kb-index.js");

    const kbStorePath = join(root, "bases.json");
    const kb = createKnowledgeBase(
      {
        title: "个人成果",
        visibility: "private",
        ownerId: "user-a",
        tenantId: "acme",
      },
      kbStorePath,
    );
    const tenantsRoot = join(root, "tenants");
    const layout = resolveKnowledgeDirectoryLayoutForBase(kb, { tenantsRoot, configDir: root });
    const filename = "劳动合同_马志_修订版_v2.docx";
    writeKnowledgeFolderFile({
      layout,
      filename,
      buffer: Buffer.from("pk-fake-docx", "utf8"),
    });
    const documentId = reservedDeliverableDocumentId({
      knowledgeBaseId: kb.id,
      filename,
    });
    // Seed index with stub title (same id reserved folder would use).
    const indexRoot = resolveKnowledgeIndexRootForBase(kb, { tenantsRoot, configDir: root });
    expect(indexRoot).toBe(layout.indexRoot);
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: kb.ownerId,
      tenantId: kb.tenantId,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      upsertKnowledgeDocument({
        db: index.db,
        docId: documentId,
        kbId: kb.id,
        title: documentId, // stub / placeholder
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    } finally {
      index.close();
    }
    kb.documentIds = [documentId];

    const sources = await listKnowledgeBaseSources({
      knowledgeBase: kb,
      tenantsRoot,
      configDir: root,
      // omit indexRoot — must default to the same layout root ingest uses
    });
    const hit = sources.find((item) => item.documentId === documentId);
    expect(hit).toBeTruthy();
    expect(hit?.title).toContain("劳动合同");
    expect(hit?.canPreviewOriginal).toBe(true);
  });

  it("keeps a human index title when reserved folder shares documentId", async () => {
    const root = mkdtempSync(join(tmpdir(), "openbot-kb-sources-title-keep-"));
    const { createKnowledgeBase } = await import("./knowledge-base-store.js");
    const {
      writeKnowledgeFolderFile,
      resolveKnowledgeDirectoryLayoutForBase,
      resolveKnowledgeIndexRootForBase,
    } = await import("./knowledge-directory.js");
    const { reservedDeliverableDocumentId } = await import("./reserved-deliverable-original.js");
    const { openKnowledgeIndex, upsertKnowledgeDocument, resolveKnowledgeIndexDbPath } =
      await import("./kb-index.js");

    const kbStorePath = join(root, "bases.json");
    const kb = createKnowledgeBase(
      {
        title: "个人成果",
        visibility: "private",
        ownerId: "user-a",
        tenantId: "acme",
      },
      kbStorePath,
    );
    const tenantsRoot = join(root, "tenants");
    const layout = resolveKnowledgeDirectoryLayoutForBase(kb, { tenantsRoot, configDir: root });
    const filename = "人才回流.docx";
    writeKnowledgeFolderFile({
      layout,
      filename,
      buffer: Buffer.from("pk-fake", "utf8"),
    });
    const documentId = reservedDeliverableDocumentId({
      knowledgeBaseId: kb.id,
      filename,
    });
    const indexRoot = resolveKnowledgeIndexRootForBase(kb, { tenantsRoot, configDir: root });
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: kb.ownerId,
      tenantId: kb.tenantId,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      upsertKnowledgeDocument({
        db: index.db,
        docId: documentId,
        kbId: kb.id,
        title: "用户手改标题",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    } finally {
      index.close();
    }
    kb.documentIds = [documentId];

    const sources = await listKnowledgeBaseSources({
      knowledgeBase: kb,
      tenantsRoot,
      configDir: root,
    });
    const hit = sources.find((item) => item.documentId === documentId);
    expect(hit?.title).toBe("用户手改标题");
    expect(hit?.canPreviewOriginal).toBe(true);
  });
});
