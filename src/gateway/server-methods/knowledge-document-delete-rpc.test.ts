// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "../../memory/embeddings.js";
import { knowledgeDocumentIdFromSkillRef } from "../knowledge/document-display-title.js";
import type { KnowledgeSourceContext } from "../knowledge/sources/types.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

const { tmpDir } = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-kb-delete-rpc-${Math.random().toString(36).slice(2)}`,
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

vi.mock("../knowledge/kb-index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../knowledge/kb-index.js")>();
  return {
    ...actual,
    deleteKnowledgeDocumentFromIndex: vi.fn(() => {
      throw new Error("index delete failed");
    }),
  };
});

const { knowledgeHandlers } = await import("./knowledge.js");

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
  error?: { message?: string };
}> {
  const handler = knowledgeHandlers[method] as GatewayRequestHandler | undefined;
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: {
    ok: boolean;
    payload?: Record<string, unknown>;
    error?: { message?: string };
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
        error: error as { message?: string } | undefined,
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

describe("knowledge.base.documents.delete retry state", () => {
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

  it("preserves bindings and unrelated concurrent writes on index failure, then retries", async () => {
    const created = await invoke("knowledge.base.create", { title: "Delete rollback KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    const uploaded = await invoke("knowledge.personal.upload", {
      knowledgeBaseId: kbId,
      attachment: {
        fileName: "rollback.md",
        mimeType: "text/markdown",
        size: 64,
        kind: "text",
        textContent: "# Rollback\nDeletion should restore binding on failure.",
      },
    });
    expect(uploaded.ok).toBe(true);
    const skillId = (uploaded.payload?.skillId as string | undefined) ?? "";
    expect(skillId).toBeTruthy();

    const documentId = knowledgeDocumentIdFromSkillRef(kbId, skillId);
    const index = await import("../knowledge/kb-index.js");
    const actualIndex = await vi.importActual<typeof import("../knowledge/kb-index.js")>(
      "../knowledge/kb-index.js",
    );
    const bases = await import("../knowledge/knowledge-base-store.js");
    let unrelatedId = "";
    vi.mocked(index.deleteKnowledgeDocumentFromIndex).mockImplementationOnce(() => {
      unrelatedId = bases.createKnowledgeBase({
        title: "Concurrent unrelated KB",
        ownerId: "user-a",
      }).id;
      throw new Error("index delete failed");
    });
    const deleted = await invoke("knowledge.base.documents.delete", {
      knowledgeBaseId: kbId,
      documentId,
    });
    expect(deleted.ok).toBe(false);
    expect(deleted.error?.message).toContain("index delete failed");

    const sources = await invoke("knowledge.base.sources.list", { knowledgeBaseId: kbId });
    expect(sources.ok).toBe(true);
    const items = sources.payload?.sources as Array<{ documentId?: string }> | undefined;
    expect(items?.some((item) => item.documentId === documentId)).toBe(true);
    expect(bases.getKnowledgeBase(unrelatedId)?.title).toBe("Concurrent unrelated KB");
    expect(bases.getKnowledgeBase(kbId)?.documentIds).toContain(documentId);
    expect(
      (await invoke("knowledge.document.preview", { knowledgeBaseId: kbId, documentId })).ok,
    ).toBe(false);
    vi.mocked(index.deleteKnowledgeDocumentFromIndex).mockImplementation(
      actualIndex.deleteKnowledgeDocumentFromIndex,
    );
    const retried = await invoke("knowledge.base.documents.delete", {
      knowledgeBaseId: kbId,
      documentId,
    });
    expect(retried.ok).toBe(true);
    expect(bases.getKnowledgeBase(unrelatedId)?.title).toBe("Concurrent unrelated KB");
    expect(bases.getKnowledgeBase(kbId)?.documentIds).not.toContain(documentId);
  });
});
