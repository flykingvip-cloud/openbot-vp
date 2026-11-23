// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "../../memory/embeddings.js";
import { knowledgeDocumentIdFromSkillRef } from "../knowledge/document-display-title.js";
import type { KnowledgeSourceContext } from "../knowledge/sources/types.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

const { tmpDir } = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-kb-preview-rpc-${Math.random().toString(36).slice(2)}`,
}));

const contextState = vi.hoisted(() => ({
  current: {
    userId: "user-a",
    seatId: null,
    tenantId: null,
    hasEnterpriseScope: false,
  } as KnowledgeSourceContext,
}));

const mockProvider: EmbeddingProvider = {
  id: "openai",
  model: "mock-embed",
  embedQuery: async (text) => [text.length % 7, 0.2, 0.4],
  embedBatch: async (texts) => texts.map((text) => [text.length % 7, 0.2, 0.4]),
};

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

vi.mock("../knowledge/context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(async () => contextState.current),
}));

vi.mock("../knowledge/kb-ingest.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../knowledge/kb-ingest.js")>();
  return {
    ...actual,
    resolveKnowledgeIngestEmbeddingProvider: vi.fn(async () => mockProvider),
  };
});

const { knowledgeHandlers } = await import("./knowledge.js");
const { hasKnowledgeOriginal, resolveKnowledgeOriginalsRoot } =
  await import("../knowledge/knowledge-original-store.js");

function cleanStore() {
  fs.rmSync(path.join(tmpDir, "skill-assets"), { recursive: true, force: true });
  fs.rmSync(path.join(tmpDir, "knowledge"), { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

async function invoke(
  method: string,
  params: Record<string, unknown> = {},
): Promise<{
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string; code?: string; details?: unknown };
}> {
  const handler = knowledgeHandlers[method] as GatewayRequestHandler | undefined;
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: {
    ok: boolean;
    payload?: Record<string, unknown>;
    error?: { message?: string; code?: string; details?: unknown };
  } | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: { connect: {} as never, user: "test@example.com" },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = {
        ok,
        payload: payload as Record<string, unknown> | undefined,
        error: error as { message?: string; code?: string; details?: unknown } | undefined,
      };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error("handler did not respond");
  }
  return response;
}

function extractUploadedDocumentId(
  kbId: string,
  payload: Record<string, unknown> | undefined,
): string {
  const skillId = payload?.skillId;
  if (typeof skillId !== "string" || !skillId) {
    throw new Error("expected upload skillId");
  }
  return knowledgeDocumentIdFromSkillRef(kbId, skillId);
}

function extractKnowledgeBaseId(payload: Record<string, unknown> | undefined): string {
  const kb = payload?.knowledgeBase;
  if (!kb || typeof kb !== "object") {
    throw new Error("expected knowledgeBase in payload");
  }
  const id = (kb as { id?: unknown }).id;
  if (typeof id !== "string" || !id) {
    throw new Error("expected knowledgeBase.id in payload");
  }
  return id;
}

describe("knowledge.document.preview", () => {
  beforeEach(() => {
    cleanStore();
    contextState.current = {
      userId: "user-a",
      seatId: null,
      tenantId: null,
      hasEnterpriseScope: false,
    };
  });

  afterEach(() => {
    cleanStore();
  });

  it("returns base64 after upload persists the original blob", async () => {
    const created = await invoke("knowledge.base.create", {
      title: "Preview KB",
      visibility: "private",
    });
    expect(created.ok).toBe(true);
    const kbId = extractKnowledgeBaseId(created.payload);

    const uploaded = await invoke("knowledge.personal.upload", {
      knowledgeBaseId: kbId,
      title: "Guide",
      attachment: {
        fileName: "guide.md",
        mimeType: "text/markdown",
        size: 24,
        kind: "text",
        textContent: "# Guide\n\nHello preview world.",
      },
    });
    expect(uploaded.ok).toBe(true);
    const documentId = extractUploadedDocumentId(kbId, uploaded.payload);
    expect(documentId).toBeTruthy();
    expect(hasKnowledgeOriginal({ kbId, docId: documentId })).toBe(true);

    const preview = await invoke("knowledge.document.preview", {
      knowledgeBaseId: kbId,
      documentId,
    });
    expect(preview.ok).toBe(true);
    expect(preview.payload?.filename).toBe("guide.md");
    expect(preview.payload?.textLike).toBe(true);
    expect(typeof preview.payload?.base64).toBe("string");
    expect(Buffer.from(String(preview.payload?.base64), "base64").toString("utf8")).toContain(
      "Hello preview world",
    );
    expect(preview.payload?.source).toBe("original_store");
  });

  it("fail-closes when no original was retained", async () => {
    const created = await invoke("knowledge.base.create", {
      title: "Empty Preview KB",
      visibility: "private",
    });
    const kbId = extractKnowledgeBaseId(created.payload);

    const preview = await invoke("knowledge.document.preview", {
      knowledgeBaseId: kbId,
      documentId: "missing-doc",
    });
    expect(preview.ok).toBe(false);
    expect(preview.error?.code).toBe("UNAVAILABLE");
    expect(preview.error?.details).toEqual({ reason: "original_not_retained" });
  });

  it("deletes the original blob when the document is hard-deleted", async () => {
    const created = await invoke("knowledge.base.create", {
      title: "Delete Preview KB",
      visibility: "private",
    });
    const kbId = extractKnowledgeBaseId(created.payload);
    const uploaded = await invoke("knowledge.personal.upload", {
      knowledgeBaseId: kbId,
      title: "Temp",
      attachment: {
        fileName: "temp.md",
        mimeType: "text/markdown",
        size: 18,
        kind: "text",
        textContent: "# Temp\n\nDelete me.",
      },
    });
    const documentId = extractUploadedDocumentId(kbId, uploaded.payload);
    expect(documentId).toBeTruthy();
    expect(hasKnowledgeOriginal({ kbId, docId: documentId })).toBe(true);

    const deleted = await invoke("knowledge.base.documents.delete", {
      knowledgeBaseId: kbId,
      documentId,
    });
    expect(deleted.ok).toBe(true);
    expect(hasKnowledgeOriginal({ kbId, docId: documentId })).toBe(false);
    expect(fs.existsSync(path.join(resolveKnowledgeOriginalsRoot(), kbId, documentId))).toBe(false);

    const preview = await invoke("knowledge.document.preview", {
      knowledgeBaseId: kbId,
      documentId,
    });
    expect(preview.ok).toBe(false);
    expect(preview.error?.details).toEqual({ reason: "original_not_retained" });
  });

  it("marks canPreviewOriginal on sources.list after upload", async () => {
    const created = await invoke("knowledge.base.create", {
      title: "Sources Preview KB",
      visibility: "private",
    });
    const kbId = extractKnowledgeBaseId(created.payload);
    const uploaded = await invoke("knowledge.personal.upload", {
      knowledgeBaseId: kbId,
      title: "Listed",
      attachment: {
        fileName: "listed.md",
        mimeType: "text/markdown",
        size: 20,
        kind: "text",
        textContent: "# Listed\n\nSource flag.",
      },
    });
    const documentId = extractUploadedDocumentId(kbId, uploaded.payload);
    expect(documentId).toBeTruthy();

    const sources = await invoke("knowledge.base.sources.list", { knowledgeBaseId: kbId });
    expect(sources.ok).toBe(true);
    const items = (sources.payload?.sources as Array<Record<string, unknown>> | undefined) ?? [];
    const match = items.find((item) => item.documentId === documentId);
    expect(match?.canPreviewOriginal).toBe(true);
  });
  it("uses the tenant originals root, retains exact bytes, and removes the blob on hard delete", async () => {
    contextState.current.tenantId = "tenant-preview-rpc";
    const created = await invoke("knowledge.base.create", {
      title: "Tenant preview",
      visibility: "private",
    });
    expect(created.ok).toBe(true);
    const kbId = extractKnowledgeBaseId(created.payload);
    const originalText = "# Tenant original\n\nExact original bytes, not normalized index text.\n";
    const uploaded = await invoke("knowledge.personal.upload", {
      knowledgeBaseId: kbId,
      title: "Tenant original",
      attachment: {
        fileName: "tenant-original.md",
        mimeType: "text/markdown",
        size: Buffer.byteLength(originalText),
        kind: "text",
        textContent: originalText,
      },
    });
    expect(uploaded.ok).toBe(true);
    const docId = extractUploadedDocumentId(kbId, uploaded.payload);
    const { getKnowledgeBase } = await import("../knowledge/knowledge-base-store.js");
    const { resolveKnowledgeDirectoryLayoutForBase } =
      await import("../knowledge/knowledge-directory.js");
    const base = getKnowledgeBase(kbId)!;
    expect(base.tenantId).toBe("tenant-preview-rpc");
    const originalsRoot = resolveKnowledgeDirectoryLayoutForBase(base).originalsRoot;
    expect(hasKnowledgeOriginal({ kbId, docId, originalsRoot })).toBe(true);
    const preview = await invoke("knowledge.document.preview", {
      knowledgeBaseId: kbId,
      documentId: docId,
    });
    expect(preview.ok).toBe(true);
    expect(preview.payload?.source).toBe("original_store");
    expect(Buffer.from(String(preview.payload?.base64), "base64").toString("utf8")).toBe(
      originalText,
    );
    const before = await invoke("knowledge.base.sources.list", { knowledgeBaseId: kbId });
    expect(
      (
        (before.payload?.sources ?? []) as Array<{
          documentId: string;
          canPreviewOriginal: boolean;
        }>
      ).find((item) => item.documentId === docId)?.canPreviewOriginal,
    ).toBe(true);
    const deleted = await invoke("knowledge.base.documents.delete", {
      knowledgeBaseId: kbId,
      documentId: docId,
    });
    expect(deleted.ok).toBe(true);
    expect(hasKnowledgeOriginal({ kbId, docId, originalsRoot })).toBe(false);
    const after = await invoke("knowledge.base.sources.list", { knowledgeBaseId: kbId });
    expect(after.ok).toBe(true);
    expect(Array.isArray(after.payload?.sources)).toBe(true);
    expect(
      (
        (after.payload?.sources ?? []) as Array<{ documentId: string; canPreviewOriginal: boolean }>
      ).find((item) => item.documentId === docId)?.canPreviewOriginal,
    ).not.toBe(true);
    const removedPreview = await invoke("knowledge.document.preview", {
      knowledgeBaseId: kbId,
      documentId: docId,
    });
    expect(removedPreview.ok).toBe(false);
    expect(removedPreview.error?.details).toEqual({ reason: "original_not_retained" });
  });
  it("fails closed durably when legacy cleanup fails, then retries without resurrecting either root", async () => {
    contextState.current.tenantId = "tenant-delete-fault";
    const created = await invoke("knowledge.base.create", {
      title: "Fault",
      visibility: "private",
    });
    const kbId = extractKnowledgeBaseId(created.payload);
    const text = "# Legacy exact bytes\n\nKeep whitespace.\n";
    const uploaded = await invoke("knowledge.personal.upload", {
      knowledgeBaseId: kbId,
      title: "Fault original",
      attachment: {
        fileName: "fault.md",
        mimeType: "text/markdown",
        size: Buffer.byteLength(text),
        kind: "text",
        textContent: text,
      },
    });
    expect(uploaded.ok).toBe(true);
    const docId = extractUploadedDocumentId(kbId, uploaded.payload);
    const store = await import("../knowledge/knowledge-original-store.js");
    const { getKnowledgeBase } = await import("../knowledge/knowledge-base-store.js");
    const { resolveKnowledgeDirectoryLayoutForBase } =
      await import("../knowledge/knowledge-directory.js");
    const originalsRoot = resolveKnowledgeDirectoryLayoutForBase(
      getKnowledgeBase(kbId)!,
    ).originalsRoot;
    store.persistKnowledgeOriginal({
      kbId,
      docId,
      fileName: "legacy.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(text),
    });
    // An unrevoked historical copy remains compatible with normal preview.
    store.deleteKnowledgeOriginal({ kbId, docId, originalsRoot });
    const legacy = await invoke("knowledge.document.preview", {
      knowledgeBaseId: kbId,
      documentId: docId,
    });
    expect(legacy.ok).toBe(true);
    expect(Buffer.from(String(legacy.payload?.base64), "base64").toString()).toBe(text);
    store.persistKnowledgeOriginal({
      kbId,
      docId,
      originalsRoot,
      fileName: "fault.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(text),
    });
    const legacyDir = path.join(resolveKnowledgeOriginalsRoot(), kbId, docId);
    const realRemove = fs.rmSync.bind(fs);
    const remove = vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
      if (String(target) === legacyDir) {
        throw Object.assign(new Error("injected legacy cleanup denial"), { code: "EACCES" });
      }
      return realRemove(target, options);
    });
    try {
      const failed = await invoke("knowledge.base.documents.delete", {
        knowledgeBaseId: kbId,
        documentId: docId,
      });
      expect(failed.ok).toBe(false);
      expect(fs.existsSync(legacyDir)).toBe(true);
      expect(getKnowledgeBase(kbId)?.documentIds).toContain(docId);
      expect(store.isKnowledgeOriginalDeleted({ kbId, docId, originalsRoot })).toBe(true);
      expect(
        (await invoke("knowledge.document.preview", { knowledgeBaseId: kbId, documentId: docId }))
          .ok,
      ).toBe(false);
      const sources = await invoke("knowledge.base.sources.list", { knowledgeBaseId: kbId });
      expect(
        (
          (sources.payload?.sources ?? []) as Array<{
            documentId: string;
            canPreviewOriginal?: boolean;
          }>
        ).find((x) => x.documentId === docId)?.canPreviewOriginal,
      ).not.toBe(true);
      // Cross-tenant callers cannot use pending deletion to gain read or cleanup authority.
      contextState.current = { ...contextState.current, userId: "user-b", tenantId: "tenant-b" };
      expect(
        (await invoke("knowledge.document.preview", { knowledgeBaseId: kbId, documentId: docId }))
          .ok,
      ).toBe(false);
      expect(
        (
          await invoke("knowledge.base.documents.delete", {
            knowledgeBaseId: kbId,
            documentId: docId,
          })
        ).ok,
      ).toBe(false);
      contextState.current = {
        ...contextState.current,
        userId: "user-a",
        tenantId: "tenant-delete-fault",
      };
      expect(() =>
        store.persistKnowledgeOriginal({
          kbId,
          docId,
          originalsRoot,
          fileName: "race.md",
          mimeType: "text/markdown",
          buffer: Buffer.from("concurrent writer"),
        }),
      ).toThrow("knowledge_original_deleted");
    } finally {
      remove.mockRestore();
    }
    // Re-import uses disk state, not an in-memory revocation cache.
    vi.resetModules();
    const restarted = await import("../knowledge/knowledge-document-preview.js");
    expect(
      await restarted.readKnowledgeDocumentContent({ knowledgeBaseId: kbId, documentId: docId }),
    ).toBeNull();
    expect(
      (
        await invoke("knowledge.base.documents.delete", {
          knowledgeBaseId: kbId,
          documentId: docId,
        })
      ).ok,
    ).toBe(true);
    expect(fs.existsSync(legacyDir)).toBe(false);
    expect(store.hasKnowledgeOriginal({ kbId, docId, originalsRoot })).toBe(false);
    expect(
      await restarted.readKnowledgeDocumentContent({ knowledgeBaseId: kbId, documentId: docId }),
    ).toBeNull();
    // Idempotent retry remains successful and does not remove the durable intent.
    expect(
      (
        await invoke("knowledge.base.documents.delete", {
          knowledgeBaseId: kbId,
          documentId: docId,
        })
      ).ok,
    ).toBe(true);
  });
});
