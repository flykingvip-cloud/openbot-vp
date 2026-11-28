// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeSourceContext } from "../knowledge/sources/types.js";
import type { GatewayRequestHandler } from "./types.js";

const { tmpDir } = vi.hoisted(() => {
  const dir = `/tmp/openbot-space-acl-13-gaps-${Math.random().toString(36).slice(2)}`;
  return { tmpDir: dir };
});

const contextState = vi.hoisted(() => ({
  current: {
    userId: "user-owner",
    seatId: "seat-owner",
    tenantId: "tenant-acl",
    hasEnterpriseScope: true,
  } satisfies KnowledgeSourceContext,
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

const { knowledgeGovernanceHandlers } = await import("./knowledge-governance.js");
const { createKnowledgeBase, attachDocumentToKnowledgeBase } =
  await import("../knowledge/knowledge-base-store.js");
const { inviteKnowledgeBaseMember } = await import("../knowledge/knowledge-base-members.js");
const { openKnowledgeIndex, resolveKnowledgeIndexDbPath } =
  await import("../knowledge/kb-index.js");
const { createGovernanceTask } = await import("../knowledge/governance/chunk-governance-store.js");
const { upsertClaimsForChunk } = await import("../knowledge/governance/claims/claim-store.js");
const { loadGovernanceSummaryForUser } =
  await import("../knowledge/runtime/knowledge-runtime-context.js");
const { knowledgeDiscoveryList, knowledgeActionsList, knowledgeObject, knowledgeRelationships } =
  await import("../knowledge/router.js");
const { listKnowledgeTimeline } = await import("../knowledge/timeline-read-model.js");
const { documentNodeObjectId } = await import("../knowledge/document-ego-graph.js");
const { bindKnowledgeSource } = await import("../knowledge/sources/source-binding-store.js");
const { getAuthorizedApiSourceCatalog, getApiSourceCatalog } =
  await import("../knowledge/sources/source-api-runtime.js");
const { knowledgeHandlers } = await import("./knowledge.js");

type InvokeResult = {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string };
};

const ownerContext: KnowledgeSourceContext = {
  userId: "user-owner",
  seatId: "seat-owner",
  tenantId: "tenant-acl",
  hasEnterpriseScope: true,
};
const peerContext: KnowledgeSourceContext = {
  userId: "user-peer",
  seatId: "seat-peer",
  tenantId: "tenant-acl",
  hasEnterpriseScope: true,
};
const editorContext: KnowledgeSourceContext = {
  userId: "user-editor",
  seatId: "seat-editor",
  tenantId: "tenant-acl",
  hasEnterpriseScope: true,
};

const ownerClient = { connect: {} as never, user: "owner@example.com" };
const peerClient = { connect: {} as never, user: "peer@example.com" };
const editorClient = { connect: {} as never, user: "editor@example.com" };

function setContext(next: KnowledgeSourceContext) {
  const { userId, seatId, tenantId } = next;
  if (userId == null) {
    throw new Error("setContext requires a non-null userId");
  }
  // seatId/tenantId are also string | null on KnowledgeSourceContext; the hoisted
  // test state is a non-null ACL actor. Narrow them without weakening assertions.
  if (seatId == null || tenantId == null) {
    throw new Error("setContext requires non-null seatId and tenantId");
  }
  // Hoisted test state is inferred as hasEnterpriseScope: true. Narrow the
  // boolean field to the literal true without weakening ACL assertions.
  if (!next.hasEnterpriseScope) {
    throw new Error("setContext requires hasEnterpriseScope === true");
  }
  contextState.current = { ...next, userId, seatId, tenantId, hasEnterpriseScope: true };
}

function cleanStore() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

async function invokeGovernance(
  method: string,
  params: Record<string, unknown> = {},
  client: { user: string } = ownerClient,
): Promise<InvokeResult> {
  const handler = knowledgeGovernanceHandlers[method] as GatewayRequestHandler | undefined;
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: InvokeResult | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client,
    isWebchatConnect: () => false,
    respond: (ok: boolean, payload: unknown, error: { message?: string } | undefined) => {
      response = { ok, payload: payload as Record<string, unknown> | undefined, error };
    },
  } as never);
  if (!response) {
    throw new Error("handler did not respond");
  }
  return response;
}

async function invokeKnowledge(
  method: string,
  params: Record<string, unknown> = {},
  client: { user: string } = ownerClient,
): Promise<InvokeResult> {
  const handler = knowledgeHandlers[method] as GatewayRequestHandler | undefined;
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: InvokeResult | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client,
    isWebchatConnect: () => false,
    respond: (ok: boolean, payload: unknown, error: { message?: string } | undefined) => {
      response = { ok, payload: payload as Record<string, unknown> | undefined, error };
    },
  } as never);
  if (!response) {
    throw new Error("handler did not respond");
  }
  return response;
}

async function seedPrivateKbWithTask(title = "Private ACL KB") {
  const kb = createKnowledgeBase({
    title,
    ownerId: ownerContext.userId!,
    tenantId: ownerContext.tenantId,
    visibility: "private",
  });
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: ownerContext.userId!,
    tenantId: ownerContext.tenantId,
  });
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  let taskId = "";
  try {
    taskId = createGovernanceTask({
      db: index.db,
      kbId: kb.id,
      taskType: "conflict",
      relatedChunkIds: ["chunk-private"],
      priority: 80,
    });
    upsertClaimsForChunk({
      db: index.db,
      kbId: kb.id,
      chunkId: "chunk-private",
      claims: [
        {
          subject: "alpha",
          predicate: "is",
          objectValue: "secret",
          claimText: "alpha is secret",
          normalizedKey: "alpha:is:secret",
        },
      ],
    });
  } finally {
    index.close();
  }
  return { kb, taskId };
}

describe("space ACL 13 residual gaps", () => {
  beforeEach(() => {
    cleanStore();
    setContext(ownerContext);
  });

  afterEach(() => {
    cleanStore();
  });

  it("E080 denies tasks.update without a KB write grant and allows the owner", async () => {
    const { taskId } = await seedPrivateKbWithTask();

    setContext(peerContext);
    const denied = await invokeGovernance(
      "knowledge.governance.tasks.update",
      { taskId, status: "resolved" },
      peerClient,
    );
    expect(denied.ok).toBe(false);
    expect(denied.error?.message).toBe("task not found");

    setContext(ownerContext);
    const allowed = await invokeGovernance(
      "knowledge.governance.tasks.update",
      { taskId, status: "resolved" },
      ownerClient,
    );
    expect(allowed.ok).toBe(true);

    const list = await invokeGovernance(
      "knowledge.governance.tasks.list",
      { status: "resolved" },
      ownerClient,
    );
    const tasks = list.payload?.tasks as Array<{ id: string; status: string }>;
    expect(tasks.some((task) => task.id === taskId && task.status === "resolved")).toBe(true);
  });

  it("E080 allows an editor member to update and rejects a mismatched kbId", async () => {
    const { kb, taskId } = await seedPrivateKbWithTask();
    inviteKnowledgeBaseMember({
      knowledgeBaseId: kb.id,
      email: "editor@example.com",
      role: "editor",
      status: "active",
      invitedByUserId: ownerContext.userId!,
    });

    setContext(editorContext);
    const mismatched = await invokeGovernance(
      "knowledge.governance.tasks.update",
      { taskId, status: "in_review", kbId: "kb_not_this_one" },
      editorClient,
    );
    expect(mismatched.ok).toBe(false);
    expect(mismatched.error?.message).toBe("task not found");

    const allowed = await invokeGovernance(
      "knowledge.governance.tasks.update",
      { taskId, status: "in_review", kbId: kb.id },
      editorClient,
    );
    expect(allowed.ok).toBe(true);
  });

  it("E078/E079/E082 hide shared-index governance data without a KB read grant", async () => {
    const { kb, taskId } = await seedPrivateKbWithTask();

    setContext(ownerContext);
    const ownerSummary = await invokeGovernance("knowledge.governance.summary", {}, ownerClient);
    expect(ownerSummary.ok).toBe(true);
    const ownerSummaryPayload = ownerSummary.payload?.summary as
      | { openConflictCount: number }
      | undefined;
    expect(ownerSummaryPayload?.openConflictCount).toBe(1);

    const ownerTasks = await invokeGovernance("knowledge.governance.tasks.list", {}, ownerClient);
    const ownerTaskList = (ownerTasks.payload?.tasks as Array<{ id: string }> | undefined) ?? [];
    expect(ownerTaskList.some((task) => task.id === taskId)).toBe(true);

    const ownerClaims = await invokeGovernance(
      "knowledge.governance.claims.list",
      { kbId: kb.id },
      ownerClient,
    );
    const ownerClaimList = (ownerClaims.payload?.claims as unknown[] | undefined) ?? [];
    expect(ownerClaimList.length).toBeGreaterThan(0);

    setContext(peerContext);
    const peerSummary = await invokeGovernance("knowledge.governance.summary", {}, peerClient);
    const peerSummaryPayload = peerSummary.payload?.summary as
      | { openConflictCount: number }
      | undefined;
    expect(peerSummaryPayload?.openConflictCount).toBe(0);

    const peerTasks = await invokeGovernance("knowledge.governance.tasks.list", {}, peerClient);
    expect(peerTasks.payload?.tasks).toEqual([]);

    const peerClaimsByKb = await invokeGovernance(
      "knowledge.governance.claims.list",
      { kbId: kb.id },
      peerClient,
    );
    expect(peerClaimsByKb.payload?.claims).toEqual([]);

    const peerClaimsByChunk = await invokeGovernance(
      "knowledge.governance.claims.list",
      { chunkIds: ["chunk-private"] },
      peerClient,
    );
    expect(peerClaimsByChunk.payload?.claims).toEqual([]);
  });

  it("E003 filters runtime governance summary to readable KBs only", async () => {
    await seedPrivateKbWithTask();
    const ownerSummary = await loadGovernanceSummaryForUser(ownerClient as never);
    expect(ownerSummary?.openConflictCount).toBe(1);
    setContext(peerContext);
    const peerFiltered = await loadGovernanceSummaryForUser(peerClient as never);
    expect(peerFiltered?.openConflictCount).toBe(0);
  });

  it("E007/E008/E017/E018 deny discovery, actions, digest, and timeline without a read grant", async () => {
    await seedPrivateKbWithTask();

    setContext(ownerContext);
    const ownerEvents = await knowledgeDiscoveryList(ownerClient as never, { limit: 20 });
    expect(ownerEvents.some((event) => event.relatedKnowledge.kbId)).toBe(true);
    const ownerActions = await knowledgeActionsList(ownerClient as never, { limit: 8 });
    expect(ownerActions.some((action) => action.context?.knowledgeBaseId)).toBe(true);
    const ownerTimeline = await listKnowledgeTimeline({
      client: ownerClient as never,
      limit: 20,
    });
    expect(ownerTimeline.totalEvents).toBeGreaterThan(0);

    setContext(peerContext);
    const peerEvents = await knowledgeDiscoveryList(peerClient as never, { limit: 20 });
    expect(peerEvents).toEqual([]);
    const peerActions = await knowledgeActionsList(peerClient as never, { limit: 8 });
    expect(peerActions.every((action) => !action.context?.knowledgeBaseId)).toBe(true);
    const { kb } = await seedPrivateKbWithTask("Second");
    // Re-seed above created another private KB owned by owner; peer still cannot request it.
    const peerRequested = await knowledgeActionsList(peerClient as never, {
      knowledgeBaseId: kb.id,
    });
    expect(peerRequested).toEqual([]);
    const peerTimeline = await listKnowledgeTimeline({
      client: peerClient as never,
      limit: 20,
    });
    expect(peerTimeline.totalEvents).toBe(0);

    const digestDenied = await invokeKnowledge("knowledge.feed.digest", { limit: 8 }, peerClient);
    expect(digestDenied.ok).toBe(true);
    const digest = digestDenied.payload?.digest as {
      discoveryEvents?: unknown[];
      actions?: unknown[];
    };
    // Digest may use a slightly different shape; assert no unauthorized governance titles leak.
    const serialized = JSON.stringify(digestDenied.payload ?? {});
    expect(serialized).not.toContain("检测到");
    expect(serialized).not.toContain("conflict");
    void digest;
  });

  it("E005 does not unscoped-scan a private KB document for a peer, and allows the owner", async () => {
    const kb = createKnowledgeBase({
      title: "Private docs",
      ownerId: ownerContext.userId!,
      tenantId: ownerContext.tenantId,
      visibility: "private",
    });
    attachDocumentToKnowledgeBase(kb.id, "doc-secret");
    const objectId = documentNodeObjectId("doc-secret");

    setContext(ownerContext);
    const ownerObject = await knowledgeObject(ownerClient as never, { objectId });
    expect(ownerObject?.id).toBe(objectId);

    setContext(peerContext);
    const peerObject = await knowledgeObject(peerClient as never, { objectId });
    expect(peerObject).toBeNull();
  });

  it("E011 does not open a private library or ego graph without a read grant", async () => {
    const kb = createKnowledgeBase({
      title: "Private graph",
      ownerId: ownerContext.userId!,
      tenantId: ownerContext.tenantId,
      visibility: "private",
    });
    attachDocumentToKnowledgeBase(kb.id, "doc-graph");

    setContext(ownerContext);
    const ownerLibrary = await knowledgeRelationships(ownerClient as never, {
      knowledgeBaseId: kb.id,
    });
    expect(
      ownerLibrary.nodes.some((node) => node.objectId === documentNodeObjectId("doc-graph")),
    ).toBe(true);

    setContext(peerContext);
    const peerLibrary = await knowledgeRelationships(peerClient as never, {
      knowledgeBaseId: kb.id,
    });
    expect(
      peerLibrary.nodes.some((node) => node.objectId === documentNodeObjectId("doc-graph")),
    ).toBe(false);

    const peerEgo = await knowledgeRelationships(peerClient as never, {
      focusDocumentId: "doc-graph",
    });
    expect(peerEgo.nodes.some((node) => node.objectId === documentNodeObjectId("doc-graph"))).toBe(
      false,
    );
  });

  it("E067 catalog.get requires owner or authorized KB read", async () => {
    const kb = createKnowledgeBase({
      title: "Catalog KB",
      ownerId: ownerContext.userId!,
      tenantId: ownerContext.tenantId,
      visibility: "private",
    });
    const source = bindKnowledgeSource({
      kind: "api",
      title: "Secret API",
      knowledgeBaseId: kb.id,
      ownerId: ownerContext.userId!,
      endpoint: "https://api.example.test",
      metadata: {},
    });
    const catalogStorePath = path.join(tmpDir, "knowledge", "source-api-catalogs.json");
    fs.mkdirSync(path.dirname(catalogStorePath), { recursive: true });
    // Write a catalog as if a prior sync landed it; the get path must still gate reads.
    const raw = {
      catalogs: {
        [source.id]: {
          sourceId: source.id,
          fetchedAtMs: 1,
          summary: "secret catalog",
          entries: [{ name: "secret" }],
        },
      },
    };
    fs.writeFileSync(catalogStorePath, JSON.stringify(raw));
    expect(getApiSourceCatalog(source.id)?.summary).toBe("secret catalog");

    const ownerCatalog = getAuthorizedApiSourceCatalog(source.id, ownerContext, {
      authorizedKnowledgeBaseIds: new Set([kb.id]),
    });
    expect(ownerCatalog?.summary).toBe("secret catalog");

    const peerCatalog = getAuthorizedApiSourceCatalog(source.id, peerContext);
    expect(peerCatalog).toBeNull();

    setContext(peerContext);
    const rpcDenied = await invokeKnowledge(
      "knowledge.source.catalog.get",
      { sourceId: source.id },
      peerClient,
    );
    expect(rpcDenied.ok).toBe(true);
    expect(rpcDenied.payload?.catalog).toBeNull();

    setContext(ownerContext);
    const rpcAllowed = await invokeKnowledge(
      "knowledge.source.catalog.get",
      { sourceId: source.id },
      ownerClient,
    );
    expect(rpcAllowed.ok).toBe(true);
    expect((rpcAllowed.payload?.catalog as { summary?: string } | null)?.summary).toBe(
      "secret catalog",
    );
  });
});
