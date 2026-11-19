import { expect, it } from "vitest";
import type { ExecutionContext, StandardExecutionResult } from "./execution-protocol.js";
it("requires evidence for completed executions and a wake condition for waiting", () => {
  const context: ExecutionContext = {
    tenantId: "t",
    taskId: "task",
    executionId: "exec",
    stepId: "step",
    operationId: "op",
    attemptId: "attempt",
    policyVersion: "p1",
    ownerToken: "owner",
  };
  const completed: StandardExecutionResult = {
    kind: "completed",
    context,
    evidence: ["receipt:1"],
  };
  const waiting: StandardExecutionResult = {
    kind: "waiting",
    context,
    condition: { waitId: "wait", reason: "timer", wakeOn: ["timer:fired"] },
  };
  expect(completed.evidence).toContain("receipt:1");
  expect(waiting.condition.wakeOn).toContain("timer:fired");
});
