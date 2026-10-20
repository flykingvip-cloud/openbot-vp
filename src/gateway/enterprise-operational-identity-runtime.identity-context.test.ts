/**
 * Task: conversation-identity-context-convergence
 *
 * WP4 negative authorization matrix for Seat-bound operational identity scope.
 * Asserts resolved scope (or typed denial), never just tool return text.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnterpriseDataStoreError } from "./enterprise-data/connector-action-store.js";
import type { GatewayClient } from "./server-methods/types.js";

const resolveTrustedEnterpriseDataExecutionContextMock = vi.hoisted(() => vi.fn());
const loadEnterpriseSeatAssetsStoreMock = vi.hoisted(() => vi.fn());

vi.mock("./enterprise-data/enterprise-data-seat-context.js", () => ({
  resolveTrustedEnterpriseDataExecutionContext: (...args: unknown[]) =>
    resolveTrustedEnterpriseDataExecutionContextMock(...args),
}));

vi.mock("./enterprise-seat-assets-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./enterprise-seat-assets-store.js")>();
  return {
    ...actual,
    loadEnterpriseSeatAssetsStore: (...args: unknown[]) =>
      loadEnterpriseSeatAssetsStoreMock(...args),
  };
});

vi.mock("./tenant-context.js", () => ({
  TenantContextError: class TenantContextError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  resolveControlPlaneStorePathForClient: vi.fn(async () => undefined),
  resolveControlPlaneStorePathForTenantId: vi.fn(() => undefined),
}));

const {
  resolveOperationalIdentityRuntimeScopeDecision,
  resolveOperationalIdentityRuntimeScope,
  enrollEmployeeEnterpriseIdentity,
} = await import("./enterprise-operational-identity-runtime.js");

const NOW = "2026-09-21T08:00:00.000Z";

function enrollmentStore(overrides?: {
  extraEnrollment?: boolean;
  extraTenantEnrollment?: boolean;
}) {
  return {
    seats: {
      "seat-1": {
        seatId: "seat-1",
        tenantId: "001",
        title: "管理层",
        status: "occupied",
        currentEmployeeId: "emp-1",
        defaultSpaceIds: [],
        defaultAgentAssetIds: ["bot--agent"],
        createdAt: NOW,
        updatedAt: NOW,
      },
      "seat-owner": {
        seatId: "seat-owner",
        tenantId: "001",
        title: "群主",
        status: "occupied",
        currentEmployeeId: "emp-owner",
        defaultSpaceIds: [],
        defaultAgentAssetIds: ["bot--agent"],
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    bindings: {
      "bind-1": {
        bindingId: "bind-1",
        tenantId: "001",
        seatId: "seat-1",
        employeeId: "emp-1",
        bindingStatus: "active",
        effectiveAt: NOW,
      },
    },
    enterpriseIdentities: {},
    identityUsagePolicies: {},
    employeeIdentityEnrollments: {
      "enroll-1": {
        enrollmentId: "enroll-1",
        tenantId: "001",
        employeeId: "emp-1",
        agentId: "bot--agent",
        identityId: "id-tm",
        allowedActions: ["list_meetings"],
        createdAt: NOW,
        updatedAt: NOW,
      },
      ...(overrides?.extraEnrollment
        ? {
            "enroll-2": {
              enrollmentId: "enroll-2",
              tenantId: "001",
              employeeId: "emp-2",
              agentId: "bot--agent",
              identityId: "id-tm",
              allowedActions: ["list_meetings"],
              createdAt: NOW,
              updatedAt: NOW,
            },
          }
        : {}),
      ...(overrides?.extraTenantEnrollment
        ? {
            "enroll-3": {
              enrollmentId: "enroll-3",
              tenantId: "002",
              employeeId: "emp-1",
              agentId: "bot--agent",
              identityId: "id-tm",
              allowedActions: ["list_meetings"],
              createdAt: NOW,
              updatedAt: NOW,
            },
          }
        : {}),
    },
    credentialBindings: {},
    connectorProfiles: {},
    seatAssets: {},
    assetBindings: {},
    auditEvents: {},
    offers: {},
  };
}

function employeeClient(): GatewayClient {
  return {
    connect: {} as GatewayClient["connect"],
    user: "employee@acme.example",
    platformUserId: "emp-1",
    sessionDomain: "employee",
    sessionEnterpriseId: "001",
    sessionMembershipId: "mem-1",
  };
}

/** Cron/knowledge owner lookup: email present, no pinned membership/enterprise. */
function cronOwnerClient(): GatewayClient {
  return {
    connect: {} as GatewayClient["connect"],
    user: "owner@acme.example",
    platformUserId: "owner-1",
    sessionDomain: "employee",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadEnterpriseSeatAssetsStoreMock.mockResolvedValue(enrollmentStore());
});

describe("resolveOperationalIdentityRuntimeScopeDecision identity context", () => {
  it("resolves tenant/seat/agent from a valid authenticated employee", async () => {
    resolveTrustedEnterpriseDataExecutionContextMock.mockResolvedValue({
      tenantId: "001",
      seatId: "seat-1",
      employeeId: "emp-1",
      agentId: "bot--agent",
    });
    const decision = await resolveOperationalIdentityRuntimeScopeDecision(employeeClient(), {
      agentId: "bot--agent",
    });
    expect(decision).toEqual({
      ok: true,
      source: "employee",
      scope: {
        tenantId: "001",
        seatId: "seat-1",
        agentId: "bot--agent",
        employeeId: "emp-1",
      },
    });
  });

  it("returns NO_CURRENT_SEAT when the employee has no seat", async () => {
    resolveTrustedEnterpriseDataExecutionContextMock.mockRejectedValue(
      new EnterpriseDataStoreError("NO_CURRENT_SEAT", "Active seat binding not found."),
    );
    const decision = await resolveOperationalIdentityRuntimeScopeDecision(employeeClient(), {
      agentId: "bot--agent",
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe("NO_CURRENT_SEAT");
      expect(decision.message).not.toMatch(/environment variable/i);
    }
  });

  it("does not revive NO_SEAT_CONTEXT from leftover store errors or message text", async () => {
    resolveTrustedEnterpriseDataExecutionContextMock.mockRejectedValue(
      new EnterpriseDataStoreError("NO_SEAT_CONTEXT", "Active seat binding not found."),
    );
    const leftover = await resolveOperationalIdentityRuntimeScopeDecision(employeeClient(), {
      agentId: "bot--agent",
    });
    expect(leftover.ok).toBe(false);
    if (!leftover.ok) {
      expect(leftover.code).toBe("MEMBERSHIP_INVALID");
      expect(leftover.code).not.toBe("NO_SEAT_CONTEXT");
      expect(leftover.code).not.toBe("NO_CURRENT_SEAT");
    }

    resolveTrustedEnterpriseDataExecutionContextMock.mockRejectedValue(
      new Error("Enterprise membership tenant mismatch."),
    );
    const fromMessage = await resolveOperationalIdentityRuntimeScopeDecision(employeeClient(), {
      agentId: "bot--agent",
    });
    expect(fromMessage.ok).toBe(false);
    if (!fromMessage.ok) {
      expect(fromMessage.code).toBe("MEMBERSHIP_INVALID");
      expect(fromMessage.code).not.toBe("TENANT_MISMATCH");
    }
  });

  it("fails closed on suspended membership and does not use enrollment fallback", async () => {
    resolveTrustedEnterpriseDataExecutionContextMock.mockRejectedValue(
      new EnterpriseDataStoreError("MEMBERSHIP_INVALID", "Enterprise membership is inactive."),
    );
    const decision = await resolveOperationalIdentityRuntimeScopeDecision(employeeClient(), {
      agentId: "bot--agent",
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe("MEMBERSHIP_INVALID");
    }
    expect(resolveTrustedEnterpriseDataExecutionContextMock).toHaveBeenCalled();
  });

  it("fails closed on wrong tenant and does not use enrollment fallback", async () => {
    resolveTrustedEnterpriseDataExecutionContextMock.mockRejectedValue(
      new EnterpriseDataStoreError("TENANT_MISMATCH", "Enterprise membership tenant mismatch."),
    );
    const decision = await resolveOperationalIdentityRuntimeScopeDecision(employeeClient(), {
      agentId: "bot--agent",
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe("TENANT_MISMATCH");
    }
  });

  it("fails closed on missing tenant context and does not use enrollment fallback", async () => {
    resolveTrustedEnterpriseDataExecutionContextMock.mockRejectedValue(
      new EnterpriseDataStoreError(
        "TENANT_CONTEXT_MISSING",
        "Enterprise tenant context is missing.",
      ),
    );
    const decision = await resolveOperationalIdentityRuntimeScopeDecision(employeeClient(), {
      agentId: "bot--agent",
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe("TENANT_CONTEXT_MISSING");
      expect(decision.message).not.toMatch(/environment variable/i);
    }
  });

  it("returns AGENT_NOT_ENROLLED when the employee seat has no agent id", async () => {
    resolveTrustedEnterpriseDataExecutionContextMock.mockResolvedValue({
      tenantId: "001",
      seatId: "seat-1",
      employeeId: "emp-1",
      agentId: "",
    });
    const decision = await resolveOperationalIdentityRuntimeScopeDecision(employeeClient(), {});
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe("AGENT_NOT_ENROLLED");
    }
  });

  it("uses collaboration owner seat instead of the speaking member seat", async () => {
    resolveTrustedEnterpriseDataExecutionContextMock.mockResolvedValue({
      tenantId: "001",
      seatId: "seat-1",
      employeeId: "emp-1",
      agentId: "bot--agent",
    });
    const decision = await resolveOperationalIdentityRuntimeScopeDecision(employeeClient(), {
      agentId: "bot--agent",
      collaborationOwnerEntitlement: {
        tenantId: "001",
        seatId: "seat-owner",
        employeeId: "emp-owner",
      },
    });
    expect(decision).toEqual({
      ok: true,
      source: "collaboration-owner",
      scope: {
        tenantId: "001",
        seatId: "seat-owner",
        agentId: "bot--agent",
        employeeId: "emp-owner",
      },
    });
  });

  it("does not substitute owner entitlement after an invalid employee context", async () => {
    resolveTrustedEnterpriseDataExecutionContextMock.mockRejectedValue(
      new EnterpriseDataStoreError("MEMBERSHIP_INVALID", "Enterprise membership is inactive."),
    );
    const decision = await resolveOperationalIdentityRuntimeScopeDecision(employeeClient(), {
      agentId: "bot--agent",
      collaborationOwnerEntitlement: {
        tenantId: "001",
        seatId: "seat-owner",
        employeeId: "emp-owner",
      },
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe("MEMBERSHIP_INVALID");
    }
  });

  it("allows unique enrollment for a cron/owner-user without pinned employee membership", async () => {
    resolveTrustedEnterpriseDataExecutionContextMock.mockRejectedValue(
      new EnterpriseDataStoreError("MEMBERSHIP_INVALID", "Enterprise membership not found."),
    );
    const decision = await resolveOperationalIdentityRuntimeScopeDecision(cronOwnerClient(), {
      agentId: "bot--agent",
    });
    expect(decision).toEqual({
      ok: true,
      source: "enrollment",
      scope: {
        tenantId: "001",
        seatId: "seat-1",
        agentId: "bot--agent",
        employeeId: "emp-1",
      },
    });
    expect(resolveTrustedEnterpriseDataExecutionContextMock).not.toHaveBeenCalled();
  });

  it("does not treat a cron/owner-user as MEMBERSHIP_INVALID when enrollment is ambiguous", async () => {
    loadEnterpriseSeatAssetsStoreMock.mockResolvedValue(enrollmentStore({ extraEnrollment: true }));
    const decision = await resolveOperationalIdentityRuntimeScopeDecision(cronOwnerClient(), {
      agentId: "bot--agent",
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe("ENROLLMENT_AMBIGUOUS");
    }
    expect(resolveTrustedEnterpriseDataExecutionContextMock).not.toHaveBeenCalled();
  });

  it("surfaces typed enroll denials instead of SEAT_AGENT_REQUIRED", async () => {
    resolveTrustedEnterpriseDataExecutionContextMock.mockRejectedValue(
      new EnterpriseDataStoreError("MEMBERSHIP_INVALID", "Enterprise membership is inactive."),
    );
    const result = await enrollEmployeeEnterpriseIdentity({
      client: employeeClient(),
      identityId: "id-tm",
      agentId: "bot--agent",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("MEMBERSHIP_INVALID");
      expect(result.code).not.toBe("SEAT_AGENT_REQUIRED");
    }
  });

  it("allows a unique enrolled background agent without an employee session", async () => {
    resolveTrustedEnterpriseDataExecutionContextMock.mockRejectedValue(new Error("no session"));
    const decision = await resolveOperationalIdentityRuntimeScopeDecision(null, {
      agentId: "bot--agent",
    });
    expect(decision).toEqual({
      ok: true,
      source: "enrollment",
      scope: {
        tenantId: "001",
        seatId: "seat-1",
        agentId: "bot--agent",
        employeeId: "emp-1",
      },
    });
  });

  it("rejects ambiguous enrollment across employees", async () => {
    loadEnterpriseSeatAssetsStoreMock.mockResolvedValue(enrollmentStore({ extraEnrollment: true }));
    const decision = await resolveOperationalIdentityRuntimeScopeDecision(null, {
      agentId: "bot--agent",
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe("ENROLLMENT_AMBIGUOUS");
    }
  });

  it("rejects ambiguous enrollment across tenants", async () => {
    loadEnterpriseSeatAssetsStoreMock.mockResolvedValue(
      enrollmentStore({ extraTenantEnrollment: true }),
    );
    const decision = await resolveOperationalIdentityRuntimeScopeDecision(null, {
      agentId: "bot--agent",
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe("ENROLLMENT_AMBIGUOUS");
    }
  });

  it("does not read process environment identity variables", async () => {
    const previous = {
      TENANT: process.env.TENANT,
      USER: process.env.USER,
      AGENT: process.env.AGENT,
      SESSION: process.env.SESSION,
      CHANNEL: process.env.CHANNEL,
    };
    process.env.TENANT = "env-tenant";
    process.env.USER = "env-user";
    process.env.AGENT = "env-agent";
    process.env.SESSION = "env-session";
    process.env.CHANNEL = "env-channel";
    try {
      resolveTrustedEnterpriseDataExecutionContextMock.mockRejectedValue(
        new EnterpriseDataStoreError("MEMBERSHIP_INVALID", "Enterprise membership is inactive."),
      );
      const decision = await resolveOperationalIdentityRuntimeScopeDecision(employeeClient(), {
        agentId: "bot--agent",
      });
      expect(decision.ok).toBe(false);
      if (!decision.ok) {
        expect(decision.code).toBe("MEMBERSHIP_INVALID");
        expect(decision.message).not.toMatch(
          /\bTENANT\b|\bUSER\b|\bAGENT\b|\bSESSION\b|\bCHANNEL\b/,
        );
      }
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it("compatibility wrapper still returns null for denials", async () => {
    resolveTrustedEnterpriseDataExecutionContextMock.mockRejectedValue(
      new EnterpriseDataStoreError("NO_CURRENT_SEAT", "Active seat binding not found."),
    );
    await expect(
      resolveOperationalIdentityRuntimeScope(employeeClient(), { agentId: "bot--agent" }),
    ).resolves.toBeNull();
  });
});
