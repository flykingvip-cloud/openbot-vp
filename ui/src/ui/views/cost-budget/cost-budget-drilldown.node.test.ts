import { describe, expect, it } from "vitest";
import {
  buildSeatsGovernanceDrilldownHref,
  parseSeatsGovernanceDrilldownFromHash,
} from "./cost-budget-drilldown.ts";

describe("cost-budget-drilldown", () => {
  it("parses governance drill-down hash fragments", () => {
    expect(parseSeatsGovernanceDrilldownFromHash("#governance-seat")).toBe("seat");
    expect(parseSeatsGovernanceDrilldownFromHash("#governance-usage")).toBe("usage");
    expect(parseSeatsGovernanceDrilldownFromHash("#governance-total")).toBe("total");
    expect(parseSeatsGovernanceDrilldownFromHash("#governance")).toBe("total");
    expect(parseSeatsGovernanceDrilldownFromHash("")).toBeNull();
  });

  it("builds seats governance drill-down href", () => {
    expect(buildSeatsGovernanceDrilldownHref("", "acme", "usage")).toBe(
      "/enterprise/acme/usage/seats#governance-usage",
    );
  });
});
