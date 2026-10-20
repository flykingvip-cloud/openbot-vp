import { describe, expect, it } from "vitest";
import {
  assertEvolutionTransition,
  listForbiddenShortcuts,
  transitionEvolutionProposal,
} from "./state-machine.js";

describe("evolution-core state machine", () => {
  it("walks the governed happy path to PROMOTED", () => {
    const path = [
      ["DISCOVERED", "suggest", "SUGGESTED"],
      ["SUGGESTED", "submit", "PENDING_AUTHORITY"],
      ["PENDING_AUTHORITY", "authorize", "APPROVED_FOR_EXPERIMENT"],
      ["APPROVED_FOR_EXPERIMENT", "start_experiment", "EXPERIMENTING"],
      ["EXPERIMENTING", "approve_application", "APPROVED_FOR_APPLICATION"],
      ["APPROVED_FOR_APPLICATION", "apply_canary", "CANARY"],
      ["CANARY", "activate", "ACTIVE"],
      ["ACTIVE", "verify", "VERIFIED"],
      ["VERIFIED", "promote", "PROMOTED"],
    ] as const;
    for (const [from, command, next] of path) {
      expect(assertEvolutionTransition(from, command)).toBe(next);
    }
  });

  it("forbids applying or verifying from APPROVED_FOR_EXPERIMENT", () => {
    for (const command of ["apply_canary", "activate", "verify"] as const) {
      const result = transitionEvolutionProposal("APPROVED_FOR_EXPERIMENT", command);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("illegal_transition");
      }
    }
  });

  it("forbids promoting ACTIVE or CANARY without VERIFIED", () => {
    expect(transitionEvolutionProposal("ACTIVE", "promote").ok).toBe(false);
    expect(transitionEvolutionProposal("CANARY", "promote").ok).toBe(false);
  });

  it("keeps every documented shortcut forbidden", () => {
    for (const row of listForbiddenShortcuts()) {
      const result = transitionEvolutionProposal(row.from, row.command);
      expect(result.ok).toBe(false);
    }
  });

  it("returns a canary to EXPERIMENTING after a rollback drill, not business rollback", () => {
    expect(assertEvolutionTransition("CANARY", "rollback_drill")).toBe("EXPERIMENTING");
    expect(assertEvolutionTransition("CANARY", "rollback")).toBe("ROLLED_BACK");
    expect(transitionEvolutionProposal("EXPERIMENTING", "rollback_drill").ok).toBe(false);
    expect(transitionEvolutionProposal("VERIFIED", "rollback_drill").ok).toBe(false);
    expect(transitionEvolutionProposal("PROMOTED", "rollback_drill").ok).toBe(false);
  });

  it("holds an experiment and resumes without skipping authority", () => {
    expect(assertEvolutionTransition("EXPERIMENTING", "hold")).toBe("HELD");
    expect(assertEvolutionTransition("HELD", "start_experiment")).toBe("EXPERIMENTING");
    expect(transitionEvolutionProposal("CANARY", "hold").ok).toBe(false);
    expect(transitionEvolutionProposal("VERIFIED", "hold").ok).toBe(false);
    expect(transitionEvolutionProposal("HELD", "promote").ok).toBe(false);
  });

  it("freezes terminal statuses except rollback from PROMOTED", () => {
    expect(transitionEvolutionProposal("REJECTED", "authorize").ok).toBe(false);
    expect(transitionEvolutionProposal("EXPIRED", "suggest").ok).toBe(false);
    expect(assertEvolutionTransition("PROMOTED", "rollback")).toBe("ROLLED_BACK");
  });
});
