// @vitest-environment node
/**
 * Property-based tests for filter AND semantics, filter reset idempotence,
 * and pagination slice correctness.
 *
 * - Property 12: Filter AND semantics
 * - Property 13: Filter reset idempotence
 * - Property 14: Pagination slice correctness
 *
 * Validates: Requirements 3.1, 3.2, 3.4, 3.6, 17.2, 17.4
 */

import * as fc from "fast-check";
import { describe, it, expect } from "vitest";
import type {
  ApplicableScope,
  AssetLifecycle,
  AssetListFilters,
  CapabilityDomain,
  CapabilityMaturity,
  EnterpriseAssetListItem,
  EnterpriseHealthStatus,
} from "../../../capability/enterprise-capability/types.ts";
import { applyFilters, createDefaultFilters } from "../filter-utils.ts";
import { sliceForPage, autoCorrectPage, totalPagesFor } from "../pagination-utils.ts";

// --- Arbitraries ---

const domainArb: fc.Arbitrary<CapabilityDomain> = fc.constantFrom(
  "销售",
  "HR",
  "客服",
  "财务",
  "法务",
  "数据分析",
);

const maturityArb: fc.Arbitrary<CapabilityMaturity> = fc.constantFrom(
  "初步形成",
  "稳定使用",
  "多人复用",
  "企业认证",
  "企业标准",
  "核心资产",
);

const healthStatusArb: fc.Arbitrary<EnterpriseHealthStatus> = fc.constantFrom(
  "效果稳定",
  "偶尔结果不理想",
  "建议重新整理",
  "已不适合继续推广",
);

const lifecycleArb: fc.Arbitrary<AssetLifecycle> = fc.constantFrom(
  "submitted",
  "reviewing",
  "approved",
  "published",
  "deprecated",
  "retired",
);

const applicableScopeArb: fc.Arbitrary<ApplicableScope> = fc.oneof(
  fc.constant({ kind: "enterprise" as const }),
  fc.record({
    kind: fc.constant("department" as const),
    id: fc.string({ minLength: 1, maxLength: 8 }),
    name: fc.string({ minLength: 1, maxLength: 8 }),
  }),
  fc.record({
    kind: fc.constant("group" as const),
    id: fc.string({ minLength: 1, maxLength: 8 }),
    name: fc.string({ minLength: 1, maxLength: 8 }),
  }),
  fc.record({
    kind: fc.constant("role" as const),
    id: fc.string({ minLength: 1, maxLength: 8 }),
    name: fc.string({ minLength: 1, maxLength: 8 }),
  }),
);

const usageScenariosArb: fc.Arbitrary<string[]> = fc.array(
  fc.string({ minLength: 1, maxLength: 10 }),
  { minLength: 0, maxLength: 4 },
);

/**
 * Simplified item generator — only the fields needed for filter/pagination tests.
 */
const assetListItemArb: fc.Arbitrary<EnterpriseAssetListItem> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 20 }),
  description: fc.string({ minLength: 0, maxLength: 40 }),
  usageScenarios: usageScenariosArb,
  applicableScope: applicableScopeArb,
  domain: domainArb,
  maturity: maturityArb,
  healthStatus: healthStatusArb,
  lifecycle: lifecycleArb,
  valueSummary: fc.record({
    monthlyExecutions: fc.nat(),
    departmentCoverageCount: fc.nat(),
    reuseGrowthRate30d: fc.integer({ min: -100, max: 500 }),
  }),
  reuseData: fc.record({
    robotCount: fc.nat(),
    employeeCount: fc.nat(),
    departmentCount: fc.nat(),
    trend30Days: fc.array(fc.nat({ max: 1000 }), { minLength: 30, maxLength: 30 }),
    growthPercentage: fc.integer({ min: -100, max: 500 }),
  }),
  sourceEmployeeName: fc.string({ minLength: 1, maxLength: 10 }),
  avatar: fc.option(fc.webUrl(), { nil: null }),
});

const pageSizeArb: fc.Arbitrary<10 | 20 | 50> = fc.constantFrom(10, 20, 50);

// --- Property 12: Filter AND semantics ---

describe("Property 12: Filter AND semantics", () => {
  it("every item in result satisfies ALL active filter conditions", () => {
    /**
     * **Validates: Requirements 3.1, 3.2, 3.6**
     */
    const filtersArb: fc.Arbitrary<AssetListFilters> = fc.record({
      searchQuery: fc.oneof(fc.constant(""), fc.string({ minLength: 1, maxLength: 6 })),
      usageScenario: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: null }),
      applicableTarget: fc.option(
        fc.oneof(
          fc.constantFrom("全企业", "某部门", "某协作组", "某角色"),
          fc.string({ minLength: 1, maxLength: 8 }),
        ),
        { nil: null },
      ),
      domain: fc.option(domainArb, { nil: null }),
      maturity: fc.option(maturityArb, { nil: null }),
      healthStatus: fc.option(healthStatusArb, { nil: null }),
      onlyInstallable: fc.boolean(),
    });

    fc.assert(
      fc.property(
        fc.array(assetListItemArb, { minLength: 0, maxLength: 30 }),
        filtersArb,
        (items, filters) => {
          const result = applyFilters(items, filters);

          for (const item of result) {
            // searchQuery condition
            if (filters.searchQuery.trim()) {
              const q = filters.searchQuery.trim().toLocaleLowerCase();
              const nameMatch = item.name.toLocaleLowerCase().includes(q);
              const descMatch = item.description.toLocaleLowerCase().includes(q);
              expect(nameMatch || descMatch).toBe(true);
            }

            // usageScenario condition
            if (filters.usageScenario !== null) {
              expect(item.usageScenarios).toContain(filters.usageScenario);
            }

            // domain condition
            if (filters.domain !== null) {
              expect(item.domain).toBe(filters.domain);
            }

            // maturity condition
            if (filters.maturity !== null) {
              expect(item.maturity).toBe(filters.maturity);
            }

            // healthStatus condition
            if (filters.healthStatus !== null) {
              expect(item.healthStatus).toBe(filters.healthStatus);
            }

            // onlyInstallable condition
            if (filters.onlyInstallable) {
              expect(item.lifecycle).toBe("published");
              expect(item.healthStatus).not.toBe("已不适合继续推广");
            }
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it("no item satisfying all conditions is excluded from result", () => {
    /**
     * **Validates: Requirements 3.1, 3.2, 3.6**
     */
    fc.assert(
      fc.property(
        fc.array(assetListItemArb, { minLength: 0, maxLength: 30 }),
        fc.record({
          searchQuery: fc.oneof(fc.constant(""), fc.string({ minLength: 1, maxLength: 4 })),
          usageScenario: fc.option(fc.string({ minLength: 1, maxLength: 6 }), { nil: null }),
          applicableTarget: fc.constant(null),
          domain: fc.option(domainArb, { nil: null }),
          maturity: fc.option(maturityArb, { nil: null }),
          healthStatus: fc.option(healthStatusArb, { nil: null }),
          onlyInstallable: fc.boolean(),
        }) as fc.Arbitrary<AssetListFilters>,
        (items, filters) => {
          const result = applyFilters(items, filters);
          const resultIds = new Set(result.map((r) => r.id));

          for (const item of items) {
            // Manually check if item satisfies all conditions
            let satisfiesAll = true;

            if (filters.searchQuery.trim()) {
              const q = filters.searchQuery.trim().toLocaleLowerCase();
              if (
                !item.name.toLocaleLowerCase().includes(q) &&
                !item.description.toLocaleLowerCase().includes(q)
              ) {
                satisfiesAll = false;
              }
            }

            if (satisfiesAll && filters.usageScenario !== null) {
              if (!item.usageScenarios.includes(filters.usageScenario)) {
                satisfiesAll = false;
              }
            }

            if (satisfiesAll && filters.domain !== null) {
              if (item.domain !== filters.domain) {
                satisfiesAll = false;
              }
            }

            if (satisfiesAll && filters.maturity !== null) {
              if (item.maturity !== filters.maturity) {
                satisfiesAll = false;
              }
            }

            if (satisfiesAll && filters.healthStatus !== null) {
              if (item.healthStatus !== filters.healthStatus) {
                satisfiesAll = false;
              }
            }

            if (satisfiesAll && filters.onlyInstallable) {
              if (item.lifecycle !== "published" || item.healthStatus === "已不适合继续推广") {
                satisfiesAll = false;
              }
            }

            if (satisfiesAll) {
              expect(resultIds.has(item.id)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});

// --- Property 13: Filter reset idempotence ---

describe("Property 13: Filter reset idempotence", () => {
  it("createDefaultFilters() always returns the same structure", () => {
    /**
     * **Validates: Requirements 3.4**
     */
    fc.assert(
      fc.property(fc.nat({ max: 1000 }), () => {
        const a = createDefaultFilters();
        const b = createDefaultFilters();
        expect(a).toStrictEqual(b);
      }),
      { numRuns: 100 },
    );
  });

  it("createDefaultFilters() returns expected default values", () => {
    /**
     * **Validates: Requirements 3.4**
     */
    fc.assert(
      fc.property(fc.nat({ max: 1000 }), () => {
        const defaults = createDefaultFilters();
        expect(defaults.searchQuery).toBe("");
        expect(defaults.usageScenario).toBeNull();
        expect(defaults.applicableTarget).toBeNull();
        expect(defaults.domain).toBeNull();
        expect(defaults.maturity).toBeNull();
        expect(defaults.healthStatus).toBeNull();
        expect(defaults.onlyInstallable).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 14: Pagination slice correctness ---

describe("Property 14: Pagination slice correctness", () => {
  it("sliceForPage returns correct slice with expected length and start index", () => {
    /**
     * **Validates: Requirements 17.2, 17.4**
     */
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { minLength: 0, maxLength: 200 }),
        fc.integer({ min: 1, max: 50 }),
        pageSizeArb,
        (items, page, size) => {
          const totalPages = totalPagesFor(items.length, size);
          const safePage = Math.max(1, Math.min(page, totalPages));
          const result = sliceForPage(items, safePage, size);

          const expectedStart = (safePage - 1) * size;
          const expectedLength = Math.min(size, items.length - expectedStart);

          expect(result.length).toBe(Math.max(0, expectedLength));

          // Verify the slice content matches the expected range
          for (let i = 0; i < result.length; i++) {
            expect(result[i]).toBe(items[expectedStart + i]);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it("autoCorrectPage clamps page to [1, totalPages]", () => {
    /**
     * **Validates: Requirements 17.2, 17.4**
     */
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 200 }),
        fc.nat({ max: 500 }),
        pageSizeArb,
        (page, totalItems, size) => {
          const corrected = autoCorrectPage(page, totalItems, size);
          const totalPages = totalPagesFor(totalItems, size);

          expect(corrected).toBeGreaterThanOrEqual(1);
          expect(corrected).toBeLessThanOrEqual(totalPages);

          // If page is within valid range, it should be unchanged
          if (page >= 1 && page <= totalPages) {
            expect(corrected).toBe(page);
          }
          // If page < 1, corrected to 1
          if (page < 1) {
            expect(corrected).toBe(1);
          }
          // If page > totalPages, corrected to totalPages
          if (page > totalPages) {
            expect(corrected).toBe(totalPages);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it("totalPagesFor returns max(1, ceil(N/S))", () => {
    /**
     * **Validates: Requirements 17.2, 17.4**
     */
    fc.assert(
      fc.property(fc.nat({ max: 1000 }), pageSizeArb, (totalItems, size) => {
        const result = totalPagesFor(totalItems, size);

        if (totalItems <= 0) {
          expect(result).toBe(1);
        } else {
          expect(result).toBe(Math.max(1, Math.ceil(totalItems / size)));
        }

        // Always at least 1
        expect(result).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 150 },
    );
  });

  it("sliceForPage never returns more than pageSize items", () => {
    /**
     * **Validates: Requirements 17.2**
     */
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { minLength: 0, maxLength: 200 }),
        fc.integer({ min: 1, max: 100 }),
        pageSizeArb,
        (items, page, size) => {
          const result = sliceForPage(items, page, size);
          expect(result.length).toBeLessThanOrEqual(size);
        },
      ),
      { numRuns: 150 },
    );
  });
});
