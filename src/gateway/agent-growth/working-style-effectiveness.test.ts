import { describe, expect, it } from "vitest";
import {
  aggregateWorkingStyleEffectiveness,
  resolveWorkingStyleCohort,
  type WorkingStyleEffectivenessInput,
  workingStyleDeltaSignature,
} from "./working-style-effectiveness.js";

describe("workingStyleDeltaSignature", () => {
  it("is order-independent and canonical", () => {
    expect(
      workingStyleDeltaSignature({
        riskPreference: "conservative",
        decisionPreference: "confirm_first",
      }),
    ).toBe("decisionPreference=confirm_first;riskPreference=conservative");
    expect(
      workingStyleDeltaSignature({
        decisionPreference: "confirm_first",
        riskPreference: "conservative",
      }),
    ).toBe("decisionPreference=confirm_first;riskPreference=conservative");
  });

  it("returns (none) for an empty delta and ignores null/undefined", () => {
    expect(workingStyleDeltaSignature({})).toBe("(none)");
    expect(
      workingStyleDeltaSignature({ riskPreference: undefined, decisionPreference: null }),
    ).toBe("(none)");
  });
});

describe("resolveWorkingStyleCohort", () => {
  it("is stable for the same agent and returns all-treatment at 0 control fraction", () => {
    const a = resolveWorkingStyleCohort("agent-x", 0.2);
    const b = resolveWorkingStyleCohort("agent-x", 0.2);
    expect(a).toBe(b);
    expect(resolveWorkingStyleCohort("agent-x", 0)).toBe("treatment");
  });

  it("assigns roughly the requested control fraction across many agents", () => {
    let control = 0;
    const n = 2000;
    for (let i = 0; i < n; i += 1) {
      if (resolveWorkingStyleCohort(`agent-${i}`, 0.2) === "control") {
        control += 1;
      }
    }
    const fraction = control / n;
    // within a tolerance band around 0.2
    expect(fraction).toBeGreaterThan(0.1);
    expect(fraction).toBeLessThan(0.3);
  });
});

describe("aggregateWorkingStyleEffectiveness", () => {
  function item(
    overrides: Partial<WorkingStyleEffectivenessInput> = {},
  ): WorkingStyleEffectivenessInput {
    return {
      agentId: "a1",
      appliedDelta: { riskPreference: "conservative" },
      status: "improved",
      deltaScore: 10,
      rolledBack: false,
      ...overrides,
    };
  }

  it("aggregates overall counts, improvedRate and avgDeltaScore", () => {
    const agg = aggregateWorkingStyleEffectiveness([
      item({ agentId: "a1", status: "improved", deltaScore: 10 }),
      item({ agentId: "a2", status: "regressed", deltaScore: -6, rolledBack: true }),
      item({ agentId: "a3", status: "inconclusive", deltaScore: null }),
    ]);
    expect(agg.overall.total).toBe(3);
    expect(agg.overall.improved).toBe(1);
    expect(agg.overall.regressed).toBe(1);
    expect(agg.overall.inconclusive).toBe(1);
    expect(agg.overall.rolledBack).toBe(1);
    expect(agg.overall.improvedRate).toBeCloseTo(0.5); // 1 / (1+1)
    expect(agg.overall.avgDeltaScore).toBeCloseTo(2); // (10 + -6) / 2
  });

  it("groups by delta signature and ranks by net effectiveness", () => {
    const agg = aggregateWorkingStyleEffectiveness([
      item({ agentId: "a1", appliedDelta: { riskPreference: "conservative" }, status: "improved" }),
      item({ agentId: "a2", appliedDelta: { riskPreference: "conservative" }, status: "improved" }),
      item({
        agentId: "a3",
        appliedDelta: { decisionPreference: "autonomous" },
        status: "regressed",
      }),
    ]);
    expect(agg.bySignature[0]?.signature).toBe("riskPreference=conservative");
    expect(agg.bySignature[0]?.netEffectiveness).toBe(1);
    expect(agg.bySignature.at(-1)?.signature).toBe("decisionPreference=autonomous");
    expect(agg.bySignature.at(-1)?.netEffectiveness).toBe(-1);
  });

  it("splits into treatment/control cohorts summing to total", () => {
    const agg = aggregateWorkingStyleEffectiveness(
      Array.from({ length: 20 }, (_unused, i) => item({ agentId: `agent-${i}` })),
      { controlFraction: 0.2 },
    );
    expect(agg.byCohort.treatment.total + agg.byCohort.control.total).toBe(20);
  });
});
