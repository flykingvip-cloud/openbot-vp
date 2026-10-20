/** Task: conversation-identity-context-convergence */
import { describe, expect, it } from "vitest";
import {
  EXECUTION_IDENTITY_INHERIT_KEYS,
  createExecutionIdentityContext,
  createExecutionIdentityFromGatewayAuth,
  createExecutionIdentityFromGatewayClient,
  describeExecutionIdentityPresence,
  hasAuthenticatedIdentity,
  hasPinnedEmployeeSessionContext,
  inheritExecutionIdentityRunFields,
  pickExecutionIdentityRunFields,
  refineExecutionIdentityContext,
  resolveExecutionIdentityFromRunFields,
  toRestrictedGatewayClient,
  toTrustedGatewayClientFields,
} from "./execution-identity-context.js";

describe("createExecutionIdentityContext", () => {
  it("preserves absence as absence instead of inventing empty values", () => {
    const context = createExecutionIdentityContext({
      user: "   ",
      platformUserId: null,
      enterpriseId: "",
    });
    expect(context).toEqual({});
    expect("user" in context).toBe(false);
    expect("enterpriseId" in context).toBe(false);
  });

  it("freezes an authenticated employee turn with tenant and membership", () => {
    const context = createExecutionIdentityContext({
      user: " Employee@Acme.example ",
      platformUserId: " emp-1 ",
      sessionDomain: "employee",
      enterpriseId: " 001 ",
      membershipId: " mem-1 ",
      agentId: "main",
      sessionKey: "agent:main:employee:emp-1",
    });
    expect(context.user).toBe("Employee@Acme.example");
    expect(context.platformUserId).toBe("emp-1");
    expect(context.enterpriseId).toBe("001");
    expect(context.membershipId).toBe("mem-1");
    expect(Object.isFrozen(context)).toBe(true);
  });

  it("keeps collaboration owner entitlement explicit and separate from the speaker", () => {
    const context = createExecutionIdentityContext({
      user: "member@acme.example",
      platformUserId: "emp-member",
      sessionDomain: "employee",
      collaborationGroupId: "grp-1",
      collaborationOwnerEntitlement: {
        tenantId: "001",
        seatId: "seat-owner",
        employeeId: "emp-owner",
      },
    });
    // The speaking member's identity is untouched; the owner entitlement is an extra field.
    expect(context.platformUserId).toBe("emp-member");
    expect(context.seatId).toBeUndefined();
    expect(context.collaborationOwnerEntitlement).toEqual({
      tenantId: "001",
      seatId: "seat-owner",
      employeeId: "emp-owner",
    });
  });

  it("drops a half-formed collaboration entitlement rather than binding a partial seat", () => {
    const context = createExecutionIdentityContext({
      user: "member@acme.example",
      collaborationOwnerEntitlement: { tenantId: "001", seatId: "  " },
    });
    expect(context.collaborationOwnerEntitlement).toBeUndefined();
  });

  it("builds an enterprise-domain context without an employee platform user", () => {
    const context = createExecutionIdentityContext({
      user: "admin@acme.example",
      sessionDomain: "enterprise",
      enterpriseId: "001",
      membershipId: "mem-admin",
    });
    expect(context.sessionDomain).toBe("enterprise");
    expect(hasAuthenticatedIdentity(context)).toBe(true);
  });

  it("builds a platform-domain context with no tenant binding", () => {
    const context = createExecutionIdentityContext({
      user: "ops@openbot.example",
      sessionDomain: "platform",
    });
    expect(context.enterpriseId).toBeUndefined();
    expect(context.membershipId).toBeUndefined();
  });
});

describe("hasAuthenticatedIdentity", () => {
  it("is false for a no-identity background context", () => {
    expect(hasAuthenticatedIdentity(createExecutionIdentityContext({ agentId: "bot--a" }))).toBe(
      false,
    );
    expect(hasAuthenticatedIdentity(null)).toBe(false);
  });

  it("is true when either email or platform user id is present", () => {
    expect(hasAuthenticatedIdentity(createExecutionIdentityContext({ user: "a@b.c" }))).toBe(true);
    expect(
      hasAuthenticatedIdentity(createExecutionIdentityContext({ platformUserId: "emp-1" })),
    ).toBe(true);
  });
});

describe("hasPinnedEmployeeSessionContext", () => {
  it("is false for a cron/owner email without pinned tenant or membership", () => {
    expect(
      hasPinnedEmployeeSessionContext({
        user: "owner@acme.example",
        platformUserId: "owner-1",
        sessionDomain: "employee",
      }),
    ).toBe(false);
  });

  it("is true for an authenticated employee webchat with a pinned membership pair", () => {
    expect(
      hasPinnedEmployeeSessionContext({
        user: "employee@acme.example",
        platformUserId: "emp-1",
        sessionDomain: "employee",
        sessionEnterpriseId: "001",
        sessionMembershipId: "mem-1",
      }),
    ).toBe(true);
  });
});

describe("toRestrictedGatewayClient", () => {
  it("returns null without an authenticated identity so callers stay fail-closed", () => {
    expect(
      toRestrictedGatewayClient(createExecutionIdentityContext({ agentId: "bot--a" })),
    ).toBeNull();
    expect(toRestrictedGatewayClient(null)).toBeNull();
  });

  it("carries tenant and membership onto the restricted client view", () => {
    const client = toRestrictedGatewayClient(
      createExecutionIdentityContext({
        user: "employee@acme.example",
        platformUserId: "emp-1",
        sessionDomain: "employee",
        enterpriseId: "001",
        membershipId: "mem-1",
      }),
    );
    expect(client?.user).toBe("employee@acme.example");
    expect(client?.platformUserId).toBe("emp-1");
    expect(client?.sessionEnterpriseId).toBe("001");
    expect(client?.sessionTenantId).toBe("001");
    expect(client?.sessionMembershipId).toBe("mem-1");
  });

  it("never leaks seat, agent, group, or entitlement into the client view", () => {
    const client = toRestrictedGatewayClient(
      createExecutionIdentityContext({
        user: "employee@acme.example",
        seatId: "seat-1",
        agentId: "main",
        collaborationGroupId: "grp-1",
        collaborationOwnerEntitlement: { tenantId: "001", seatId: "seat-owner" },
      }),
    );
    expect(client).not.toHaveProperty("seatId");
    expect(client).not.toHaveProperty("agentId");
    expect(client).not.toHaveProperty("collaborationGroupId");
    expect(client).not.toHaveProperty("collaborationOwnerEntitlement");
  });
});

describe("refineExecutionIdentityContext", () => {
  it("adds fields forward-only and never blanks an existing one", () => {
    const base = createExecutionIdentityContext({
      user: "employee@acme.example",
      platformUserId: "emp-1",
      enterpriseId: "001",
      membershipId: "mem-1",
    });
    const refined = refineExecutionIdentityContext(base, {
      seatId: "seat-1",
      enterpriseId: undefined,
    });
    expect(refined.enterpriseId).toBe("001");
    expect(refined.membershipId).toBe("mem-1");
    expect(refined.seatId).toBe("seat-1");
  });

  it("works from an absent base", () => {
    const refined = refineExecutionIdentityContext(null, { agentId: "bot--a" });
    expect(refined.agentId).toBe("bot--a");
    expect(hasAuthenticatedIdentity(refined)).toBe(false);
  });
});

describe("resolveExecutionIdentityFromRunFields", () => {
  it("prefers the canonical object over parallel scalar leftovers", () => {
    const context = resolveExecutionIdentityFromRunFields({
      executionIdentity: createExecutionIdentityContext({
        user: "employee@acme.example",
        enterpriseId: "001",
        membershipId: "mem-1",
      }),
      gatewayClientUser: "stale@example.com",
      gatewayClientSessionEnterpriseId: "stale-tenant",
    });
    expect(context.user).toBe("employee@acme.example");
    expect(context.enterpriseId).toBe("001");
    expect(context.membershipId).toBe("mem-1");
  });

  it("fills from transitional scalars when no canonical object was supplied", () => {
    const context = resolveExecutionIdentityFromRunFields({
      gatewayClientUser: "employee@acme.example",
      gatewayClientPlatformUserId: "emp-1",
      gatewayClientSessionDomain: "employee",
      gatewayClientSessionEnterpriseId: "001",
      gatewayClientSessionMembershipId: "mem-1",
      agentId: "main",
      sessionKey: "agent:main:employee:emp-1",
    });
    expect(context).toMatchObject({
      user: "employee@acme.example",
      platformUserId: "emp-1",
      sessionDomain: "employee",
      enterpriseId: "001",
      membershipId: "mem-1",
      agentId: "main",
    });
  });
});

describe("inheritExecutionIdentityRunFields", () => {
  it("re-emits trusted scalars from the frozen object so a reconstruct hop cannot drop pins", () => {
    const executionIdentity = createExecutionIdentityContext({
      user: "steward@acme.example",
      platformUserId: "emp-ops",
      sessionDomain: "employee",
      enterpriseId: "001",
      membershipId: "mem-ops",
      agentId: "ops-bot",
    });
    const inherited = inheritExecutionIdentityRunFields({ executionIdentity });
    expect(inherited.executionIdentity).toBe(executionIdentity);
    expect(inherited.gatewayClientUser).toBe("steward@acme.example");
    expect(inherited.gatewayClientSessionDomain).toBe("employee");
    expect(inherited.gatewayClientPlatformUserId).toBe("emp-ops");
    expect(inherited.gatewayClientSessionEnterpriseId).toBe("001");
    expect(inherited.gatewayClientSessionMembershipId).toBe("mem-ops");
    for (const key of EXECUTION_IDENTITY_INHERIT_KEYS) {
      expect(inherited).toHaveProperty(key);
    }
  });

  it("freezes a canonical object from scalars when the object was not yet present", () => {
    const inherited = inheritExecutionIdentityRunFields({
      gatewayClientUser: "steward@acme.example",
      gatewayClientSessionDomain: "employee",
      gatewayClientPlatformUserId: "emp-ops",
      gatewayClientSessionEnterpriseId: "001",
      gatewayClientSessionMembershipId: "mem-ops",
    });
    expect(inherited.executionIdentity?.enterpriseId).toBe("001");
    expect(inherited.executionIdentity?.membershipId).toBe("mem-ops");
    expect(inherited.executionIdentity?.agentId).toBeUndefined();
    expect(inherited.gatewayClientSessionEnterpriseId).toBe("001");
  });

  it("stays empty when the source had no authenticated identity", () => {
    expect(inheritExecutionIdentityRunFields({})).toEqual({});
    expect(inheritExecutionIdentityRunFields({ agentId: "ops-bot" })).toEqual({});
    expect(pickExecutionIdentityRunFields(null)).toEqual({});
  });
});

describe("createExecutionIdentityFromGatewayClient", () => {
  it("freezes the authenticated client pin pair without inventing a robot id", () => {
    const identity = createExecutionIdentityFromGatewayClient(
      {
        user: "steward@acme.example",
        platformUserId: "emp-ops",
        sessionDomain: "employee",
        sessionEnterpriseId: "001",
        sessionMembershipId: "mem-ops",
      },
      { agentId: "ops-bot", sessionKey: "agent:ops-bot:employee:emp-ops" },
    );
    expect(identity.enterpriseId).toBe("001");
    expect(identity.membershipId).toBe("mem-ops");
    expect(identity.agentId).toBe("ops-bot");
  });
});

describe("createExecutionIdentityFromGatewayAuth", () => {
  it("reads tenant and membership from the trusted-proxy session, not the request body", () => {
    const identity = createExecutionIdentityFromGatewayAuth({
      user: "steward@acme.example",
      trustedProxy: {
        user: "steward@acme.example",
        domain: "employee",
        enterpriseId: "001",
        membershipId: "mem-ops",
      },
    });
    expect(identity.user).toBe("steward@acme.example");
    expect(identity.sessionDomain).toBe("employee");
    expect(identity.enterpriseId).toBe("001");
    expect(identity.membershipId).toBe("mem-ops");
  });
});

describe("toTrustedGatewayClientFields", () => {
  it("exposes only the trusted client scalars, never seat or entitlement", () => {
    const fields = toTrustedGatewayClientFields(
      createExecutionIdentityContext({
        user: "employee@acme.example",
        platformUserId: "emp-1",
        sessionDomain: "employee",
        enterpriseId: "001",
        membershipId: "mem-1",
        seatId: "seat-1",
        agentId: "main",
        collaborationOwnerEntitlement: { tenantId: "001", seatId: "seat-owner" },
      }),
    );
    expect(fields).toEqual({
      gatewayClientUser: "employee@acme.example",
      gatewayClientPlatformUserId: "emp-1",
      gatewayClientSessionDomain: "employee",
      gatewayClientSessionEnterpriseId: "001",
      gatewayClientSessionMembershipId: "mem-1",
    });
  });
});

describe("describeExecutionIdentityPresence", () => {
  it("reports presence only and never the values themselves", () => {
    const presence = describeExecutionIdentityPresence(
      createExecutionIdentityContext({
        user: "employee@acme.example",
        platformUserId: "emp-1",
        sessionDomain: "employee",
        enterpriseId: "001",
        membershipId: "mem-1",
      }),
    );
    expect(presence).toEqual({
      user: true,
      platformUserId: true,
      sessionDomain: "employee",
      tenant: true,
      membership: true,
      seat: false,
      agent: false,
      collaborationOwner: false,
    });
    expect(JSON.stringify(presence)).not.toContain("acme.example");
    expect(JSON.stringify(presence)).not.toContain("mem-1");
  });
});
