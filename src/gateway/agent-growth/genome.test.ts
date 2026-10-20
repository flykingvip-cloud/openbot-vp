import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKING_STYLE,
  deriveWorkingStyleDelta,
  WORKING_STYLE_MIN_SAMPLES_AUTONOMOUS,
  WORKING_STYLE_MIN_SAMPLES_LEARNING,
} from "./genome.js";

describe("deriveWorkingStyleDelta evidence gates", () => {
  it("does not learn from a single successful task (no autonomous escalation)", () => {
    expect(
      deriveWorkingStyleDelta({
        tasksTotal: 1,
        taskSuccessRate: 1,
        humanTakeoverRate: 0,
      }),
    ).toEqual({});
  });

  it("does not grant autonomous below the autonomous sample threshold", () => {
    expect(
      deriveWorkingStyleDelta({
        tasksTotal: WORKING_STYLE_MIN_SAMPLES_LEARNING,
        taskSuccessRate: 1,
        humanTakeoverRate: 0,
      }),
    ).toEqual({});
  });

  it("grants autonomous only after enough stable successful tasks", () => {
    expect(
      deriveWorkingStyleDelta({
        tasksTotal: WORKING_STYLE_MIN_SAMPLES_AUTONOMOUS,
        taskSuccessRate: 0.95,
        humanTakeoverRate: 0.05,
      }),
    ).toMatchObject({ decisionPreference: "autonomous" });
  });

  it("allows conservative downgrade once learning threshold is met", () => {
    expect(
      deriveWorkingStyleDelta({
        tasksTotal: WORKING_STYLE_MIN_SAMPLES_LEARNING,
        humanTakeoverRate: 0.8,
        taskSuccessRate: 0.4,
      }),
    ).toMatchObject({
      riskPreference: "conservative",
      decisionPreference: "confirm_first",
    });
  });

  it("blocks all learning when tasksTotal is missing", () => {
    expect(
      deriveWorkingStyleDelta({
        taskSuccessRate: 1,
        humanTakeoverRate: 0,
      }),
    ).toEqual({});
  });

  it("does not change defaults for neutral mid-sample signals", () => {
    expect(
      deriveWorkingStyleDelta({
        tasksTotal: 8,
        humanTakeoverRate: 0.3,
        taskSuccessRate: 0.7,
      }),
    ).toEqual({});
    expect(DEFAULT_WORKING_STYLE.decisionPreference).toBe("confirm_first");
  });
});
