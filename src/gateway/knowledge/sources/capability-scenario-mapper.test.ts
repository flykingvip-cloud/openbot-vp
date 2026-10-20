import { describe, expect, it } from "vitest";
import { mapCapabilityScenarios } from "./capability-scenario-mapper.js";

describe("mapCapabilityScenarios", () => {
  it("maps known capability keys to employee-facing scenarios", () => {
    expect(mapCapabilityScenarios("customer.profile")).toEqual([
      "客户分析",
      "销售跟进",
      "客户画像",
    ]);
  });

  it("falls back to a generic scenario label", () => {
    expect(mapCapabilityScenarios("unknown.capability")).toEqual(["通用分析"]);
  });
});
