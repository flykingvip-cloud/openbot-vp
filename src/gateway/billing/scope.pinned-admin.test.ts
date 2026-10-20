// @vitest-environment node
// Pinned session membership and same-enterprise admin must win over object order.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  store: {
    enterprises: {
      "ent-a": { id: "ent-a", status: "paid" },
      "ent-b": { id: "ent-b", status: "paid" },
    },
    users: {
      "user-1": {
        id: "user-1",
        email: "admin@example.com",
        normalizedEmail: "admin@example.com",
        status: "active" as const,
      },
    },
    memberships: {} as Record<
      string,
      {
        id: string;
        userId: string;
        enterpriseId: string;
        membershipRole: "enterprise-admin" | "member";
      }
    >,
  },
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({ gateway: { auth: { trustedProxy: {} } } }),
}));

vi.mock("../platform-auth.js", () => ({
  resolvePlatformAuthConfig: () => ({ enabled: true }),
  loadPlatformAuthStore: async () => h.store,
}));

const { resolveBillingScope, USAGE_BUDGET_PERMISSION } = await import("./scope.ts");

beforeEach(() => {
  h.store.memberships = {};
});

describe("resolveBillingScope pinned admin membership", () => {
  it("uses the pinned enterprise-admin membership when the first row is a member", async () => {
    // Object order would select ent-b / member. The session pin is ent-a admin.
    h.store.memberships = {
      "membership-member": {
        id: "membership-member",
        userId: "user-1",
        enterpriseId: "ent-b",
        membershipRole: "member",
      },
      "membership-admin": {
        id: "membership-admin",
        userId: "user-1",
        enterpriseId: "ent-a",
        membershipRole: "enterprise-admin",
      },
    };
    const scope = await resolveBillingScope({
      connect: {} as never,
      user: "admin@example.com",
      sessionMembershipId: "membership-admin",
      sessionEnterpriseId: "ent-a",
    });
    expect(scope.enterpriseId).toBe("ent-a");
    expect(scope.membership?.id).toBe("membership-admin");
    expect(scope.isEnterpriseAdmin).toBe(true);
    expect(scope.permissions.has(USAGE_BUDGET_PERMISSION)).toBe(true);
  });

  it("keeps same-enterprise admin when the first row is member and no session is pinned", async () => {
    h.store.memberships = {
      "membership-member": {
        id: "membership-member",
        userId: "user-1",
        enterpriseId: "ent-a",
        membershipRole: "member",
      },
      "membership-admin": {
        id: "membership-admin",
        userId: "user-1",
        enterpriseId: "ent-a",
        membershipRole: "enterprise-admin",
      },
    };
    const scope = await resolveBillingScope({
      connect: {} as never,
      user: "admin@example.com",
    });
    expect(scope.enterpriseId).toBe("ent-a");
    expect(scope.isEnterpriseAdmin).toBe(true);
    expect(scope.permissions.has(USAGE_BUDGET_PERMISSION)).toBe(true);
  });

  it("keeps a pinned member role when the same enterprise also has an admin row", async () => {
    h.store.memberships = {
      "membership-member": {
        id: "membership-member",
        userId: "user-1",
        enterpriseId: "ent-a",
        membershipRole: "member",
      },
      "membership-admin": {
        id: "membership-admin",
        userId: "user-1",
        enterpriseId: "ent-a",
        membershipRole: "enterprise-admin",
      },
    };
    const scope = await resolveBillingScope({
      connect: {} as never,
      user: "admin@example.com",
      sessionMembershipId: "membership-member",
      sessionEnterpriseId: "ent-a",
    });
    expect(scope.enterpriseId).toBe("ent-a");
    expect(scope.membership?.id).toBe("membership-member");
    expect(scope.isEnterpriseAdmin).toBe(false);
    expect(scope.permissions.has(USAGE_BUDGET_PERMISSION)).toBe(false);
  });

  it("does not grant admin across tenants when nothing is pinned", async () => {
    h.store.memberships = {
      "membership-member": {
        id: "membership-member",
        userId: "user-1",
        enterpriseId: "ent-b",
        membershipRole: "member",
      },
      "membership-admin": {
        id: "membership-admin",
        userId: "user-1",
        enterpriseId: "ent-a",
        membershipRole: "enterprise-admin",
      },
    };
    const scope = await resolveBillingScope({
      connect: {} as never,
      user: "admin@example.com",
    });
    expect(scope.enterpriseId).toBeNull();
    expect(scope.isEnterpriseAdmin).toBe(false);
  });
});
