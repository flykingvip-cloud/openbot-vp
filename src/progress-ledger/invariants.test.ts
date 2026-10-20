import { describe, expect, it } from "vitest";
import { foldEvents } from "./fold.js";
import { collectLedgerInvariants } from "./invariants.js";
import { completeStep, ev, seedPlan } from "./test-helpers.js";
import type { ExecutionLedger } from "./types.js";

function mutate<T>(value: T, edit: (draft: T) => void): T {
  const draft = structuredClone(value);
  edit(draft);
  return draft;
}

describe("ledger invariants", () => {
  it("I2 flags a completed step that was never verified", () => {
    const events = [...seedPlan(), ...completeStep("E1", "A1", 10_000)];
    const ledger = mutate(foldEvents(events), (draft: ExecutionLedger) => {
      const step = draft.steps.find((item) => item.id === "E1");
      if (step) {
        step.verified = false;
      }
    });
    expect(collectLedgerInvariants(events, ledger).some((item) => item.id === "I2")).toBe(true);
  });

  it("I3 flags met acceptance without evidence", () => {
    const events = seedPlan();
    const ledger = mutate(foldEvents(events), (draft: ExecutionLedger) => {
      const item = draft.acceptance.find((row) => row.id === "A1");
      if (item) {
        item.status = "met";
        item.evidence = [];
      }
    });
    expect(collectLedgerInvariants(events, ledger).some((item) => item.id === "I3")).toBe(true);
  });

  it("I4 flags task.completed when a required criterion is still open", () => {
    const events = [...seedPlan(), ...completeStep("E1", "A1", 10_000)];
    const ledger = mutate(foldEvents(events), (draft: ExecutionLedger) => {
      draft.completed = true;
    });
    expect(collectLedgerInvariants(events, ledger).some((item) => item.id === "I4")).toBe(true);
  });

  it("I1 flags an llm actor in the event log", () => {
    const events = [
      ...seedPlan(),
      ev("STEP_STARTED", { stepId: "E1", actor: "llm" as never, atMs: 10_000 }),
    ];
    const ledger = foldEvents(seedPlan());
    expect(collectLedgerInvariants(events, ledger).some((item) => item.id === "I1")).toBe(true);
  });

  it("a valid happy-path fold has no I1–I5 violations", () => {
    const events = [
      ...seedPlan(),
      ...completeStep("E1", "A1", 10_000),
      ...completeStep("E2", "A2", 20_000),
      ...completeStep("E3", "A3", 30_000),
      ...completeStep("E4", "A4", 40_000),
    ];
    expect(collectLedgerInvariants(events, foldEvents(events))).toEqual([]);
  });
});
