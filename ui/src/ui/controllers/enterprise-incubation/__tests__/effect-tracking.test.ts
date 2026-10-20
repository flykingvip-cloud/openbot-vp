import { describe, expect, it } from "vitest";
import { calcDeclineRate, hasEffectDeclineWarning, DECLINE_THRESHOLD } from "../effect-tracking.ts";

describe("calcDeclineRate", () => {
  it("returns -0.2 when before=100, after=80 (20% decline)", () => {
    expect(calcDeclineRate(100, 80)).toBeCloseTo(-0.2);
  });

  it("returns 0.2 when before=100, after=120 (20% growth)", () => {
    expect(calcDeclineRate(100, 120)).toBeCloseTo(0.2);
  });

  it("returns 0 when before=0 (avoids division by zero)", () => {
    expect(calcDeclineRate(0, 50)).toBe(0);
  });

  it("returns 0 when before=0 and after=0", () => {
    expect(calcDeclineRate(0, 0)).toBe(0);
  });
});

describe("hasEffectDeclineWarning", () => {
  it("returns true when calls decline rate is below -DECLINE_THRESHOLD", () => {
    // -0.21 < -0.2 → warning
    expect(hasEffectDeclineWarning(-0.21, 0)).toBe(true);
  });

  it("returns true when dept decline rate is below -DECLINE_THRESHOLD", () => {
    // dept -0.21 < -0.2 → warning
    expect(hasEffectDeclineWarning(0, -0.21)).toBe(true);
  });

  it("returns false when both rates are above -DECLINE_THRESHOLD", () => {
    // -0.19 > -0.2 → no warning
    expect(hasEffectDeclineWarning(-0.19, -0.19)).toBe(false);
  });

  it("returns false when calls rate is exactly -0.2 (not strictly less than)", () => {
    // -0.2 is NOT < -0.2, so no warning
    expect(hasEffectDeclineWarning(-0.2, 0)).toBe(false);
  });

  it("returns false when dept rate is exactly -0.2 (not strictly less than)", () => {
    expect(hasEffectDeclineWarning(0, -0.2)).toBe(false);
  });

  it("DECLINE_THRESHOLD is 0.2", () => {
    expect(DECLINE_THRESHOLD).toBe(0.2);
  });
});
