import { describe, expect, it } from "vitest";
import { LedgerInvariantError, LedgerWriteError } from "./errors.js";
import { foldEvents } from "./fold.js";
import {
  completeStep,
  ev,
  receiptEvidence,
  seedPlan,
  toolEvidence,
  validationEvidence,
} from "./test-helpers.js";

describe("foldEvents", () => {
  it("rebuilds the same ledger from the same events", () => {
    const events = [...seedPlan(), ...completeStep("E1", "A1", 10_000)];
    expect(foldEvents(events)).toEqual(foldEvents(events));
  });

  it("does not complete a step on tool success alone", () => {
    const ledger = foldEvents([
      ...seedPlan(),
      ev("STEP_STARTED", { stepId: "E1", atMs: 10_000 }),
      ev("TOOL_SUCCEEDED", {
        stepId: "E1",
        atMs: 10_100,
        payload: { evidence: toolEvidence(10_100) },
      }),
    ]);
    const step = ledger.steps.find((item) => item.id === "E1");
    expect(step?.status).toBe("executed");
    expect(step?.executed).toBe(true);
    expect(step?.verified).toBe(false);
    expect(ledger.completed).toBe(false);
    expect(ledger.acceptance.find((item) => item.id === "A1")?.status).toBe("unknown");
  });

  it("rejects completing a step before verified (I2)", () => {
    expect(() =>
      foldEvents([
        ...seedPlan(),
        ev("STEP_STARTED", { stepId: "E1", atMs: 10_000 }),
        ev("TOOL_SUCCEEDED", {
          stepId: "E1",
          atMs: 10_100,
          payload: { evidence: toolEvidence(10_100) },
        }),
        ev("STEP_COMPLETED", {
          stepId: "E1",
          atMs: 10_200,
          payload: { evidence: toolEvidence(10_200) },
        }),
      ]),
    ).toThrow(LedgerInvariantError);
  });

  it("rejects ACCEPTANCE_MET without allowed evidence (I3)", () => {
    expect(() =>
      foldEvents([...seedPlan(), ev("ACCEPTANCE_MET", { acceptanceId: "A1", atMs: 10_000 })]),
    ).toThrow(/I3/);
  });

  it("rejects verify/complete/met that reuse historical evidence without payload evidence", () => {
    const executed = [
      ...seedPlan(),
      ev("STEP_STARTED", { stepId: "E1", atMs: 10_000 }),
      ev("TOOL_SUCCEEDED", {
        stepId: "E1",
        atMs: 10_100,
        payload: { evidence: toolEvidence(10_100) },
      }),
    ];
    expect(() =>
      foldEvents([
        ...executed,
        ev("VALIDATION_PASSED", { stepId: "E1", atMs: 10_200, actor: "validator" }),
      ]),
    ).toThrow(/VALIDATION_PASSED payload must include at least one allowed evidence/);
    expect(() =>
      foldEvents([
        ...executed,
        ev("STEP_VERIFIED", { stepId: "E1", atMs: 10_200, actor: "validator" }),
      ]),
    ).toThrow(/STEP_VERIFIED payload must include at least one allowed evidence/);

    const verified = [
      ...executed,
      ev("VALIDATION_PASSED", {
        stepId: "E1",
        atMs: 10_200,
        actor: "validator",
        payload: { evidence: validationEvidence(10_200) },
      }),
    ];
    expect(() =>
      foldEvents([...verified, ev("STEP_COMPLETED", { stepId: "E1", atMs: 10_300 })]),
    ).toThrow(/STEP_COMPLETED payload must include at least one allowed evidence/);
    expect(() =>
      foldEvents([
        ...verified,
        ev("STEP_COMPLETED", {
          stepId: "E1",
          atMs: 10_300,
          payload: { evidence: toolEvidence(10_300) },
        }),
        ev("ACCEPTANCE_MET", { acceptanceId: "A1", atMs: 10_400 }),
      ]),
    ).toThrow(/ACCEPTANCE_MET payload must include at least one allowed evidence/);
  });

  it("rejects forbidden evidence on the write path", () => {
    expect(() =>
      foldEvents([
        ...seedPlan(),
        ev("EVIDENCE_RECORDED", {
          stepId: "E1",
          atMs: 10_000,
          payload: {
            evidence: {
              type: "assistant_text" as never,
              atMs: 10_000,
              note: "我已经成功发送邮件。",
            },
          },
        }),
      ]),
    ).toThrow(/forbidden evidence type/);
  });

  it("records executed + verification failed + blocked, not completed", () => {
    const ledger = foldEvents([
      ...seedPlan(),
      ev("STEP_STARTED", { stepId: "E3", atMs: 20_000 }),
      ev("TOOL_SUCCEEDED", {
        stepId: "E3",
        atMs: 20_100,
        payload: { evidence: toolEvidence(20_100) },
      }),
      ev("VALIDATION_FAILED", {
        stepId: "E3",
        atMs: 20_200,
        actor: "validator",
        payload: {
          evidence: {
            type: "validation_result",
            atMs: 20_200,
            source: "bonus-policy",
            ruleVersion: "v3.1",
            verification: "failed",
          },
        },
      }),
      ev("STEP_BLOCKED", {
        stepId: "E3",
        atMs: 20_300,
        payload: { reason: "blocked_policy", question: "制度版本不是 v3.2，暂不允许入账" },
      }),
    ]);
    const step = ledger.steps.find((item) => item.id === "E3");
    expect(step?.executed).toBe(true);
    expect(step?.verified).toBe(false);
    expect(step?.status).toBe("blocked");
    expect(step?.blocking?.reason).toBe("blocked_policy");
    expect(ledger.currentBlocking?.reason).toBe("blocked_policy");
    expect(ledger.completed).toBe(false);
  });

  it("does not mark the task completed until every required acceptance is met (I4)", () => {
    const ledger = foldEvents([
      ...seedPlan(),
      ...completeStep("E1", "A1", 10_000),
      ...completeStep("E2", "A2", 20_000),
      ...completeStep("E3", "A3", 30_000),
    ]);
    expect(ledger.acceptance.filter((item) => item.status === "met")).toHaveLength(3);
    expect(ledger.completed).toBe(false);
  });

  it("marks the task completed only after all required acceptance items are met", () => {
    const ledger = foldEvents([
      ...seedPlan(),
      ...completeStep("E1", "A1", 10_000),
      ...completeStep("E2", "A2", 20_000),
      ...completeStep("E3", "A3", 30_000),
      ...completeStep("E4", "A4", 40_000),
    ]);
    expect(ledger.completed).toBe(true);
  });

  it("keeps historical plan steps after replan (I5)", () => {
    const events = [
      ...seedPlan(),
      ...completeStep("E1", "A1", 10_000),
      ev("REPLAN_APPENDED", {
        atMs: 50_000,
        planVersion: 1,
        payload: {
          fromVersion: 1,
          toVersion: 2,
          replanReason: "missing_data",
          triggeredBy: "runtime",
          retiredStepIds: ["E4"],
          addedSteps: [
            { id: "E4b", title: "补齐本周价表", acceptanceIds: ["A4"] },
            { id: "E5", title: "投递市场组", acceptanceIds: [] },
          ],
        },
      }),
    ];
    const ledger = foldEvents(events);
    expect(ledger.currentPlanVersion).toBe(2);
    const v1 = ledger.steps.find((item) => item.id === "E1");
    expect(v1?.status).toBe("completed");
    expect(v1?.planVersion).toBe(1);
    expect(ledger.steps.find((item) => item.id === "E4")?.retired).toBe(true);
    expect(ledger.steps.find((item) => item.id === "E4")?.status).toBe("pending");
    expect(ledger.replans[0]?.reason).toBe("missing_data");
    expect(foldEvents(events).steps.map((item) => item.id)).toEqual(
      ledger.steps.map((item) => item.id),
    );
  });

  it("rejects a second PLAN_SEEDED", () => {
    expect(() => foldEvents([...seedPlan(), ...seedPlan()])).toThrow(LedgerWriteError);
  });

  it("rejects LLM actors (I1)", () => {
    expect(() =>
      foldEvents([
        ...seedPlan(),
        ev("STEP_STARTED", { stepId: "E1", actor: "llm" as never, atMs: 10_000 }),
      ]),
    ).toThrow(/I1/);
  });

  it("rejects direct status mutation on the payload (I1)", () => {
    expect(() =>
      foldEvents([
        ...seedPlan(),
        ev("STEP_STARTED", {
          stepId: "E1",
          atMs: 10_000,
          payload: { status: "completed" },
        }),
      ]),
    ).toThrow(/I1/);
  });

  it("updates lastMeaningfulChangeAt on execution events, not via Date.now", () => {
    const ledger = foldEvents([...seedPlan(), ev("STEP_STARTED", { stepId: "E1", atMs: 12_345 })]);
    expect(ledger.lastMeaningfulChangeAtMs).toBe(12_345);
    expect(ledger.lastUpdatedAtMs).toBe(12_345);
  });

  it("records validation evidence on the step", () => {
    const ledger = foldEvents([
      ...seedPlan(),
      ev("STEP_STARTED", { stepId: "E1", atMs: 10_000 }),
      ev("TOOL_SUCCEEDED", {
        stepId: "E1",
        atMs: 10_100,
        payload: { evidence: toolEvidence(10_100) },
      }),
      ev("VALIDATION_PASSED", {
        stepId: "E1",
        atMs: 10_200,
        actor: "validator",
        payload: { evidence: validationEvidence(10_200) },
      }),
    ]);
    expect(ledger.steps.find((item) => item.id === "E1")?.status).toBe("verified");
    expect(ledger.steps.find((item) => item.id === "E1")?.evidence.map((row) => row.type)).toEqual([
      "tool_result",
      "validation_result",
    ]);
  });

  it("does not consult quiet when applying events (I7)", () => {
    const ledger = foldEvents([...seedPlan(), ...completeStep("E1", "A1", 10_000)]);
    expect(ledger.acceptance.find((item) => item.id === "A1")?.status).toBe("met");
    expect(ledger.acceptance.find((item) => item.id === "A1")?.evidence[0]).toMatchObject(
      receiptEvidence(10_004),
    );
  });
});
