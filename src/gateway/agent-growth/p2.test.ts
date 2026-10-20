import { describe, expect, it } from "vitest";
import { buildGrowthReportSnapshot, estimateHoursSaved } from "./growth-report.js";
import { computeBusinessImpact } from "./impact-metrics.js";
import {
  computeAdaptivityAdjustment,
  computeOperationalScore,
  detectFalseReady,
} from "./operational-score.js";

describe("computeOperationalScore", () => {
  it("returns null with no signals (preserves null contract)", () => {
    expect(computeOperationalScore()).toBeNull();
    expect(computeOperationalScore({})).toBeNull();
  });

  it("weights present signals and normalizes", () => {
    // only taskSuccessRate present → equals that rate * 100
    expect(computeOperationalScore({ taskSuccessRate: 0.9 })).toBe(90);
  });

  it("inverts human takeover rate", () => {
    // only takeover present (weight 0.1) → (1-0.8)*100 normalized = 20
    expect(computeOperationalScore({ humanTakeoverRate: 0.8 })).toBe(20);
  });

  it("combines multiple signals", () => {
    const score = computeOperationalScore({
      taskSuccessRate: 1,
      toolSuccessRate: 1,
      satisfaction: 1,
      humanTakeoverRate: 0,
    });
    expect(score).toBe(100);
  });
});

describe("detectFalseReady", () => {
  it("flags high activation + low operational", () => {
    expect(detectFalseReady(95, 20)).toBe(true);
  });
  it("does not flag when operational is null (no data)", () => {
    expect(detectFalseReady(95, null)).toBe(false);
  });
  it("does not flag healthy operational", () => {
    expect(detectFalseReady(95, 80)).toBe(false);
  });
});

describe("computeBusinessImpact", () => {
  it("returns empty for no input", () => {
    expect(computeBusinessImpact()).toEqual([]);
  });
  it("skips zero/negative counts and falls back to known descriptions", () => {
    const metrics = computeBusinessImpact({
      manual_review_avoided: { value: 37, description: "" },
      risk_contracts_flagged: { value: 0, description: "x" },
    });
    expect(metrics).toEqual([
      { key: "manual_review_avoided", value: 37, description: "减少人工审核" },
    ]);
  });
});

describe("buildGrowthReportSnapshot", () => {
  it("estimates hours saved from tasks when not provided", () => {
    expect(estimateHoursSaved({ tasksCompleted: 6 })).toBe(2); // 6*20/60 = 2h
    expect(estimateHoursSaved({ tasksCompleted: 6, hoursSavedEstimate: 5 })).toBe(5);
  });

  it("assembles a snapshot with businessImpact and reserved rate fields", () => {
    const snap = buildGrowthReportSnapshot({
      periodDays: 30,
      generatedAtMs: 1000,
      tasksCompleted: 12,
      learningMaterialsCount: 3,
      toolInvocations: 842,
      taskSuccessRate: 0.8,
      businessImpactInput: {
        customer_auto_replies: { value: 286, description: "" },
      },
    });
    expect(snap.periodDays).toBe(30);
    expect(snap.toolInvocations).toBe(842);
    expect(snap.taskSuccessRate).toBe(0.8);
    expect(snap.toolSuccessRate).toBeNull();
    expect(snap.businessImpact).toEqual([
      { key: "customer_auto_replies", value: 286, description: "自动回复客户" },
    ]);
    expect(snap.hoursSavedEstimate).toBe(4); // 12*20/60
  });
});

describe("computeAdaptivityAdjustment (third-order self-tuning)", () => {
  it("returns 0 below the minimum sample count", () => {
    expect(computeAdaptivityAdjustment(undefined)).toBe(0);
    expect(
      computeAdaptivityAdjustment({ improvedCount: 1, regressedCount: 0, assessedCount: 2 }),
    ).toBe(0);
  });

  it("gives a positive bounded bonus when changes mostly improved", () => {
    // net = (5-0)/5 = 1 → +MAX (6)
    expect(
      computeAdaptivityAdjustment({ improvedCount: 5, regressedCount: 0, assessedCount: 5 }),
    ).toBe(6);
  });

  it("gives a negative bounded penalty when changes mostly regressed", () => {
    // net = (0-4)/4 = -1 → -MAX (6)
    expect(
      computeAdaptivityAdjustment({ improvedCount: 0, regressedCount: 4, assessedCount: 4 }),
    ).toBe(-6);
  });

  it("scales linearly for mixed outcomes", () => {
    // net = (3-1)/4 = 0.5 → round(0.5*6) = 3
    expect(
      computeAdaptivityAdjustment({ improvedCount: 3, regressedCount: 1, assessedCount: 4 }),
    ).toBe(3);
  });
});
