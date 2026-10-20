// Feature: skill-lifecycle-asset-system, Property 21: 成熟度员工语言投影
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MATURITY_LABEL_MAP,
  projectToCapabilitySummary,
} from "../capability/employee-capability/projection.ts";
import {
  computeCapabilityMaturity,
  computeCapabilityReuseValueScore,
  type CapabilityMaturityInput,
} from "./enterprise-asset-lifecycle.ts";

const maturityInputArb: fc.Arbitrary<CapabilityMaturityInput> = fc.record({
  depositedDays: fc.nat({ max: 1_000 }),
  usageCount: fc.nat({ max: 10_000 }),
  robotCount: fc.nat({ max: 200 }),
  employeeCount: fc.nat({ max: 1_000 }),
  averageSuccessRate: fc.double({ min: 0, max: 1, noNaN: true }),
  approvedReviewCount: fc.nat({ max: 20 }),
});

const hiddenEnterpriseMetricTerms = [
  "forming",
  "stable",
  "multi-reuse",
  "enterprise-certified",
  "core-asset",
  "reuseValueScore",
  "CapabilityReuseValueScore",
];

describe("Property 21: capability maturity projection", () => {
  it("maps every computed maturity to an employee-language label", () => {
    fc.assert(
      fc.property(maturityInputArb, (input) => {
        const maturity = computeCapabilityMaturity(input);
        const projected = projectToCapabilitySummary({
          id: "cap-maturity",
          name: "成熟能力",
          summary: "用于日常复用的能力",
          maturity: maturity,
          sourceRobot: { id: "robot-1", name: "机器人" },
        });

        expect(projected.maturity).toBe(MATURITY_LABEL_MAP[maturity]);
        expect(projected.maturity).toMatch(/^[\u4e00-\u9fa5]+$/u);
      }),
      { numRuns: 100 },
    );
  });

  it("keeps reuse value score bounded and out of employee projection", () => {
    fc.assert(
      fc.property(maturityInputArb, (input) => {
        const score = computeCapabilityReuseValueScore(input);
        expect(Object.values(score).every((value) => value >= 0 && value <= 100)).toBe(true);

        const projected = projectToCapabilitySummary({
          id: "cap-score",
          name: "复用能力",
          summary: "用于多人复用的能力",
          maturity: computeCapabilityMaturity(input),
          sourceRobot: { id: "robot-1", name: "机器人" },
        });
        const serialized = JSON.stringify(projected);

        for (const term of hiddenEnterpriseMetricTerms) {
          expect(serialized).not.toContain(term);
        }
      }),
      { numRuns: 100 },
    );
  });
});
