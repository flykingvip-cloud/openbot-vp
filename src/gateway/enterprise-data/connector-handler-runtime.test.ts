// @vitest-environment node
import { describe, expect, it } from "vitest";
import { executeConnectorHandlerAsync } from "./connector-handler-runtime.js";

describe("connector-handler-runtime production mock refusal", () => {
  it("refuses mock fallback for production connectors without a live adapter match", async () => {
    await expect(
      executeConnectorHandlerAsync(
        "enterprise-data/mock/notion.unused",
        {
          input: {},
          scope: {
            scopeType: "ALL",
            resolvedValues: {},
            appliedFilters: [],
            scopeAppliedLabel: "ALL",
          },
          employeeId: "probe",
        },
        { connectorId: "notion" },
      ),
    ).rejects.toThrow(/refusing mock fallback|Production connector/);
  });

  it("still allows labeled demo connectors to use mock handlers", async () => {
    // crm-salesforce is demo tier; without secret it uses mock (demo package handlers).
    // Unknown mock ref should throw from mock registry, not production refusal.
    await expect(
      executeConnectorHandlerAsync(
        "enterprise-data/mock/does-not-exist",
        {
          input: {},
          scope: {
            scopeType: "ALL",
            resolvedValues: {},
            appliedFilters: [],
            scopeAppliedLabel: "ALL",
          },
          employeeId: "probe",
        },
        { connectorId: "crm-salesforce" },
      ),
    ).rejects.toThrow();
  });
});
