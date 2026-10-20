import { describe, expect, it } from "vitest";
import type { ToolExecutionRun } from "../contract.js";
import {
  canTransition,
  IllegalRunTransitionError,
  isTerminal,
  transitionRun,
} from "./run-state.js";

function run(phase: ToolExecutionRun["phase"] = "validated"): ToolExecutionRun {
  return { id: "run-1", nodeId: "n1", phase, policyDecisionId: "pd-1", attempts: 0, metadata: {} };
}

describe("run-state machine (R15)", () => {
  it("allows the happy path validated→scheduled→executing→streaming→finalized", () => {
    expect(canTransition("validated", "scheduled")).toBe(true);
    expect(canTransition("scheduled", "executing")).toBe(true);
    expect(canTransition("executing", "streaming")).toBe(true);
    expect(canTransition("streaming", "finalized")).toBe(true);
  });

  it("any active phase can fail", () => {
    for (const p of ["validated", "scheduled", "executing", "streaming"] as const) {
      expect(canTransition(p, "failed")).toBe(true);
    }
  });

  it("rejects illegal transitions (e.g. finalized→executing)", () => {
    expect(canTransition("finalized", "executing")).toBe(false);
    expect(() => transitionRun(run("finalized"), "executing")).toThrow(IllegalRunTransitionError);
  });

  it("transition emits an observable event", () => {
    const { run: next, event } = transitionRun(run("validated"), "scheduled");
    expect(next.phase).toBe("scheduled");
    expect(event).toEqual({ runId: "run-1", nodeId: "n1", from: "validated", to: "scheduled" });
  });

  it("same-phase transition is a no-op with no event", () => {
    const { run: next, event } = transitionRun(run("executing"), "executing");
    expect(next.phase).toBe("executing");
    expect(event).toBeUndefined();
  });

  it("finalized and failed are terminal", () => {
    expect(isTerminal("finalized")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("executing")).toBe(false);
  });
});
