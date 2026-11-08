import { beforeEach, expect, it, vi } from "vitest";
import { recordRunnerTurnOutcome } from "../../../task-outcome/runtime-from-runner.js";
import { createCommandOutcomeCloseout } from "./command-outcome.js";
vi.mock("../../../task-outcome/runtime-from-runner.js", () => ({
  recordRunnerTurnOutcome: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());
it("waits for identity and records current budget once without inventing delivery", async () => {
  type Context = ReturnType<Parameters<typeof createCommandOutcomeCloseout>[0]["readContext"]>;
  let context: Context = { budgetCharged: false };
  const close = createCommandOutcomeCloseout({
    config: {},
    agentId: "agent",
    runId: "run",
    startedAtMs: Date.now(),
    entrypoint: "cli",
    readContext: () => context,
  });
  await close();
  expect(recordRunnerTurnOutcome).not.toHaveBeenCalled();
  context = {
    taskId: "task",
    scope: {
      kind: "personal",
      personalDomainId: "domain",
      subjectRef: "user",
      authzScopeRef: "scope",
    },
    success: true,
    budgetCharged: true,
    costUsd: 2,
  };
  await Promise.all([close(), close()]);
  expect(recordRunnerTurnOutcome).toHaveBeenCalledTimes(1);
  const result = vi.mocked(recordRunnerTurnOutcome).mock.calls[0][2];
  expect(result).toMatchObject({ taskId: "task", success: true, skipBudgetCharge: true });
  expect(result).not.toHaveProperty("costUsd");
  expect(result).not.toHaveProperty("delivery");
  expect(result).not.toHaveProperty("acceptance");
});
it("reports persistence failure and retains the original at-most-once closeout", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(recordRunnerTurnOutcome).mockRejectedValueOnce(new Error("write failed"));
  const close = createCommandOutcomeCloseout({
    config: {},
    agentId: "agent",
    runId: "run",
    startedAtMs: Date.now(),
    entrypoint: "subagent",
    readContext: () => ({
      taskId: "task",
      scope: {
        kind: "personal",
        personalDomainId: "domain",
        subjectRef: "user",
        authzScopeRef: "scope",
      },
      success: false,
      failureReason: "user_cancelled",
      budgetCharged: false,
      costUsd: 0,
    }),
  });
  await close();
  await close();
  expect(recordRunnerTurnOutcome).toHaveBeenCalledTimes(1);
  expect(recordRunnerTurnOutcome).toHaveBeenCalledWith(
    {},
    "agent",
    expect.objectContaining({ success: false, failureReason: "user_cancelled", costUsd: 0 }),
  );
  expect(log).toHaveBeenCalled();
  log.mockRestore();
});
it("does not guess a second spend when the command commit result is unknown", async () => {
  const close = createCommandOutcomeCloseout({
    config: {},
    agentId: "agent",
    runId: "run",
    startedAtMs: Date.now(),
    entrypoint: "cli",
    readContext: () => ({
      taskId: "task",
      scope: {
        kind: "personal",
        personalDomainId: "domain",
        subjectRef: "user",
        authzScopeRef: "scope",
      },
      success: false,
      failureReason: "run_failed",
      budgetCharged: false,
      chargeState: "attempted_unknown",
      costUsd: 5,
    }),
  });
  await close();
  const outcome = vi.mocked(recordRunnerTurnOutcome).mock.calls[0]?.[2];
  expect(outcome).toMatchObject({ skipBudgetCharge: true });
  expect(outcome).not.toHaveProperty("costUsd");
});
it("persists failed delivery independently of successful execution", async () => {
  const close = createCommandOutcomeCloseout({
    config: {},
    agentId: "agent",
    runId: "run",
    startedAtMs: Date.now(),
    entrypoint: "cli",
    readContext: () => ({
      taskId: "task",
      scope: {
        kind: "personal",
        personalDomainId: "domain",
        subjectRef: "user",
        authzScopeRef: "scope",
      },
      success: true,
      budgetCharged: true,
      deliveryReceipt: {
        deliveryId: "delivery:run:command",
        status: "failed",
        messageIds: ["sent-part"],
      },
    }),
  });
  await close();
  expect(recordRunnerTurnOutcome).toHaveBeenCalledWith(
    {},
    "agent",
    expect.objectContaining({
      success: true,
      delivery: { status: "failed" },
      deliveryId: "delivery:run:command",
    }),
  );
  expect(vi.mocked(recordRunnerTurnOutcome).mock.calls[0][2]).not.toHaveProperty("acceptance");
});
