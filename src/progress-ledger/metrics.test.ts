import { describe, expect, it } from "vitest";
import { LedgerInvariantError } from "./errors.js";
import { createLedgerMetrics } from "./metrics.js";
import { createMemoryLedgerStore } from "./store.js";
import { ev, seedPlan } from "./test-helpers.js";
import { appendLedgerEvent } from "./writer.js";

describe("ledger metrics", () => {
  it("counts accepted writes and I1 rejections", async () => {
    const metrics = createLedgerMetrics();
    const store = createMemoryLedgerStore("task_q2");
    const seed = seedPlan()[0];
    if (!seed) {
      throw new Error("missing seed");
    }
    await appendLedgerEvent(store, seed, { metrics });
    await expect(
      appendLedgerEvent(store, ev("STEP_STARTED", { stepId: "E1", actor: "llm" as never }), {
        metrics,
      }),
    ).rejects.toBeInstanceOf(LedgerInvariantError);
    const snap = metrics.snapshot();
    expect(snap.writesAccepted).toBe(1);
    expect(snap.writesRejected).toBe(1);
    expect(snap.violationsById.I1).toBe(1);
    expect(snap.lastViolation?.id).toBe("I1");
  });

  it("keeps isolated sinks independent of the process default", () => {
    const local = createLedgerMetrics();
    local.recordProjectionViolation({ id: "I8", message: "blocked as nearly complete" });
    expect(local.snapshot().projectionViolations).toBe(1);
    expect(local.snapshot().violationsById.I8).toBe(1);
  });
});
