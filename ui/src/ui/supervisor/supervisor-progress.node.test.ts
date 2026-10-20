import { describe, expect, it } from "vitest";
import {
  formatSupervisorIterationProgress,
  resolveSupervisorStageChip,
} from "./supervisor-types.ts";

describe("formatSupervisorIterationProgress (P0-2)", () => {
  it("uses 第 i/max 轮 while in progress", () => {
    expect(
      formatSupervisorIterationProgress({
        state: "executing",
        usedRounds: 2,
        maxIterations: 5,
      }),
    ).toBe("第 2/5 轮");
  });

  it("uses 已用 N 轮 · 上限 max for terminal states", () => {
    expect(
      formatSupervisorIterationProgress({
        state: "max_iterations",
        usedRounds: 174,
        maxIterations: 5,
      }),
    ).toBe("已用 174 轮 · 上限 5");
  });

  it("does not render bare fraction that looks like a progress bar", () => {
    const label = formatSupervisorIterationProgress({
      state: "escalated",
      usedRounds: 174,
      maxIterations: 5,
    });
    expect(label).not.toMatch(/^\d+\s*\/\s*\d+$/);
    expect(label).toContain("已用");
  });
});

describe("resolveSupervisorStageChip (P1-2)", () => {
  it("maps engine states to stage chips", () => {
    expect(resolveSupervisorStageChip("executing").id).toBe("executing");
    expect(resolveSupervisorStageChip("validating").label).toBe("验证中");
    expect(resolveSupervisorStageChip("fixing").label).toBe("修复中");
    expect(resolveSupervisorStageChip("escalated").label).toContain("Needs You");
    expect(resolveSupervisorStageChip("planned").label).toBe("Needs You");
  });
});
