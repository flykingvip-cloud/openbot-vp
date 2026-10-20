// @vitest-environment node
/**
 * Property-based tests for ordering utilities.
 *
 * Covers:
 * - Property 11: default capability ordering
 * - Property 17: time-order invariants for records and queues
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  ApplicableScope,
  AssetLifecycle,
  CapabilityMaturity,
  EnterpriseAssetListItem,
  EnterpriseHealthStatus,
  InstallRelation,
  ReviewQueueItem,
  ReviewRecord,
  ContributionRecord,
} from "../../../capability/enterprise-capability/types.ts";
import {
  MATURITY_ORDER,
  compareByDefaultSort,
  sortContributionRecordsAscending,
  sortInstallRecordsDescending,
  sortReviewHistoryDescending,
  sortReviewQueueAscending,
} from "../ordering-utils.ts";

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
);

const assetArb: fc.Arbitrary<EnterpriseAssetListItem> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 16 }),
  description: fc.string({ minLength: 0, maxLength: 32 }),
  usageScenarios: fc.array(fc.string({ minLength: 1, maxLength: 8 }), {
    minLength: 0,
    maxLength: 4,
  }),
  applicableScope: applicableScopeArb,
  domain: fc.constantFrom("销售", "HR", "客服", "财务", "法务", "数据分析"),
  maturity: maturityArb,
  healthStatus: healthStatusArb,
  lifecycle: lifecycleArb,
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

const contributionRecordArb: fc.Arbitrary<ContributionRecord> = fc.record({
  id: fc.uuid(),
  employeeId: fc.uuid(),
  employeeName: fc.string({ minLength: 1, maxLength: 12 }),
  timestamp: fc.nat({ max: 2_000_000_000 }),
  type: fc.constantFrom("初始提交", "内容修改", "场景补充"),
  summary: fc.string({ minLength: 1, maxLength: 64 }),
});

const reviewRecordArb: fc.Arbitrary<ReviewRecord> = fc.record({
  id: fc.uuid(),
  reviewerId: fc.uuid(),
  reviewerName: fc.string({ minLength: 1, maxLength: 12 }),
  timestamp: fc.nat({ max: 2_000_000_000 }),
  result: fc.constantFrom("通过", "拒绝", "需修改"),
  opinion: fc.string({ minLength: 1, maxLength: 64 }),
});

const installRelationArb: fc.Arbitrary<InstallRelation> = fc.record({
  id: fc.uuid(),
  capabilityId: fc.uuid(),
  capabilityName: fc.string({ minLength: 1, maxLength: 20 }),
  robotId: fc.uuid(),
  robotName: fc.string({ minLength: 1, maxLength: 20 }),
  installedAt: fc.nat({ max: 2_000_000_000 }),
  source: fc.constantFrom("管理员推送", "员工自主安装"),
  status: fc.constantFrom("正常运行", "已暂停", "待更新"),
});

const reviewQueueItemArb: fc.Arbitrary<ReviewQueueItem> = fc.record({
  id: fc.uuid(),
  capabilityId: fc.uuid(),
  capabilityName: fc.string({ minLength: 1, maxLength: 20 }),
  capabilitySummary: fc.string({ minLength: 1, maxLength: 32 }),
  usageScenarios: fc.array(fc.string({ minLength: 1, maxLength: 8 }), {
    minLength: 0,
    maxLength: 4,
  }),
  sourceEmployee: fc.record({ id: fc.uuid(), name: fc.string({ minLength: 1, maxLength: 12 }) }),
  sourceRobot: fc.record({ id: fc.uuid(), name: fc.string({ minLength: 1, maxLength: 12 }) }),
  sourceTaskSummary: fc.string({ minLength: 1, maxLength: 32 }),
  usageCount: fc.nat({ max: 10_000 }),
  robotCount: fc.nat({ max: 100 }),
  lastUsedAt: fc.option(fc.nat({ max: 2_000_000_000 }), { nil: null }),
  submittedAt: fc.nat({ max: 2_000_000_000 }),
  status: fc.constantFrom("待审核", "审核中"),
});

describe("Property 11: default capability ordering", () => {
  it("sorts by maturity desc, then monthlyExecutions desc", () => {
    fc.assert(
      fc.property(fc.array(assetArb, { minLength: 0, maxLength: 40 }), (items) => {
        const snapshot = items.map((item) => ({ ...item }));
        const sorted = [...items].toSorted(compareByDefaultSort);

        expect(items).toEqual(snapshot);
        for (let i = 0; i < sorted.length - 1; i += 1) {
          const current = sorted[i];
          const next = sorted[i + 1];
          expect(MATURITY_ORDER[current.maturity]).toBeGreaterThanOrEqual(
            MATURITY_ORDER[next.maturity],
          );
          if (current.maturity === next.maturity) {
            expect(current.valueSummary.monthlyExecutions).toBeGreaterThanOrEqual(
              next.valueSummary.monthlyExecutions,
            );
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe("Property 17: time-order invariants", () => {
  it("sortContributionRecordsAscending returns timestamps in ascending order", () => {
    fc.assert(
      fc.property(fc.array(contributionRecordArb, { minLength: 0, maxLength: 40 }), (records) => {
        const snapshot = records.map((record) => ({ ...record }));
        const sorted = sortContributionRecordsAscending(records);

        expect(records).toEqual(snapshot);
        for (let i = 0; i < sorted.length - 1; i += 1) {
          expect(sorted[i].timestamp).toBeLessThanOrEqual(sorted[i + 1].timestamp);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("sortReviewHistoryDescending returns timestamps in descending order", () => {
    fc.assert(
      fc.property(fc.array(reviewRecordArb, { minLength: 0, maxLength: 40 }), (records) => {
        const snapshot = records.map((record) => ({ ...record }));
        const sorted = sortReviewHistoryDescending(records);

        expect(records).toEqual(snapshot);
        for (let i = 0; i < sorted.length - 1; i += 1) {
          expect(sorted[i].timestamp).toBeGreaterThanOrEqual(sorted[i + 1].timestamp);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("sortInstallRecordsDescending returns timestamps in descending order", () => {
    fc.assert(
      fc.property(fc.array(installRelationArb, { minLength: 0, maxLength: 40 }), (records) => {
        const snapshot = records.map((record) => ({ ...record }));
        const sorted = sortInstallRecordsDescending(records);

        expect(records).toEqual(snapshot);
        for (let i = 0; i < sorted.length - 1; i += 1) {
          expect(sorted[i].installedAt).toBeGreaterThanOrEqual(sorted[i + 1].installedAt);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("sortReviewQueueAscending returns submissions in ascending order", () => {
    fc.assert(
      fc.property(fc.array(reviewQueueItemArb, { minLength: 0, maxLength: 40 }), (items) => {
        const snapshot = items.map((item) => ({ ...item }));
        const sorted = sortReviewQueueAscending(items);

        expect(items).toEqual(snapshot);
        for (let i = 0; i < sorted.length - 1; i += 1) {
          expect(sorted[i].submittedAt).toBeLessThanOrEqual(sorted[i + 1].submittedAt);
        }
      }),
      { numRuns: 200 },
    );
  });
});
