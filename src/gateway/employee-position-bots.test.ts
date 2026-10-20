import { describe, expect, it } from "vitest";
import {
  assembleEmployeePositionAgentIds,
  auditAgentOwnershipOutsidePosition,
  bindInvitedEmployeeToPosition,
  resolveInvitePositionId,
  resolvePositionBotIds,
} from "./employee-position-bots.js";
import type { EnterpriseSeatAssetsStore } from "./enterprise-seat-assets-store.js";

function emptySeatStore(): EnterpriseSeatAssetsStore {
  return {
    version: 1,
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
    organizationDepartments: {},
    organizationChildOrders: {},
  } as EnterpriseSeatAssetsStore;
}

describe("invite position id", () => {
  it("accepts positionId and the legacy seatId field as the same stable id", () => {
    expect(resolveInvitePositionId({ positionId: " pos-1 " })).toEqual({
      ok: true,
      positionId: "pos-1",
    });
    expect(resolveInvitePositionId({ seatId: "seat-9" })).toEqual({
      ok: true,
      positionId: "seat-9",
    });
  });

  it("rejects title, email, and a missing id", () => {
    expect(resolveInvitePositionId({}).ok).toBe(false);
    expect(resolveInvitePositionId({ positionId: "ceo@example.com" }).ok).toBe(false);
    expect(resolveInvitePositionId({ seatId: "  " }).ok).toBe(false);
  });
});

describe("position bot set", () => {
  it("is empty without a position, even when grants or user-owned config rows exist", () => {
    expect(
      resolvePositionBotIds({
        positionId: null,
        grantedAgentIds: ["bot-a"],
        configAgents: [{ id: "bot-b", ownerId: "user-ceo" }],
      }),
    ).toEqual([]);
    expect(
      assembleEmployeePositionAgentIds({
        positionId: "",
        grantedAgentIds: [],
      }),
    ).toEqual(["main"]);
  });

  it("unions seat grants with config rows owned by the position id only", () => {
    expect(
      resolvePositionBotIds({
        positionId: "seat-cs",
        grantedAgentIds: ["main", "from-binding"],
        configAgents: [
          { id: "position-bot", ownerId: "seat-cs" },
          { id: "creator-bot", ownerId: "user-elle" },
          { id: "other-seat", ownerId: "seat-sales" },
        ],
      }),
    ).toEqual(["from-binding", "position-bot"]);
  });

  it("reports historical user ownership that is not on the position set and does not write", () => {
    const records = [
      {
        tenantId: "001",
        subjectKind: "agent",
        subjectId: "panda",
        positionId: "seat-ceo",
        currentManagerUserId: "user-ceo",
        bindingStatus: "active",
      },
      {
        tenantId: "001",
        subjectKind: "agent",
        subjectId: "on-seat",
        positionId: "seat-ceo",
        currentManagerUserId: "user-ceo",
        bindingStatus: "active",
      },
      {
        tenantId: "001",
        subjectKind: "agent",
        subjectId: "no-position",
        currentManagerUserId: "user-ceo",
        bindingStatus: "active",
      },
    ];
    expect(
      auditAgentOwnershipOutsidePosition({
        records,
        botsByPositionKey: { "001:seat-ceo": ["on-seat"] },
      }),
    ).toEqual([
      {
        tenantId: "001",
        subjectId: "panda",
        positionId: "seat-ceo",
        currentManagerUserId: "user-ceo",
        reason: "not-in-position-bot-set",
      },
      {
        tenantId: "001",
        subjectId: "no-position",
        positionId: "",
        currentManagerUserId: "user-ceo",
        reason: "missing-position-id",
      },
    ]);
  });
});

describe("bindInvitedEmployeeToPosition", () => {
  it("binds immediately and a second call stays on the same active binding", () => {
    const store = emptySeatStore();
    store.seats["seat-cs"] = {
      seatId: "seat-cs",
      tenantId: "tenant-a",
      title: "客服专员",
      status: "assigned",
      defaultSpaceIds: [],
      defaultAgentAssetIds: ["bot-cs"],
      memoryScopeEnabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const first = bindInvitedEmployeeToPosition({
      store,
      tenantId: "tenant-a",
      seatId: "seat-cs",
      employeeId: "user-1",
      nowIso: "2026-01-02T00:00:00.000Z",
    });
    const second = bindInvitedEmployeeToPosition({
      store,
      tenantId: "tenant-a",
      seatId: "seat-cs",
      employeeId: "user-1",
      nowIso: "2026-01-03T00:00:00.000Z",
    });
    expect(first.idempotent).toBe(false);
    expect(first.seat.status).toBe("occupied");
    expect(first.seat.currentEmployeeId).toBe("user-1");
    expect(second.idempotent).toBe(true);
    expect(second.binding.bindingId).toBe(first.binding.bindingId);
    const active = Object.values(store.bindings).filter(
      (binding) => binding.bindingStatus === "active",
    );
    expect(active).toHaveLength(1);
  });

  it("fails when the position is missing from the tenant", () => {
    const store = emptySeatStore();
    expect(() =>
      bindInvitedEmployeeToPosition({
        store,
        tenantId: "tenant-a",
        seatId: "missing",
        employeeId: "user-1",
        nowIso: "2026-01-02T00:00:00.000Z",
      }),
    ).toThrow(/Seat not found/);
  });
});
