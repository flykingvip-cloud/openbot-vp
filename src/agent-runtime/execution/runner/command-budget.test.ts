import { beforeEach, expect, it, vi } from "vitest";
import {
  assertRunnerTurnBudgetAllowsModelCall,
  chargeModelCallAgainstTip,
} from "../../../task-outcome/runtime-from-runner.js";
import { createCommandBudget } from "./command-budget.js";
vi.mock("../../../task-outcome/runtime-from-runner.js", async (original) => ({
  ...(await original<typeof import("../../../task-outcome/runtime-from-runner.js")>()),
  assertRunnerTurnBudgetAllowsModelCall: vi.fn(),
  chargeModelCallAgainstTip: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());

function boundBudget() {
  return createCommandBudget({
    config: {},
    agentId: "bot",
    runId: "run",
    startedAtMs: 1,
    taskId: "task",
    scope: {
      kind: "personal",
      personalDomainId: "personal:test",
      subjectRef: "user",
      authzScopeRef: "test",
    },
  });
}

it("owns candidate budget gating and retains successful usage for closeout", async () => {
  const budget = boundBudget();
  vi.mocked(chargeModelCallAgainstTip).mockReturnValue({
    evidence: "known",
    costUsd: 0.2,
    closedForBudget: false,
    record: {} as never,
  });
  const result = {
    meta: {
      durationMs: 1,
      agentMeta: { sessionId: "session", provider: "p", model: "m", usage: { input: 3 } },
    },
  };
  expect(await budget.runCandidate({ provider: "p", model: "m", run: async () => result })).toBe(
    result,
  );
  expect(assertRunnerTurnBudgetAllowsModelCall).toHaveBeenCalledOnce();
  expect(chargeModelCallAgainstTip).toHaveBeenCalledWith(
    {},
    "bot",
    expect.objectContaining({ usage: { input: 3 }, callSeq: 1 }),
  );
  expect(budget.charged).toBe(true);
  expect(budget.costUsd).toBe(0.2);
});

it("records failed provider attempts without replacing the provider error", async () => {
  const budget = boundBudget();
  vi.mocked(chargeModelCallAgainstTip).mockReturnValue({
    evidence: "unknown",
    closedForBudget: false,
    record: {} as never,
  });
  const error = new Error("provider failed");
  await expect(
    budget.runCandidate({
      provider: "p",
      model: "m",
      run: async () => {
        throw error;
      },
    }),
  ).rejects.toBe(error);
  expect(chargeModelCallAgainstTip).toHaveBeenCalledOnce();
  expect(budget.charged).toBe(true);
});
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
