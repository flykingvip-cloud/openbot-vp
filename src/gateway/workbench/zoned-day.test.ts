// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isWithinZonedDay, resolveZonedDayBounds } from "./zoned-day.js";

describe("resolveZonedDayBounds", () => {
  it("keeps same-day events inside Asia/Shanghai natural day across UTC midnight", () => {
    // 2026-07-30 23:30 CST = 2026-07-30 15:30 UTC
    const lateLocal = Date.parse("2026-07-30T15:30:00.000Z");
    const bounds = resolveZonedDayBounds(lateLocal, "Asia/Shanghai");
    expect(isWithinZonedDay(lateLocal, lateLocal, "Asia/Shanghai")).toBe(true);
    // 20 minutes later is still same local day (23:50 CST)
    expect(isWithinZonedDay(lateLocal + 20 * 60_000, lateLocal, "Asia/Shanghai")).toBe(true);
    // Next local day 00:30 CST should be outside
    const nextLocalMorning = Date.parse("2026-07-30T16:30:00.000Z"); // 2026-07-31 00:30 CST
    expect(nextLocalMorning).toBeGreaterThanOrEqual(bounds.endMs);
    expect(isWithinZonedDay(nextLocalMorning, lateLocal, "Asia/Shanghai")).toBe(false);
  });

  it("falls back to UTC for invalid timezone labels", () => {
    const now = Date.parse("2026-07-30T12:00:00.000Z");
    const bounds = resolveZonedDayBounds(now, "Not/AZone");
    expect(bounds.timeZone).toBe("UTC");
    expect(bounds.startMs).toBeLessThanOrEqual(now);
    expect(bounds.endMs).toBeGreaterThan(now);
  });
});
