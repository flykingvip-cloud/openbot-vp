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
  isAclSafeTenantTrust,
  labelCollaborationIoTenant,
  labelServiceExecutionTenant,
  resolveAuthorityTenantForEntry,
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

  it("labelCollaborationIoTenant never claims membership", () => {
    expect(labelCollaborationIoTenant("t1")).toEqual({ tenantId: "t1", trust: "actor_fallback" });
    expect(labelCollaborationIoTenant(null)).toEqual({ tenantId: null, trust: "none" });
    expect(isAclSafeTenantTrust(labelCollaborationIoTenant("t1").trust)).toBe(false);
  });

  it("resolveAuthorityTenantForEntry prefers membership label from caller", () => {
    expect(
      resolveAuthorityTenantForEntry({
        preferred: { tenantId: "acme", trust: "membership" },
        groupTenantId: "group-owned",
      }),
    ).toEqual({ tenantId: "acme", trust: "membership" });
  });

  it("resolveAuthorityTenantForEntry group fallback is I/O only (not ACL membership)", () => {
    const labeled = resolveAuthorityTenantForEntry({
      preferred: null,
      groupTenantId: "group-owned",
    });
    expect(labeled).toEqual({ tenantId: "group-owned", trust: "actor_fallback" });
    expect(isAclSafeTenantTrust(labeled.trust)).toBe(false);
  });

  it("resolveAuthorityTenantForEntry does not upgrade actor_fallback to membership", () => {
    expect(
      resolveAuthorityTenantForEntry({
        preferred: { tenantId: "hint", trust: "actor_fallback" },
        groupTenantId: "group-owned",
      }),
    ).toEqual({ tenantId: "hint", trust: "actor_fallback" });
  });

  it("labelServiceExecutionTenant is ACL-safe and distinct from membership/actor_fallback", () => {
    expect(labelServiceExecutionTenant("t1")).toEqual({
      tenantId: "t1",
      trust: "service_execution",
    });
    expect(labelServiceExecutionTenant(null)).toEqual({ tenantId: null, trust: "none" });
    expect(isAclSafeTenantTrust("service_execution")).toBe(true);
    expect(isAclSafeTenantTrust("membership")).toBe(true);
    expect(isAclSafeTenantTrust("actor_fallback")).toBe(false);
    expect(labelServiceExecutionTenant("t1").trust).not.toBe("membership");
    expect(labelServiceExecutionTenant("t1").trust).not.toBe("actor_fallback");
  });

  it("resolveAuthorityTenantForEntry preserves service_execution", () => {
    expect(
      resolveAuthorityTenantForEntry({
        preferred: { tenantId: "svc-t", trust: "service_execution" },
        groupTenantId: "group-owned",
      }),
    ).toEqual({ tenantId: "svc-t", trust: "service_execution" });
  });
});
