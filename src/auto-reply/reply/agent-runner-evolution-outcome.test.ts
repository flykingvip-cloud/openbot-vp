import { afterEach, describe, expect, it } from "vitest";
import {
  listEvolutionLoopLogsForTests,
  reportEvolutionOutcomeWriteFailure,
  resetEvolutionLoopLogsForTests,
} from "../../gateway/evolution-control/evolution-loop-log.js";

afterEach(() => {
  resetEvolutionLoopLogsForTests();
});

describe("runner evolution outcome write failure", () => {
  it("does not silently drop an appendEvolutionTaskOutcome failure", async () => {
    resetEvolutionLoopLogsForTests();
    const write = Promise.reject(new Error("EACCES: evolution-task-outcomes.jsonl"));
    await write.catch((error: unknown) => {
      reportEvolutionOutcomeWriteFailure({
        runId: "run-runner-fail",
        agentId: "growth-bot",
        tenantId: "tenant-acme",
        taskId: "task-runner-fail",
        reason: error instanceof Error ? error.message : "evolution_outcome_write_failed",
      });
    });
    const row = listEvolutionLoopLogsForTests().find(
      (entry) => entry.event === "evolution.outcome.write_failed",
    );
    expect(row).toMatchObject({
      event: "evolution.outcome.write_failed",
      runId: "run-runner-fail",
      agentId: "growth-bot",
      tenantId: "tenant-acme",
      taskId: "task-runner-fail",
      reason: "EACCES: evolution-task-outcomes.jsonl",
    });
  });
});
