// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  evaluateTenantLifecycle,
  TENANT_EXPIRED_RUN_MESSAGE,
  TENANT_SUSPENDED_RUN_MESSAGE,
} from "./resolve-tenant-lifecycle-access.js";

describe("evaluateTenantLifecycle", () => {
  it("blocks expired tenants (trial ended past grace / subscription lapsed)", () => {
    const result = evaluateTenantLifecycle({ status: "expired" });
    expect(result).toEqual({
      blocked: true,
      status: "expired",
      reason: "expired",
      message: TENANT_EXPIRED_RUN_MESSAGE,
    });
  });

  it("blocks suspended tenants", () => {
    const result = evaluateTenantLifecycle({ status: "suspended" });
    expect(result).toEqual({
      blocked: true,
      status: "suspended",
      reason: "suspended",
      message: TENANT_SUSPENDED_RUN_MESSAGE,
    });
  });

  it("allows active trial tenants (within grace stays trial)", () => {
    expect(evaluateTenantLifecycle({ status: "trial" })).toEqual({
      blocked: false,
      status: "trial",
    });
  });

  it("allows paid tenants", () => {
    expect(evaluateTenantLifecycle({ status: "paid" })).toEqual({ blocked: false, status: "paid" });
  });

  it("fails open for unknown tenants (no enterprise record)", () => {
    expect(evaluateTenantLifecycle(null)).toEqual({ blocked: false });
    expect(evaluateTenantLifecycle(undefined)).toEqual({ blocked: false });
  });
});
