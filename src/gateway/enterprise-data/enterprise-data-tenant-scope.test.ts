import { describe, expect, it, vi } from "vitest";
import type { BillingScope } from "../billing/scope.js";
import type { PlatformAuthUser } from "../platform-auth/store-types.js";
import { requireResolvedEnterpriseTenantId } from "./enterprise-data-seat-context.js";

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

vi.mock("../billing/scope.js", () => ({
  resolveBillingScope: vi.fn(async (_client, opts) => {
    if (opts?.requestedTenantId) {
      return {
        enterpriseId: opts.requestedTenantId,
        user: null,
        membership: null,
        isEnterpriseAdmin: true,
        permissions: new Set(),
      } satisfies BillingScope;
    }
    return {
      enterpriseId: "tenant-acme",
      user: platformUser("emp-admin-001"),
      membership: null,
      isEnterpriseAdmin: true,
      permissions: new Set(),
    } satisfies BillingScope;
  }),
}));

describe("requireResolvedEnterpriseTenantId", () => {
  it("rejects forged tenantId", async () => {
    const responseRef: { current: { ok: boolean; message?: string } | null } = { current: null };
    const tenantId = await requireResolvedEnterpriseTenantId({
      client: { connect: {} as never, user: "admin@acme.test" },
      params: { tenantId: "tenant-evil" },
      respond: (ok, _payload, error) => {
        responseRef.current = { ok, message: error?.message };
      },
    });
    expect(tenantId).toBeNull();
    expect(responseRef.current?.ok).toBe(false);
    expect(responseRef.current?.message).toContain(
      "tenantId must match authenticated enterprise scope",
    );
  });

  it("accepts matching tenantId from session scope", async () => {
    const tenantId = await requireResolvedEnterpriseTenantId({
      client: { connect: {} as never, user: "admin@acme.test" },
      params: { tenantId: "tenant-acme" },
      respond: () => {},
    });
    expect(tenantId).toBe("tenant-acme");
  });

  it("accepts omitted tenantId and uses session enterprise", async () => {
    const tenantId = await requireResolvedEnterpriseTenantId({
      client: { connect: {} as never, user: "admin@acme.test" },
      params: {},
      respond: () => {},
    });
    expect(tenantId).toBe("tenant-acme");
  });
});
