import { afterEach, describe, expect, it } from "vitest";
import {
  __resetOverviewLoadCacheForTest,
  enterpriseShellProfileForTabForTest,
} from "./app-settings.ts";

// Re-export profile helper via test-only export below if needed.
// We assert the mapping by importing the module and checking behavior through
// a thin test export.

describe("enterprise shell profile mapping", () => {
  afterEach(() => {
    __resetOverviewLoadCacheForTest();
  });

  it("maps enterprise tabs to minimal shell profiles", () => {
    expect(enterpriseShellProfileForTabForTest("enterpriseOverview")).toBe("overview");
    expect(enterpriseShellProfileForTabForTest("enterpriseOrganization")).toBe("organization");
    expect(enterpriseShellProfileForTabForTest("enterpriseSettings")).toBe("identity");
    expect(enterpriseShellProfileForTabForTest("enterpriseMesh")).toBe("mesh");
    expect(enterpriseShellProfileForTabForTest("enterpriseUsage")).toBe("none");
    expect(enterpriseShellProfileForTabForTest("enterpriseBudget")).toBe("none");
    expect(enterpriseShellProfileForTabForTest("enterpriseCapabilityCenter")).toBe("none");
    expect(enterpriseShellProfileForTabForTest("enterpriseDataGovernanceCenter")).toBe("none");
  });
});
