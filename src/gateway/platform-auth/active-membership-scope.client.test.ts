// Feature: shared-agent-identity-access-control-plane

import { describe, expect, it } from "vitest";
import { resolveAuthoritativeEnterpriseScopeForClient } from "./active-membership-scope.js";
import type { PlatformAuthStore } from "./store-types.js";

const canonicalize = (value: string | null | undefined): string | null =>
  value?.trim().toLowerCase() || null;

/** `ent-b` is stored before `ent-a` so a first-match lookup picks the wrong tenant. */
function multiMembershipStore(): PlatformAuthStore {
  return {
    enterprises: {
      "ent-a": { id: "ent-a", status: "paid" },
      "ent-b": { id: "ent-b", status: "paid" },
    },
    users: {
      "user-1": { id: "user-1", normalizedEmail: "member@example.com", status: "active" },
    },
    memberships: {
      "membership-b": {
        id: "membership-b",
        userId: "user-1",
        enterpriseId: "ent-b",
        membershipRole: "member",
      },
      "membership-a": {
        id: "membership-a",
        userId: "user-1",
        enterpriseId: "ent-a",
        membershipRole: "enterprise-admin",
      },
    },
  } as unknown as PlatformAuthStore;
}

describe("client-facing authoritative scope resolution", () => {
  it("uses the validated session pair rather than the first stored membership", () => {
    expect(
      resolveAuthoritativeEnterpriseScopeForClient({
        store: multiMembershipStore(),
        client: {
          user: "Member@Example.com",
          sessionMembershipId: "membership-a",
          sessionEnterpriseId: "ent-a",
        },
        canonicalize,
      }),
    ).toMatchObject({ kind: "authoritative", enterpriseId: "ent-a" });
  });

  it("fails closed for a multi-membership client with no session pair", () => {
    expect(
      resolveAuthoritativeEnterpriseScopeForClient({
        store: multiMembershipStore(),
        client: { user: "member@example.com" },
        canonicalize,
      }),
    ).toEqual({ kind: "deny", reason: "membership-ambiguous" });
  });

  it("normalizes the login email before lookup", () => {
    const store = multiMembershipStore();
    delete (store.memberships as Record<string, unknown>)["membership-b"];
    expect(
      resolveAuthoritativeEnterpriseScopeForClient({
        store,
        client: { user: "  MEMBER@EXAMPLE.COM  " },
        canonicalize,
      }),
    ).toMatchObject({ kind: "authoritative", enterpriseId: "ent-a" });
  });

  it("reports no identity for a client without a user", () => {
    expect(
      resolveAuthoritativeEnterpriseScopeForClient({
        store: multiMembershipStore(),
        client: null,
        canonicalize,
      }),
    ).toEqual({ kind: "no-platform-identity", claimedIdentity: false });
    expect(
      resolveAuthoritativeEnterpriseScopeForClient({
        store: multiMembershipStore(),
        client: { user: "   " },
        canonicalize,
      }),
    ).toEqual({ kind: "no-platform-identity", claimedIdentity: false });
  });

  it("still applies the requested-tenant equality constraint", () => {
    expect(
      resolveAuthoritativeEnterpriseScopeForClient({
        store: multiMembershipStore(),
        client: {
          user: "member@example.com",
          sessionMembershipId: "membership-a",
          sessionEnterpriseId: "ent-a",
        },
        requestedTenantId: "ent-b",
        canonicalize,
      }),
    ).toEqual({ kind: "deny", reason: "requested-tenant-mismatch" });
  });
});
