// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "../../memory/embeddings.js";
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
  } satisfies KnowledgeSourceContext,
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
    const documentId = (uploaded.payload?.skillId as string | undefined) ?? "";
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
    const documentId = (uploaded.payload?.skillId as string | undefined) ?? "";
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
    const documentId = (uploaded.payload?.skillId as string | undefined) ?? "";
    expect(documentId).toBeTruthy();

    const sources = await invoke("knowledge.base.sources.list", { knowledgeBaseId: kbId });
    expect(sources.ok).toBe(true);
    const items = (sources.payload?.sources as Array<Record<string, unknown>> | undefined) ?? [];
    const match = items.find((item) => item.documentId === documentId);
    expect(match?.canPreviewOriginal).toBe(true);
  });
});
