import { describe, expect, it } from "vitest";
import {
  assertTenantAccess,
  canAccessTenantResource,
  filterByTenant,
  scopedSessionKey,
  TenantIsolationError,
  tenantOf,
} from "./tenancy.js";

describe("tenancy — tenantOf / scopedSessionKey", () => {
  it("normalizes tenant id and prefixes session key", () => {
    expect(tenantOf({ type: "cursor", tenantId: " t1 " })).toBe("t1");
    expect(tenantOf({ type: "cursor" })).toBeUndefined();
    expect(scopedSessionKey({ type: "cursor", tenantId: "t1" }, "s1")).toBe("t1:s1");
  });

  it("single-tenant degrade: no tenant → base key unchanged (R10.3)", () => {
    expect(scopedSessionKey({ type: "cursor" }, "s1")).toBe("s1");
  });

  it("prefixing is idempotent", () => {
    expect(scopedSessionKey({ type: "cursor", tenantId: "t1" }, "t1:s1")).toBe("t1:s1");
  });
});

describe("tenancy — cross-tenant isolation (R10.2)", () => {
  it("same tenant can access; different tenant cannot", () => {
    expect(canAccessTenantResource("t1", "t1")).toBe(true);
    expect(canAccessTenantResource("t1", "t2")).toBe(false);
  });

  it("untenanted requester sees only untenanted resources", () => {
    expect(canAccessTenantResource(undefined, undefined)).toBe(true);
    expect(canAccessTenantResource(undefined, "t1")).toBe(false);
  });

  it("tenanted requester cannot see untenanted resource", () => {
    expect(canAccessTenantResource("t1", undefined)).toBe(false);
  });

  it("assertTenantAccess throws on cross-tenant", () => {
    expect(() => assertTenantAccess("t1", "t2")).toThrow(TenantIsolationError);
    expect(() => assertTenantAccess("t1", "t1")).not.toThrow();
  });

  it("filterByTenant keeps only visible records", () => {
    const records = [{ id: "a", tenantId: "t1" }, { id: "b", tenantId: "t2" }, { id: "c" }];
    expect(filterByTenant(records, "t1").map((r) => r.id)).toEqual(["a"]);
    expect(filterByTenant(records, undefined).map((r) => r.id)).toEqual(["c"]);
  });
});
