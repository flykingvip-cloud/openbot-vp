// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayClient } from "../server-methods/types.js";
import { resolveKnowledgeSourceContext } from "./context.js";

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({
    gateway: { auth: { trustedProxy: { enabled: true } } },
  }),
}));

const enterpriseMock = vi.hoisted(() => ({
  resolveTrustedEnterpriseDataExecutionContext: vi.fn(),
}));

vi.mock("../enterprise-data/enterprise-data-seat-context.js", () => ({
  resolveTrustedEnterpriseDataExecutionContext:
    enterpriseMock.resolveTrustedEnterpriseDataExecutionContext,
}));

vi.mock("../platform-auth.js", () => ({
  resolvePlatformAuthConfig: () => ({ enabled: true }),
  // Realistic store shape: the authoritative resolver validates normalizedEmail,
  // user status, a single unambiguous membership, and enterprise availability.
  loadPlatformAuthStore: async () => ({
    users: {
      "user-1": {
        id: "user-1",
        email: "emp@acme.test",
        normalizedEmail: "emp@acme.test",
        status: "active",
      },
    },
    memberships: {
      mem1: {
        id: "mem1",
        userId: "user-1",
        enterpriseId: "tenant-acme",
        membershipRole: "member",
      },
    },
    enterprises: { "tenant-acme": { id: "tenant-acme", status: "paid" } },
  }),
  findUserByEmail: (_store: unknown, email: string) =>
    email === "emp@acme.test" ? { id: "user-1", email } : null,
  findUserById: (_store: unknown, userId: string) =>
    userId === "user-1" ? { id: "user-1", email: "emp@acme.test" } : null,
}));

describe("resolveKnowledgeSourceContext", () => {
  const client = {
    connect: {} as never,
    user: "emp@acme.test",
  } satisfies GatewayClient;

  beforeEach(() => {
    enterpriseMock.resolveTrustedEnterpriseDataExecutionContext.mockReset();
  });

  it("returns full enterprise context when seat binding resolves", async () => {
    enterpriseMock.resolveTrustedEnterpriseDataExecutionContext.mockResolvedValue({
      tenantId: "tenant-acme",
      seatId: "seat-east",
      userId: "user-1",
      teamLabel: "华东",
      roleCode: "sales-mgr",
      departmentId: "dept-1",
    });
    const context = await resolveKnowledgeSourceContext(client);
    expect(context.userId).toBe("user-1");
    expect(context.seatId).toBe("seat-east");
    expect(context.hasEnterpriseScope).toBe(true);
  });

  it("falls back to platform user when seat context is unavailable", async () => {
    enterpriseMock.resolveTrustedEnterpriseDataExecutionContext.mockRejectedValue(
      new Error("NO_SEAT_CONTEXT"),
    );
    const context = await resolveKnowledgeSourceContext(client);
    expect(context.userId).toBe("user-1");
    expect(context.tenantId).toBe("tenant-acme");
    expect(context.seatId).toBeNull();
    expect(context.hasEnterpriseScope).toBe(false);
  });

  it("hydrates email from platformUserId when the websocket header is absent", async () => {
    enterpriseMock.resolveTrustedEnterpriseDataExecutionContext.mockResolvedValue({
      tenantId: "tenant-acme",
      seatId: "seat-east",
      userId: "user-1",
      teamLabel: "华东",
      roleCode: "sales-mgr",
      departmentId: "dept-1",
    });
    const context = await resolveKnowledgeSourceContext({
      connect: {} as never,
      platformUserId: "user-1",
    });
    expect(context.userId).toBe("user-1");
    expect(context.seatId).toBe("seat-east");
    expect(enterpriseMock.resolveTrustedEnterpriseDataExecutionContext).toHaveBeenCalledWith(
      expect.objectContaining({ user: "emp@acme.test", platformUserId: "user-1" }),
    );
  });
});
