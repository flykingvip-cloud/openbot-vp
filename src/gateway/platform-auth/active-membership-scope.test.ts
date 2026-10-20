// Feature: shared-agent-identity-access-control-plane

import { describe, expect, it } from "vitest";
import { resolveAuthoritativeEnterpriseScope } from "./active-membership-scope.js";
import type { PlatformAuthStore } from "./store-types.js";

const canonicalize = (value: string | null | undefined): string | null =>
  value?.trim().toLowerCase() || null;

/**
 * `enterprise-b` is inserted before `enterprise-a` on purpose: a first-match
 * lookup over object order would hand this user the wrong tenant.
 */
const ENTERPRISES = {
  "enterprise-a": { id: "enterprise-a", status: "paid" },
  "enterprise-b": { id: "enterprise-b", status: "trial" },
  "enterprise-c": { id: "enterprise-c", status: "paid" },
};

function multiMembershipStore(): PlatformAuthStore {
  return {
    enterprises: ENTERPRISES,
    users: {
      "user-1": { id: "user-1", normalizedEmail: "member@example.com", status: "active" },
    },
    memberships: {
      "membership-b": {
        id: "membership-b",
        userId: "user-1",
        enterpriseId: "enterprise-b",
        membershipRole: "enterprise-admin",
      },
      "membership-a": {
        id: "membership-a",
        userId: "user-1",
        enterpriseId: "enterprise-a",
        membershipRole: "member",
      },
      "membership-other": {
        id: "membership-other",
        userId: "user-2",
        enterpriseId: "enterprise-c",
        membershipRole: "enterprise-admin",
      },
    },
  } as unknown as PlatformAuthStore;
}

/**
 * Same-enterprise duplicate: one user holds BOTH an enterprise-admin and a
 * member membership for the SAME enterprise (no cross-tenant ambiguity). The
 * admin row is listed first on purpose to prove the un-pinned representative is
 * chosen by least privilege ("member"), not by object order.
 */
function sameEnterpriseMultiMembershipStore(): PlatformAuthStore {
  return {
    enterprises: ENTERPRISES,
    users: {
      "user-1": { id: "user-1", normalizedEmail: "member@example.com", status: "active" },
    },
    memberships: {
      "membership-admin": {
        id: "membership-admin",
        userId: "user-1",
        enterpriseId: "enterprise-a",
        membershipRole: "enterprise-admin",
      },
      "membership-member": {
        id: "membership-member",
        userId: "user-1",
        enterpriseId: "enterprise-a",
        membershipRole: "member",
      },
    },
  } as unknown as PlatformAuthStore;
}

function singleMembershipStore(): PlatformAuthStore {
  return {
    enterprises: ENTERPRISES,
    users: {
      "user-1": { id: "user-1", normalizedEmail: "member@example.com", status: "active" },
    },
    memberships: {
      "membership-a": {
        id: "membership-a",
        userId: "user-1",
        enterpriseId: "enterprise-a",
        membershipRole: "enterprise-admin",
      },
    },
  } as unknown as PlatformAuthStore;
}

function platformOnlyStore(platformRole?: "admin" | "super-admin"): PlatformAuthStore {
  return {
    enterprises: ENTERPRISES,
    users: {
      "user-1": {
        id: "user-1",
        normalizedEmail: "ops@example.com",
        status: "active",
        ...(platformRole ? { platformRole } : {}),
      },
    },
    memberships: {},
  } as unknown as PlatformAuthStore;
}

/** Single-membership store with overridable user/enterprise lifecycle state. */
function lifecycleStore(overrides: {
  userStatus?: "active" | "suspended";
  enterpriseStatus?: "trial" | "paid" | "suspended" | "expired";
  omitEnterprise?: boolean;
}): PlatformAuthStore {
  return {
    enterprises: overrides.omitEnterprise
      ? {}
      : { "enterprise-a": { id: "enterprise-a", status: overrides.enterpriseStatus ?? "paid" } },
    users: {
      "user-1": {
        id: "user-1",
        normalizedEmail: "member@example.com",
        status: overrides.userStatus ?? "active",
      },
    },
    memberships: {
      "membership-a": {
        id: "membership-a",
        userId: "user-1",
        enterpriseId: "enterprise-a",
        membershipRole: "enterprise-admin",
      },
    },
  } as unknown as PlatformAuthStore;
}

describe("authoritative enterprise scope", () => {
  it("selects the session-pinned membership instead of the first stored one", () => {
    const result = resolveAuthoritativeEnterpriseScope({
      store: multiMembershipStore(),
      email: "member@example.com",
      sessionMembershipId: "membership-a",
      sessionEnterpriseId: "enterprise-a",
      canonicalize,
    });
    expect(result).toMatchObject({ kind: "authoritative", enterpriseId: "enterprise-a" });
  });

  it("fails closed for multiple memberships that span different enterprises", () => {
    // Pre-migration this returned the object-order first match (enterprise-b).
    // Different enterprises => a real cross-tenant ambiguity => still fail closed.
    expect(
      resolveAuthoritativeEnterpriseScope({
        store: multiMembershipStore(),
        email: "member@example.com",
        canonicalize,
      }),
    ).toEqual({ kind: "deny", reason: "membership-ambiguous" });
  });

  it("resolves same-enterprise duplicate memberships to that enterprise, picking the member role", () => {
    // Both memberships point to enterprise-a => no tenant to leak between, so the
    // enterprise is unambiguous even without a pinned session pair. The un-pinned
    // representative must be the least-privileged member (not the admin listed first).
    const result = resolveAuthoritativeEnterpriseScope({
      store: sameEnterpriseMultiMembershipStore(),
      email: "member@example.com",
      canonicalize,
    });
    expect(result).toMatchObject({
      kind: "authoritative",
      enterpriseId: "enterprise-a",
      membership: { id: "membership-member", membershipRole: "member" },
    });
  });

  it("still honors an explicit admin session pair for a same-enterprise duplicate", () => {
    // An explicit enterprise-admin login pins its admin membership and keeps admin
    // scope; only the un-pinned fallback is downgraded to member.
    expect(
      resolveAuthoritativeEnterpriseScope({
        store: sameEnterpriseMultiMembershipStore(),
        email: "member@example.com",
        sessionMembershipId: "membership-admin",
        sessionEnterpriseId: "enterprise-a",
        canonicalize,
      }),
    ).toMatchObject({
      kind: "authoritative",
      enterpriseId: "enterprise-a",
      membership: { id: "membership-admin", membershipRole: "enterprise-admin" },
    });
  });

  it("rejects a membership that belongs to a different user", () => {
    expect(
      resolveAuthoritativeEnterpriseScope({
        store: multiMembershipStore(),
        email: "member@example.com",
        sessionMembershipId: "membership-other",
        sessionEnterpriseId: "enterprise-c",
        canonicalize,
      }),
    ).toEqual({ kind: "deny", reason: "membership-unknown" });
  });

  it("rejects a pair whose enterprise no longer matches the membership", () => {
    expect(
      resolveAuthoritativeEnterpriseScope({
        store: multiMembershipStore(),
        email: "member@example.com",
        sessionMembershipId: "membership-a",
        sessionEnterpriseId: "enterprise-b",
        canonicalize,
      }),
    ).toEqual({ kind: "deny", reason: "membership-enterprise-mismatch" });
  });

  it("rejects a half-bound session context instead of guessing the other side", () => {
    expect(
      resolveAuthoritativeEnterpriseScope({
        store: multiMembershipStore(),
        email: "member@example.com",
        sessionMembershipId: "membership-a",
        canonicalize,
      }),
    ).toEqual({ kind: "deny", reason: "membership-unknown" });
    expect(
      resolveAuthoritativeEnterpriseScope({
        store: multiMembershipStore(),
        email: "member@example.com",
        sessionEnterpriseId: "enterprise-a",
        canonicalize,
      }),
    ).toEqual({ kind: "deny", reason: "membership-unknown" });
  });

  it("treats a requested tenant as an equality constraint only", () => {
    const store = multiMembershipStore();
    expect(
      resolveAuthoritativeEnterpriseScope({
        store,
        email: "member@example.com",
        sessionMembershipId: "membership-a",
        sessionEnterpriseId: "enterprise-a",
        requestedTenantId: "enterprise-a",
        canonicalize,
      }),
    ).toMatchObject({ kind: "authoritative", enterpriseId: "enterprise-a" });
    // A requested tenant must never move the caller to another enterprise.
    expect(
      resolveAuthoritativeEnterpriseScope({
        store,
        email: "member@example.com",
        sessionMembershipId: "membership-a",
        sessionEnterpriseId: "enterprise-a",
        requestedTenantId: "enterprise-b",
        canonicalize,
      }),
    ).toEqual({ kind: "deny", reason: "requested-tenant-mismatch" });
  });

  it("keeps the unambiguous legacy single-membership path working", () => {
    expect(
      resolveAuthoritativeEnterpriseScope({
        store: singleMembershipStore(),
        email: "member@example.com",
        canonicalize,
      }),
    ).toMatchObject({ kind: "authoritative", enterpriseId: "enterprise-a" });
  });

  it("reports a platform account without memberships separately from a denial", () => {
    expect(
      resolveAuthoritativeEnterpriseScope({
        store: platformOnlyStore(),
        email: "ops@example.com",
        canonicalize,
      }),
    ).toMatchObject({ kind: "no-enterprise-membership" });
  });

  // Unknown vs absent callers are asserted in "fallback eligibility signals",
  // which also pins the `claimedIdentity` distinction the Billing gate relies on.
});

describe("request-time lifecycle revalidation", () => {
  const pair = {
    sessionMembershipId: "membership-a",
    sessionEnterpriseId: "enterprise-a",
  } as const;

  it("denies a suspended user even with a valid session pair", () => {
    expect(
      resolveAuthoritativeEnterpriseScope({
        store: lifecycleStore({ userStatus: "suspended" }),
        email: "member@example.com",
        ...pair,
        canonicalize,
      }),
    ).toEqual({ kind: "deny", reason: "user-inactive" });
  });

  it("denies a suspended enterprise even with a valid session pair", () => {
    expect(
      resolveAuthoritativeEnterpriseScope({
        store: lifecycleStore({ enterpriseStatus: "suspended" }),
        email: "member@example.com",
        ...pair,
        canonicalize,
      }),
    ).toEqual({ kind: "deny", reason: "enterprise-unavailable" });
  });

  it("denies an expired enterprise", () => {
    expect(
      resolveAuthoritativeEnterpriseScope({
        store: lifecycleStore({ enterpriseStatus: "expired" }),
        email: "member@example.com",
        ...pair,
        canonicalize,
      }),
    ).toEqual({ kind: "deny", reason: "enterprise-unavailable" });
  });

  it("denies a membership whose enterprise record no longer exists", () => {
    expect(
      resolveAuthoritativeEnterpriseScope({
        store: lifecycleStore({ omitEnterprise: true }),
        email: "member@example.com",
        ...pair,
        canonicalize,
      }),
    ).toEqual({ kind: "deny", reason: "enterprise-unavailable" });
  });

  it("applies the same revalidation to the legacy unique-membership path", () => {
    expect(
      resolveAuthoritativeEnterpriseScope({
        store: lifecycleStore({ userStatus: "suspended" }),
        email: "member@example.com",
        canonicalize,
      }),
    ).toEqual({ kind: "deny", reason: "user-inactive" });
    expect(
      resolveAuthoritativeEnterpriseScope({
        store: lifecycleStore({ enterpriseStatus: "suspended" }),
        email: "member@example.com",
        canonicalize,
      }),
    ).toEqual({ kind: "deny", reason: "enterprise-unavailable" });
  });
});

describe("fallback eligibility signals", () => {
  it("marks a plain account without memberships as not a platform operator", () => {
    expect(
      resolveAuthoritativeEnterpriseScope({
        store: platformOnlyStore(),
        email: "ops@example.com",
        canonicalize,
      }),
    ).toMatchObject({ kind: "no-enterprise-membership", isPlatformOperator: false });
  });

  it("marks a platform admin without memberships as a platform operator", () => {
    expect(
      resolveAuthoritativeEnterpriseScope({
        store: platformOnlyStore("admin"),
        email: "ops@example.com",
        canonicalize,
      }),
    ).toMatchObject({ kind: "no-enterprise-membership", isPlatformOperator: true });
  });

  it("separates an unknown claimed identity from having no identity at all", () => {
    expect(
      resolveAuthoritativeEnterpriseScope({
        store: singleMembershipStore(),
        email: "stranger@example.com",
        canonicalize,
      }),
    ).toEqual({ kind: "no-platform-identity", claimedIdentity: true });
    expect(
      resolveAuthoritativeEnterpriseScope({
        store: singleMembershipStore(),
        email: null,
        canonicalize,
      }),
    ).toEqual({ kind: "no-platform-identity", claimedIdentity: false });
  });
});
