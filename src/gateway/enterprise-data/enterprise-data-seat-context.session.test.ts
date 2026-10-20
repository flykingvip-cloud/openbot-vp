import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTrustedEnterpriseDataExecutionContext } from "./enterprise-data-seat-context.js";

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({
    gateway: { auth: { trustedProxy: { enabled: true } } },
  }),
}));

vi.mock("../platform-auth.js", () => ({
  resolvePlatformAuthConfig: () => ({ enabled: true }),
  loadPlatformAuthStore: async () => ({
    users: {
      "user-mgr-001": {
        id: "user-mgr-001",
        email: "mgr@acme.test",
        normalizedEmail: "mgr@acme.test",
        status: "active",
      },
    },
    memberships: {
      "mem-1": {
        id: "mem-1",
        userId: "user-mgr-001",
        enterpriseId: "tenant-acme",
        membershipRole: "member",
      },
    },
    enterprises: {
      "tenant-acme": { id: "tenant-acme", status: "paid" },
    },
  }),
  findUserByEmail: (_store: unknown, email: string) =>
    email === "mgr@acme.test" ? { id: "user-mgr-001", email } : null,
  findUserById: (_store: unknown, userId: string) =>
    userId === "user-mgr-001" ? { id: "user-mgr-001", email: "mgr@acme.test" } : null,
  findMembershipByUserId: () => ({
    userId: "user-mgr-001",
    enterpriseId: "tenant-acme",
    membershipRole: "member",
  }),
}));

vi.mock("../enterprise-seat-assets-store.js", () => ({
  loadEnterpriseSeatAssetsStore: async () => ({
    seats: {
      "seat-sales-mgr-east": {
        seatId: "seat-sales-mgr-east",
        tenantId: "tenant-acme",
        title: "华东销售经理",
        teamLabel: "华东销售",
        roleCode: "sales-mgr",
        status: "occupied",
        currentEmployeeId: "user-mgr-001",
        defaultSpaceIds: [],
        defaultAgentAssetIds: [],
        createdAt: "2026-06-05T00:00:00.000Z",
        updatedAt: "2026-06-05T00:00:00.000Z",
      },
    },
    bindings: {
      "bind-1": {
        bindingId: "bind-1",
        seatId: "seat-sales-mgr-east",
        tenantId: "tenant-acme",
        employeeId: "user-mgr-001",
        bindingStatus: "active",
        effectiveAt: "2026-06-05T00:00:00.000Z",
      },
    },
  }),
}));

describe("resolveTrustedEnterpriseDataExecutionContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves tenant/seat/employee/team from session and seat binding", async () => {
    const context = await resolveTrustedEnterpriseDataExecutionContext({
      connect: {} as never,
      user: "mgr@acme.test",
    });
    expect(context.tenantId).toBe("tenant-acme");
    expect(context.seatId).toBe("seat-sales-mgr-east");
    expect(context.employeeId).toBe("user-mgr-001");
    expect(context.teamLabel).toBe("华东销售");
    expect(context.roleCode).toBe("sales-mgr");
    expect(context.trustAttestation).toBe("server-session-v1");
  });

  it("rejects missing session user", async () => {
    await expect(resolveTrustedEnterpriseDataExecutionContext(null)).rejects.toMatchObject({
      code: "IDENTITY_CONTEXT_MISSING",
      message: expect.stringMatching(/Authenticated session is required/),
    });
  });

  it("resolves tenant/seat/employee from platformUserId when email is absent", async () => {
    const context = await resolveTrustedEnterpriseDataExecutionContext({
      connect: {} as never,
      platformUserId: "user-mgr-001",
    });
    expect(context.tenantId).toBe("tenant-acme");
    expect(context.seatId).toBe("seat-sales-mgr-east");
    expect(context.employeeId).toBe("user-mgr-001");
  });

  it("uses the session-pinned membership pair when present", async () => {
    const context = await resolveTrustedEnterpriseDataExecutionContext({
      connect: {} as never,
      user: "mgr@acme.test",
      sessionEnterpriseId: "tenant-acme",
      sessionMembershipId: "mem-1",
    });
    expect(context.tenantId).toBe("tenant-acme");
    expect(context.seatId).toBe("seat-sales-mgr-east");
  });

  it("fails closed for a half-bound session enterprise without membership", async () => {
    await expect(
      resolveTrustedEnterpriseDataExecutionContext({
        connect: {} as never,
        user: "mgr@acme.test",
        sessionEnterpriseId: "tenant-acme",
      }),
    ).rejects.toMatchObject({ code: "MEMBERSHIP_INVALID" });
  });
});
