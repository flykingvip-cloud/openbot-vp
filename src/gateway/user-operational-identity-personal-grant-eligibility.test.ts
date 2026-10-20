import { describe, expect, it, vi } from "vitest";
import { isPersonalIdentityGrantEligibleForAgentScope } from "./user-operational-identity-personal-grant-eligibility.js";

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({ agents: { list: [] } })),
}));

vi.mock("./ownership-store.js", () => ({
  listOwnershipRecords: vi.fn(() => []),
}));

vi.mock("./collaboration-learning/shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./collaboration-learning/shared.js")>();
  return {
    ...actual,
    readConfiguredAgentOwnership: vi.fn((agentId: string) => {
      if (agentId === "agt-direct-user") {
        return { ownerId: "user-1", scope: "shared", ownerName: null, ownerType: "user" };
      }
      if (agentId === "agt-seat-shared" || agentId === "agt-foreign") {
        return {
          ownerId: agentId === "agt-foreign" ? "seat-other" : "seat-1",
          scope: "shared",
          ownerName: "产品体验-王老师",
          ownerType: "position",
        };
      }
      return null;
    }),
  };
});

function seatStore(params: { seatId: string; employeeId: string; agentId: string }): never {
  return {
    version: 1,
    seats: {
      [params.seatId]: {
        seatId: params.seatId,
        tenantId: "001",
        title: "岗位",
        status: "occupied",
        currentEmployeeId: params.employeeId,
        defaultSpaceIds: [],
        defaultAgentAssetIds: [],
        memoryScopeEnabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    assetBindings: {
      [`bind-${params.agentId}`]: {
        bindingId: `bind-${params.agentId}`,
        tenantId: "001",
        seatId: params.seatId,
        assetType: "agent",
        assetId: params.agentId,
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    credentialBindings: {},
    employeeIdentityEnrollments: {},
  } as never;
}

describe("isPersonalIdentityGrantEligibleForAgentScope", () => {
  it("allows owned and group scopes without seat checks", () => {
    expect(
      isPersonalIdentityGrantEligibleForAgentScope({
        ownerId: "user-1",
        agentId: "any",
        agentScope: "owned",
      }),
    ).toBe(true);
    expect(
      isPersonalIdentityGrantEligibleForAgentScope({
        ownerId: "user-1",
        agentId: "any",
        agentScope: "group",
      }),
    ).toBe(true);
  });

  it("allows shared agents whose config ownerId is the granting user", () => {
    expect(
      isPersonalIdentityGrantEligibleForAgentScope({
        ownerId: "user-1",
        agentId: "agt-direct-user",
        agentScope: "shared",
      }),
    ).toBe(true);
  });

  it("allows seat-owned shared agents when agent.ownerId is the occupied seat", () => {
    expect(
      isPersonalIdentityGrantEligibleForAgentScope({
        ownerId: "user-1",
        agentId: "agt-seat-shared",
        agentScope: "shared",
        seatStore: {
          version: 1,
          seats: {
            "seat-1": {
              seatId: "seat-1",
              tenantId: "001",
              title: "产品体验-王老师",
              status: "occupied",
              currentEmployeeId: "user-1",
              defaultSpaceIds: [],
              defaultAgentAssetIds: [],
              memoryScopeEnabled: true,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          },
          assetBindings: {},
          credentialBindings: {},
          employeeIdentityEnrollments: {},
        } as never,
      }),
    ).toBe(true);
  });

  it("allows seat-owned shared agents via seat asset bindings", () => {
    expect(
      isPersonalIdentityGrantEligibleForAgentScope({
        ownerId: "user-1",
        agentId: "agt-seat-shared",
        agentScope: "shared",
        tenantId: "001",
        seatStore: seatStore({
          seatId: "seat-1",
          employeeId: "user-1",
          agentId: "agt-seat-shared",
        }),
      }),
    ).toBe(true);
  });

  it("denies shared agents owned by another seat", () => {
    expect(
      isPersonalIdentityGrantEligibleForAgentScope({
        ownerId: "user-1",
        agentId: "agt-foreign",
        agentScope: "shared",
        tenantId: "001",
        seatStore: seatStore({
          seatId: "seat-other",
          employeeId: "user-2",
          agentId: "agt-foreign",
        }),
      }),
    ).toBe(false);
  });

  it("fail-closes shared grants when seat authority is unavailable", () => {
    expect(
      isPersonalIdentityGrantEligibleForAgentScope({
        ownerId: "user-1",
        agentId: "agt-seat-shared",
        agentScope: "shared",
      }),
    ).toBe(false);
  });
});
