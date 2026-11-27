import { describe, expect, it } from "vitest";
import {
  computeStoredResultHostReadBinding,
  exposeStoredHostReadBinding,
  peekCurrentStoredResultReadBinding,
  peekExposedStoredResultReadBinding,
  stampHostReadBindingOnSuccess,
  withStoredResultReadContext,
} from "./stored-result-read-binding.js";

describe("computeStoredResultHostReadBinding", () => {
  it("returns undefined without a session or run identifier", () => {
    expect(computeStoredResultHostReadBinding({})).toBeUndefined();
    expect(
      computeStoredResultHostReadBinding({
        taskId: "task-1",
        executionAttempt: "attempt-1",
        sessionKey: "  ",
        runId: "",
      }),
    ).toBeUndefined();
  });

  it("does not treat enterprise or membership fields as a read binding", () => {
    const withSession = computeStoredResultHostReadBinding({
      sessionKey: "sess-a",
      runId: "run-a",
    });
    // Extra unrecognized identity must not be expressible on this helper.
    expect(withSession).toBe(
      computeStoredResultHostReadBinding({
        sessionKey: "sess-a",
        runId: "run-a",
        taskId: undefined,
      }),
    );
    expect(withSession).toContain("stored-result-read:v1:");
    expect(withSession).toContain("sess-a");
    expect(withSession).not.toContain("enterprise");
    expect(withSession).not.toContain("membership");
  });

  it("is exact about session, run, and optional task attempt fields", () => {
    const same = computeStoredResultHostReadBinding({
      sessionKey: "sess-a",
      sessionId: "sid-1",
      runId: "run-a",
      taskId: "task-1",
      executionAttempt: "att-1",
    });
    const otherRun = computeStoredResultHostReadBinding({
      sessionKey: "sess-a",
      sessionId: "sid-1",
      runId: "run-b",
      taskId: "task-1",
      executionAttempt: "att-1",
    });
    const otherSession = computeStoredResultHostReadBinding({
      sessionKey: "sess-b",
      sessionId: "sid-1",
      runId: "run-a",
      taskId: "task-1",
      executionAttempt: "att-1",
    });
    expect(same).toBeDefined();
    expect(same).not.toBe(otherRun);
    expect(same).not.toBe(otherSession);
  });
});

describe("stored-result read binding scope", () => {
  it("stamps the current binding on first success and exposes a stored stamp on replay", async () => {
    const binding = computeStoredResultHostReadBinding({ sessionKey: "sess", runId: "run" });
    expect(binding).toBeDefined();
    await withStoredResultReadContext(binding!, async () => {
      expect(stampHostReadBindingOnSuccess()).toBe(binding);
      expect(peekExposedStoredResultReadBinding()).toBeUndefined();
      exposeStoredHostReadBinding(binding);
      expect(peekExposedStoredResultReadBinding()).toBe(binding);
      expect(peekCurrentStoredResultReadBinding()).toBe(binding);
    });
    expect(peekExposedStoredResultReadBinding()).toBeUndefined();
  });

  it("does not invent a stamp for an unstamped historical receipt", async () => {
    const binding = computeStoredResultHostReadBinding({ sessionKey: "sess", runId: "run" });
    await withStoredResultReadContext(binding!, async () => {
      exposeStoredHostReadBinding(undefined);
      expect(peekExposedStoredResultReadBinding()).toBeUndefined();
      expect(stampHostReadBindingOnSuccess(" already-stamped ")).toBe("already-stamped");
    });
  });
});
