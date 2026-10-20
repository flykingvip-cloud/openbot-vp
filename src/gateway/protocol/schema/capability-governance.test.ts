// Feature: capability-lifecycle-closure (Task 11.5)
// Protocol round-trip: capabilities.governance.updateDistribution employeeVisibilityMode.

import AjvPkg from "ajv";
import { describe, expect, it } from "vitest";
import { CapabilitiesGovernanceUpdateDistributionParamsSchema } from "./capability-governance.js";

const ajv = new (AjvPkg as unknown as new (opts?: object) => import("ajv").default)({
  allErrors: true,
  strict: false,
});

const validate = ajv.compile(CapabilitiesGovernanceUpdateDistributionParamsSchema);

describe("CapabilitiesGovernanceUpdateDistributionParamsSchema · employeeVisibilityMode", () => {
  it("accepts enterprise_review_required", () => {
    const ok = validate({
      manifestId: "urn:openclaw:skill:demo@1.0.0",
      scope: { tenantIds: ["tenant-a"] },
      defaultEnabled: true,
      employeeVisibilityMode: "enterprise_review_required",
      updatedBy: "platform-admin",
    });
    expect(ok).toBe(true);
  });

  it("accepts direct_employee_visible", () => {
    const ok = validate({
      manifestId: "urn:openclaw:skill:demo@1.0.0",
      scope: { tenantIds: ["tenant-a"] },
      defaultEnabled: true,
      employeeVisibilityMode: "direct_employee_visible",
    });
    expect(ok).toBe(true);
  });

  it("treats employeeVisibilityMode as optional (omitted is valid)", () => {
    const ok = validate({
      manifestId: "urn:openclaw:skill:demo@1.0.0",
      defaultEnabled: false,
    });
    expect(ok).toBe(true);
  });

  it("rejects an unknown visibility mode", () => {
    const ok = validate({
      manifestId: "urn:openclaw:skill:demo@1.0.0",
      employeeVisibilityMode: "everyone_everywhere",
    });
    expect(ok).toBe(false);
  });

  it("rejects a missing manifestId", () => {
    const ok = validate({
      employeeVisibilityMode: "direct_employee_visible",
    });
    expect(ok).toBe(false);
  });
});
