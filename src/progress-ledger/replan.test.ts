import { describe, expect, it } from "vitest";
import { foldEvents } from "./fold.js";
import { projectProgress } from "./project.js";
import { acceptReplanProposal } from "./replan.js";
import { createMemoryLedgerStore } from "./store.js";
import { completeStep, seedPlan } from "./test-helpers.js";
import { appendLedgerEvent } from "./writer.js";

describe("acceptReplanProposal", () => {
  it("appends a new plan version and keeps historical steps", async () => {
    const store = createMemoryLedgerStore("task_q2");
    const seed = seedPlan()[0];
    if (!seed) {
      throw new Error("missing seed");
    }
    await appendLedgerEvent(store, seed);
    for (const event of completeStep("E1", "A1", 10_000)) {
      await appendLedgerEvent(store, event);
    }
    const before = foldEvents(await store.loadEvents());
    const e1 = before.steps.find((item) => item.id === "E1");
    const ledger = await acceptReplanProposal(
      store,
      {
        taskId: "task_q2",
        reason: "missing_data",
        proposedBy: "model",
        retiredStepIds: ["E4"],
        addedSteps: [
          { id: "E4b", title: "补齐本周价表", acceptanceIds: ["A4"] },
          { id: "E5", title: "投递市场组" },
        ],
      },
      { atMs: Date.parse("2026-08-22T01:32:00.000Z"), triggeredBy: "runtime" },
    );
    expect(ledger.currentPlanVersion).toBe(2);
    expect(ledger.replans).toHaveLength(1);
    expect(ledger.replans[0]).toMatchObject({
      fromVersion: 1,
      toVersion: 2,
      reason: "missing_data",
      triggeredBy: "runtime",
    });
    expect(ledger.steps.find((item) => item.id === "E1")?.status).toBe(e1?.status);
    expect(ledger.steps.find((item) => item.id === "E1")?.evidence).toEqual(e1?.evidence);
    expect(ledger.steps.find((item) => item.id === "E4")?.retired).toBe(true);
    expect(ledger.steps.find((item) => item.id === "E4")?.status).toBe("pending");
    expect(ledger.steps.find((item) => item.id === "E4b")?.planVersion).toBe(2);
    const view = projectProgress(
      ledger,
      { mode: "deliver" },
      Date.parse("2026-08-22T01:33:00.000Z"),
    );
    expect(view.planVersion).toBe(2);
    expect(view.replans).toHaveLength(1);
    expect(foldEvents(await store.loadEvents())).toEqual(ledger);
  });

  it("rejects a proposal that writes status or skips a reason", async () => {
    const store = createMemoryLedgerStore("task_q2");
    const seed = seedPlan()[0];
    if (!seed) {
      throw new Error("missing seed");
    }
    await appendLedgerEvent(store, seed);
    await expect(
      acceptReplanProposal(store, {
        taskId: "task_q2",
        reason: "",
        addedSteps: [{ id: "E9", title: "新步骤" }],
      }),
    ).rejects.toThrow(/reason/);
    await expect(
      acceptReplanProposal(store, {
        taskId: "task_q2",
        reason: "missing_data",
        addedSteps: [{ id: "E9", title: "新步骤", status: "completed" } as never],
      }),
    ).rejects.toThrow(/status/);
  });
});
