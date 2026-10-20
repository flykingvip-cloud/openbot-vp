// @vitest-environment node
/**
 * Property-based tests for domain aggregation utilities.
 *
 * Covers:
 * - 6-domain completeness
 * - representative capability selection
 * - coverage rate calculation
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  ApplicableScope,
  AssetLifecycle,
  CapabilityDomain,
  CapabilityMaturity,
  DomainDistribution,
  EnterpriseAssetListItem,
  EnterpriseHealthStatus,
} from "../../../capability/enterprise-capability/types.ts";
import { CAPABILITY_DOMAINS } from "../../../capability/enterprise-capability/types.ts";
import { aggregateByDomain, emptyDomainDistributions } from "../domain-aggregation.ts";

const maturityArb: fc.Arbitrary<CapabilityMaturity> = fc.constantFrom(
  "初步形成",
  "稳定使用",
  "多人复用",
  "企业认证",
  "企业标准",
  "核心资产",
);

const assetArb: fc.Arbitrary<EnterpriseAssetListItem> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 20 }),
  description: fc.string({ minLength: 0, maxLength: 40 }),
  usageScenarios: fc.array(fc.string({ minLength: 1, maxLength: 8 }), {
    minLength: 0,
    maxLength: 4,
  }),
  applicableScope: fc.oneof(
    fc.constant({ kind: "enterprise" as const }),
    fc.record({
      kind: fc.constant("department" as const),
      id: fc.string({ minLength: 1, maxLength: 10 }),
      name: fc.string({ minLength: 1, maxLength: 10 }),
    }),
    fc.record({
      kind: fc.constant("group" as const),
      id: fc.string({ minLength: 1, maxLength: 10 }),
      name: fc.string({ minLength: 1, maxLength: 10 }),
    }),
    fc.record({
      kind: fc.constant("role" as const),
      id: fc.string({ minLength: 1, maxLength: 10 }),
      name: fc.string({ minLength: 1, maxLength: 10 }),
    }),
  ) as fc.Arbitrary<ApplicableScope>,
  domain: fc.constantFrom(...CAPABILITY_DOMAINS),
  maturity: maturityArb,
  healthStatus: fc.constantFrom(
    "效果稳定",
    "偶尔结果不理想",
    "建议重新整理",
    "已不适合继续推广",
  ) as fc.Arbitrary<EnterpriseHealthStatus>,
  lifecycle: fc.constantFrom(
    "submitted",
    "reviewing",
    "approved",
    "published",
    "deprecated",
    "retired",
  ) as fc.Arbitrary<AssetLifecycle>,
  valueSummary: fc.record({
    monthlyExecutions: fc.nat({ max: 10_000 }),
    departmentCoverageCount: fc.nat({ max: 50 }),
    reuseGrowthRate30d: fc.integer({ min: -100, max: 500 }),
  }),
  reuseData: fc.record({
    robotCount: fc.nat({ max: 100 }),
    employeeCount: fc.nat({ max: 200 }),
    departmentCount: fc.nat({ max: 50 }),
    trend30Days: fc.array(fc.nat({ max: 10_000 }), { minLength: 30, maxLength: 30 }),
    growthPercentage: fc.integer({ min: -100, max: 500 }),
  }),
  sourceEmployeeName: fc.string({ minLength: 1, maxLength: 12 }),
  avatar: fc.option(fc.webUrl(), { nil: null }),
});

const maturityRank: Record<CapabilityMaturity, number> = {
  初步形成: 1,
  稳定使用: 2,
  多人复用: 3,
  企业认证: 4,
  企业标准: 5,
  核心资产: 6,
};

const domainIndex = new Map<CapabilityDomain, number>(
  CAPABILITY_DOMAINS.map((domain, index) => [domain, index]),
);

function expectedTopThreeNames(items: EnterpriseAssetListItem[]): string[] {
  return [...items]
    .toSorted((a, b) => {
      const maturityDelta = maturityRank[b.maturity] - maturityRank[a.maturity];
      if (maturityDelta !== 0) {
        return maturityDelta;
      }
      return b.valueSummary.monthlyExecutions - a.valueSummary.monthlyExecutions;
    })
    .slice(0, 3)
    .map((item) => item.name);
}

function expectedAggregate(items: EnterpriseAssetListItem[]): DomainDistribution[] {
  const totalItems = items.length;
  const buckets = new Map<CapabilityDomain, EnterpriseAssetListItem[]>();
  for (const domain of CAPABILITY_DOMAINS) {
    buckets.set(domain, []);
  }
  for (const item of items) {
    buckets.get(item.domain)?.push(item);
  }

  return [...CAPABILITY_DOMAINS]
    .map((domain) => {
      const domainItems = buckets.get(domain) ?? [];
      return {
        domain,
        capabilityCount: domainItems.length,
        representativeCapabilities: expectedTopThreeNames(domainItems),
        coverageRate: totalItems === 0 ? 0 : Math.round((domainItems.length / totalItems) * 100),
      };
    })
    .toSorted((a, b) => {
      if (a.capabilityCount !== b.capabilityCount) {
        return b.capabilityCount - a.capabilityCount;
      }
      return (domainIndex.get(a.domain) ?? 0) - (domainIndex.get(b.domain) ?? 0);
    });
}

describe("domain aggregation", () => {
  it("returns six empty domain buckets in canonical order", () => {
    expect(emptyDomainDistributions()).toEqual(
      CAPABILITY_DOMAINS.map((domain) => ({
        domain,
        capabilityCount: 0,
        representativeCapabilities: [],
        coverageRate: 0,
      })),
    );
  });

  it("aggregates by domain with stable coverage and top-3 selection", () => {
    fc.assert(
      fc.property(fc.array(assetArb, { minLength: 0, maxLength: 40 }), (items) => {
        const result = aggregateByDomain(items);
        const expected = expectedAggregate(items);

        expect(result).toEqual(expected);
        expect(result).toHaveLength(6);
        expect(result.every((entry) => entry.representativeCapabilities.length <= 3)).toBe(true);
        expect(result.reduce((sum, entry) => sum + entry.capabilityCount, 0)).toBe(items.length);
        for (const entry of result) {
          expect(entry.coverageRate).toBeGreaterThanOrEqual(0);
          expect(entry.coverageRate).toBeLessThanOrEqual(100);
        }
      }),
      { numRuns: 200 },
    );
  });
});
