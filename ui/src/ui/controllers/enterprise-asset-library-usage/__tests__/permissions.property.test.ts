// @vitest-environment node
// Feature: enterprise-capability-usage-management
// Property 9: 权限迁移兼容性

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canAccessUsageManagement, canHandleGovernance, canManageInstall } from "../permissions.ts";

const ALL_PERMISSIONS = [
  "agent:view",
  "agent:create",
  "usage:view",
  "usage:install-manage",
  "usage:governance",
  "member:view",
  "mesh:view",
  "settings:policy",
] as const;

describe("Property 9: permission migration compatibility", () => {
  it("canAccessUsageManagement returns true when user holds usage:view", () => {
    expect(canAccessUsageManagement({ permissions: ["usage:view"] })).toBe(true);
  });

  it("canAccessUsageManagement returns true when user holds legacy agent:view", () => {
    expect(canAccessUsageManagement({ permissions: ["agent:view"] })).toBe(true);
  });

  it("canAccessUsageManagement returns true with both old and new permissions", () => {
    expect(canAccessUsageManagement({ permissions: ["agent:view", "usage:view"] })).toBe(true);
  });

  it("canAccessUsageManagement returns false without view permission", () => {
    expect(canAccessUsageManagement({ permissions: [] })).toBe(false);
    expect(canAccessUsageManagement({ permissions: ["mesh:view"] })).toBe(false);
    expect(canAccessUsageManagement({ permissions: ["agent:create"] })).toBe(false);
  });

  it("canManageInstall returns true when user holds usage:install-manage", () => {
    expect(canManageInstall({ permissions: ["usage:install-manage"] })).toBe(true);
  });

  it("canManageInstall returns true when user holds legacy agent:create", () => {
    expect(canManageInstall({ permissions: ["agent:create"] })).toBe(true);
  });

  it("canHandleGovernance returns true only when usage:governance is held", () => {
    expect(canHandleGovernance({ permissions: ["usage:governance"] })).toBe(true);
    expect(canHandleGovernance({ permissions: ["usage:view"] })).toBe(false);
    expect(canHandleGovernance({ permissions: ["agent:view"] })).toBe(false);
  });

  it("canAccessUsageManagement: holding agent:view always grants access (compatibility window)", () => {
    fc.assert(
      fc.property(fc.subarray([...ALL_PERMISSIONS]), (perms) => {
        if (perms.includes("agent:view")) {
          expect(canAccessUsageManagement({ permissions: perms })).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("canManageInstall: holding agent:create always grants manage permission", () => {
    fc.assert(
      fc.property(fc.subarray([...ALL_PERMISSIONS]), (perms) => {
        if (perms.includes("agent:create")) {
          expect(canManageInstall({ permissions: perms })).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("canAccessUsageManagement: random subsets grant access iff usage:view OR agent:view present", () => {
    fc.assert(
      fc.property(fc.subarray([...ALL_PERMISSIONS]), (perms) => {
        const expected = perms.includes("usage:view") || perms.includes("agent:view");
        expect(canAccessUsageManagement({ permissions: perms })).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });
});
