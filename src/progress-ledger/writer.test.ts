import { describe, expect, it } from "vitest";
import { LedgerWriteError } from "./errors.js";
import { foldEvents } from "./fold.js";
import { createMemoryLedgerStore } from "./store.js";
import { ev, receiptEvidence, seedPlan, toolEvidence, validationEvidence } from "./test-helpers.js";
import { appendLedgerEvent, assertNotLegacyProgressSource } from "./writer.js";

describe("appendLedgerEvent", () => {
  it("appends a valid runtime event and matches a replayed fold", async () => {
    const store = createMemoryLedgerStore("task_q2");
    const seed = seedPlan()[0];
    if (!seed) {
      throw new Error("missing seed");
    }
    await appendLedgerEvent(store, seed);
    const started = ev("STEP_STARTED", { stepId: "E1", atMs: 10_000 });
    const { ledger } = await appendLedgerEvent(store, started);
    expect(ledger.steps.find((item) => item.id === "E1")?.status).toBe("in_progress");
    expect(foldEvents(await store.loadEvents())).toEqual(ledger);
  });

  it("rejects assistant_text evidence", async () => {
    const store = createMemoryLedgerStore("task_q2");
    const seed = seedPlan()[0];
    if (!seed) {
      throw new Error("missing seed");
    }
    await appendLedgerEvent(store, seed);
    await expect(
      appendLedgerEvent(
        store,
        ev("EVIDENCE_RECORDED", {
          stepId: "E1",
          payload: {
            evidence: { type: "assistant_text" as never, atMs: 1, note: "我已经成功发送邮件。" },
          },
        }),
      ),
    ).rejects.toThrow(/forbidden evidence type|not canonical progress/);
  });

  it("rejects run-summary disguised as evidence", async () => {
    const store = createMemoryLedgerStore("task_q2");
    const seed = seedPlan()[0];
    if (!seed) {
      throw new Error("missing seed");
    }
    await appendLedgerEvent(store, seed);
    await expect(
      appendLedgerEvent(
        store,
        ev("EVIDENCE_RECORDED", {
          stepId: "E1",
          payload: {
            evidence: { type: "tool_result", atMs: 1, source: "run_summary" },
          },
        }),
      ),
    ).rejects.toThrow(LedgerWriteError);
  });

  it("rejects a model-authored replan event", async () => {
    const store = createMemoryLedgerStore("task_q2");
    const seed = seedPlan()[0];
    if (!seed) {
      throw new Error("missing seed");
    }
    await appendLedgerEvent(store, seed);
    await expect(
      appendLedgerEvent(
        store,
        ev("REPLAN_APPENDED", {
          actor: "model" as never,
          payload: {
            fromVersion: 1,
            toVersion: 2,
            replanReason: "missing_data",
            addedSteps: [{ id: "E9", title: "新步骤" }],
          },
        }),
      ),
    ).rejects.toThrow(/I1/);
  });

  it("rejects LLM actors", async () => {
    const store = createMemoryLedgerStore("task_q2");
    const seed = seedPlan()[0];
    if (!seed) {
      throw new Error("missing seed");
    }
    await appendLedgerEvent(store, seed);
    await expect(
      appendLedgerEvent(store, ev("STEP_STARTED", { stepId: "E1", actor: "llm" as never })),
    ).rejects.toThrow(/I1/);
  });

  it("rejects VALIDATION_PASSED that only reuses prior tool_result evidence", async () => {
    const store = createMemoryLedgerStore("task_q2");
    const seed = seedPlan()[0];
    if (!seed) {
      throw new Error("missing seed");
    }
    await appendLedgerEvent(store, seed);
    await appendLedgerEvent(store, ev("STEP_STARTED", { stepId: "E1", atMs: 10_000 }));
    await appendLedgerEvent(
      store,
      ev("TOOL_SUCCEEDED", {
        stepId: "E1",
        atMs: 10_100,
        payload: { evidence: toolEvidence(10_100) },
      }),
    );
    await expect(
      appendLedgerEvent(store, ev("VALIDATION_PASSED", { stepId: "E1", atMs: 10_200 })),
    ).rejects.toThrow(/payload must include at least one allowed evidence/);
  });

  it("still writes while quiet would be active (I7)", async () => {
    const store = createMemoryLedgerStore("task_q2");
    const seed = seedPlan()[0];
    if (!seed) {
      throw new Error("missing seed");
    }
    await appendLedgerEvent(store, seed);
    const { ledger } = await appendLedgerEvent(
      store,
      ev("STEP_STARTED", { stepId: "E1", atMs: 11_000 }),
    );
    expect(ledger.lastMeaningfulChangeAtMs).toBe(11_000);
  });
});

describe("assertNotLegacyProgressSource", () => {
  it("rejects run summary and model claims", () => {
    expect(() => assertNotLegacyProgressSource({ source: "run_summary" })).toThrow(
      /not canonical progress/,
    );
    expect(() => assertNotLegacyProgressSource({ kind: "legacy_best_effort" })).toThrow(
      /not canonical progress/,
    );
    expect(() => assertNotLegacyProgressSource({ projectionKind: "planner_claim" })).toThrow(
      /not canonical progress/,
    );
  });

  it("allows tool receipts", () => {
    expect(() =>
      assertNotLegacyProgressSource({ kind: receiptEvidence().type, source: "email_send" }),
    ).not.toThrow();
    expect(() =>
      assertNotLegacyProgressSource({ kind: toolEvidence().type, source: "calculator" }),
    ).not.toThrow();
    expect(() =>
      assertNotLegacyProgressSource({ kind: validationEvidence().type, source: "bonus-policy" }),
    ).not.toThrow();
  });
});
