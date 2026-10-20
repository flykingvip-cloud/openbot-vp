import path from "node:path";
import { describe, expect, it } from "vitest";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { resolveSeatGrantedAgentAssetIds } from "../enterprise-seat-assets-store.js";
import {
  applyVisibleSeatAgentGrant,
  isAgentConfigOwnedBySeat,
  isPathBSeatWorkspaceLocator,
  isStickyPathBSeatWorkspaceLocator,
  resolvePathBSeatAgentWorkspaceLocator,
} from "./seat-visible-agent-projection.js";

const AGENT_ID = "agt-daniel-hhd-gmail-com-nchn5ey";
const SEAT_ID = "seat-ceo-daniel-main";
const USER_ID = "90fed19a-1c8b-4420-87e0-bcc6165e32fa";

function emptySeatStore(): EnterpriseSeatAssetsStore {
  return {
    version: 1,
    seats: {
      [SEAT_ID]: {
        seatId: SEAT_ID,
        tenantId: "tenant-a",
        title: "CEO",
        status: "occupied",
        currentEmployeeId: USER_ID,
        defaultSpaceIds: [],
        defaultAgentAssetIds: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    bindings: {},
    accessPolicies: {},
    assetBindings: {},
    credentialBindings: {},
    handovers: {},
    offers: {},
    auditEvents: {},
    enterpriseIdentities: {},
    identityUsagePolicies: {},
    dataSourceIdentityBindings: {},
    employeeIdentityEnrollments: {},
  };
}

describe("seat-visible agent grant projection", () => {
  it("recognizes a robots-list agent whose ownerId is the occupied seat", () => {
    expect(
      isAgentConfigOwnedBySeat(
        {
          agents: {
            list: [{ id: AGENT_ID, name: "高级秘书", ownerId: SEAT_ID }],
          },
        },
        AGENT_ID,
        SEAT_ID,
      ),
    ).toBe(true);
    expect(
      isAgentConfigOwnedBySeat(
        {
          agents: {
            list: [{ id: AGENT_ID, name: "高级秘书", ownerId: USER_ID }],
          },
        },
        AGENT_ID,
        SEAT_ID,
      ),
    ).toBe(false);
  });

  it("writes defaultAgentAssetIds, asset bindings, and execute policy once", () => {
    const store = emptySeatStore();
    const changed = applyVisibleSeatAgentGrant({
      store,
      tenantId: "tenant-a",
      seatId: SEAT_ID,
      agentIds: [AGENT_ID, "asset-senior-secretary"],
      actorUserId: USER_ID,
      nowIso: "2026-10-10T00:00:00.000Z",
    });
    expect(changed).toBe(true);
    expect(store.seats[SEAT_ID]?.defaultAgentAssetIds).toEqual([
      AGENT_ID,
      "asset-senior-secretary",
    ]);
    const bindings = Object.values(store.assetBindings);
    expect(bindings).toHaveLength(2);
    expect(
      bindings.every((binding) => binding.seatId === SEAT_ID && binding.status === "active"),
    ).toBe(true);
    expect(
      Object.values(store.accessPolicies).filter(
        (policy) =>
          policy.action === "execute" && policy.resourceType === "agent" && !policy.revokedAt,
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      resolveSeatGrantedAgentAssetIds({
        store,
        tenantId: "tenant-a",
        seat: store.seats[SEAT_ID],
      }),
    ).toEqual([AGENT_ID, "asset-senior-secretary"].toSorted());

    expect(
      applyVisibleSeatAgentGrant({
        store,
        tenantId: "tenant-a",
        seatId: SEAT_ID,
        agentIds: [AGENT_ID],
        actorUserId: USER_ID,
        nowIso: "2026-10-10T00:01:00.000Z",
      }),
    ).toBe(false);
    expect(Object.values(store.assetBindings)).toHaveLength(2);
  });

  it("skips a registry UUID that is not a runtime agent id, even when defaults are full", () => {
    const store = emptySeatStore();
    const registryAssetId = "a84dd78f-972b-4f28-94de-d2fbca3d9cb1";
    store.seats[SEAT_ID].defaultAgentAssetIds = [
      "main",
      "panda",
      "bot-2",
      "bot--agent",
      "bot-skill",
    ];
    const changed = applyVisibleSeatAgentGrant({
      store,
      tenantId: "tenant-a",
      seatId: SEAT_ID,
      agentIds: [AGENT_ID, registryAssetId],
      runtimeAgentIds: [AGENT_ID, "bot-2"],
      actorUserId: USER_ID,
      nowIso: "2026-10-10T00:00:00.000Z",
    });
    expect(changed).toBe(true);
    expect(store.seats[SEAT_ID]?.defaultAgentAssetIds).toEqual([
      "main",
      "panda",
      "bot-2",
      "bot--agent",
      "bot-skill",
    ]);
    expect(Object.values(store.assetBindings).map((binding) => binding.assetId)).toEqual([
      AGENT_ID,
    ]);
    expect(
      Object.values(store.accessPolicies).some((policy) => policy.resourceId === registryAssetId),
    ).toBe(false);
    expect(
      resolveSeatGrantedAgentAssetIds({
        store,
        tenantId: "tenant-a",
        seat: store.seats[SEAT_ID],
      }),
    ).not.toContain(registryAssetId);
    expect(
      resolveSeatGrantedAgentAssetIds({
        store,
        tenantId: "tenant-a",
        seat: store.seats[SEAT_ID],
      }),
    ).toContain(AGENT_ID);
  });

  it("still grants a UUID when that id is itself a runtime agents.list id", () => {
    const store = emptySeatStore();
    const runtimeUuid = "78f3e31f-8c4c-45c1-b9da-9401253fbcc8";
    const changed = applyVisibleSeatAgentGrant({
      store,
      tenantId: "tenant-a",
      seatId: SEAT_ID,
      agentIds: [runtimeUuid],
      runtimeAgentIds: [runtimeUuid],
      actorUserId: USER_ID,
      nowIso: "2026-10-10T00:00:00.000Z",
    });
    expect(changed).toBe(true);
    expect(Object.values(store.assetBindings).map((binding) => binding.assetId)).toEqual([
      runtimeUuid,
    ]);
  });

  it("keeps an asset binding when defaultAgentAssetIds is already at the position cap", () => {
    const store = emptySeatStore();
    store.seats[SEAT_ID].defaultAgentAssetIds = ["a", "b", "c", "d", "e"];
    const changed = applyVisibleSeatAgentGrant({
      store,
      tenantId: "tenant-a",
      seatId: SEAT_ID,
      agentIds: [AGENT_ID],
      actorUserId: USER_ID,
      nowIso: "2026-10-10T00:00:00.000Z",
    });
    expect(changed).toBe(true);
    expect(store.seats[SEAT_ID]?.defaultAgentAssetIds).toEqual(["a", "b", "c", "d", "e"]);
    expect(
      resolveSeatGrantedAgentAssetIds({
        store,
        tenantId: "tenant-a",
        seat: store.seats[SEAT_ID],
      }),
    ).toContain(AGENT_ID);
  });

  it("places Path B cwd on the tenant volume, not the gateway state dir", () => {
    const tenantsRoot = path.join("/root", "openbot-tenants");
    const locator = resolvePathBSeatAgentWorkspaceLocator({
      tenantId: "001",
      userId: USER_ID,
      agentId: AGENT_ID,
      tenantsRoot,
    });
    const canonical = path.join(
      tenantsRoot,
      "001",
      "users",
      USER_ID,
      "OpenBot",
      "agents",
      AGENT_ID,
      "workspace",
    );
    expect(locator).toBe(canonical);
    expect(locator.startsWith(path.join("/root", ".openbot"))).toBe(false);
    expect(locator).not.toContain(`workspace-${AGENT_ID}`);
    expect(
      isPathBSeatWorkspaceLocator(canonical, {
        tenantId: "001",
        userId: USER_ID,
        agentId: AGENT_ID,
        tenantsRoot,
      }),
    ).toBe(true);
    const stateDirShadow = path.join(
      "/root",
      ".openbot",
      "tenants",
      "001",
      "users",
      USER_ID,
      "OpenBot",
      "agents",
      AGENT_ID,
      "workspace",
    );
    expect(
      isPathBSeatWorkspaceLocator(stateDirShadow, {
        tenantId: "001",
        userId: USER_ID,
        agentId: AGENT_ID,
        tenantsRoot,
      }),
    ).toBe(false);
    expect(
      isPathBSeatWorkspaceLocator(`/root/.openbot/agents/${AGENT_ID}/agent`, {
        tenantId: "001",
        userId: USER_ID,
        agentId: AGENT_ID,
        tenantsRoot,
      }),
    ).toBe(false);
  });

  it("treats another host's Path B as sticky for the same seat agent", () => {
    const tenantsRoot = path.join("/root", "openbot-tenants");
    const elleLocator = resolvePathBSeatAgentWorkspaceLocator({
      tenantId: "001",
      userId: USER_ID,
      agentId: AGENT_ID,
      tenantsRoot,
    });
    const otherHost = resolvePathBSeatAgentWorkspaceLocator({
      tenantId: "001",
      userId: "user-ceo",
      agentId: AGENT_ID,
      tenantsRoot,
    });
    expect(
      isStickyPathBSeatWorkspaceLocator(elleLocator, {
        tenantId: "001",
        agentId: AGENT_ID,
        tenantsRoot,
      }),
    ).toBe(true);
    expect(
      isStickyPathBSeatWorkspaceLocator(otherHost, {
        tenantId: "001",
        agentId: AGENT_ID,
        tenantsRoot,
      }),
    ).toBe(true);
    expect(
      isPathBSeatWorkspaceLocator(elleLocator, {
        tenantId: "001",
        userId: "user-ceo",
        agentId: AGENT_ID,
        tenantsRoot,
      }),
    ).toBe(false);
    const stateDirShadow = path.join(
      "/root",
      ".openbot",
      "tenants",
      "001",
      "users",
      USER_ID,
      "OpenBot",
      "agents",
      AGENT_ID,
      "workspace",
    );
    expect(
      isStickyPathBSeatWorkspaceLocator(stateDirShadow, {
        tenantId: "001",
        agentId: AGENT_ID,
        tenantsRoot,
      }),
    ).toBe(false);
  });
});
