import { describe, expect, it } from "vitest";
import { resolveEnterpriseAdminSessionContext } from "./session-context.js";
import type {
  PlatformAuthEnterprise,
  PlatformAuthMembership,
  PlatformAuthSessionContext,
  PlatformAuthStore,
  PlatformAuthUser,
} from "./store-types.js";
import { createDefaultPolicy } from "./trial-policy.js";

function makeUser(overrides: Partial<PlatformAuthUser> = {}): PlatformAuthUser {
  return {
    id: "user-1",
    email: "ceo@example.com",
    normalizedEmail: "ceo@example.com",
    displayName: "CEO",
    passwordHash: "hash",
    passwordUpdatedAt: "2026-01-01T00:00:00.000Z",
    emailVerifiedAt: "2026-01-01T00:00:00.000Z",
    lastLoginAt: "2026-01-01T00:00:00.000Z",
    loginFailedCount: 0,
    status: "active",
    source: "self-created",
    role: "operator",
    scopes: ["operator.admin"],
    platformRole: "admin",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeEnterprise(overrides: Partial<PlatformAuthEnterprise> = {}): PlatformAuthEnterprise {
  return {
    id: "ent-1",
    name: "Acme",
    slug: "acme",
    status: "trial",
    plan: "trial",
    billingStatus: "ok",
    seatQuota: 10,
    seatUsed: 1,
    createdSource: "self-service",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeMembership(overrides: Partial<PlatformAuthMembership> = {}): PlatformAuthMembership {
  return {
    id: "mem-admin",
    userId: "user-1",
    enterpriseId: "ent-1",
    membershipRole: "enterprise-admin",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeStore(params?: {
  user?: PlatformAuthUser;
  enterprise?: PlatformAuthEnterprise;
  membership?: PlatformAuthMembership;
}): PlatformAuthStore {
  const user = params?.user ?? makeUser();
  const enterprise = params?.enterprise ?? makeEnterprise();
  const membership = params?.membership ?? makeMembership();
  return {
    version: 1,
    secret: "secret",
    users: { [user.id]: user },
    enterprises: { [enterprise.id]: enterprise },
    memberships: { [membership.id]: membership },
    sessions: {},
    adminProvisions: {},
    employeeProvisions: {},
    activationCodes: {},
    trialApplications: {},
    leadNotifications: {},
    policy: createDefaultPolicy("2026-01-01T00:00:00.000Z"),
  };
}

describe("resolveEnterpriseAdminSessionContext", () => {
  it("returns the enterprise-admin cookie context unchanged", () => {
    const store = makeStore();
    const membership = store.memberships["mem-admin"];
    const enterprise = store.enterprises["ent-1"];
    const user = store.users["user-1"];
    const context: PlatformAuthSessionContext = {
      user,
      membership,
      enterprise,
      session: {
        provider: "trusted-proxy",
        user: user.email,
        displayName: user.displayName,
        membershipId: membership.id,
        enterpriseId: enterprise.id,
        tenantId: enterprise.id,
        role: user.role,
        scopes: [...user.scopes],
      },
      sessionKind: "enterprise-admin",
    };

    expect(resolveEnterpriseAdminSessionContext({ store, context })).toMatchObject({
      sessionKind: "enterprise-admin",
      membership: { id: "mem-admin" },
      enterprise: { id: "ent-1" },
    });
  });

  it("elevates platform-admin sessions that hold an enterprise-admin membership", () => {
    const store = makeStore();
    const user = store.users["user-1"];
    const context: PlatformAuthSessionContext = {
      user,
      membership: null,
      enterprise: null,
      session: {
        provider: "trusted-proxy",
        user: user.email,
        displayName: user.displayName,
        role: user.role,
        scopes: [...user.scopes],
      },
      sessionKind: "platform-admin",
    };

    const resolved = resolveEnterpriseAdminSessionContext({ store, context });
    expect(resolved).toMatchObject({
      sessionKind: "enterprise-admin",
      membership: { id: "mem-admin", membershipRole: "enterprise-admin" },
      enterprise: { id: "ent-1" },
      session: {
        membershipId: "mem-admin",
        enterpriseId: "ent-1",
        tenantId: "ent-1",
      },
    });
  });

  it("does not elevate platform-admin when membership is only member", () => {
    const store = makeStore({
      membership: makeMembership({
        id: "mem-member",
        membershipRole: "member",
      }),
    });
    const user = store.users["user-1"];
    const context: PlatformAuthSessionContext = {
      user,
      membership: null,
      enterprise: null,
      session: {
        provider: "trusted-proxy",
        user: user.email,
        displayName: user.displayName,
        role: user.role,
        scopes: [...user.scopes],
      },
      sessionKind: "platform-admin",
    };

    expect(resolveEnterpriseAdminSessionContext({ store, context })).toBeNull();
  });

  it("does not elevate member sessions", () => {
    const store = makeStore();
    const membership = makeMembership({
      id: "mem-member",
      membershipRole: "member",
    });
    store.memberships = { [membership.id]: membership };
    const user = store.users["user-1"];
    const enterprise = store.enterprises["ent-1"];
    const context: PlatformAuthSessionContext = {
      user,
      membership,
      enterprise,
      session: {
        provider: "trusted-proxy",
        user: user.email,
        displayName: user.displayName,
        membershipId: membership.id,
        enterpriseId: enterprise.id,
        tenantId: enterprise.id,
        role: user.role,
        scopes: [...user.scopes],
      },
      sessionKind: "member",
    };

    expect(resolveEnterpriseAdminSessionContext({ store, context })).toBeNull();
  });
});
