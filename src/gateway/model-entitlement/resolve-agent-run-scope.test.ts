// @vitest-environment node
// Feature: model-entitlement-chain P5 任务 17.1 — agent 归属席位解析
import { describe, expect, it } from "vitest";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { resolveAgentRunEntitlementScope } from "./resolve-agent-run-scope.js";

function makeStore(): EnterpriseSeatAssetsStore {
  return {
    version: 1,
    seats: {
      "seat-1": {
        seatId: "seat-1",
        tenantId: "tenant-a",
        status: "occupied",
        currentEmployeeId: "emp-1",
        defaultSpaceIds: [],
        defaultAgentAssetIds: ["agent-default"],
        createdAt: "2026-06-08T00:00:00.000Z",
        updatedAt: "2026-06-08T00:00:00.000Z",
      },
    },
    bindings: {},
    accessPolicies: {},
    assetBindings: {
      "ab-1": {
        assetBindingId: "ab-1",
        tenantId: "tenant-a",
        seatId: "seat-1",
        assetType: "agent",
        assetId: "agent-bound",
        status: "active",
        source: "manual",
      },
      "ab-2": {
        assetBindingId: "ab-2",
        tenantId: "tenant-a",
        seatId: "seat-1",
        assetType: "agent",
        assetId: "agent-revoked",
        status: "active",
        revokedAt: "2026-06-08T01:00:00.000Z",
        source: "manual",
      },
    },
    credentialBindings: {},
    handovers: {},
  } as unknown as EnterpriseSeatAssetsStore;
}

describe("resolveAgentRunEntitlementScope", () => {
  it("按 active agent 资产绑定解析归属席位", async () => {
    const scope = await resolveAgentRunEntitlementScope({
      agentId: "agent-bound",
      store: makeStore(),
    });
    expect(scope).toEqual({ tenantId: "tenant-a", seatId: "seat-1", employeeId: "emp-1" });
  });

  it("回退到席位 default agent 资产列表", async () => {
    const scope = await resolveAgentRunEntitlementScope({
      agentId: "agent-default",
      store: makeStore(),
    });
    expect(scope?.seatId).toBe("seat-1");
    expect(scope?.tenantId).toBe("tenant-a");
  });

  it("已撤销的绑定不解析（视为无归属）", async () => {
    const scope = await resolveAgentRunEntitlementScope({
      agentId: "agent-revoked",
      store: makeStore(),
    });
    expect(scope).toBeNull();
  });

  it("未知 agent / 空 agentId → null（放行依据）", async () => {
    expect(
      await resolveAgentRunEntitlementScope({ agentId: "nope", store: makeStore() }),
    ).toBeNull();
    expect(await resolveAgentRunEntitlementScope({ agentId: "", store: makeStore() })).toBeNull();
    expect(await resolveAgentRunEntitlementScope({ store: makeStore() })).toBeNull();
  });
});
