import { describe, expect, it, vi } from "vitest";
import type { BillingScope } from "../billing/scope.js";
import type { PlatformAuthUser } from "../platform-auth/store-types.js";
import type { RespondFn } from "./types.js";

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
    // Membership path ignores forged requestedTenantId — scope stays acme.
    void opts;
    return {
      enterpriseId: "tenant-acme",
      user: platformUser("emp-admin-001"),
      membership: null,
      isEnterpriseAdmin: true,
      permissions: new Set(),
    } satisfies BillingScope;
  }),
  isScopeAuthorizedForTenant: (scope: BillingScope, target: string) =>
    scope.enterpriseId === target,
  scopeHasPermission: () => true,
}));

vi.mock("../enterprise-data/enterprise-data-seat-context.js", () => ({
  requireResolvedEnterpriseTenantId: vi.fn(async ({ params, respond }) => {
    const requested =
      typeof params.tenantId === "string" && params.tenantId.trim() ? params.tenantId.trim() : null;
    if (requested && requested !== "tenant-acme") {
      respond(false, undefined, {
        code: "INVALID_REQUEST",
        message: "tenantId must match authenticated enterprise scope.",
      });
      return null;
    }
    return "tenant-acme";
  }),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({}),
}));

vi.mock("../platform-auth/config.js", () => ({
  resolvePlatformAuthConfig: () => null,
}));

const { enterpriseOrganizationHandlers } = await import("./enterprise-organization.ts");
const { requireEnterpriseScope } = await import("./billing-helpers.ts");

describe("enterprise.organization.snapshot tenant scope (D1)", () => {
  it("rejects forged tenantId", async () => {
    const responseRef: { current: { ok: boolean; message?: string } | null } = { current: null };
    await enterpriseOrganizationHandlers["enterprise.organization.snapshot"]({
      client: { connect: {} as never, user: "admin@acme.test" },
      params: { tenantId: "tenant-evil" },
      respond: ((ok, _payload, error) => {
        responseRef.current = { ok, message: error?.message };
      }) satisfies RespondFn,
      context: {} as never,
      req: {} as never,
    } as never);
    expect(responseRef.current?.ok).toBe(false);
    expect(responseRef.current?.message).toContain(
      "tenantId must match authenticated enterprise scope",
    );
  });

  it("accepts matching tenantId", async () => {
    const responseRef: { current: { ok: boolean; payload?: unknown } | null } = { current: null };
    await enterpriseOrganizationHandlers["enterprise.organization.snapshot"]({
      client: { connect: {} as never, user: "admin@acme.test" },
      params: { tenantId: "tenant-acme" },
      respond: ((ok, payload) => {
        responseRef.current = { ok, payload };
      }) satisfies RespondFn,
      context: {} as never,
      req: {} as never,
    } as never);
    expect(responseRef.current?.ok).toBe(true);
    expect(responseRef.current?.payload).toMatchObject({
      tenantId: "tenant-acme",
      organization: null,
    });
  });
});

describe("requireEnterpriseScope tenant mismatch (D1)", () => {
  it("rejects forged tenantId even when membership resolves a different enterprise", async () => {
    const responseRef: { current: { ok: boolean; message?: string } | null } = { current: null };
    const scope = await requireEnterpriseScope(
      { connect: {} as never, user: "admin@acme.test" },
      ((ok, _payload, error) => {
        responseRef.current = { ok, message: error?.message };
      }) satisfies RespondFn,
      { tenantId: "tenant-evil" },
    );
    expect(scope).toBeNull();
    expect(responseRef.current?.ok).toBe(false);
    expect(responseRef.current?.message).toContain(
      "tenantId must match authenticated enterprise scope",
    );
  });

  it("accepts matching tenantId", async () => {
    const scope = await requireEnterpriseScope(
      { connect: {} as never, user: "admin@acme.test" },
      () => {},
      { tenantId: "tenant-acme" },
    );
    expect(scope?.enterpriseId).toBe("tenant-acme");
  });
});
