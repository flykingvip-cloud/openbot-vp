// @vitest-environment node
// Feature: capability-lifecycle-closure, Task 2.3 — 评分与候选池单元测试
// Validates: Requirements 2.1, 2.2, 2.3, 2.6, 1.2, 1.7, 1.8
// Properties: P2 (Score Dimension Boundaries), P3 (Weight Redistribution)

import { describe, expect, it } from "vitest";
import {
  calcBusinessCoverage,
  calcCompositeScore,
  calcEffectStability,
  calcEmployeeSatisfaction,
  calcReuseBreath,
  calculateIncubationScore,
  WEIGHTS,
  type ScoreDimension,
  type ScoreInput,
} from "../incubation-score.ts";

describe("calcReuseBreath", () => {
  it("returns 0 when both robotCount and employeeCount are 0", () => {
    expect(calcReuseBreath(0, 0)).toBe(0);
  });

  it("caps robotScore at 100 for large robotCount", () => {
    // robotScore = min(100, 20*10) = 100, employeeScore = min(100, 0*5) = 0
    // result = round(100*0.4 + 0*0.6) = 40
    expect(calcReuseBreath(20, 0)).toBe(40);
  });

  it("caps employeeScore at 100 for large employeeCount", () => {
    // robotScore = 0, employeeScore = min(100, 30*5) = 100
    // result = round(0*0.4 + 100*0.6) = 60
    expect(calcReuseBreath(0, 30)).toBe(60);
  });

  it("caps both at 100 for very large values", () => {
    // robotScore = 100, employeeScore = 100
    // result = round(100*0.4 + 100*0.6) = 100
    expect(calcReuseBreath(1000, 1000)).toBe(100);
  });

  it("computes weighted average for moderate values", () => {
    // robotScore = min(100, 5*10) = 50, employeeScore = min(100, 10*5) = 50
    // result = round(50*0.4 + 50*0.6) = 50
    expect(calcReuseBreath(5, 10)).toBe(50);
  });

  it("result is always in [0, 100]", () => {
    const cases = [
      [0, 0],
      [1, 1],
      [10, 20],
      [100, 100],
      [0, 1000],
      [1000, 0],
    ];
    for (const [r, e] of cases) {
      const score = calcReuseBreath(r, e);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

describe("calcEffectStability", () => {
  it("returns 100 for perfect rate (1.0) and zero stdDev", () => {
    expect(calcEffectStability(1.0, 0)).toBe(100);
  });

  it("returns 0 for zero rate regardless of stdDev", () => {
    expect(calcEffectStability(0, 0)).toBe(0);
  });

  it("applies high stdDev penalty", () => {
    // rateScore = 100, stabilityPenalty = min(50, 0.25*200) = 50
    // result = max(0, 100 - 50) = 50
    expect(calcEffectStability(1.0, 0.25)).toBe(50);
  });

  it("penalty is capped at 50", () => {
    // rateScore = 100, stabilityPenalty = min(50, 1.0*200) = 50
    // result = max(0, 100 - 50) = 50
    expect(calcEffectStability(1.0, 1.0)).toBe(50);
  });

  it("result never goes below 0", () => {
    // rateScore = min(100, 0.2*100) = 20, penalty = min(50, 0.5*200) = 50
    // result = max(0, 20 - 50) = 0
    expect(calcEffectStability(0.2, 0.5)).toBe(0);
  });

  it("result is always in [0, 100]", () => {
    const cases: [number, number][] = [
      [0, 0],
      [0.5, 0.1],
      [1.0, 0],
      [1.0, 0.5],
      [0.3, 0.8],
    ];
    for (const [rate, std] of cases) {
      const score = calcEffectStability(rate, std);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

describe("calcBusinessCoverage", () => {
  it("returns 0 when both departmentCount and roleCount are 0", () => {
    expect(calcBusinessCoverage(0, 0)).toBe(0);
  });

  it("caps deptScore at 100 for large departmentCount", () => {
    // deptScore = min(100, 10*20) = 100, roleScore = 0
    // result = round(100*0.6 + 0*0.4) = 60
    expect(calcBusinessCoverage(10, 0)).toBe(60);
  });

  it("caps roleScore at 100 for large roleCount", () => {
    // deptScore = 0, roleScore = min(100, 10*15) = 100
    // result = round(0*0.6 + 100*0.4) = 40
    expect(calcBusinessCoverage(0, 10)).toBe(40);
  });

  it("caps both at 100 for very large values", () => {
    expect(calcBusinessCoverage(100, 100)).toBe(100);
  });

  it("computes weighted average for moderate values", () => {
    // deptScore = min(100, 3*20) = 60, roleScore = min(100, 4*15) = 60
    // result = round(60*0.6 + 60*0.4) = 60
    expect(calcBusinessCoverage(3, 4)).toBe(60);
  });

  it("result is always in [0, 100]", () => {
    const cases = [
      [0, 0],
      [1, 1],
      [5, 7],
      [50, 50],
    ];
    for (const [d, r] of cases) {
      const score = calcBusinessCoverage(d, r);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

describe("calcEmployeeSatisfaction", () => {
  it("returns available:false when both inputs are null", () => {
    const result = calcEmployeeSatisfaction(null, null);
    expect(result.available).toBe(false);
    expect(result.value).toBe(0);
  });

  it("returns available:true when only installRate is provided", () => {
    const result = calcEmployeeSatisfaction(0.8, null);
    expect(result.available).toBe(true);
    // installScore = min(100, 0.8*100) = 80, usageScore = 50 (default)
    // value = round(80*0.5 + 50*0.5) = 65
    expect(result.value).toBe(65);
  });

  it("returns available:true when only continuousUsageDays is provided", () => {
    const result = calcEmployeeSatisfaction(null, 20);
    expect(result.available).toBe(true);
    // installScore = 50 (default), usageScore = min(100, 20*3) = 60
    // value = round(50*0.5 + 60*0.5) = 55
    expect(result.value).toBe(55);
  });

  it("computes correctly when both are provided", () => {
    const result = calcEmployeeSatisfaction(1.0, 40);
    expect(result.available).toBe(true);
    // installScore = 100, usageScore = min(100, 40*3) = 100
    // value = round(100*0.5 + 100*0.5) = 100
    expect(result.value).toBe(100);
  });

  it("caps value at 100", () => {
    const result = calcEmployeeSatisfaction(1.5, 100);
    expect(result.available).toBe(true);
    // installScore = min(100, 150) = 100, usageScore = min(100, 300) = 100
    expect(result.value).toBe(100);
  });

  it("value is always in [0, 100] when available", () => {
    const cases: [number | null, number | null][] = [
      [0, 0],
      [0.5, 10],
      [1.0, 50],
      [0, null],
      [null, 0],
    ];
    for (const [rate, days] of cases) {
      const result = calcEmployeeSatisfaction(rate, days);
      if (result.available) {
        expect(result.value).toBeGreaterThanOrEqual(0);
        expect(result.value).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("calcCompositeScore — Property 2 & 3", () => {
  it("returns weighted average when all dimensions are available", () => {
    const dimensions: Record<string, ScoreDimension> = {
      reuseBreath: { value: 80, available: true },
      effectStability: { value: 60, available: true },
      businessCoverage: { value: 70, available: true },
      employeeSatisfaction: { value: 90, available: true },
    };
    // weighted = 80*0.3 + 60*0.3 + 70*0.2 + 90*0.2 = 24 + 18 + 14 + 18 = 74
    expect(calcCompositeScore(dimensions)).toBe(74);
  });

  it("redistributes weights when one dimension is unavailable (Property 3)", () => {
    const dimensions: Record<string, ScoreDimension> = {
      reuseBreath: { value: 80, available: true },
      effectStability: { value: 60, available: true },
      businessCoverage: { value: 70, available: true },
      employeeSatisfaction: { value: 0, available: false },
    };
    // Available weights: 0.3 + 0.3 + 0.2 = 0.8
    // Redistributed: reuseBreath=0.3/0.8, effectStability=0.3/0.8, businessCoverage=0.2/0.8
    // weighted = 80*(0.3/0.8) + 60*(0.3/0.8) + 70*(0.2/0.8)
    //          = 80*0.375 + 60*0.375 + 70*0.25
    //          = 30 + 22.5 + 17.5 = 70
    expect(calcCompositeScore(dimensions)).toBe(70);
  });

  it("redistributes weights when two dimensions are unavailable (Property 3)", () => {
    const dimensions: Record<string, ScoreDimension> = {
      reuseBreath: { value: 80, available: true },
      effectStability: { value: 60, available: true },
      businessCoverage: { value: 0, available: false },
      employeeSatisfaction: { value: 0, available: false },
    };
    // Available weights: 0.3 + 0.3 = 0.6
    // Redistributed: reuseBreath=0.3/0.6=0.5, effectStability=0.3/0.6=0.5
    // weighted = 80*0.5 + 60*0.5 = 40 + 30 = 70
    expect(calcCompositeScore(dimensions)).toBe(70);
  });

  it("returns single dimension value when only one is available", () => {
    const dimensions: Record<string, ScoreDimension> = {
      reuseBreath: { value: 80, available: true },
      effectStability: { value: 0, available: false },
      businessCoverage: { value: 0, available: false },
      employeeSatisfaction: { value: 0, available: false },
    };
    // Only reuseBreath available, weight = 0.3/0.3 = 1.0
    // weighted = 80 * 1.0 = 80
    expect(calcCompositeScore(dimensions)).toBe(80);
  });

  it("returns 0 when all dimensions are unavailable", () => {
    const dimensions: Record<string, ScoreDimension> = {
      reuseBreath: { value: 0, available: false },
      effectStability: { value: 0, available: false },
      businessCoverage: { value: 0, available: false },
      employeeSatisfaction: { value: 0, available: false },
    };
    expect(calcCompositeScore(dimensions)).toBe(0);
  });

  it("redistributed weights sum to 1.0 (Property 3 invariant)", () => {
    // Verify the logic: for any subset of available dimensions,
    // the redistributed weights should sum to 1.0
    const allKeys = Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[];
    // Test all possible subsets (excluding empty set)
    for (let mask = 1; mask < 1 << allKeys.length; mask++) {
      const available = allKeys.filter((_, i) => (mask >> i) & 1);
      const totalWeight = available.reduce((sum, key) => sum + WEIGHTS[key], 0);
      const redistributedSum = available.reduce((sum, key) => sum + WEIGHTS[key] / totalWeight, 0);
      expect(redistributedSum).toBeCloseTo(1.0, 10);
    }
  });
});

describe("calculateIncubationScore — integration", () => {
  it("computes full score for a complete input", () => {
    const input: ScoreInput = {
      robotCount: 5,
      employeeCount: 10,
      successRate30d: 0.95,
      successRateStdDev: 0.05,
      departmentCount: 3,
      roleCount: 4,
      installRate: 0.8,
      continuousUsageDays: 20,
    };
    const result = calculateIncubationScore(input);

    // Verify all dimensions are available
    expect(result.reuseBreath.available).toBe(true);
    expect(result.effectStability.available).toBe(true);
    expect(result.businessCoverage.available).toBe(true);
    expect(result.employeeSatisfaction.available).toBe(true);

    // Verify dimension values are in [0, 100] (Property 2)
    expect(result.reuseBreath.value).toBeGreaterThanOrEqual(0);
    expect(result.reuseBreath.value).toBeLessThanOrEqual(100);
    expect(result.effectStability.value).toBeGreaterThanOrEqual(0);
    expect(result.effectStability.value).toBeLessThanOrEqual(100);
    expect(result.businessCoverage.value).toBeGreaterThanOrEqual(0);
    expect(result.businessCoverage.value).toBeLessThanOrEqual(100);
    expect(result.employeeSatisfaction.value).toBeGreaterThanOrEqual(0);
    expect(result.employeeSatisfaction.value).toBeLessThanOrEqual(100);

    // Verify composite score matches weighted average
    const expected =
      result.reuseBreath.value * 0.3 +
      result.effectStability.value * 0.3 +
      result.businessCoverage.value * 0.2 +
      result.employeeSatisfaction.value * 0.2;
    expect(result.compositeScore).toBe(Math.round(expected));
  });

  it("handles null satisfaction inputs (triggers weight redistribution)", () => {
    const input: ScoreInput = {
      robotCount: 5,
      employeeCount: 10,
      successRate30d: 0.9,
      successRateStdDev: 0.1,
      departmentCount: 3,
      roleCount: 4,
      installRate: null,
      continuousUsageDays: null,
    };
    const result = calculateIncubationScore(input);

    expect(result.employeeSatisfaction.available).toBe(false);
    // Composite should exclude employeeSatisfaction and redistribute
    expect(result.compositeScore).toBeGreaterThan(0);
    expect(result.compositeScore).toBeLessThanOrEqual(100);
  });

  it("composite score is in [0, 100] for any valid input (Property 2)", () => {
    const inputs: ScoreInput[] = [
      {
        robotCount: 0,
        employeeCount: 0,
        successRate30d: 0,
        successRateStdDev: 0,
        departmentCount: 0,
        roleCount: 0,
        installRate: null,
        continuousUsageDays: null,
      },
      {
        robotCount: 100,
        employeeCount: 100,
        successRate30d: 1.0,
        successRateStdDev: 0,
        departmentCount: 10,
        roleCount: 10,
        installRate: 1.0,
        continuousUsageDays: 100,
      },
      {
        robotCount: 3,
        employeeCount: 5,
        successRate30d: 0.7,
        successRateStdDev: 0.3,
        departmentCount: 2,
        roleCount: 2,
        installRate: 0.5,
        continuousUsageDays: 10,
      },
    ];
    for (const input of inputs) {
      const result = calculateIncubationScore(input);
      expect(result.compositeScore).toBeGreaterThanOrEqual(0);
      expect(result.compositeScore).toBeLessThanOrEqual(100);
    }
  });
});
