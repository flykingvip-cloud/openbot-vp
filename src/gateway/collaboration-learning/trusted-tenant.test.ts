import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveTenantContext = vi.fn();
const resolveEmployeeWorkbenchActor = vi.fn();

vi.mock("../tenant-context.js", () => ({
  resolveTenantContext: (...args: unknown[]) => resolveTenantContext(...args),
}));

vi.mock("../employee-workbench-scope.js", () => ({
  resolveEmployeeWorkbenchActor: (...args: unknown[]) => resolveEmployeeWorkbenchActor(...args),
}));

const {
  resolveCollaborationTenantResolution,
  resolveMembershipTenantIdForAcl,
  resolveTrustedCollaborationTenantId,
} = await import("./trusted-tenant.js");

describe("trusted-tenant multi-surface fail-closed", () => {
  beforeEach(() => {
    resolveTenantContext.mockReset();
    resolveEmployeeWorkbenchActor.mockReset();
  });

  it("ACL helper uses membership only and ignores actor fallback", async () => {
    resolveTenantContext.mockResolvedValue(null);
    resolveEmployeeWorkbenchActor.mockResolvedValue({ tenantId: "actor-tenant" });
    expect(await resolveMembershipTenantIdForAcl({} as never)).toBeNull();
    expect(resolveEmployeeWorkbenchActor).not.toHaveBeenCalled();
  });

  it("ACL helper returns membership tenantId", async () => {
    resolveTenantContext.mockResolvedValue({ tenantId: "acme", userId: "u1", domain: "employee" });
    expect(await resolveMembershipTenantIdForAcl({} as never)).toBe("acme");
  });

  it("collaboration resolution labels actor_fallback distinctly from membership", async () => {
    resolveTenantContext.mockResolvedValue(null);
    resolveEmployeeWorkbenchActor.mockResolvedValue({ tenantId: "actor-tenant" });
    await expect(resolveCollaborationTenantResolution({} as never)).resolves.toEqual({
      tenantId: "actor-tenant",
      trust: "actor_fallback",
    });
  });

  it("collaboration resolution prefers membership trust", async () => {
    resolveTenantContext.mockResolvedValue({ tenantId: "acme", userId: "u1", domain: "employee" });
    resolveEmployeeWorkbenchActor.mockResolvedValue({ tenantId: "actor-tenant" });
    await expect(resolveCollaborationTenantResolution({} as never)).resolves.toEqual({
      tenantId: "acme",
      trust: "membership",
    });
    expect(resolveEmployeeWorkbenchActor).not.toHaveBeenCalled();
  });

  it("never accepts a client-supplied tenant param (function arity is client-only)", () => {
    expect(resolveMembershipTenantIdForAcl.length).toBeLessThanOrEqual(1);
    expect(resolveCollaborationTenantResolution.length).toBeLessThanOrEqual(1);
    expect(resolveTrustedCollaborationTenantId.length).toBeLessThanOrEqual(1);
  });

  it("legacy helper still returns actor fallback id for non-ACL callers", async () => {
    resolveTenantContext.mockResolvedValue(null);
    resolveEmployeeWorkbenchActor.mockResolvedValue({ tenantId: "actor-tenant" });
    expect(await resolveTrustedCollaborationTenantId({} as never)).toBe("actor-tenant");
  });
});
