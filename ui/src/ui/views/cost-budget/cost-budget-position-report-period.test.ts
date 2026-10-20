import { describe, expect, it } from "vitest";
import { resolvePositionReportWindow } from "./cost-budget-position-report-period.ts";

describe("resolvePositionReportWindow", () => {
  it("never returns an empty cycle window when bounds are missing", () => {
    const { startTime, endTime } = resolvePositionReportWindow({ preset: "cycle" });
    expect(new Date(endTime).getTime()).toBeGreaterThan(new Date(startTime).getTime());
  });

  it("honors explicit billing cycle bounds", () => {
    const { startTime, endTime } = resolvePositionReportWindow({
      preset: "cycle",
      cycleStart: "2026-03-01T00:00:00.000Z",
      cycleEnd: "2026-04-01T00:00:00.000Z",
    });
    expect(startTime).toBe("2026-03-01T00:00:00.000Z");
    expect(endTime).toBe("2026-04-01T00:00:00.000Z");
  });
});
