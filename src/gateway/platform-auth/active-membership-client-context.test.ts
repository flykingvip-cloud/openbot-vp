// Feature: shared-agent-identity-access-control-plane

import { describe, expect, it } from "vitest";
import {
  resolveAuthoritativeClientMembershipContext,
  resolveClientSessionIdentity,
} from "./active-membership-client-context.js";
import type { PlatformAuthTrustedProxySession } from "./store-types.js";

function session(
  overrides: Partial<PlatformAuthTrustedProxySession>,
): PlatformAuthTrustedProxySession {
  return {
    provider: "trusted-proxy",
    user: "employee@example.com",
    ...overrides,
  };
}

describe("authoritative client membership context", () => {
  it("propagates the validated membership and enterprise pair", () => {
    expect(
      resolveAuthoritativeClientMembershipContext(
        session({
          membershipId: "membership-a",
          enterpriseId: "enterprise-a",
          tenantId: "enterprise-a",
        }),
      ),
    ).toEqual({ sessionMembershipId: "membership-a", sessionEnterpriseId: "enterprise-a" });
  });

  it("exposes nothing for an unbound platform session", () => {
    expect(resolveAuthoritativeClientMembershipContext(session({ domain: "platform" }))).toEqual(
      {},
    );
  });

  it("fails closed when only one side of the pair is present", () => {
    expect(
      resolveAuthoritativeClientMembershipContext(session({ membershipId: "membership-a" })),
    ).toEqual({});
    expect(
      resolveAuthoritativeClientMembershipContext(session({ enterpriseId: "enterprise-a" })),
    ).toEqual({});
  });

  it("does not let a tenant hint alone establish authoritative context", () => {
    expect(
      resolveAuthoritativeClientMembershipContext(session({ tenantId: "enterprise-a" })),
    ).toEqual({});
  });

  it("treats blank pair values as absent", () => {
    expect(
      resolveAuthoritativeClientMembershipContext(
        session({ membershipId: "  ", enterpriseId: "enterprise-a" }),
      ),
    ).toEqual({});
  });

  it("trims stored pair values", () => {
    expect(
      resolveAuthoritativeClientMembershipContext(
        session({ membershipId: " membership-a ", enterpriseId: " enterprise-a " }),
      ),
    ).toEqual({ sessionMembershipId: "membership-a", sessionEnterpriseId: "enterprise-a" });
  });

  it("exposes nothing when there is no session at all", () => {
    expect(resolveAuthoritativeClientMembershipContext(null)).toEqual({});
    expect(resolveAuthoritativeClientMembershipContext(undefined)).toEqual({});
  });
});

describe("client session identity block", () => {
  it("preserves the validated platform session kind for governance audit", () => {
    expect(
      resolveClientSessionIdentity(
        session({ domain: "platform", sessionKind: "platform-super-admin" }),
      ),
    ).toMatchObject({
      sessionDomain: "platform",
      sessionKind: "platform-super-admin",
    });
  });

  it("carries user, domain and the authoritative pair for a scoped session", () => {
    expect(
      resolveClientSessionIdentity(
        session({
          domain: "employee",
          membershipId: "membership-a",
          enterpriseId: "enterprise-a",
          tenantId: "enterprise-a",
        }),
      ),
    ).toEqual({
      user: "employee@example.com",
      sessionDomain: "employee",
      sessionMembershipId: "membership-a",
      sessionEnterpriseId: "enterprise-a",
      sessionTenantId: "enterprise-a",
    });
  });

  it("keeps a tenant hint without granting authoritative context", () => {
    // A trusted-proxy header-only session has a tenant hint but no validated
    // pair; consumers must not be able to treat the hint as authority.
    const identity = resolveClientSessionIdentity(
      session({ domain: "enterprise", tenantId: "enterprise-a" }),
    );
    expect(identity.sessionTenantId).toBe("enterprise-a");
    expect(identity.sessionMembershipId).toBeUndefined();
    expect(identity.sessionEnterpriseId).toBeUndefined();
  });

  it("does not let a mismatched tenant hint overwrite the authoritative pair", () => {
    expect(
      resolveClientSessionIdentity(
        session({
          membershipId: "membership-a",
          enterpriseId: "enterprise-a",
          tenantId: "enterprise-b",
        }),
      ),
    ).toMatchObject({
      sessionMembershipId: "membership-a",
      sessionEnterpriseId: "enterprise-a",
      sessionTenantId: "enterprise-b",
    });
  });

  it("drops a half-bound pair from the identity block", () => {
    const identity = resolveClientSessionIdentity(
      session({ domain: "enterprise", enterpriseId: "enterprise-a" }),
    );
    expect(identity.sessionMembershipId).toBeUndefined();
    expect(identity.sessionEnterpriseId).toBeUndefined();
    expect(identity.sessionDomain).toBe("enterprise");
  });

  it("returns an empty identity when the connection has no validated session", () => {
    expect(resolveClientSessionIdentity(null)).toEqual({});
    expect(resolveClientSessionIdentity(undefined)).toEqual({});
  });
});
