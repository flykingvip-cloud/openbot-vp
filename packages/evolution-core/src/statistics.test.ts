import { describe, expect, it } from "vitest";
import { assessTwoProportion, wilsonScoreInterval } from "./statistics.js";

describe("statistical assessment", () => {
  it("returns null confidence for zero samples", () => {
    expect(
      assessTwoProportion({
        baselineRate: 0.7,
        baselineTrials: 0,
        treatmentRate: 0.8,
        treatmentTrials: 40,
        minimumTrials: 20,
      }).confidence,
    ).toBeNull();
    expect(wilsonScoreInterval(0, 0)).toBeNull();
  });

  it("returns null confidence when either side is below the minimum", () => {
    const assessment = assessTwoProportion({
      baselineRate: 0.7,
      baselineTrials: 10,
      treatmentRate: 0.8,
      treatmentTrials: 40,
      minimumTrials: 20,
    });
    expect(assessment.method).toBe("insufficient-sample");
    expect(assessment.confidence).toBeNull();
  });

  it("computes a finite confidence for a large improved proportion", () => {
    const assessment = assessTwoProportion({
      baselineRate: 0.5,
      baselineTrials: 200,
      treatmentRate: 0.75,
      treatmentTrials: 200,
      minimumTrials: 20,
    });
    expect(assessment.method).toBe("two-proportion-z");
    expect(assessment.confidence).toBeGreaterThan(0.9);
    expect(assessment.confidence).toBeLessThanOrEqual(1);
  });

  it("keeps Wilson bounds inside [0, 1] at the 0/1 edges", () => {
    const zero = wilsonScoreInterval(0, 40);
    const one = wilsonScoreInterval(40, 40);
    expect(zero?.lower).toBeGreaterThanOrEqual(0);
    expect(one?.upper).toBeLessThanOrEqual(1);
  });
});
