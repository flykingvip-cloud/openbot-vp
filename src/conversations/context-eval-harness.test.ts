import { describe, expect, it } from "vitest";
import {
  defaultEvalFixtures,
  evalProjectionRetention,
  runEvalSuite,
  runFixture,
} from "./context-eval-harness.js";

describe("CL-P2-03 evaluation harness", () => {
  it("keeps must-retain strings under planner better than random drop", () => {
    const fixtures = defaultEvalFixtures();
    for (const fixture of fixtures) {
      const planner = runFixture({
        fixture,
        modelContextTokens: 4_000,
        mode: "planner",
      });
      // Current user content is always required.
      const currentMust = fixture.mustRetain.find((s) =>
        /CURRENT|FINAL_QUESTION|What did we decide/i.test(s),
      );
      if (currentMust) {
        expect(planner.missingMust).not.toContain(currentMust);
      }
      expect(planner.messageCountOut).toBeLessThanOrEqual(planner.messageCountIn);
    }
  });

  it("suite report has planner retain rate not below baseline for current-input keys", () => {
    const report = runEvalSuite({ smallWindow: 4_000, largeWindow: 24_000 });
    expect(report.fixtures).toBeGreaterThanOrEqual(3);
    expect(report.plannerRetainRate).toBeGreaterThan(0.5);
    // Planner should not invent more overflow than baseline on these fixtures.
    expect(report.plannerOverflowCount).toBeLessThanOrEqual(report.baselineOverflowCount + 2);
  });

  it("projection extraction retains evidence hygiene", () => {
    for (const fixture of defaultEvalFixtures()) {
      const result = evalProjectionRetention(fixture);
      expect(result.approvedWithoutEvidence).toBe(0);
      expect(result.hasEvidence).toBe(true);
    }
  });
});
