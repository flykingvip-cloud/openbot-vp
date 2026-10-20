// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeSourceContext } from "../knowledge/sources/types.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

const { tmpDir } = vi.hoisted(() => {
  const dir = `/tmp/openbot-kb-attach-rpc-${Math.random().toString(36).slice(2)}`;
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

describe("knowledge.deliverables.attach RPC integration", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(tmpDir, "knowledge"), { recursive: true });
    setContext({ userId: "user-a", tenantId: null, seatId: null, hasEnterpriseScope: false });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects attach without user context", async () => {
    setContext({ userId: null });
    const result = await invoke("knowledge.deliverables.attach", {
      knowledgeBaseId: "kb-1",
      deliverableId: "skill:doc-1",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("user context required");
  });

  it("attaches collected knowledge into KB without resurfacing it in deliverables list", async () => {
    const collected = await invoke("knowledge.personal.collect", {
      title: "Agent Report",
      summary: "Quarterly analysis notes",
    });
    expect(collected.ok).toBe(true);
    const skillId = collected.payload?.skillId as string;

    const created = await invoke("knowledge.base.create", { title: "Archive KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    const attached = await invoke("knowledge.deliverables.attach", {
      knowledgeBaseId: kbId,
      deliverableId: `skill:${skillId}`,
    });
    expect(attached.ok).toBe(true);
    expect(attached.payload?.relatedKnowledgeBaseId).toBe(kbId);
    const kb = attached.payload?.knowledgeBase as { documentIds?: string[] };
    expect(kb.documentIds).toContain(skillId);

    const listed = await invoke("knowledge.deliverables.list", { limit: 20 });
    expect(listed.ok).toBe(true);
    const deliverables = listed.payload?.deliverables as Array<{
      deliverableId?: string;
      relatedKnowledgeBaseId?: string;
    }>;
    const archived = deliverables.find((item) => item.deliverableId === `skill:${skillId}`);
    expect(archived).toBeUndefined();
  });

  it("rejects attach to another user's knowledge base", async () => {
    const created = await invoke("knowledge.base.create", { title: "Owner KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    setContext({ userId: "user-b", tenantId: null, seatId: null, hasEnterpriseScope: false });
    const attached = await invoke("knowledge.deliverables.attach", {
      knowledgeBaseId: kbId,
      deliverableId: "skill:foreign-doc",
    });
    expect(attached.ok).toBe(false);
    expect(attached.error?.message).toContain("not authorized");
  });
});
