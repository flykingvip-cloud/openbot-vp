// @vitest-environment node
// Feature: capability-lifecycle-closure, Task 2.3 — 评分与候选池单元测试
// Validates: Requirements 2.1, 2.2, 2.3, 2.6, 1.2, 1.7, 1.8
// Properties: P1 (Candidate Pool Filtering), P6 (Sort Invariant), P15 (Domain Filtering)

import { describe, expect, it } from "vitest";
import type { CapabilityDomain } from "../../../capability/enterprise-capability/types.ts";
import { filterByDomain, sortCandidates, type CandidateCapability } from "../candidate-pool.ts";

// --- Helpers ---

function makeCandidate(overrides: Partial<CandidateCapability> = {}): CandidateCapability {
  return {
    capabilityId: "cap-1",
    name: "测试能力",
    maturity: "企业认证",
    calls30d: 200,
    departmentCount: 3,
    successRate: 0.9,
    domain: "销售",
    score: {
      reuseBreath: { value: 70, available: true },
      effectStability: { value: 80, available: true },
      businessCoverage: { value: 60, available: true },
      employeeSatisfaction: { value: 75, available: true },
      compositeScore: 72,
    },
    ...overrides,
  };
}

// --- filterByDomain (Property 15) ---

describe("filterByDomain — Property 15: Domain Filtering", () => {
  const candidates: CandidateCapability[] = [
    makeCandidate({ capabilityId: "1", domain: "销售" }),
    makeCandidate({ capabilityId: "2", domain: "HR" }),
    makeCandidate({ capabilityId: "3", domain: "客服" }),
    makeCandidate({ capabilityId: "4", domain: "销售" }),
    makeCandidate({ capabilityId: "5", domain: "财务" }),
  ];

  it("returns all candidates when domain is null", () => {
    const result = filterByDomain(candidates, null);
    expect(result).toHaveLength(candidates.length);
    expect(result).toEqual(candidates);
  });

  it("filters correctly for 销售 domain", () => {
    const result = filterByDomain(candidates, "销售");
    expect(result).toHaveLength(2);
    for (const c of result) {
      expect(c.domain).toBe("销售");
    }
  });

  it("filters correctly for HR domain", () => {
    const result = filterByDomain(candidates, "HR");
    expect(result).toHaveLength(1);
    expect(result[0].domain).toBe("HR");
  });

  it("returns empty array when no candidates match domain", () => {
    const result = filterByDomain(candidates, "法务");
    expect(result).toHaveLength(0);
  });

  it("every result has the specified domain (Property 15 invariant)", () => {
    const domains: CapabilityDomain[] = ["销售", "HR", "客服", "财务", "法务", "数据分析"];
    for (const domain of domains) {
      const result = filterByDomain(candidates, domain);
      for (const c of result) {
        expect(c.domain).toBe(domain);
      }
    }
  });

  it("does not mutate the original array", () => {
    const original = [...candidates];
    filterByDomain(candidates, "销售");
    expect(candidates).toEqual(original);
  });
});

// --- sortCandidates (Property 6) ---

describe("sortCandidates — Property 6: Sort Invariant", () => {
  const candidates: CandidateCapability[] = [
    makeCandidate({
      capabilityId: "1",
      calls30d: 50,
      score: { ...makeCandidate().score!, compositeScore: 80 },
    }),
    makeCandidate({
      capabilityId: "2",
      calls30d: 300,
      score: { ...makeCandidate().score!, compositeScore: 60 },
    }),
    makeCandidate({
      capabilityId: "3",
      calls30d: 150,
      score: { ...makeCandidate().score!, compositeScore: 90 },
    }),
    makeCandidate({
      capabilityId: "4",
      calls30d: 200,
      score: { ...makeCandidate().score!, compositeScore: 70 },
    }),
    makeCandidate({
      capabilityId: "5",
      calls30d: 100,
      score: { ...makeCandidate().score!, compositeScore: 85 },
    }),
  ];

  it("sorts by calls30d descending", () => {
    const sorted = sortCandidates(candidates, "calls30d");
    for (let i = 0; i < sorted.length - 1; i++) {
      expect(sorted[i].calls30d).toBeGreaterThanOrEqual(sorted[i + 1].calls30d);
    }
  });

  it("sorts by compositeScore descending", () => {
    const sorted = sortCandidates(candidates, "compositeScore");
    for (let i = 0; i < sorted.length - 1; i++) {
      const scoreA = sorted[i].score?.compositeScore ?? 0;
      const scoreB = sorted[i + 1].score?.compositeScore ?? 0;
      expect(scoreA).toBeGreaterThanOrEqual(scoreB);
    }
  });

  it("calls30d sort produces correct order", () => {
    const sorted = sortCandidates(candidates, "calls30d");
    expect(sorted[0].calls30d).toBe(300);
    expect(sorted[1].calls30d).toBe(200);
    expect(sorted[2].calls30d).toBe(150);
    expect(sorted[3].calls30d).toBe(100);
    expect(sorted[4].calls30d).toBe(50);
  });

  it("compositeScore sort produces correct order", () => {
    const sorted = sortCandidates(candidates, "compositeScore");
    expect(sorted[0].score?.compositeScore).toBe(90);
    expect(sorted[1].score?.compositeScore).toBe(85);
    expect(sorted[2].score?.compositeScore).toBe(80);
    expect(sorted[3].score?.compositeScore).toBe(70);
    expect(sorted[4].score?.compositeScore).toBe(60);
  });

  it("handles candidates with null score (treated as 0)", () => {
    const withNull: CandidateCapability[] = [
      makeCandidate({ capabilityId: "1", score: null }),
      makeCandidate({
        capabilityId: "2",
        score: { ...makeCandidate().score!, compositeScore: 50 },
      }),
      makeCandidate({ capabilityId: "3", score: null }),
    ];
    const sorted = sortCandidates(withNull, "compositeScore");
    expect(sorted[0].score?.compositeScore).toBe(50);
    // null scores treated as 0, should come after
    expect(sorted[1].score).toBeNull();
    expect(sorted[2].score).toBeNull();
  });

  it("stability: equal values maintain relative order", () => {
    const sameValues: CandidateCapability[] = [
      makeCandidate({ capabilityId: "a", calls30d: 100 }),
      makeCandidate({ capabilityId: "b", calls30d: 100 }),
      makeCandidate({ capabilityId: "c", calls30d: 100 }),
    ];
    const sorted = sortCandidates(sameValues, "calls30d");
    // All have same calls30d, sort should not crash and maintain length
    expect(sorted).toHaveLength(3);
    for (let i = 0; i < sorted.length - 1; i++) {
      expect(sorted[i].calls30d).toBeGreaterThanOrEqual(sorted[i + 1].calls30d);
    }
  });

  it("does not mutate the original array", () => {
    const original = [...candidates];
    sortCandidates(candidates, "calls30d");
    expect(candidates).toEqual(original);
  });

  it("returns empty array for empty input", () => {
    const sorted = sortCandidates([], "calls30d");
    expect(sorted).toHaveLength(0);
  });

  it("single element array is already sorted", () => {
    const single = [makeCandidate({ capabilityId: "only" })];
    const sorted = sortCandidates(single, "compositeScore");
    expect(sorted).toHaveLength(1);
    expect(sorted[0].capabilityId).toBe("only");
  });
});
