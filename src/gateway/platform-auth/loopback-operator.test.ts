import { describe, expect, it } from "vitest";
import { resolveOperatorSessionFromStore } from "./loopback-operator.js";
import type { PlatformAuthMembership, PlatformAuthStore, PlatformAuthUser } from "./store-types.js";

function makeUser(
  overrides: Partial<PlatformAuthUser> & { id: string; email: string },
): PlatformAuthUser {
  return {
    normalizedEmail: overrides.email.trim().toLowerCase(),
    displayName: "Operator",
    passwordHash: "hash",
    passwordUpdatedAt: "2026-01-01T00:00:00.000Z",
    loginFailedCount: 0,
    status: "active",
    source: "self-created",
    role: "operator",
    scopes: ["gateway:operate"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeMembership(
  overrides: Partial<PlatformAuthMembership> & {
    id: string;
    userId: string;
    enterpriseId: string;
  },
): PlatformAuthMembership {
  return {
    membershipRole: "member",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeStore(params: {
  users: PlatformAuthUser[];
  memberships?: PlatformAuthMembership[];
}): PlatformAuthStore {
  return {
    users: Object.fromEntries(params.users.map((entry) => [entry.id, entry] as const)),
    memberships: Object.fromEntries(
      (params.memberships ?? []).map((entry) => [entry.id, entry] as const),
    ),
  } as unknown as PlatformAuthStore;
}

describe("resolveOperatorSessionFromStore", () => {
  it("synthesizes an employee-domain session for an active member operator", () => {
    const store = makeStore({
      users: [makeUser({ id: "user-1", email: "ops@corp.example" })],
      memberships: [
        makeMembership({
          id: "membership-1",
          userId: "user-1",
          enterpriseId: "001",
          membershipRole: "member",
        }),
      ],
    });

    const session = resolveOperatorSessionFromStore(store, "ops@corp.example");
    expect(session).not.toBeNull();
    expect(session).toMatchObject({
      provider: "trusted-proxy",
      user: "ops@corp.example",
      membershipId: "membership-1",
      enterpriseId: "001",
      tenantId: "001",
      sessionKind: "member",
      domain: "employee",
    });
  });

  it("pins the enterprise domain for an enterprise-admin membership", () => {
    const store = makeStore({
      users: [makeUser({ id: "user-1", email: "admin@corp.example" })],
      memberships: [
        makeMembership({
          id: "membership-1",
          userId: "user-1",
          enterpriseId: "001",
          membershipRole: "enterprise-admin",
        }),
      ],
    });

    const session = resolveOperatorSessionFromStore(store, "admin@corp.example");
    expect(session).toMatchObject({ sessionKind: "enterprise-admin", domain: "enterprise" });
  });

  it("normalizes the configured email (case/whitespace) to match the stored user", () => {
    const store = makeStore({
      users: [makeUser({ id: "user-1", email: "ops@corp.example" })],
      memberships: [makeMembership({ id: "membership-1", userId: "user-1", enterpriseId: "001" })],
    });

    const session = resolveOperatorSessionFromStore(store, "  OPS@Corp.Example  ");
    expect(session?.enterpriseId).toBe("001");
  });

  it("returns null when the configured email has no matching user", () => {
    const store = makeStore({
      users: [makeUser({ id: "user-1", email: "ops@corp.example" })],
      memberships: [makeMembership({ id: "membership-1", userId: "user-1", enterpriseId: "001" })],
    });

    expect(resolveOperatorSessionFromStore(store, "ghost@corp.example")).toBeNull();
  });

  it("returns null when the user is not active (fail closed)", () => {
    const store = makeStore({
      users: [makeUser({ id: "user-1", email: "ops@corp.example", status: "suspended" })],
      memberships: [makeMembership({ id: "membership-1", userId: "user-1", enterpriseId: "001" })],
    });

    expect(resolveOperatorSessionFromStore(store, "ops@corp.example")).toBeNull();
  });

  it("returns null when the user has no enterprise membership (no tenant to grant)", () => {
    const store = makeStore({
      users: [makeUser({ id: "user-1", email: "ops@corp.example" })],
      memberships: [],
    });

    expect(resolveOperatorSessionFromStore(store, "ops@corp.example")).toBeNull();
  });

  it("returns null for an empty/undefined configured email", () => {
    const store = makeStore({
      users: [makeUser({ id: "user-1", email: "ops@corp.example" })],
      memberships: [makeMembership({ id: "membership-1", userId: "user-1", enterpriseId: "001" })],
    });

    expect(resolveOperatorSessionFromStore(store, "   ")).toBeNull();
    expect(resolveOperatorSessionFromStore(store, undefined)).toBeNull();
  });
});
