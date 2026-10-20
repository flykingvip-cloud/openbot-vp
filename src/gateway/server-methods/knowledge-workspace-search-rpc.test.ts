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
  } satisfies KnowledgeSourceContext,
}));

const searchWorkspaceMock = vi.hoisted(() =>
  vi.fn(async () => ({
    query: "销售",
    searchMode: "mixed" as const,
    totalCount: 3,
    groups: [
      {
        group: "knowledge" as const,
        hits: [
          { id: "object:obj-1", group: "knowledge" as const, title: "销售制度", objectId: "obj-1" },
        ],
      },
      {
        group: "enterprise" as const,
        hits: [],
      },
      {
        group: "deliverables" as const,
        hits: [],
      },
      {
        group: "capabilities" as const,
        hits: [],
      },
      {
        group: "agents" as const,
        hits: [],
      },
      {
        group: "owners" as const,
        hits: [],
      },
    ],
    legacyResults: [],
  })),
);

vi.mock("../knowledge/context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(async () => contextState.current),
}));

vi.mock("../knowledge/workspace-search.js", () => ({
  searchWorkspace: searchWorkspaceMock,
}));

const { knowledgeHandlers } = await import("./knowledge.js");

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
  const options: GatewayRequestHandlerOptions = {
    params,
    client: null,
    respond: (ok, payload, error) => {
      response = { ok, payload: payload as Record<string, unknown>, error };
    },
  } as GatewayRequestHandlerOptions;
  await handler(options);
  if (!response) {
    throw new Error("handler did not respond");
  }
  return response;
}

describe("knowledge.workspace.search RPC", () => {
  it("returns grouped workspace search payload", async () => {
    const result = await invoke("knowledge.workspace.search", {
      query: "销售",
      limitPerGroup: 5,
    });
    expect(result.ok).toBe(true);
    expect(searchWorkspaceMock).toHaveBeenCalledWith(null, {
      query: "销售",
      limitPerGroup: 5,
    });
    expect(result.payload?.totalCount).toBe(3);
    expect(Array.isArray(result.payload?.groups)).toBe(true);
  });

  it("defaults limitPerGroup to 5", async () => {
    await invoke("knowledge.workspace.search", { query: "test" });
    expect(searchWorkspaceMock).toHaveBeenCalledWith(null, {
      query: "test",
      limitPerGroup: 5,
    });
  });
});
