import { describe, expect, it } from "vitest";
import {
  buildSubscribedCapacityUsageRows,
  capacityUsageRatio,
} from "./plan-capacity-usage-panel.ts";

describe("capacityUsageRatio", () => {
  it("clamps ratio between 0 and 1", () => {
    expect(capacityUsageRatio(5, 10)).toBe(0.5);
    expect(capacityUsageRatio(15, 10)).toBe(1);
    expect(capacityUsageRatio(-1, 10)).toBe(0);
  });

  it("returns null when limit is zero", () => {
    expect(capacityUsageRatio(3, 0)).toBeNull();
  });
});

describe("buildSubscribedCapacityUsageRows", () => {
  it("includes credits row when limit is set", () => {
    const rows = buildSubscribedCapacityUsageRows({
      assignedSeats: 2,
      seatLimit: 17,
      usedBots: 5,
      botLimit: 60,
      concurrencyUsed: 2,
      concurrencyLimit: 8,
      creditsConsumed: 200,
      creditsLimit: 1000,
    });
    expect(rows.map((row) => row.id)).toEqual(["seats", "bots", "concurrency", "credits"]);
    expect(rows.find((row) => row.id === "credits")?.used).toBe(200);
  });

  it("omits credits row when limit is null", () => {
    const rows = buildSubscribedCapacityUsageRows({
      assignedSeats: 0,
      seatLimit: 10,
      usedBots: 0,
      botLimit: 10,
      concurrencyUsed: 0,
      concurrencyLimit: 4,
      creditsConsumed: null,
      creditsLimit: null,
    });
    expect(rows.map((row) => row.id)).toEqual(["seats", "bots", "concurrency"]);
  });
});
