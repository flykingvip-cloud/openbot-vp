import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LEDGER_I7_DEFINED_IN_INVARIANTS,
  fakeLedgerIntentCases,
  proveLedgerBridgeFakeEvents,
} from "./ledger-bridge-fake-events.js";
import { ORCHESTRATION_LIVE_INVOKE } from "./types.js";

describe("ledger-bridge fake-event I1 proof", () => {
  const proof = proveLedgerBridgeFakeEvents();

  it("never imports or calls appendLedgerEvent (writerCalled=false)", () => {
    const importLines = (source: string) =>
      source
        .split("\n")
        .filter((line) => /^\s*import\b/.test(line))
        .join("\n");
    const bridge = readFileSync(
      fileURLToPath(new URL("./ledger-bridge.ts", import.meta.url)),
      "utf8",
    );
    const fake = readFileSync(
      fileURLToPath(new URL("./ledger-bridge-fake-events.ts", import.meta.url)),
      "utf8",
    );
    expect(importLines(bridge)).not.toMatch(/appendLedgerEvent|appendLedgerEvents|writer\.js/);
    expect(importLines(fake)).not.toMatch(/appendLedgerEvent|appendLedgerEvents|writer\.js/);
    expect(proof.writerCalled).toBe(false);
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
  });

  it("rejects assistant_text / model_claim / ack-as-STEP_COMPLETED", () => {
    const byName = Object.fromEntries(proof.intents.map((row) => [row.name, row]));
    expect(byName.assistant_text?.accepted).toBe(false);
    expect(byName.model_claim?.accepted).toBe(false);
    expect(byName.ack_as_step_completed?.accepted).toBe(false);
    expect(byName.assistant_text?.errorMessage).toMatch(/ORCH7|forbidden/i);
    expect(byName.model_claim?.errorMessage).toMatch(/ORCH7|forbidden/i);
    expect(byName.ack_as_step_completed?.errorMessage).toMatch(/ack/i);
  });

  it("accepts tool_result and ackLedgerIntent", () => {
    const byName = Object.fromEntries(proof.intents.map((row) => [row.name, row]));
    expect(byName.tool_result?.accepted).toBe(true);
    expect(byName.ack_ledger_intent?.accepted).toBe(true);
    expect(fakeLedgerIntentCases().map((row) => row.name)).toEqual([
      "assistant_text",
      "model_claim",
      "ack_as_step_completed",
      "tool_result",
      "ack_ledger_intent",
    ]);
  });

  it("holds I1–I5 on events + folded ledger", () => {
    expect(proof.ledgerInvariantViolations).toEqual([]);
    expect(proof.ledger.taskId).toBe("orch-fake-i1");
    expect(proof.events[0]?.type).toBe("PLAN_SEEDED");
    expect(proof.events.some((event) => event.type === "TOOL_SUCCEEDED")).toBe(true);
    expect(proof.ledger.steps[0]?.executed).toBe(true);
    expect(proof.ledger.completed).toBe(false);
  });

  it("holds I6/I8 projection and does not define I7 in invariants.ts", () => {
    expect(proof.projectionInvariantViolations).toEqual([]);
    expect(proof.view.taskCompleted).toBe(false);
    expect(proof.view.taskCompleted).toBe(proof.ledger.completed);
    expect(JSON.stringify(proof.ledger)).toContain(proof.ledger.taskId);
    expect(LEDGER_I7_DEFINED_IN_INVARIANTS).toBe(false);
    expect(proof.i7DefinedInInvariants).toBe(false);

    const invariants = readFileSync(
      fileURLToPath(new URL("../progress-ledger/invariants.ts", import.meta.url)),
      "utf8",
    );
    expect(invariants).not.toMatch(/id:\s*"I7"/);
    expect(invariants).toMatch(/I1–I5 apply to events \+ folded ledger/);
    expect(invariants).toMatch(/I6–I8 are projection \/ writer concerns/);
  });

  it("matches expectAccepted for every fake intent case", () => {
    for (const row of proof.intents) {
      expect(row.accepted).toBe(row.expectAccepted);
    }
  });
});
