// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeSourceContext } from "../knowledge/sources/types.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

const { tmpDir } = vi.hoisted(() => {
  const dir = `/tmp/openbot-policy-pre02-read-gate-${Math.random().toString(36).slice(2)}`;
  return { tmpDir: dir };
});

const contextState = vi.hoisted(() => ({
  current: {
    userId: "user-owner",
    seatId: "seat-owner",
    tenantId: "tenant-pre02",
    hasEnterpriseScope: true,
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
const { createKnowledgeBase } = await import("../knowledge/knowledge-base-store.js");
const { inviteKnowledgeBaseMember } = await import("../knowledge/knowledge-base-members.js");
const { searchScopedKnowledgeBaseEvidence } =
  await import("../knowledge/knowledge-retrieval-runtime.js");
const { isKnowledgeBaseVisible } = await import("../../retrieval/visibility-resolver.js");

type InvokeResult = {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string };
};

const ownerContext: KnowledgeSourceContext = {
  userId: "user-owner",
  seatId: "seat-owner",
  tenantId: "tenant-pre02",
  hasEnterpriseScope: true,
};
const memberContext: KnowledgeSourceContext = {
  userId: "user-member",
  seatId: "seat-member",
  tenantId: "tenant-pre02",
  hasEnterpriseScope: true,
};
const peerContext: KnowledgeSourceContext = {
  userId: "user-peer",
  seatId: "seat-peer",
  tenantId: "tenant-pre02",
  hasEnterpriseScope: true,
};

const ownerClient = { connect: {} as never, user: "owner@example.com" };
const memberClient = { connect: {} as never, user: "viewer@example.com" };
const peerClient = { connect: {} as never, user: "peer@example.com" };

function setContext(next: KnowledgeSourceContext) {
  contextState.current = next;
}

async function invoke(
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

function membersPath(): string {
  return path.join(tmpDir, "knowledge", "base-members.json");
}

function listedIds(result: InvokeResult): string[] {
  const bases = (result.payload?.knowledgeBases ?? []) as Array<{ id?: string }>;
  return bases.map((base) => base.id).filter((id): id is string => typeof id === "string");
}

describe("POLICY-PRE02 canReadKnowledgeBase sole read gate", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    setContext(ownerContext);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lets an active private-KB viewer member list, get, list documents, and scoped-search; same-tenant non-members stay denied; write stays closed", async () => {
    const kb = createKnowledgeBase(
      {
        title: "Private PRE02",
        ownerId: "user-owner",
        tenantId: "tenant-pre02",
        visibility: "private",
      },
      storePath(),
    );
    inviteKnowledgeBaseMember(
      {
        knowledgeBaseId: kb.id,
        email: "viewer@example.com",
        role: "viewer",
        status: "active",
        invitedByUserId: "user-owner",
      },
      membersPath(),
    );

    // Visibility primitive still hides private bases from non-owners — membership
    // is granted only by canReadKnowledgeBase.
    expect(
      isKnowledgeBaseVisible(
        { userId: "user-member", seatId: null, tenantId: "tenant-pre02" },
        { id: kb.id, visibility: "private", ownerId: "user-owner", tenantId: "tenant-pre02" },
      ),
    ).toBe(false);

    setContext(memberContext);
    const listed = await invoke("knowledge.base.list", {}, memberClient);
    expect(listed.ok).toBe(true);
    expect(listedIds(listed)).toContain(kb.id);

    const got = await invoke("knowledge.base.get", { knowledgeBaseId: kb.id }, memberClient);
    expect(got.ok).toBe(true);
    expect((got.payload?.knowledgeBase as { id?: string } | undefined)?.id).toBe(kb.id);

    const docs = await invoke(
      "knowledge.base.documents.list",
      { knowledgeBaseId: kb.id },
      memberClient,
    );
    expect(docs.ok).toBe(true);

    const searched = await invoke(
      "knowledge.base.search",
      { knowledgeBaseId: kb.id, query: "anything" },
      memberClient,
    );
    expect(searched.ok).toBe(true);
    expect(searched.payload?.knowledgeBaseId).toBe(kb.id);

    const scoped = await searchScopedKnowledgeBaseEvidence({
      knowledgeBaseId: kb.id,
      query: "anything",
      retrievalContext: {
        userId: "user-member",
        seatId: "seat-member",
        tenantId: "tenant-pre02",
        email: "viewer@example.com",
      },
      storePath: storePath(),
    });
    expect(scoped.knowledgeBase?.id).toBe(kb.id);

    const updated = await invoke(
      "knowledge.base.update",
      { knowledgeBaseId: kb.id, title: "Hijack" },
      memberClient,
    );
    expect(updated.ok).toBe(false);

    setContext(peerContext);
    const peerListed = await invoke("knowledge.base.list", {}, peerClient);
    expect(peerListed.ok).toBe(true);
    expect(listedIds(peerListed)).not.toContain(kb.id);

    const peerGot = await invoke("knowledge.base.get", { knowledgeBaseId: kb.id }, peerClient);
    expect(peerGot.ok).toBe(false);
    expect(peerGot.error?.message).toContain("not found");

    const peerDocs = await invoke(
      "knowledge.base.documents.list",
      { knowledgeBaseId: kb.id },
      peerClient,
    );
    expect(peerDocs.ok).toBe(false);
    expect(peerDocs.error?.message).toContain("not found");

    const peerSearch = await invoke(
      "knowledge.base.search",
      { knowledgeBaseId: kb.id, query: "anything" },
      peerClient,
    );
    expect(peerSearch.ok).toBe(false);
    expect(peerSearch.error?.message).toContain("not found");

    const peerScoped = await searchScopedKnowledgeBaseEvidence({
      knowledgeBaseId: kb.id,
      query: "anything",
      retrievalContext: {
        userId: "user-peer",
        seatId: "seat-peer",
        tenantId: "tenant-pre02",
        email: "peer@example.com",
      },
      storePath: storePath(),
    });
    expect(peerScoped.knowledgeBase).toBeNull();
    expect(peerScoped.evidence).toEqual([]);
  });

  it("keeps team/enterprise same-tenant visibility through the canRead fallback without granting write", async () => {
    const kb = createKnowledgeBase(
      {
        title: "Team PRE02",
        ownerId: "user-owner",
        tenantId: "tenant-pre02",
        visibility: "team",
      },
      storePath(),
    );

    setContext(peerContext);
    const listed = await invoke("knowledge.base.list", {}, peerClient);
    expect(listed.ok).toBe(true);
    expect(listedIds(listed)).toContain(kb.id);

    const got = await invoke("knowledge.base.get", { knowledgeBaseId: kb.id }, peerClient);
    expect(got.ok).toBe(true);
    expect((got.payload?.knowledgeBase as { id?: string } | undefined)?.id).toBe(kb.id);

    const updated = await invoke(
      "knowledge.base.update",
      { knowledgeBaseId: kb.id, title: "Hijack team" },
      peerClient,
    );
    expect(updated.ok).toBe(false);
  });
});
