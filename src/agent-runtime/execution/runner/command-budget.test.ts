import { beforeEach, expect, it, vi } from "vitest";
import {
  assertRunnerTurnBudgetAllowsModelCall,
  chargeModelCallAgainstTip,
} from "../../../task-outcome/runtime-from-runner.js";
import { createCommandBudget } from "./command-budget.js";
vi.mock("../../../task-outcome/runtime-from-runner.js", () => ({
  assertRunnerTurnBudgetAllowsModelCall: vi.fn(),
  chargeModelCallAgainstTip: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());
it("preserves parent identity and advances sequence even after a failed charge", () => {
  const budget = createCommandBudget({
    config: {},
    agentId: "child",
    runId: "run",
    startedAtMs: 1,
    taskId: "task",
    scope: {
      kind: "personal",
      personalDomainId: "personal:test",
      subjectRef: "user",
      authzScopeRef: "test",
    },
    parentTaskId: " parent ",
    parentAgentId: " owner ",
  });
  budget.assertAllowed();
  expect(assertRunnerTurnBudgetAllowsModelCall).toHaveBeenCalledWith(
    {},
    "child",
    expect.objectContaining({
      taskId: "task",
      parentTaskId: "parent",
      parentAgentId: "owner",
      startedAtMs: 1,
    }),
  );
  vi.mocked(chargeModelCallAgainstTip).mockImplementationOnce(() => {
    throw new Error("charge failed");
  });
  expect(() => budget.charge({ provider: "p", model: "m" })).toThrow("charge failed");
  budget.charge({ provider: "p", model: "m", usage: { input: 2 } });
  expect(vi.mocked(chargeModelCallAgainstTip).mock.calls.map((call) => call[2].callSeq)).toEqual([
    1, 2,
  ]);
  expect(chargeModelCallAgainstTip).toHaveBeenLastCalledWith(
    {},
    "child",
    expect.objectContaining({
      parentTaskId: "parent",
      parentAgentId: "owner",
      runId: "run",
      usage: { input: 2 },
    }),
  );
});
it("does not invent a task or charge when no outcome binding exists", () => {
  const budget = createCommandBudget({
    config: {},
    agentId: "child",
    runId: "run",
    startedAtMs: 1,
  });
  budget.assertAllowed();
  expect(budget.charge({ provider: "p", model: "m" })).toBeUndefined();
  expect(assertRunnerTurnBudgetAllowsModelCall).not.toHaveBeenCalled();
  expect(chargeModelCallAgainstTip).not.toHaveBeenCalled();
});
