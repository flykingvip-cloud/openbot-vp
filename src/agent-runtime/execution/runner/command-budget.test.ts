import { beforeEach, expect, it, vi } from "vitest";
import type { BudgetCommandReport } from "../../../executor-evidence/association.js";
import {
  assertRunnerTurnBudgetAllowsModelCall,
  chargeModelCallAgainstTip,
  recordRunnerTurnOutcome,
  type ModelCallCloseoutLink,
} from "../../../task-outcome/runtime-from-runner.js";
import { createCommandOutcomeCloseout } from "../outcomes/command-outcome.js";
import { settleCommandBudgetForCloseout, createCommandBudget } from "./command-budget.js";
vi.mock("../../../task-outcome/runtime-from-runner.js", async (original) => ({
  ...(await original<typeof import("../../../task-outcome/runtime-from-runner.js")>()),
  assertRunnerTurnBudgetAllowsModelCall: vi.fn(),
  chargeModelCallAgainstTip: vi.fn(),
  recordRunnerTurnOutcome: vi.fn(),
}));

function budgetCommand(costUsd: number | null): BudgetCommandReport {
  return {
    commandId: "budget-spend:task:run:1",
    requestDigest: "digest-1",
    disposition: "applied",
    commitId: "c_once",
    chargeOutcomeVersion: 2,
    closeOutcomeVersion: null,
    committedCostUsd: costUsd,
    costStatus: costUsd == null ? "unknown" : "known",
  };
}

function chargeReceipt(input: {
  evidence: "known" | "unknown";
  costUsd?: number;
  closedForBudget: boolean;
  disposition?: BudgetCommandReport["disposition"];
  callId?: string;
}): ReturnType<typeof chargeModelCallAgainstTip> {
  const command = budgetCommand(input.costUsd ?? null);
  if (input.disposition) {
    command.disposition = input.disposition;
    command.costStatus =
      input.disposition === "applied" || input.disposition === "replayed"
        ? command.costStatus
        : "not_committed";
  }
  const link: ModelCallCloseoutLink | null = input.callId
    ? {
        callId: input.callId,
        evidenceId: `mce_${input.callId}`,
        candidateAttemptId: `attempt_${input.callId}`,
        chargeOutcomeVersion: 2,
        chargeCommitId: "c_once",
        requestDigest: "digest-1",
        usageFingerprint: "usage",
        commandId: command.commandId,
      }
    : null;
  return {
    record: { taskId: "task" } as ReturnType<typeof chargeModelCallAgainstTip>["record"],
    evidence: input.evidence,
    ...(input.costUsd != null ? { costUsd: input.costUsd } : {}),
    closedForBudget: input.closedForBudget,
    budgetCommand: command,
    callId: input.callId ?? null,
    associationCompleteness: link ? "partial" : "unlinked",
    modelCallLink: link,
  };
}

function candidateResult(usage: { input: number; output: number }) {
  return {
    payloads: [{ text: "ok" }],
    meta: {
      durationMs: 1,
      agentMeta: { sessionId: "s", provider: "p", model: "m", usage },
    },
  };
}
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
  vi.mocked(chargeModelCallAgainstTip).mockReturnValue(
    chargeReceipt({ evidence: "known", costUsd: 0.2, closedForBudget: false }),
  );
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
  vi.mocked(chargeModelCallAgainstTip).mockReturnValue(
    chargeReceipt({ evidence: "unknown", closedForBudget: false }),
  );
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
  vi.mocked(chargeModelCallAgainstTip).mockReturnValueOnce(
    chargeReceipt({ evidence: "known", costUsd: 0.1, closedForBudget: false }),
  );
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
it("does not open a second command when the committed charge then throws", async () => {
  const budget = boundBudget();
  const committed: Array<{ callSeq: number; iterations: number; costUsd: number }> = [];
  vi.mocked(chargeModelCallAgainstTip).mockImplementation((_cfg, _agent, params) => {
    committed.push({ callSeq: params.callSeq, iterations: 1, costUsd: 0.4 });
    throw new Error("parent attribution failed after commit");
  });
  const usage = { input: 4, output: 1, cacheRead: 0, cacheWrite: 0 };
  await expect(
    budget.runCandidate({
      provider: "p",
      model: "m",
      run: async () => ({
        payloads: [{ text: "ok" }],
        meta: { durationMs: 1, agentMeta: { sessionId: "s", provider: "p", model: "m", usage } },
      }),
    }),
  ).rejects.toThrow("parent attribution failed after commit");
  expect(committed).toEqual([{ callSeq: 1, iterations: 1, costUsd: 0.4 }]);
  expect(chargeModelCallAgainstTip).toHaveBeenCalledTimes(1);
  expect(budget.chargeState).toBe("attempted_unknown");
  expect(budget.charged).toBe(false);
  expect(budget.costUsd).toBeUndefined();
  const settled = settleCommandBudgetForCloseout(budget, { costUsd: 9 });
  expect(settled.chargeState).toBe("attempted_unknown");
  expect(settled.budgetCharged).toBe(true);
  expect(settled.costUsd).toBeUndefined();
  expect(settled.reasons.join(" ")).toContain("parent attribution failed after commit");
  const close = createCommandOutcomeCloseout({
    config: {},
    agentId: "bot",
    runId: "run",
    startedAtMs: 1,
    entrypoint: "cli",
    readContext: () => ({
      taskId: "task",
      scope: {
        kind: "personal",
        personalDomainId: "personal:test",
        subjectRef: "user",
        authzScopeRef: "test",
      },
      success: false,
      failureReason: "run_failed",
      budgetCharged: settled.budgetCharged,
      chargeState: settled.chargeState,
      budgetChargeReasons: settled.reasons,
      costUsd: settled.costUsd,
    }),
  });
  await close();
  expect(recordRunnerTurnOutcome).toHaveBeenCalledTimes(1);
  const outcome = vi.mocked(recordRunnerTurnOutcome).mock.calls[0]?.[2];
  expect(outcome).toMatchObject({ skipBudgetCharge: true });
  expect(outcome).not.toHaveProperty("costUsd");
  expect(outcome?.budgetChargeReasons?.join(" ")).toContain(
    "parent attribution failed after commit",
  );
});
it("charges A and B on one command when A fails and B succeeds", async () => {
  const budget = boundBudget();
  vi.mocked(chargeModelCallAgainstTip)
    .mockReturnValueOnce(
      chargeReceipt({
        evidence: "known",
        costUsd: 0.2,
        closedForBudget: false,
        callId: "call-a",
      }),
    )
    .mockReturnValueOnce(
      chargeReceipt({
        evidence: "known",
        costUsd: 0.3,
        closedForBudget: false,
        callId: "call-b",
      }),
    );
  await expect(
    budget.runCandidate({
      provider: "p",
      model: "a",
      run: async () => {
        throw new Error("candidate A failed");
      },
    }),
  ).rejects.toThrow("candidate A failed");
  await budget.runCandidate({
    provider: "p",
    model: "b",
    run: async () => candidateResult({ input: 2, output: 2 }),
  });
  expect(vi.mocked(chargeModelCallAgainstTip).mock.calls.map((call) => call[2].callSeq)).toEqual([
    1, 2,
  ]);
  expect(budget.modelCallLinks.map((link) => link.callId)).toEqual(["call-a", "call-b"]);
  expect(budget.chargeState).toBe("committed");
  expect(budget.costUsd).toBeCloseTo(0.5);
});
it("does not re-charge A after a post-commit throw and still charges B", async () => {
  const budget = boundBudget();
  vi.mocked(chargeModelCallAgainstTip)
    .mockImplementationOnce(() => {
      throw new Error("parent attribution failed after commit");
    })
    .mockReturnValueOnce(
      chargeReceipt({
        evidence: "known",
        costUsd: 0.3,
        closedForBudget: false,
        callId: "call-b",
      }),
    );
  await expect(
    budget.runCandidate({
      provider: "p",
      model: "a",
      run: async () => candidateResult({ input: 4, output: 1 }),
    }),
  ).rejects.toThrow("parent attribution failed after commit");
  await budget.runCandidate({
    provider: "p",
    model: "b",
    run: async () => candidateResult({ input: 1, output: 1 }),
  });
  expect(vi.mocked(chargeModelCallAgainstTip).mock.calls.map((call) => call[2].callSeq)).toEqual([
    1, 2,
  ]);
  expect(budget.modelCallLinks.map((link) => link.callId)).toEqual(["call-b"]);
  expect(budget.chargeState).toBe("attempted_unknown");
  expect(budget.chargeRecords.map((record) => record.state)).toEqual([
    "attempted_unknown",
    "committed",
  ]);
});
it("does not label a conflict receipt as committed", async () => {
  const budget = boundBudget();
  vi.mocked(chargeModelCallAgainstTip).mockReturnValue(
    chargeReceipt({
      evidence: "unknown",
      closedForBudget: false,
      disposition: "conflict",
      callId: "call-conflict",
    }),
  );
  await budget.runCandidate({
    provider: "p",
    model: "m",
    run: async () => candidateResult({ input: 1, output: 1 }),
  });
  expect(chargeModelCallAgainstTip).toHaveBeenCalledTimes(1);
  expect(budget.charged).toBe(false);
  expect(budget.chargeState).toBe("conflict");
  expect(budget.chargeRecords[0]?.disposition).toBe("conflict");
  const settled = settleCommandBudgetForCloseout(budget, { costUsd: 9 });
  expect(settled.chargeState).toBe("conflict");
  expect(settled.costUsd).toBeUndefined();
  const close = createCommandOutcomeCloseout({
    config: {},
    agentId: "bot",
    runId: "run",
    startedAtMs: 1,
    entrypoint: "cli",
    readContext: () => ({
      taskId: "task",
      scope: {
        kind: "personal",
        personalDomainId: "personal:test",
        subjectRef: "user",
        authzScopeRef: "test",
      },
      success: false,
      failureReason: "run_failed",
      budgetCharged: settled.budgetCharged,
      chargeState: settled.chargeState,
      budgetChargeReasons: settled.reasons,
      costUsd: settled.costUsd,
    }),
  });
  await close();
  const outcome = vi.mocked(recordRunnerTurnOutcome).mock.calls.at(-1)?.[2];
  expect(outcome).toMatchObject({ skipBudgetCharge: true });
  expect(outcome).not.toHaveProperty("costUsd");
  expect(outcome?.budgetChargeReasons?.join(" ")).toContain("conflict");
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
