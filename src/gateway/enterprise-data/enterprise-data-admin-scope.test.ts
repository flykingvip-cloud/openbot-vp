import { describe, expect, it, vi } from "vitest";
import type { BillingScope } from "../billing/scope.js";
import type { PlatformAuthUser } from "../platform-auth/store-types.js";
import {
  GOVERNANCE_ADMIN_REQUIRED_MESSAGE,
  requireResolvedEnterpriseAdminTenantId,
  requireResolvedEnterpriseTenantId,
} from "./enterprise-data-seat-context.js";

const client = { connect: {} as never, user: "user@acme.test" };

function platformUser(id: string): PlatformAuthUser {
  return {
    id,
    email: `${id}@acme.test`,
    normalizedEmail: `${id}@acme.test`,
    displayName: id,
    passwordHash: "hash",
    passwordUpdatedAt: "2026-01-01T00:00:00.000Z",
    loginFailedCount: 0,
    status: "active",
    source: "platform-created",
    role: "user",
    scopes: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as PlatformAuthUser;
}

function billingScope(
  overrides: Partial<BillingScope> & { enterpriseId: string | null },
): BillingScope {
  return {
    enterpriseId: overrides.enterpriseId,
    user: overrides.user ?? null,
    membership: overrides.membership ?? null,
    isEnterpriseAdmin: overrides.isEnterpriseAdmin ?? false,
    permissions: overrides.permissions ?? new Set<string>(),
  };
}

vi.mock("../billing/scope.js", () => ({
  resolveBillingScope: vi.fn(
    async () =>
      ({
        enterpriseId: "tenant-acme",
        user: platformUser("emp-admin-001"),
        membership: null,
        isEnterpriseAdmin: true,
        permissions: new Set(["operator"]),
      }) satisfies BillingScope,
  ),
}));

describe("requireResolvedEnterpriseAdminTenantId", () => {
  it("rejects enterprise member for governance read even with matching tenant", async () => {
    const { resolveBillingScope } = await import("../billing/scope.js");
    const memberScope = billingScope({
      enterpriseId: "tenant-acme",
      user: platformUser("emp-member-001"),
      membership: null,
      isEnterpriseAdmin: false,
      permissions: new Set(["operator"]),
    });
    vi.mocked(resolveBillingScope)
      .mockResolvedValueOnce(memberScope)
      .mockResolvedValueOnce(memberScope);
    const responseRef: { current: { ok: boolean; message?: string } | null } = { current: null };
    const tenantId = await requireResolvedEnterpriseAdminTenantId({
      client,
      params: { tenantId: "tenant-acme" },
      respond: (ok, _payload, error) => {
        responseRef.current = { ok, message: error?.message };
      },
    });
    expect(tenantId).toBeNull();
    expect(responseRef.current?.ok).toBe(false);
    expect(responseRef.current?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
  });

  it("rejects enterprise member for governance write even with matching tenant", async () => {
    const { resolveBillingScope } = await import("../billing/scope.js");
    vi.mocked(resolveBillingScope)
      .mockResolvedValueOnce({
        enterpriseId: "tenant-acme",
        user: platformUser("emp-member-001"),
        membership: null,
        isEnterpriseAdmin: false,
        permissions: new Set(["operator"]),
      } satisfies BillingScope)
      .mockResolvedValueOnce({
        enterpriseId: "tenant-acme",
        user: platformUser("emp-member-001"),
        membership: null,
        isEnterpriseAdmin: false,
        permissions: new Set(["operator"]),
      } satisfies BillingScope);
    const responseRef: { current: { ok: boolean; message?: string } | null } = { current: null };
    const tenantId = await requireResolvedEnterpriseAdminTenantId({
      client,
      params: { displayName: "Team scope" },
      respond: (ok, _payload, error) => {
        responseRef.current = { ok, message: error?.message };
      },
    });
    expect(tenantId).toBeNull();
    expect(responseRef.current?.ok).toBe(false);
    expect(responseRef.current?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
  });

  it("allows enterprise-admin with matching tenant", async () => {
    const { resolveBillingScope } = await import("../billing/scope.js");
    vi.mocked(resolveBillingScope)
      .mockResolvedValueOnce({
        enterpriseId: "tenant-acme",
        user: platformUser("emp-admin-001"),
        membership: null,
        isEnterpriseAdmin: true,
        permissions: new Set(["operator"]),
      } satisfies BillingScope)
      .mockResolvedValueOnce({
        enterpriseId: "tenant-acme",
        user: platformUser("emp-admin-001"),
        membership: null,
        isEnterpriseAdmin: true,
        permissions: new Set(["operator"]),
      } satisfies BillingScope);
    const tenantId = await requireResolvedEnterpriseAdminTenantId({
      client,
      params: { tenantId: "tenant-acme" },
      respond: () => {},
    });
    expect(tenantId).toBe("tenant-acme");
  });

  it("rejects tenant match when role is insufficient", async () => {
    const { resolveBillingScope } = await import("../billing/scope.js");
    vi.mocked(resolveBillingScope)
      .mockResolvedValueOnce({
        enterpriseId: "tenant-acme",
        user: platformUser("emp-member-001"),
        membership: null,
        isEnterpriseAdmin: false,
        permissions: new Set(["operator"]),
      } satisfies BillingScope)
      .mockResolvedValueOnce({
        enterpriseId: "tenant-acme",
        user: platformUser("emp-member-001"),
        membership: null,
        isEnterpriseAdmin: false,
        permissions: new Set(["operator"]),
      } satisfies BillingScope);
    const responseRef: { current: { ok: boolean; message?: string } | null } = { current: null };
    const tenantId = await requireResolvedEnterpriseAdminTenantId({
      client,
      params: {},
      respond: (ok, _payload, error) => {
        responseRef.current = { ok, message: error?.message };
      },
    });
    expect(tenantId).toBeNull();
    expect(responseRef.current?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
  });

  it("still allows member through tenant-only helper for employee-plane RPC", async () => {
    const { resolveBillingScope } = await import("../billing/scope.js");
    vi.mocked(resolveBillingScope).mockResolvedValueOnce({
      enterpriseId: "tenant-acme",
      user: platformUser("emp-member-001"),
      membership: null,
      isEnterpriseAdmin: false,
      permissions: new Set(["operator"]),
    } satisfies BillingScope);
    const tenantId = await requireResolvedEnterpriseTenantId({
      client,
      params: { tenantId: "tenant-acme" },
      respond: () => {},
    });
    expect(tenantId).toBe("tenant-acme");
  });
});
