// @vitest-environment node
/**
 * Property-based tests for maturity state machine.
 *
 * Covers:
 * - Property 9: Maturity level calculation
 * - Property 10: Promotion guards
 * - Property 11: Maturity-based default sorting
 *
 * Validates: Requirements 5.1, 5.2, 5.4, 5.5, 5.8, 5.9, 5.10
 */

import * as fc from "fast-check";
import { describe, it, expect } from "vitest";
import type { CapabilityMaturity } from "../../../capability/enterprise-capability/types.ts";
import {
  calculateMaturity,
  canPromoteToCertified,
  canPromoteToStandard,
  compareMaturity,
  MATURITY_THRESHOLDS,
} from "../maturity-state-machine.ts";

/**
 * Arbitrary for MaturityMetrics matching the domain constraints.
 */
const metricsArb = fc.record({
  usageCount: fc.nat({ max: 2000 }),
  userCount: fc.nat({ max: 100 }),
  reuseRate: fc.integer({ min: 0, max: 100 }),
  successRate: fc.integer({ min: 0, max: 100 }),
  adoptionRate: fc.integer({ min: 0, max: 100 }),
});

/**
 * Arbitrary for CapabilityMaturity values.
 */
const maturityArb: fc.Arbitrary<CapabilityMaturity> = fc.constantFrom(
  "初步形成" as const,
  "稳定使用" as const,
  "多人复用" as const,
  "企业认证" as const,
  "企业标准" as const,
  "核心资产" as const,
);

/**
 * Helper: check if metrics satisfy ALL thresholds for a given level.
 */
function meetsAllThresholds(
  metrics: {
    usageCount: number;
    userCount: number;
    reuseRate: number;
    successRate: number;
    adoptionRate: number;
  },
  level: CapabilityMaturity,
): boolean {
  const t = MATURITY_THRESHOLDS[level];
  return (
    metrics.usageCount >= t.minUsageCount &&
    metrics.userCount >= t.minUserCount &&
    metrics.reuseRate >= t.minReuseRate &&
    metrics.successRate >= t.minSuccessRate &&
    metrics.adoptionRate >= t.minAdoptionRate
  );
}

/**
 * The auto-levels in ascending order (excludes 企业认证 and 企业标准).
 */
const AUTO_LEVELS_ASCENDING: CapabilityMaturity[] = [
  "初步形成",
  "稳定使用",
  "多人复用",
  "核心资产",
];

/**
 * Auto-levels that can be returned by calculateMaturity, in ascending order
 * (excluding the fallback 初步形成 which is always the default).
 */
const AUTO_LEVELS_CHECKED: CapabilityMaturity[] = ["稳定使用", "多人复用", "核心资产"];

describe("Property 9: Maturity level calculation", () => {
  /**
   * **Validates: Requirements 5.1, 5.2**
   *
   * For any MaturityMetrics, calculateMaturity returns the highest auto-level
   * whose ALL thresholds are satisfied. Auto-levels only: 核心资产, 多人复用, 稳定使用
   * (企业认证 and 企业标准 are skipped). Default fallback: 初步形成.
   *
   * Verify: if result is X, then metrics satisfy ALL thresholds for X;
   * and for the next higher auto-level, at least one threshold is NOT satisfied.
   */
  it("returns the highest auto-level whose ALL thresholds are satisfied", () => {
    fc.assert(
      fc.property(metricsArb, (metrics) => {
        const result = calculateMaturity(metrics);

        // Result must be one of the auto-levels or the fallback
        expect(AUTO_LEVELS_ASCENDING).toContain(result);

        // The result level's thresholds must ALL be satisfied
        expect(meetsAllThresholds(metrics, result)).toBe(true);

        // For the next higher auto-level (if any), at least one threshold must NOT be satisfied
        const resultIndex = AUTO_LEVELS_ASCENDING.indexOf(result);
        if (resultIndex < AUTO_LEVELS_ASCENDING.length - 1) {
          // Find the next auto-level above the result
          const nextHigherLevel = AUTO_LEVELS_ASCENDING[resultIndex + 1];
          expect(meetsAllThresholds(metrics, nextHigherLevel)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("never returns 企业认证 or 企业标准 (manual-only levels)", () => {
    fc.assert(
      fc.property(metricsArb, (metrics) => {
        const result = calculateMaturity(metrics);
        expect(result).not.toBe("企业认证");
        expect(result).not.toBe("企业标准");
      }),
      { numRuns: 100 },
    );
  });

  it("returns 初步形成 when no auto-level thresholds are met", () => {
    fc.assert(
      fc.property(metricsArb, (metrics) => {
        const result = calculateMaturity(metrics);
        if (result === "初步形成") {
          // None of the checked auto-levels should have all thresholds satisfied
          for (const level of AUTO_LEVELS_CHECKED) {
            expect(meetsAllThresholds(metrics, level)).toBe(false);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("Property 10: Promotion guards", () => {
  /**
   * **Validates: Requirements 5.8, 5.9, 5.10**
   *
   * canPromoteToCertified: ok only when maturity is "稳定使用" or "多人复用"
   * canPromoteToStandard: ok only when maturity is "企业认证"
   * All other maturity values → { ok: false }
   */
  it("canPromoteToCertified allows only 稳定使用 or 多人复用", () => {
    fc.assert(
      fc.property(maturityArb, (maturity) => {
        const result = canPromoteToCertified({ maturity });
        if (maturity === "稳定使用" || maturity === "多人复用") {
          expect(result).toEqual({ ok: true });
        } else {
          expect(result.ok).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("canPromoteToStandard allows only 企业认证", () => {
    fc.assert(
      fc.property(maturityArb, (maturity) => {
        const result = canPromoteToStandard({ maturity });
        if (maturity === "企业认证") {
          expect(result).toEqual({ ok: true });
        } else {
          expect(result.ok).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("Property 11: Maturity-based default sorting", () => {
  /**
   * **Validates: Requirements 5.5**
   *
   * For any list of items with maturity values, sorting by compareMaturity DESC
   * produces a list where each item's maturity rank >= next item's rank.
   * 核心资产(6) > 企业标准(5) > 企业认证(4) > 多人复用(3) > 稳定使用(2) > 初步形成(1)
   */
  const MATURITY_RANK: Record<CapabilityMaturity, number> = {
    初步形成: 1,
    稳定使用: 2,
    多人复用: 3,
    企业认证: 4,
    企业标准: 5,
    核心资产: 6,
  };

  it("sorting by compareMaturity DESC produces non-increasing rank order", () => {
    fc.assert(
      fc.property(fc.array(maturityArb, { minLength: 0, maxLength: 50 }), (maturities) => {
        // Sort descending using compareMaturity (b - a for DESC)
        const sorted = [...maturities].toSorted((a, b) => compareMaturity(b, a));

        // Verify non-increasing rank order
        for (let i = 0; i < sorted.length - 1; i++) {
          expect(MATURITY_RANK[sorted[i]]).toBeGreaterThanOrEqual(MATURITY_RANK[sorted[i + 1]]);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("compareMaturity is consistent with rank ordering", () => {
    fc.assert(
      fc.property(maturityArb, maturityArb, (a, b) => {
        const cmp = compareMaturity(a, b);
        const rankDiff = MATURITY_RANK[a] - MATURITY_RANK[b];

        // Sign must match
        if (rankDiff > 0) {
          expect(cmp).toBeGreaterThan(0);
        } else if (rankDiff < 0) {
          expect(cmp).toBeLessThan(0);
        } else {
          expect(cmp).toBe(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
