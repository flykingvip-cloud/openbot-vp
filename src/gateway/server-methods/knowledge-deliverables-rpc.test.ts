// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { KnowledgeSourceContext } from "../knowledge/sources/types.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

const contextState = vi.hoisted(() => ({
  current: {
    userId: "user-1",
    seatId: null,
    tenantId: null,
    hasEnterpriseScope: false,
  } as KnowledgeSourceContext,
}));

const listWorkspaceDeliverablesMock = vi.hoisted(() =>
  vi.fn(async () => ({
    deliverables: [
      {
        deliverableId: "del-1",
        title: "Q2 Report",
        kind: "report" as const,
        source: "group" as const,
        creators: ["user-1"],
        groupId: "group-a",
        groupTitle: "Alpha Team",
        status: "published",
        updatedAtMs: 100,
      },
      {
        deliverableId: "skill:skill-1",
        title: "Agent Analysis",
        kind: "analysis" as const,
        source: "agent" as const,
        creators: ["Main Agent"],
        status: "published",
        updatedAtMs: 200,
      },
    ],
  })),
);

vi.mock("../knowledge/context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(async () => contextState.current),
}));

vi.mock("../knowledge/deliverables/read-model.js", () => ({
  listWorkspaceDeliverables: listWorkspaceDeliverablesMock,
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

describe("knowledge.deliverables.trace RPC", () => {
  it("rejects trace without user context", async () => {
    setContext({ userId: null });
    const result = await invoke("knowledge.deliverables.trace", { deliverableId: "del-1" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("user context required");
  });
});

describe("knowledge.deliverables.list RPC integration", () => {
  it("rejects listing without user context", async () => {
    setContext({ userId: null });
    const result = await invoke("knowledge.deliverables.list");
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("user context required");
  });

  it("returns aggregated deliverables for authenticated user", async () => {
    setContext({ userId: "user-1" });
    listWorkspaceDeliverablesMock.mockResolvedValueOnce({
      deliverables: [
        {
          deliverableId: "del-1",
          title: "Q2 Report",
          kind: "report",
          source: "group",
          creators: ["user-1"],
          groupId: "group-a",
          groupTitle: "Alpha Team",
          status: "published",
          updatedAtMs: 100,
        },
      ],
    });
    const result = await invoke("knowledge.deliverables.list", { limit: 10 });
    expect(result.ok).toBe(true);
    const deliverables = (result.payload as { deliverables?: unknown[] }).deliverables;
    expect(deliverables).toHaveLength(1);
    expect(listWorkspaceDeliverablesMock).toHaveBeenCalledWith({
      userId: "user-1",
      limit: 10,
      source: undefined,
      status: undefined,
      groupIds: undefined,
    });
  });

  it("forwards source filter to read model", async () => {
    setContext({ userId: "user-1" });
    listWorkspaceDeliverablesMock.mockResolvedValueOnce({ deliverables: [] });
    const result = await invoke("knowledge.deliverables.list", { source: "agent", limit: 5 });
    expect(result.ok).toBe(true);
    expect(listWorkspaceDeliverablesMock).toHaveBeenCalledWith({
      userId: "user-1",
      limit: 5,
      source: "agent",
      status: undefined,
      groupIds: undefined,
    });
  });

  it("returns empty deliverables when read model has no matches", async () => {
    setContext({ userId: "user-9" });
    listWorkspaceDeliverablesMock.mockResolvedValueOnce({ deliverables: [] });
    const result = await invoke("knowledge.deliverables.list");
    expect(result.ok).toBe(true);
    expect((result.payload as { deliverables?: unknown[] }).deliverables).toEqual([]);
  });
});
