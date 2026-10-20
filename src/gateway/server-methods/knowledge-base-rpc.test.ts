// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeSourceContext } from "../knowledge/sources/types.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-kb-rpc-${randomUUID()}`);

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
const { bindKnowledgeSource } = await import("../knowledge/sources/source-binding-store.js");

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

function storePath(): string {
  return path.join(tmpDir, "knowledge", "bases.json");
}

function membersStorePath(): string {
  return path.join(tmpDir, "knowledge", "base-members.json");
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

function extractKnowledgeBase(payload: Record<string, unknown> | undefined): {
  documentIds: string[];
  recycledDocumentIds: string[];
  documentCount: number;
} {
  const kb = payload?.knowledgeBase;
  if (!kb || typeof kb !== "object") {
    throw new Error("expected knowledgeBase in payload");
  }
  const record = kb as {
    documentIds?: unknown;
    recycledDocumentIds?: unknown;
    documentCount?: unknown;
  };
  return {
    documentIds: Array.isArray(record.documentIds)
      ? record.documentIds.filter((item): item is string => typeof item === "string")
      : [],
    recycledDocumentIds: Array.isArray(record.recycledDocumentIds)
      ? record.recycledDocumentIds.filter((item): item is string => typeof item === "string")
      : [],
    documentCount: typeof record.documentCount === "number" ? record.documentCount : 0,
  };
}

describe("knowledge.base.* RPC integration", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    setContext({ userId: "user-a", tenantId: null, seatId: null, hasEnterpriseScope: false });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("hides user A knowledge base from user B on list and get", async () => {
    const created = await invoke("knowledge.base.create", { title: "Private A" });
    expect(created.ok).toBe(true);
    const kbId = extractKnowledgeBaseId(created.payload);

    setContext({ userId: "user-b", tenantId: null, seatId: null, hasEnterpriseScope: false });

    const listed = await invoke("knowledge.base.list");
    expect(listed.ok).toBe(true);
    const listedBases = (listed.payload?.knowledgeBases ?? []) as Array<{
      id?: string;
      title?: string;
    }>;
    expect(listedBases.every((base) => base.id !== kbId)).toBe(true);
    expect(
      listedBases
        .map((base) => base.title ?? "")
        .toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(["个人成果", "团队成果"]);

    const got = await invoke("knowledge.base.get", { knowledgeBaseId: kbId });
    expect(got.ok).toBe(false);
    expect(got.error?.message).toContain("not found");
  });

  it("lists owner knowledge bases with enriched runtime summary", async () => {
    const created = await invoke("knowledge.base.create", { title: "Owner Visible" });
    expect(created.ok).toBe(true);
    const kbId = extractKnowledgeBaseId(created.payload);

    const listed = await invoke("knowledge.base.list");
    expect(listed.ok).toBe(true);
    const knowledgeBases = listed.payload?.knowledgeBases as
      | Array<{ id?: string; title?: string; chunkCount?: number; healthScore?: number }>
      | undefined;
    expect(knowledgeBases?.some((base) => base.id === kbId)).toBe(true);
    const createdBase = knowledgeBases?.find((base) => base.id === kbId);
    expect(createdBase).toMatchObject({
      chunkCount: expect.any(Number),
      healthScore: expect.any(Number),
    });
    expect(
      knowledgeBases
        ?.map((base) => base.title ?? "")
        .toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(["Owner Visible", "个人成果", "团队成果"]);
  });

  it("rejects rename and delete of reserved deliverable folders", async () => {
    const listed = await invoke("knowledge.base.list");
    const reserved = (
      (listed.payload?.knowledgeBases ?? []) as Array<{ id?: string; title?: string }>
    ).find((base) => base.title === "个人成果");
    expect(reserved?.id).toBeTruthy();

    const renamed = await invoke("knowledge.base.update", {
      knowledgeBaseId: reserved?.id,
      title: "改名",
    });
    expect(renamed.ok).toBe(false);
    expect(renamed.error?.message).toContain("reserved knowledge folder");

    const deleted = await invoke("knowledge.base.delete", { knowledgeBaseId: reserved?.id });
    expect(deleted.ok).toBe(false);
    expect(deleted.error?.message).toContain("reserved knowledge folder");
  });

  it("rejects update, delete and attach from non-owner", async () => {
    const created = await invoke("knowledge.base.create", { title: "Owner only" });
    const kbId = extractKnowledgeBaseId(created.payload);

    setContext({ userId: "user-b", tenantId: null, seatId: null, hasEnterpriseScope: false });

    const updated = await invoke("knowledge.base.update", {
      knowledgeBaseId: kbId,
      title: "Hijacked",
    });
    expect(updated.ok).toBe(false);
    expect(updated.error?.message).toContain("not authorized");

    const deleted = await invoke("knowledge.base.delete", { knowledgeBaseId: kbId });
    expect(deleted.ok).toBe(false);
    expect(deleted.error?.message).toContain("not authorized");

    const attached = await invoke("knowledge.base.attach", {
      knowledgeBaseId: kbId,
      documentId: "doc-1",
    });
    expect(attached.ok).toBe(false);
    expect(attached.error?.message).toContain("not authorized");
  });

  it("rejects team knowledge base create without tenant context", async () => {
    const team = await invoke("knowledge.base.create", {
      title: "Team KB",
      visibility: "team",
    });
    expect(team.ok).toBe(false);
    expect(team.error?.message).toContain("enterprise seat context");

    const enterprise = await invoke("knowledge.base.create", {
      title: "Enterprise KB",
      visibility: "enterprise",
    });
    expect(enterprise.ok).toBe(false);
    expect(enterprise.error?.message).toContain("enterprise seat context");
  });

  it("rejects enterprise knowledge base create without an existing write grant", async () => {
    setContext({ userId: "user-a", tenantId: "tenant-1", seatId: "seat-1" });
    const enterprise = await invoke("knowledge.base.create", {
      title: "Enterprise KB",
      visibility: "enterprise",
    });
    expect(enterprise.ok).toBe(false);
    expect(enterprise.error?.message).toContain("not authorized to create enterprise");
  });

  it("attach is idempotent and keeps documentCount consistent", async () => {
    const created = await invoke("knowledge.base.create", { title: "Docs KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    const first = await invoke("knowledge.base.attach", {
      knowledgeBaseId: kbId,
      documentId: "doc-1",
    });
    expect(first.ok).toBe(true);
    const afterFirst = extractKnowledgeBase(first.payload);
    expect(afterFirst.documentIds).toEqual(["doc-1"]);
    expect(afterFirst.documentCount).toBe(1);

    const second = await invoke("knowledge.base.attach", {
      knowledgeBaseId: kbId,
      documentId: "doc-1",
    });
    expect(second.ok).toBe(true);
    const afterSecond = extractKnowledgeBase(second.payload);
    expect(afterSecond.documentIds).toEqual(["doc-1"]);
    expect(afterSecond.documentCount).toBe(1);

    const third = await invoke("knowledge.base.attach", {
      knowledgeBaseId: kbId,
      documentId: "doc-2",
    });
    expect(third.ok).toBe(true);
    const afterThird = extractKnowledgeBase(third.payload);
    expect(afterThird.documentIds).toEqual(["doc-1", "doc-2"]);
    expect(afterThird.documentCount).toBe(2);
  });

  it("lists documents and snippets for an owned knowledge base", async () => {
    const created = await invoke("knowledge.base.create", { title: "Library content KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    const docs = await invoke("knowledge.base.documents.list", { knowledgeBaseId: kbId });
    expect(docs.ok).toBe(true);
    expect(docs.payload?.knowledgeBaseId).toBe(kbId);
    expect(Array.isArray(docs.payload?.documents)).toBe(true);

    const snippets = await invoke("knowledge.base.snippets.list", {
      knowledgeBaseId: kbId,
      limit: 5,
    });
    expect(snippets.ok).toBe(true);
    expect(snippets.payload?.knowledgeBaseId).toBe(kbId);
    expect(Array.isArray(snippets.payload?.snippets)).toBe(true);
  });

  it("detaches, lists recycle, and restores documents", async () => {
    const created = await invoke("knowledge.base.create", { title: "Recycle RPC KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    await invoke("knowledge.base.attach", { knowledgeBaseId: kbId, documentId: "doc-rpc-1" });
    await invoke("knowledge.base.attach", { knowledgeBaseId: kbId, documentId: "doc-rpc-2" });

    const detached = await invoke("knowledge.base.documents.detach", {
      knowledgeBaseId: kbId,
      documentId: "doc-rpc-1",
    });
    expect(detached.ok).toBe(true);
    const afterDetach = extractKnowledgeBase(detached.payload);
    expect(afterDetach.documentIds).toEqual(["doc-rpc-2"]);
    expect(afterDetach.recycledDocumentIds).toEqual(["doc-rpc-1"]);

    const recycle = await invoke("knowledge.base.recycle.list", { knowledgeBaseId: kbId });
    expect(recycle.ok).toBe(true);
    expect(Array.isArray(recycle.payload?.documents)).toBe(true);

    const restored = await invoke("knowledge.base.documents.restore", {
      knowledgeBaseId: kbId,
      documentId: "doc-rpc-1",
    });
    expect(restored.ok).toBe(true);
    const afterRestore = extractKnowledgeBase(restored.payload);
    expect(afterRestore.documentIds).toEqual(["doc-rpc-2", "doc-rpc-1"]);
    expect(afterRestore.recycledDocumentIds).toEqual([]);
  });

  it("lists web pages, datasets, and invites members for an owned knowledge base", async () => {
    const created = await invoke("knowledge.base.create", { title: "P3 library KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    await invoke("knowledge.base.attach", {
      knowledgeBaseId: kbId,
      documentId: "https://example.com/policy",
    });

    const web = await invoke("knowledge.base.web.list", { knowledgeBaseId: kbId });
    expect(web.ok).toBe(true);
    const webPages = web.payload?.webPages as unknown[] | undefined;
    expect(Array.isArray(webPages)).toBe(true);
    expect(webPages?.length ?? 0).toBeGreaterThanOrEqual(1);

    const datasets = await invoke("knowledge.base.datasets.list", { knowledgeBaseId: kbId });
    expect(datasets.ok).toBe(true);
    expect(Array.isArray(datasets.payload?.datasets)).toBe(true);

    const agentKnowledge = await invoke("knowledge.base.agent-knowledge.list", {
      knowledgeBaseId: kbId,
    });
    expect(agentKnowledge.ok).toBe(true);
    expect(Array.isArray(agentKnowledge.payload?.items)).toBe(true);
    expect(Array.isArray(agentKnowledge.payload?.summary)).toBe(true);

    // Generate handler is wired + owner-gated; a non-existent session yields no transcript
    // (or no model configured in the test env) — either way it responds gracefully.
    const generate = await invoke("knowledge.base.agent-knowledge.generate", {
      knowledgeBaseId: kbId,
      sessionKey: "agent:nonexistent:session",
    });
    expect(typeof generate.ok).toBe("boolean");
    if (generate.ok) {
      expect(generate.payload?.generated).toEqual([]);
    } else {
      expect(generate.error?.message).toContain("model");
    }

    const invited = await invoke("knowledge.base.members.invite", {
      knowledgeBaseId: kbId,
      email: "collaborator@example.com",
      role: "editor",
    });
    expect(invited.ok).toBe(true);
    const invitedMember = invited.payload?.member as { email?: string } | undefined;
    expect(invitedMember?.email).toBe("collaborator@example.com");

    const members = await invoke("knowledge.base.members.list", { knowledgeBaseId: kbId });
    expect(members.ok).toBe(true);
    expect(members.payload?.members).toHaveLength(1);
  });

  it("allows active editor member to attach documents", async () => {
    const { inviteKnowledgeBaseMember } = await import("../knowledge/knowledge-base-members.js");
    const created = await invoke("knowledge.base.create", { title: "Collaborative KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    inviteKnowledgeBaseMember(
      {
        knowledgeBaseId: kbId,
        email: "test@example.com",
        role: "editor",
        status: "active",
        invitedByUserId: "user-a",
      },
      membersStorePath(),
    );

    setContext({ userId: "user-b", tenantId: null, seatId: null, hasEnterpriseScope: false });

    const attached = await invoke("knowledge.base.attach", {
      knowledgeBaseId: kbId,
      documentId: "doc-collab",
    });
    expect(attached.ok).toBe(true);
    expect(extractKnowledgeBase(attached.payload).documentIds).toEqual(["doc-collab"]);
  });

  it("rejects viewer member attach attempts", async () => {
    const { inviteKnowledgeBaseMember } = await import("../knowledge/knowledge-base-members.js");
    const created = await invoke("knowledge.base.create", { title: "Viewer KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    inviteKnowledgeBaseMember(
      {
        knowledgeBaseId: kbId,
        email: "test@example.com",
        role: "viewer",
        status: "active",
        invitedByUserId: "user-a",
      },
      membersStorePath(),
    );

    setContext({ userId: "user-b", tenantId: null, seatId: null, hasEnterpriseScope: false });

    const attached = await invoke("knowledge.base.attach", {
      knowledgeBaseId: kbId,
      documentId: "doc-denied",
    });
    expect(attached.ok).toBe(false);
    expect(attached.error?.message).toContain("not authorized");
  });

  it("rejects visibility upgrade to team without tenant context on update", async () => {
    const created = await invoke("knowledge.base.create", { title: "Private first" });
    const kbId = extractKnowledgeBaseId(created.payload);

    const upgraded = await invoke("knowledge.base.update", {
      knowledgeBaseId: kbId,
      visibility: "team",
    });
    expect(upgraded.ok).toBe(false);
    expect(upgraded.error?.message).toContain("enterprise seat context");
  });

  it("aggregates passive documents and active bindings in knowledge.base.sources.list", async () => {
    const created = await invoke("knowledge.base.create", { title: "Sources KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    await invoke("knowledge.base.attach", { knowledgeBaseId: kbId, documentId: "doc-1" });
    const bound = await invoke("knowledge.source.bind", {
      knowledgeBaseId: kbId,
      kind: "api",
      title: "CRM API",
      endpoint: "https://crm.example/api",
    });
    expect(bound.ok).toBe(true);

    const all = await invoke("knowledge.base.sources.list", { knowledgeBaseId: kbId });
    expect(all.ok).toBe(true);
    const sources = all.payload?.sources as Array<{
      plane: string;
      kind: string;
      title: string;
      visibility: string;
    }>;
    expect(Array.isArray(sources)).toBe(true);
    expect(sources.some((item) => item.kind === "document" && item.plane === "passive")).toBe(true);
    expect(sources.some((item) => item.kind === "api" && item.plane === "active")).toBe(true);
    expect(sources.every((item) => item.visibility === "private")).toBe(true);

    const activeOnly = await invoke("knowledge.base.sources.list", {
      knowledgeBaseId: kbId,
      plane: "active",
    });
    expect(activeOnly.ok).toBe(true);
    const activeSources = activeOnly.payload?.sources as Array<{ plane: string; title?: string }>;
    expect(activeSources.every((item) => item.plane === "active")).toBe(true);
    expect(activeSources.some((item) => item.title === "CRM API")).toBe(true);
  });

  it("exposes compat flags, warning stats, and binding visibility backfill via knowledge.compat.status", async () => {
    const created = await invoke("knowledge.base.create", { title: "Compat status KB" });
    const kbId = extractKnowledgeBaseId(created.payload);
    bindKnowledgeSource(
      {
        kind: "api",
        title: "Stale visibility API",
        knowledgeBaseId: kbId,
        ownerId: "user-a",
        visibility: "enterprise",
      },
      path.join(tmpDir, "knowledge", "source-bindings.json"),
    );

    const status = await invoke("knowledge.compat.status");
    expect(status.ok).toBe(true);
    expect(status.payload?.featureFlags).toEqual({
      requireKnowledgeBaseId: false,
      rejectSourceBindVisibility: false,
    });
    const backfill = status.payload?.sourceBindingVisibilityBackfill as { updated?: number };
    expect(backfill?.updated).toBeGreaterThanOrEqual(1);
    const listed = await invoke("knowledge.source.list", { knowledgeBaseId: kbId });
    const bindings = listed.payload?.bindings as Array<{ visibility?: string }>;
    expect(bindings?.[0]?.visibility).toBe("private");
  });
});
