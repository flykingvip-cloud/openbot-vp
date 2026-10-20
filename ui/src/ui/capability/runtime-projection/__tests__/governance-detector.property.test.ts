// @vitest-environment node
// Feature: enterprise-capability-usage-management
// Property 6: 治理检测器幂等性与边界

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  detectGovernanceIssues,
  type CapabilityMetadataForGovernance,
} from "../governance-detector.ts";
import type { GovernanceConfig, InstallRelationEnhanced } from "../types.ts";
import { DEFAULT_GOVERNANCE_CONFIG } from "../types.ts";

const installRelationArb: fc.Arbitrary<InstallRelationEnhanced> = fc.record({
  id: fc
    .string({ minLength: 1, maxLength: 16 })
    .filter((s) => /^[a-z0-9]+$/i.test(s) && s.length > 0),
  capabilityId: fc
    .string({ minLength: 1, maxLength: 16 })
    .filter((s) => /^[a-z0-9]+$/i.test(s) && s.length > 0),
  capabilityName: fc
    .string({ minLength: 1, maxLength: 30 })
    .filter((s) => !/runtime|template|cpu|memory/i.test(s)),
  robotId: fc
    .string({ minLength: 1, maxLength: 16 })
    .filter((s) => /^[a-z0-9]+$/i.test(s) && s.length > 0),
  robotName: fc
    .string({ minLength: 1, maxLength: 30 })
    .filter((s) => !/runtime|template|cpu|memory/i.test(s)),
  installedAt: fc.integer({ min: 0, max: 1_700_000_000_000 }),
  source: fc.constantFrom("员工沉淀", "企业发布"),
  usageStats: fc.record({
    executions30d: fc.nat({ max: 10000 }),
    successRate: fc.double({ min: 0, max: 1, noNaN: true }),
  }),
  status: fc.constantFrom("正常", "待优化", "已停用"),
});

describe("Property 6: detectGovernanceIssues idempotency", () => {
  it("returns identical results when called twice with same inputs", () => {
    fc.assert(
      fc.property(
        fc.array(installRelationArb, { maxLength: 20 }),
        fc.integer({ min: 1_700_000_000_000, max: 1_800_000_000_000 }),
        (relations, now) => {
          const result1 = detectGovernanceIssues(relations, [], DEFAULT_GOVERNANCE_CONFIG, now);
          const result2 = detectGovernanceIssues(relations, [], DEFAULT_GOVERNANCE_CONFIG, now);
          expect(result1).toEqual(result2);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("issueId remains stable across calls", () => {
    fc.assert(
      fc.property(
        fc.array(installRelationArb, { maxLength: 20 }),
        fc.integer({ min: 1_700_000_000_000, max: 1_800_000_000_000 }),
        (relations, now) => {
          const result1 = detectGovernanceIssues(relations, [], DEFAULT_GOVERNANCE_CONFIG, now);
          const result2 = detectGovernanceIssues(relations, [], DEFAULT_GOVERNANCE_CONFIG, now);
          const ids1 = result1.map((i) => i.issueId);
          const ids2 = result2.map((i) => i.issueId);
          expect(ids1).toEqual(ids2);
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("Property 6: low-efficiency boundary (strict)", () => {
  const config: GovernanceConfig = {
    lowEfficiency: { minExecutions: 50, maxSuccessRate: 0.7 },
    zombie: { minInstallDays: 30 },
    conflict: { minSimilarity: 0.8 },
  };
  const now = 1_700_000_000_000;

  it("does NOT flag relation with executions === 50 and successRate === 0.70", () => {
    const relation: InstallRelationEnhanced = {
      id: "r1",
      capabilityId: "c1",
      capabilityName: "test cap",
      robotId: "rob1",
      robotName: "test bot",
      installedAt: now - 10 * 24 * 3600 * 1000,
      source: "员工沉淀",
      usageStats: { executions30d: 50, successRate: 0.7 },
      status: "正常",
    };
    const issues = detectGovernanceIssues([relation], [], config, now);
    expect(issues.filter((i) => i.type === "低效能力")).toHaveLength(0);
  });

  it("DOES flag relation strictly inside failure region (executions=51, rate=0.69)", () => {
    const relation: InstallRelationEnhanced = {
      id: "r1",
      capabilityId: "c1",
      capabilityName: "test cap",
      robotId: "rob1",
      robotName: "test bot",
      installedAt: now - 10 * 24 * 3600 * 1000,
      source: "员工沉淀",
      usageStats: { executions30d: 51, successRate: 0.69 },
      status: "正常",
    };
    const issues = detectGovernanceIssues([relation], [], config, now);
    expect(issues.filter((i) => i.type === "低效能力")).toHaveLength(1);
  });
});

describe("Property 6: zombie boundary (strict)", () => {
  const config: GovernanceConfig = {
    lowEfficiency: { minExecutions: 50, maxSuccessRate: 0.7 },
    zombie: { minInstallDays: 30 },
    conflict: { minSimilarity: 0.8 },
  };
  const now = 1_700_000_000_000;
  const exactly30DaysAgo = now - 30 * 24 * 3600 * 1000;
  const moreThan30DaysAgo = now - 31 * 24 * 3600 * 1000;

  it("does NOT flag relation with installDays === 30 and 0 executions", () => {
    const relation: InstallRelationEnhanced = {
      id: "r1",
      capabilityId: "c1",
      capabilityName: "test cap",
      robotId: "rob1",
      robotName: "test bot",
      installedAt: exactly30DaysAgo,
      source: "员工沉淀",
      usageStats: { executions30d: 0, successRate: 0 },
      status: "正常",
    };
    const issues = detectGovernanceIssues([relation], [], config, now);
    expect(issues.filter((i) => i.type === "未使用能力")).toHaveLength(0);
  });

  it("DOES flag relation with installDays > 30 and 0 executions", () => {
    const relation: InstallRelationEnhanced = {
      id: "r1",
      capabilityId: "c1",
      capabilityName: "test cap",
      robotId: "rob1",
      robotName: "test bot",
      installedAt: moreThan30DaysAgo,
      source: "员工沉淀",
      usageStats: { executions30d: 0, successRate: 0 },
      status: "正常",
    };
    const issues = detectGovernanceIssues([relation], [], config, now);
    expect(issues.filter((i) => i.type === "未使用能力")).toHaveLength(1);
  });
});

describe("Property 6: conflict detection", () => {
  const config: GovernanceConfig = {
    lowEfficiency: { minExecutions: 50, maxSuccessRate: 0.7 },
    zombie: { minInstallDays: 30 },
    conflict: { minSimilarity: 0.8 },
  };
  const now = 1_700_000_000_000;

  it("flags two capabilities on same robot with same domain and identical descriptions", () => {
    const r1: InstallRelationEnhanced = {
      id: "r1",
      capabilityId: "c1",
      capabilityName: "客户跟进 A",
      robotId: "rob1",
      robotName: "CRM 助手",
      installedAt: now - 5 * 24 * 3600 * 1000,
      source: "员工沉淀",
      usageStats: { executions30d: 100, successRate: 0.9 },
      status: "正常",
    };
    const r2: InstallRelationEnhanced = {
      ...r1,
      id: "r2",
      capabilityId: "c2",
      capabilityName: "客户跟进 B",
    };
    const meta: CapabilityMetadataForGovernance[] = [
      { capabilityId: "c1", domain: "Sales", description: "follow up customer leads daily" },
      { capabilityId: "c2", domain: "Sales", description: "follow up customer leads daily" },
    ];
    const issues = detectGovernanceIssues([r1, r2], meta, config, now);
    const conflicts = issues.filter((i) => i.type === "冲突能力");
    expect(conflicts.length).toBeGreaterThanOrEqual(2);
  });
});
