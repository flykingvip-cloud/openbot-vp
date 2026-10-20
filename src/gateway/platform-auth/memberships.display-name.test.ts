import { describe, expect, it } from "vitest";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { buildPlatformOrganizationSnapshot } from "./memberships.js";
import type { PlatformAuthStore } from "./store-types.js";

function createStore(): PlatformAuthStore {
  return {
    users: {
      "user-current": {
        id: "user-current",
        email: "current@example.com",
        displayName: "current@example.com",
        status: "active",
        scopes: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
    memberships: {},
    enterprises: {},
    employeeProvisions: {
      provision1: {
        id: "provision1",
        enterpriseId: "acme",
        seatId: "seat-pending",
        employeeName: "hedon25@126.com",
        employeeEmail: "hedon25@126.com",
        status: "pending_activation",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
    activationCodes: {},
  } as unknown as PlatformAuthStore;
}

function createSeatStore(): EnterpriseSeatAssetsStore {
  return {
    version: 4,
    seats: {
      "seat-current": {
        seatId: "seat-current",
        tenantId: "acme",
        title: "销售总监",
        teamLabel: "销售部",
        status: "occupied",
        currentEmployeeId: "user-current",
        defaultSpaceIds: [],
        defaultAgentAssetIds: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      "seat-pending": {
        seatId: "seat-pending",
        tenantId: "acme",
        title: "运营经理",
        teamLabel: "运营部",
        status: "assigned",
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
    organizationDepartments: {},
    organizationChildOrders: {},
  } as unknown as EnterpriseSeatAssetsStore;
}

describe("buildPlatformOrganizationSnapshot display names", () => {
  it("does not emit emails as current or pending employee display names", () => {
    const snapshot = buildPlatformOrganizationSnapshot({
      store: createStore(),
      seatStore: createSeatStore(),
      enterpriseId: "acme",
    });

    const current = snapshot?.seats.find((seat) => seat.seatId === "seat-current");
    const pending = snapshot?.seats.find((seat) => seat.seatId === "seat-pending");

    expect(current?.currentEmployeeUser).toBe("current@example.com");
    expect(current?.currentEmployeeDisplayName).toBe("current");
    expect(pending?.pendingEmployeeUser).toBe("hedon25@126.com");
    expect(pending?.pendingEmployeeDisplayName).toBe("hedon25");
  });
});
