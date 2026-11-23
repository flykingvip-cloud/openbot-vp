// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetKnowledgeRetrievalServiceForTests } from "../../retrieval/retrieval-service.js";
import { resetDeliverableRetrievalSourceRegistrationForTests } from "../../retrieval/sources/deliverable-source.js";
import { resetKnowledgeRetrievalSourceRegistrationForTests } from "../../retrieval/sources/knowledge-source.js";
import { ingestKnowledgeDocument } from "../knowledge/kb-ingest.js";
import type { KnowledgeSourceContext } from "../knowledge/sources/types.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

const { tmpDir } = vi.hoisted(() => {
  const dir = `/tmp/openbot-kb-search-rpc-${Math.random().toString(36).slice(2)}`;
  return { tmpDir: dir };
});

const contextState = vi.hoisted(() => ({
  current: {
    userId: "user-a",
    seatId: null,
    tenantId: null,
    hasEnterpriseScope: false,
  } as KnowledgeSourceContext,
}));

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

const { knowledgeHandlers } = await import("./knowledge.js");

function setContext(context: Partial<KnowledgeSourceContext> & { userId: string | null }) {
  contextState.current = {
    userId: context.userId,
    seatId: context.seatId ?? null,
    tenantId: context.tenantId ?? null,
    hasEnterpriseScope: context.hasEnterpriseScope ?? Boolean(context.tenantId),
    teamLabel: context.teamLabel ?? null,
    roleCode: context.roleCode ?? null,
    departmentId: context.departmentId ?? null,
  };
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
    throw new Error(`handler ${method} did not respond`);
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

describe("knowledge.base.search RPC integration", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(tmpDir, "knowledge"), { recursive: true });
    setContext({ userId: "user-a", tenantId: null, seatId: null, hasEnterpriseScope: false });
    resetKnowledgeRetrievalServiceForTests();
    resetKnowledgeRetrievalSourceRegistrationForTests();
    resetDeliverableRetrievalSourceRegistrationForTests();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    resetKnowledgeRetrievalServiceForTests();
    resetKnowledgeRetrievalSourceRegistrationForTests();
    resetDeliverableRetrievalSourceRegistrationForTests();
  });

  it("returns indexed evidence for authorized owner when chunks exist", async () => {
    const created = await invoke("knowledge.base.create", { title: "Search KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    await ingestKnowledgeDocument({
      kbId,
      docId: "doc-search-1",
      title: "Refund Guide",
      fileName: "refund.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Refunds\n\nEnterprise refund escalation playbook.", "utf8"),
      ownerId: "user-a",
      tenantId: null,
      indexRoot: path.join(tmpDir, "knowledge", "index"),
      embeddingProvider: null,
    });

    const searched = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "refund escalation",
      limit: 4,
    });
    expect(searched.ok).toBe(true);
    expect(searched.payload?.searchMode).toBe("indexed");
    const evidence = searched.payload?.evidence;
    expect(Array.isArray(evidence)).toBe(true);
    expect((evidence as unknown[]).length).toBeGreaterThan(0);
    const first = (evidence as Array<Record<string, unknown>>)[0];
    expect(first?.kbId).toBe(kbId);
    expect(String(first?.sourceUri)).toMatch(/^ku:\/\/kb\//);
  });

  it("rejects cross-owner KB deletion and removes its manual summaries", async () => {
    const created = await invoke("knowledge.base.create", { title: "Delete manual summary" });
    const kbId = extractKnowledgeBaseId(created.payload);
    const indexRoot = path.join(tmpDir, "knowledge", "index");
    await ingestKnowledgeDocument({
      kbId,
      docId: "delete-manual",
      title: "Delete",
      fileName: "delete.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("Synthetic manual source"),
      ownerId: "user-a",
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    });
    const fields = { purpose: "manual", keyPoints: [], coverage: [], entities: [], boundaries: [] };
    expect(
      (
        await invoke("knowledge.document.summary", {
          knowledgeBaseId: kbId,
          documentId: "delete-manual",
          fields,
        })
      ).ok,
    ).toBe(true);
    setContext({ userId: "user-b" });
    expect((await invoke("knowledge.base.delete", { knowledgeBaseId: kbId })).ok).toBe(false);
    setContext({ userId: "user-a" });
    expect((await invoke("knowledge.base.delete", { knowledgeBaseId: kbId })).ok).toBe(true);
    const { openKnowledgeIndex, resolveKnowledgeIndexDbPath } =
      await import("../knowledge/kb-index.js");
    const index = await openKnowledgeIndex({
      dbPath: resolveKnowledgeIndexDbPath({ ownerId: "user-a", tenantId: null, indexRoot }),
      vectorEnabled: false,
    });
    try {
      expect(
        index.db.prepare("SELECT count(*) AS n FROM retrieval_summaries WHERE kb_id=?").get(kbId)
          ?.n,
      ).toBe(0);
    } finally {
      index.close();
    }
  });

  it("maintains summaries through ACL and recalls a document without bundle projection", async () => {
    const created = await invoke("knowledge.base.create", { title: "Summary KB" });
    const kbId = extractKnowledgeBaseId(created.payload);
    await ingestKnowledgeDocument({
      kbId,
      docId: "summary-only",
      title: "Target",
      fileName: "target.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("Unrelated original body."),
      ownerId: "user-a",
      tenantId: null,
      indexRoot: path.join(tmpDir, "knowledge", "index"),
      embeddingProvider: null,
    });
    const retry = await invoke("knowledge.document.summary", {
      knowledgeBaseId: kbId,
      documentId: "summary-only",
      retry: true,
    });
    expect(retry.ok).toBe(false);
    expect(retry.error?.message).toContain("automatic summary generation is not available");
    const fields = {
      purpose: "needle summary",
      keyPoints: [],
      coverage: [],
      entities: [],
      boundaries: [],
    };
    expect(
      (
        await invoke("knowledge.document.summary", {
          knowledgeBaseId: kbId,
          documentId: "summary-only",
          fields,
        })
      ).ok,
    ).toBe(true);
    await ingestKnowledgeDocument({
      kbId,
      docId: "body-hit",
      title: "Other body",
      fileName: "other.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("needle unrelated body evidence"),
      ownerId: "user-a",
      tenantId: null,
      indexRoot: path.join(tmpDir, "knowledge", "index"),
      embeddingProvider: null,
    });
    const search = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "needle",
    });
    expect(
      (
        await invoke("knowledge.document.summary", {
          knowledgeBaseId: kbId,
          documentId: "summary-only",
          metadata: {
            editorialStatus: "final",
            sourceRelations: [{ kind: "derived-from", documentId: "body-hit" }],
          },
        })
      ).ok,
    ).toBe(true);
    const labeled = await invoke("knowledge.document.summary", {
      knowledgeBaseId: kbId,
      documentId: "summary-only",
    });
    expect(labeled.payload?.summary).toMatchObject({
      editorialStatus: "final",
      reviewedBy: "user-a",
      sourceRelations: [{ kind: "derived-from", documentId: "body-hit" }],
    });
    expect(
      (
        await invoke("knowledge.document.summary", {
          knowledgeBaseId: kbId,
          documentId: "summary-only",
          metadata: { sourceRelations: [{ kind: "supersedes", documentId: "foreign-hidden-doc" }] },
        })
      ).ok,
    ).toBe(false);
    expect(search.ok).toBe(true);
    expect((search.payload?.evidence as unknown[] | undefined)?.length ?? 0).toBeGreaterThan(0);
    expect(search.payload?.substringMatches).toMatchObject([
      { id: "summary-only", title: "Target" },
    ]);
    const other = extractKnowledgeBaseId(
      (await invoke("knowledge.base.create", { title: "Other" })).payload,
    );
    expect(
      (
        await invoke("knowledge.document.summary", {
          knowledgeBaseId: other,
          documentId: "summary-only",
        })
      ).payload?.summary,
    ).toBeNull();
    expect(
      (
        await invoke("knowledge.document.summary", {
          knowledgeBaseId: kbId,
          documentId: "summary-only",
          fields: { ...fields, purpose: "x".repeat(4001) },
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await invoke("knowledge.document.summary", {
          knowledgeBaseId: kbId,
          documentId: "summary-only",
          fields: { ...fields, purpose: " " },
        })
      ).ok,
    ).toBe(false);
    await ingestKnowledgeDocument({
      kbId,
      docId: "summary-only",
      title: "Target updated",
      fileName: "target.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("Updated original body."),
      ownerId: "user-a",
      tenantId: null,
      indexRoot: path.join(tmpDir, "knowledge", "index"),
      embeddingProvider: null,
    });
    const stale = await invoke("knowledge.document.summary", {
      knowledgeBaseId: kbId,
      documentId: "summary-only",
    });
    expect(stale.payload?.summary).toMatchObject({ state: "stale", method: "human" });
    expect(
      (
        await invoke("knowledge.document.summary", {
          knowledgeBaseId: kbId,
          documentId: "summary-only",
          fields: { ...fields, purpose: "revised" },
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await invoke("knowledge.document.summary", {
          knowledgeBaseId: kbId,
          documentId: "summary-only",
          retry: true,
        })
      ).ok,
    ).toBe(false);
    setContext({ userId: "user-b" });
    expect(
      (
        await invoke("knowledge.document.summary", {
          knowledgeBaseId: kbId,
          documentId: "summary-only",
          retry: true,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await invoke("knowledge.document.summary", {
          knowledgeBaseId: kbId,
          documentId: "summary-only",
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await invoke("knowledge.document.summary", {
          knowledgeBaseId: kbId,
          documentId: "summary-only",
          fields,
        })
      ).ok,
    ).toBe(false);
  });

  it("hides knowledge base search from unauthorized user", async () => {
    const created = await invoke("knowledge.base.create", { title: "Hidden KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    await ingestKnowledgeDocument({
      kbId,
      docId: "doc-hidden",
      title: "Hidden",
      fileName: "hidden.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Hidden\n\nSecret refund escalation content.", "utf8"),
      ownerId: "user-a",
      tenantId: null,
      indexRoot: path.join(tmpDir, "knowledge", "index"),
      embeddingProvider: null,
    });

    setContext({ userId: "user-b", tenantId: null, seatId: null, hasEnterpriseScope: false });

    const searched = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "refund escalation",
    });
    expect(searched.ok).toBe(false);
    expect(searched.error?.message).toContain("not found");
  });

  it("returns substring mode when knowledge base has no indexed chunks", async () => {
    const created = await invoke("knowledge.base.create", { title: "Empty Index KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    const searched = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "anything",
    });
    expect(searched.ok).toBe(true);
    expect(searched.payload?.searchMode).toBe("substring");
    expect(searched.payload?.evidence).toEqual([]);
    expect(searched.payload?.substringMatches).toEqual([]);
  });

  it("returns substringMatches from bundle when indexed evidence is empty", async () => {
    const collected = await invoke("knowledge.personal.collect", {
      title: "Fallback Playbook",
      summary: "General onboarding notes",
      tags: ["kb-substring-marker"],
    });
    expect(collected.ok).toBe(true);
    const skillId = collected.payload?.skillId as string;

    const created = await invoke("knowledge.base.create", { title: "Fallback KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    const attached = await invoke("knowledge.base.attach", {
      knowledgeBaseId: kbId,
      documentId: skillId,
    });
    expect(attached.ok).toBe(true);

    const searched = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "kb-substring-marker",
    });
    expect(searched.ok).toBe(true);
    if (searched.payload?.searchMode === "indexed") {
      expect(searched.payload?.evidence).toEqual(expect.any(Array));
      return;
    }
    expect(searched.payload?.searchMode).toBe("substring");
    const matches = searched.payload?.substringMatches as Array<{ title?: string }>;
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((item) => item.title === "Fallback Playbook")).toBe(true);
  });

  it("returns historical version evidence when versionId is provided", async () => {
    const created = await invoke("knowledge.base.create", { title: "Versioned Search KB" });
    const kbId = extractKnowledgeBaseId(created.payload);
    const indexRoot = path.join(tmpDir, "knowledge", "index");

    const v1 = await ingestKnowledgeDocument({
      kbId,
      docId: "doc-version-rpc",
      title: "Policy",
      fileName: "policy.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Legacy onboarding refund escalation notes. legacyonlymarker77.", "utf8"),
      ownerId: "user-a",
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    });
    const v2 = await ingestKnowledgeDocument({
      kbId,
      docId: "doc-version-rpc",
      title: "Policy",
      fileName: "policy.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Current onboarding refund escalation notes.", "utf8"),
      ownerId: "user-a",
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    });

    const current = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "legacyonlymarker77",
    });
    expect(current.ok).toBe(true);
    expect((current.payload?.evidence as unknown[] | undefined)?.length ?? 0).toBe(0);

    // A broad multiword query intentionally falls back from AND to OR.
    // Matching shared words must still return only the current revision.
    const orFallback = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "legacyonlymarker77 onboarding refund",
    });
    expect(orFallback.ok).toBe(true);
    const currentEvidence = orFallback.payload?.evidence as Array<{
      versionId: string;
      chunkText: string;
    }>;
    expect(currentEvidence.length).toBeGreaterThan(0);
    expect(currentEvidence.every((item) => item.versionId === v2.versionId)).toBe(true);
    expect(currentEvidence.every((item) => !item.chunkText.includes("legacyonlymarker77"))).toBe(
      true,
    );

    const historical = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "legacyonlymarker77",
      versionId: v1.versionId,
    });
    expect(historical.ok).toBe(true);
    expect(historical.payload?.searchMode).toBe("indexed");
    const evidence = historical.payload?.evidence as Array<{ versionId?: string }>;
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((item) => item.versionId === v1.versionId)).toBe(true);
  });
});
