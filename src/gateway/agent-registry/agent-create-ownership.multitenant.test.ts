// @vitest-environment node
// agents.create ownership: a multitenant user needs an authoritative session pair.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  enabled: true,
  store: {
    enterprises: {
      "ent-a": { id: "ent-a", status: "paid" },
      "ent-b": { id: "ent-b", status: "paid" },
    },
    users: {
      "user-1": {
        id: "user-1",
        email: "member@example.com",
        normalizedEmail: "member@example.com",
        status: "active" as const,
        displayName: "Member",
      },
    },
    memberships: {
      "membership-b": {
        id: "membership-b",
        userId: "user-1",
        enterpriseId: "ent-b",
        membershipRole: "member" as const,
      },
      "membership-a": {
        id: "membership-a",
        userId: "user-1",
        enterpriseId: "ent-a",
        membershipRole: "enterprise-admin" as const,
      },
    },
  },
  seatStore: {
    seats: {
      "seat-1": {
        seatId: "seat-1",
        tenantId: "ent-a",
        title: "Seat",
        status: "occupied",
        currentEmployeeId: "user-1",
        defaultAgentAssetIds: [] as string[],
        defaultSpaceIds: [] as string[],
      },
    },
    bindings: {
      "bind-1": {
        tenantId: "ent-a",
        employeeId: "user-1",
        bindingStatus: "active" as const,
        seatId: "seat-1",
        effectiveAt: "2026-01-01T00:00:00.000Z",
      },
    },
    offers: {},
    assetBindings: {},
  },
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({ gateway: { auth: { trustedProxy: {} } } }),
}));

vi.mock("../platform-auth.js", () => ({
  resolvePlatformAuthConfig: () => ({ enabled: h.enabled }),
  loadPlatformAuthStore: async () => h.store,
}));

vi.mock("../platform-auth/seat-store-loader.js", () => ({
  loadSeatAssetsStoreForTenantId: async () => h.seatStore,
  saveSeatAssetsStoreForTenantId: async () => {},
}));

const { resolveAgentCreateOwnershipForClient } = await import("./agent-create-ownership.ts");

beforeEach(() => {
  h.enabled = true;
});

describe("agents.create multitenant ownership", () => {
  it("accepts a create when the session pair pins the enterprise", async () => {
    const ownership = await resolveAgentCreateOwnershipForClient({
      client: {
        user: "member@example.com",
        sessionMembershipId: "membership-a",
        sessionEnterpriseId: "ent-a",
      },
      requestedTenantId: "ent-a",
      requestedOwnerPositionId: "seat-1",
    });
    expect(ownership).toMatchObject({
      kind: "enterprise",
      tenantId: "ent-a",
      actorUserId: "user-1",
      actorMembershipId: "membership-a",
      ownerPositionId: "seat-1",
    });
  });

  it("rejects a tenant create when the multitenant session is not authoritative", async () => {
    const ownership = await resolveAgentCreateOwnershipForClient({
      client: { user: "member@example.com" },
      requestedTenantId: "ent-a",
      requestedOwnerPositionId: "seat-1",
    });
    expect(ownership).toMatchObject({
      kind: "reject",
      code: "NO_AUTHORITATIVE_TENANT",
      scopeKind: "deny",
      denyReason: "membership-ambiguous",
    });
    if (ownership.kind === "reject") {
      expect(ownership.message).toContain("deny/membership-ambiguous");
      expect(ownership.message).toContain("重新登录");
    }
  });
});
