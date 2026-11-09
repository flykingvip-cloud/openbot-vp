import { describe, expect, it } from "vitest";
import { pathForTab, portForTab, tabFromPath } from "./navigation.ts";

describe("platform observation route", () => {
  it("routes /platform/observation while retaining the monitored-task diagnosis page", () => {
    expect(tabFromPath("/platform/observation", "")).toBe("platformObservation");
    expect(pathForTab("platformObservation", "")).toBe("/platform/observation");
    expect(portForTab("platformObservation")).toBe("platform");
    expect(tabFromPath("/platform/diagnosis", "")).toBe("platformDiagnosis");
  });
});
