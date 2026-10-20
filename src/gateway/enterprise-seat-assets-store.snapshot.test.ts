import { describe, expect, it } from "vitest";
import {
  acceptSeatAssignmentOffer,
  buildEmployeeAccessSnapshot,
  ENTERPRISE_POSITION_AGENT_ASSET_LIMIT,
  type EnterpriseSeatAssetsStore,
} from "./enterprise-seat-assets-store.js";

describe("buildEmployeeAccessSnapshot", () => {
  it("unions defaultAgentAssetIds with active agent assetBindings", () => {
    const employeeId = "employee-wang";
    const seatId = "seat-wang";
    const store = {
      offers: {},
      bindings: {
        "bind-1": {
          bindingId: "bind-1",
          tenantId: "tenant-1",
          seatId,
          employeeId,
          bindingStatus: "active",
          effectiveAt: "2026-06-20T00:00:00.000Z",
        },
      },
      seats: {
        [seatId]: {
          seatId,
          tenantId: "tenant-1",
          title: "产品体验",
          status: "assigned",
          currentEmployeeId: employeeId,
          defaultAgentAssetIds: ["fengshui"],
          defaultSpaceIds: [],
          memoryScopeEnabled: false,
          updatedAt: "2026-06-20T00:00:00.000Z",
          createdAt: "2026-06-20T00:00:00.000Z",
        },
      },
      assetBindings: {
        "ab-hire": {
          assetBindingId: "ab-hire",
          tenantId: "tenant-1",
          seatId,
          assetType: "agent",
          assetId: "hire-manager",
          status: "active",
          source: "manual",
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
        "ab-culture": {
          assetBindingId: "ab-culture",
          tenantId: "tenant-1",
          seatId,
          assetType: "agent",
          assetId: "culture-director",
          status: "active",
          source: "manual",
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
        "ab-revoked": {
          assetBindingId: "ab-revoked",
          tenantId: "tenant-1",
          seatId,
          assetType: "agent",
          assetId: "revoked-bot",
          status: "revoked",
          source: "manual",
          revokedAt: "2026-06-21T00:00:00.000Z",
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-21T00:00:00.000Z",
        },
      },
      credentialBindings: {},
      accessPolicies: {},
      auditEvents: {},
      handovers: {},
    } as unknown as EnterpriseSeatAssetsStore;

    const snapshot = buildEmployeeAccessSnapshot({
      store,
      tenantId: "tenant-1",
      employeeId,
    });

    expect(snapshot.currentSeat?.seatId).toBe(seatId);
    expect(snapshot.agentIds).toEqual(
      expect.arrayContaining(["fengshui", "hire-manager", "culture-director", "main"]),
    );
    expect(snapshot.agentIds).not.toContain("revoked-bot");
  });

  it("clips pending offer agent ids instead of throwing when over the position limit", () => {
    const employeeId = "employee-1";
    const store = {
      offers: {
        "offer-1": {
          offerId: "offer-1",
          tenantId: "tenant-1",
          targetEmployeeId: employeeId,
          status: "pending",
          seatId: "seat-ceo",
          offeredAt: "2026-06-20T00:00:00.000Z",
          packageSnapshot: {
            seatTitle: "CEO",
            defaultAgentId: "main",
            agentIds: ["main", "bot", "bot--agent", "bot-2", "bot-skill", "panda"],
            defaultSpaceIds: [],
          },
        },
      },
      bindings: {},
      seats: {},
    } as unknown as EnterpriseSeatAssetsStore;

    const snapshot = buildEmployeeAccessSnapshot({
      store,
      tenantId: "tenant-1",
      employeeId,
    });

    expect(snapshot.pendingOffer?.agentIds).toHaveLength(ENTERPRISE_POSITION_AGENT_ASSET_LIMIT);
    expect(snapshot.pendingOffer?.omittedAgentIds).toEqual(["panda"]);
    expect(snapshot.notice).toContain("waiting for your confirmation");
  });

  it("accepts pending offers when the package exceeds the position agent limit", () => {
    const employeeId = "employee-1";
    const store = {
      offers: {
        "offer-1": {
          offerId: "offer-1",
          tenantId: "tenant-1",
          targetEmployeeId: employeeId,
          status: "pending",
          seatId: "seat-ceo",
          offeredAt: "2026-06-20T00:00:00.000Z",
          packageSnapshot: {
            seatTitle: "CEO",
            defaultAgentId: "main",
            agentIds: ["main", "bot", "bot--agent", "bot-2", "bot-skill", "panda"],
            defaultSpaceIds: [],
          },
        },
      },
      bindings: {},
      seats: {
        "seat-ceo": {
          seatId: "seat-ceo",
          tenantId: "tenant-1",
          title: "CEO",
          status: "assigned",
          defaultAgentAssetIds: ["main", "bot", "bot--agent", "bot-2", "bot-skill", "panda"],
          defaultSpaceIds: [],
          memoryScopeEnabled: false,
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      },
      assetBindings: {},
      credentialBindings: {},
      accessPolicies: {},
      auditEvents: {},
      handovers: {},
    } as unknown as EnterpriseSeatAssetsStore;

    acceptSeatAssignmentOffer({
      store,
      tenantId: "tenant-1",
      offerId: "offer-1",
      employeeId,
      nowIso: "2026-06-20T01:00:00.000Z",
    });

    expect(store.seats["seat-ceo"]?.defaultAgentAssetIds).toEqual([
      "main",
      "bot",
      "bot--agent",
      "bot-2",
      "bot-skill",
    ]);
    expect(store.offers["offer-1"]?.status).toBe("accepted");
  });
});
