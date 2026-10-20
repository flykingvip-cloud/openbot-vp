import { describe, expect, it } from "vitest";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { buildMemberSeatAssignmentIndex } from "./memberships.js";
import type { PlatformAuthStore } from "./store-types.js";

function createStore(): PlatformAuthStore {
  return {
    users: {
      "user-current": {
        id: "user-current",
        email: "current@example.com",
        displayName: "Current",
        status: "active",
        scopes: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      "user-pending": {
        id: "user-pending",
        email: "pending@example.com",
        displayName: "Pending",
        status: "active",
        scopes: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      "user-offer": {
        id: "user-offer",
        email: "offer@example.com",
        displayName: "Offer",
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
        employeeName: "Pending",
        employeeEmail: "pending@example.com",
        status: "pending_activation",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
  } as unknown as PlatformAuthStore;
}

function createSeatStore(): EnterpriseSeatAssetsStore {
  return {
    seats: {
      "seat-current": {
        seatId: "seat-current",
        tenantId: "acme",
        title: "销售总监",
        teamLabel: "销售部/华东区",
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
      "seat-offer": {
        seatId: "seat-offer",
        tenantId: "acme",
        title: "增长负责人",
        teamLabel: "增长部",
        status: "vacant",
        defaultSpaceIds: [],
        defaultAgentAssetIds: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    bindings: {},
    offers: {
      offer1: {
        offerId: "offer1",
        tenantId: "acme",
        seatId: "seat-offer",
        targetEmployeeId: "user-offer",
        status: "pending",
        offeredAt: "2026-01-01T00:00:00.000Z",
        packageSnapshot: {
          seatTitle: "增长负责人",
          defaultSpaceIds: [],
        },
      },
    },
    handovers: {},
    auditEvents: {},
  } as unknown as EnterpriseSeatAssetsStore;
}

describe("buildMemberSeatAssignmentIndex", () => {
  it("maps current employees, pending provisions, and pending offers by email", () => {
    const index = buildMemberSeatAssignmentIndex({
      store: createStore(),
      seatStore: createSeatStore(),
      enterpriseId: "acme",
    });

    expect(index.get("current@example.com")).toEqual({
      seatTitle: "销售总监",
      seatStatus: "occupied",
      teamLabel: "销售部/华东区",
    });
    expect(index.get("pending@example.com")).toEqual({
      seatTitle: "运营经理",
      seatStatus: "assigned",
      teamLabel: "运营部",
    });
    expect(index.get("offer@example.com")).toEqual({
      seatTitle: "增长负责人",
      seatStatus: "vacant",
      teamLabel: "增长部",
    });
  });

  it("prefers the current seat assignment over pending links for the same email", () => {
    const store = createStore();
    const provision = store.employeeProvisions.provision1;
    if (provision) {
      provision.employeeEmail = "current@example.com";
    }
    const seatStore = createSeatStore();
    const pendingSeat = seatStore.seats["seat-pending"];
    if (pendingSeat) {
      pendingSeat.title = "旧岗位";
      pendingSeat.teamLabel = "旧部门";
    }

    const index = buildMemberSeatAssignmentIndex({
      store,
      seatStore,
      enterpriseId: "acme",
    });

    expect(index.get("current@example.com")).toEqual({
      seatTitle: "销售总监",
      seatStatus: "occupied",
      teamLabel: "销售部/华东区",
    });
  });
});
