/**
 * P3 mesh growth RPC — handler / method list / scope 三处齐备。
 */

import { describe, expect, it, vi } from "vitest";

const MESH_GROWTH_METHODS = [
  "growth.aggregate",
  "growth.groupAggregate",
  "mesh.performance.growthSummary",
  "mesh.performance.groupGrowthSummary",
] as const;

describe("mesh growth aggregate RPC registration", () => {
  it("lists and scopes growth aggregate methods", async () => {
    const { agentGrowthHandlers } = await import("../server-methods/agent-growth.js");
    const { meshBoundaryFacadeHandlers } =
      await import("../server-methods/mesh-boundary-facade.js");
    const { listGatewayMethods } = await import("../server-methods-list.js");
    const { getMethodScopeGroups, READ_SCOPE } = await import("../method-scopes.js");
    const declared = new Set(listGatewayMethods());
    const scopeOf = (method: string): string => {
      for (const [scope, methods] of Object.entries(getMethodScopeGroups())) {
        if (methods.includes(method)) {
          return scope;
        }
      }
      return "UNSCOPED";
    };

    for (const method of MESH_GROWTH_METHODS) {
      expect(declared.has(method), `${method} missing from gateway method list`).toBe(true);
      expect(scopeOf(method)).toBe(READ_SCOPE);
    }
    expect(Object.hasOwn(agentGrowthHandlers, "growth.aggregate")).toBe(true);
    expect(Object.hasOwn(agentGrowthHandlers, "growth.groupAggregate")).toBe(true);
    expect(Object.hasOwn(meshBoundaryFacadeHandlers, "mesh.performance.growthSummary")).toBe(true);
    expect(Object.hasOwn(meshBoundaryFacadeHandlers, "mesh.performance.groupGrowthSummary")).toBe(
      true,
    );
  });

  it("growth.aggregate returns empty aggregate without authoritative tenant", async () => {
    const { agentGrowthHandlers } = await import("./agent-growth.js");
    const respond = vi.fn();
    await agentGrowthHandlers["growth.aggregate"]({
      req: {} as never,
      params: { tenantId: "forged-tenant" },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        summary: expect.objectContaining({ botCount: 0, trackedCount: 0 }),
        ranking: [],
      }),
      undefined,
    );
  });

  it("growth.aggregate ignores client-supplied tenantId params", async () => {
    vi.resetModules();
    vi.doMock("../agent-growth/mesh-growth-tenant-scope.js", () => ({
      resolveMeshGrowthTenantScope: async () => ({ kind: "empty" }),
      listTenantMeshGrowthAgents: async () => [],
    }));
    const { agentGrowthHandlers } = await import("./agent-growth.js");
    const respond = vi.fn();
    await agentGrowthHandlers["growth.aggregate"]({
      req: {} as never,
      params: { tenantId: "tenant-b-forged" },
      respond: respond as never,
      context: {} as never,
      client: { user: "admin@tenant-a.example", sessionEnterpriseId: "tenant-a" } as never,
      isWebchatConnect: () => false,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        summary: expect.objectContaining({ botCount: 0 }),
      }),
      undefined,
    );
  });
});
