import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import {
  resolveOrgSeatIdForAgentInStore,
  resolveOrgSeatIdForMemberInStore,
  resolveUsageAttributionTags,
} from "./usage-attribution-context.js";

function makeStore(overrides: Partial<EnterpriseSeatAssetsStore> = {}): EnterpriseSeatAssetsStore {
  return {
    version: 4,
    seats: {},
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
    ...overrides,
  };
}

describe("usage-attribution-context", () => {
  it("resolves orgSeatId from agentId via defaultAgentAssetIds", () => {
    const store = makeStore({
      seats: {
        "seat-sales": {
          seatId: "seat-sales",
          tenantId: "ent-a",
          title: "销售助理",
          status: "occupied",
          defaultSpaceIds: [],
          defaultAgentAssetIds: ["bot-sales"],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });
    expect(resolveOrgSeatIdForAgentInStore(store, "ent-a", "bot-sales")).toBe("seat-sales");
    expect(resolveOrgSeatIdForAgentInStore(store, "ent-a", "unknown")).toBeNull();
  });

  it("resolves orgSeatId from active member binding", () => {
    const store = makeStore({
      seats: {
        "seat-ops": {
          seatId: "seat-ops",
          tenantId: "ent-a",
          title: "运营",
          status: "occupied",
          currentEmployeeId: "alice@example.com",
          defaultSpaceIds: [],
          defaultAgentAssetIds: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      bindings: {
        "bind-1": {
          bindingId: "bind-1",
          seatId: "seat-ops",
          tenantId: "ent-a",
          employeeId: "alice@example.com",
          bindingStatus: "active",
          effectiveAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });
    expect(resolveOrgSeatIdForMemberInStore(store, "ent-a", "alice@example.com")).toBe("seat-ops");
  });

  it("resolveUsageAttributionTags auto-fills orgSeatId when only agentId is given", async () => {
    const seatPath = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-seat-attr-"));
    const storePath = path.join(seatPath, "seats.json");
    const store = makeStore({
      seats: {
        "seat-1": {
          seatId: "seat-1",
          tenantId: "ent-tag",
          title: "岗位",
          status: "occupied",
          defaultSpaceIds: [],
          defaultAgentAssetIds: ["agent-x"],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });
    const { saveEnterpriseSeatAssetsStore } = await import("../enterprise-seat-assets-store.js");
    await saveEnterpriseSeatAssetsStore(storePath, store);

    const tags = await resolveUsageAttributionTags({
      enterpriseId: "ent-tag",
      agentId: "agent-x",
      seatAssetsPath: storePath,
    });
    expect(tags).toEqual({ agentId: "agent-x", orgSeatId: "seat-1" });
  });
});
