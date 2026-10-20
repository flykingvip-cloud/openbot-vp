import { describe, expect, it } from "vitest";
import {
  buildGrowthFlowStep,
  isGrowthFlowStepActive,
  type GrowthFlowSubStepStatus,
} from "./co-flow-step.ts";
import type { GrowthStatus, LifecycleState } from "./types.ts";

function statusOf(lifecycleState: LifecycleState, activationScore = 50): GrowthStatus {
  return {
    lifecycleState,
    dimensions: { identity: 0, capability: 0, knowledge: 0, habits: 0 },
    birthAtMs: 1,
    activationScore,
    operationalScore: null,
    capabilityReadiness: false,
    isActivated: lifecycleState === "activated" || lifecycleState === "evolution",
    milestones: { createdAtMs: 1 },
  };
}

function statusList(step: ReturnType<typeof buildGrowthFlowStep>): GrowthFlowSubStepStatus[] {
  return step.subSteps.map((s) => s.status);
}

describe("buildGrowthFlowStep", () => {
  it("titles step '\u0041gent 成长' with 5 lifecycle subSteps (≤12 chars title)", () => {
    const step = buildGrowthFlowStep(statusOf("birth"));
    expect(step.title).toBe("Agent 成长");
    expect(step.title.length).toBeLessThanOrEqual(12);
    expect(step.kind).toBe("auto");
    expect(step.subSteps.map((s) => s.id)).toEqual([
      "growth-birth",
      "growth-growing",
      "growth-mission_ready",
      "growth-activated",
      "growth-evolution",
    ]);
  });

  it("marks past stages done, current in_progress, future pending (growing)", () => {
    const step = buildGrowthFlowStep(statusOf("growing"));
    expect(statusList(step)).toEqual(["done", "in_progress", "pending", "pending", "pending"]);
    expect(step.initialStatus).toBe("in_progress");
  });

  it("mission_ready advances the in_progress cursor", () => {
    const step = buildGrowthFlowStep(statusOf("mission_ready"));
    expect(statusList(step)).toEqual(["done", "done", "in_progress", "pending", "pending"]);
    expect(step.initialStatus).toBe("in_progress");
  });

  it("terminal lifecycle (activated) marks current done and step done", () => {
    const step = buildGrowthFlowStep(statusOf("activated", 88));
    expect(statusList(step)).toEqual(["done", "done", "done", "done", "pending"]);
    expect(step.initialStatus).toBe("done");
    expect(step.description).toContain("88/100");
    expect(step.description).toContain("已激活");
  });

  it("evolution marks all prior done and itself done", () => {
    const step = buildGrowthFlowStep(statusOf("evolution", 95));
    expect(statusList(step)).toEqual(["done", "done", "done", "done", "done"]);
    expect(step.initialStatus).toBe("done");
  });

  it("rounds activationScore in description", () => {
    const step = buildGrowthFlowStep(statusOf("birth", 12.7));
    expect(step.description).toContain("13/100");
    expect(step.description).toContain("诞生");
  });
});

describe("isGrowthFlowStepActive", () => {
  it("is active during birth/growing/mission_ready", () => {
    expect(isGrowthFlowStepActive(statusOf("birth"))).toBe(true);
    expect(isGrowthFlowStepActive(statusOf("growing"))).toBe(true);
    expect(isGrowthFlowStepActive(statusOf("mission_ready"))).toBe(true);
  });

  it("is inactive once activated/evolution (journey complete)", () => {
    expect(isGrowthFlowStepActive(statusOf("activated"))).toBe(false);
    expect(isGrowthFlowStepActive(statusOf("evolution"))).toBe(false);
  });
});
