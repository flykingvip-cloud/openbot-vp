import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTurnOutcomeRecorder } from "./turn-outcome.js";
const mocks = vi.hoisted(() => ({ record: vi.fn(), growth: vi.fn(), failure: vi.fn() }));
vi.mock("../../../task-outcome/runtime-from-runner.js", () => ({
  recordRunnerTurnOutcome: (...args: unknown[]) => mocks.record(...args),
}));
vi.mock("../../../gateway/agent-growth/operational-growth.js", () => ({
  syncRobotGrowthFromOperationalMetrics: (...args: unknown[]) => mocks.growth(...args),
}));
vi.mock("../../../gateway/evolution-control/evolution-loop-log.js", () => ({
  reportEvolutionOutcomeWriteFailure: (...args: unknown[]) => mocks.failure(...args),
}));
const scope = {
  kind: "personal",
  personalDomainId: "domain-a",
  subjectRef: "user-a",
  authzScopeRef: "scope-a",
} as const;
function create(overrides: Partial<Parameters<typeof createTurnOutcomeRecorder>[0]> = {}) {
  return createTurnOutcomeRecorder({
    config: {},
    agentId: "agent-a",
    isHeartbeat: false,
    runId: "run-a",
    startedAtMs: Date.now(),
    readContext: () => ({ taskId: "task-a", scope, budgetCharged: true }),
    ...overrides,
  });
}
beforeEach(() => {
  mocks.record.mockReset().mockResolvedValue(undefined);
  mocks.growth.mockReset().mockResolvedValue(undefined);
  mocks.failure.mockReset();
});
describe("turn outcome evidence aggregation", () => {
  it("keeps tool and artifact evidence until explicit delivery classification commit", async () => {
    const recorder = create();
    recorder.recordToolResult(false);
    recorder.recordToolResult(true);
    recorder.recordArtifact({ toolName: "image_gen", relativePath: "out/image.png" });
    expect(mocks.record).not.toHaveBeenCalled();
    await recorder.commit(true, {
      acceptance: { status: "passed" },
      delivery: { status: "delivered" },
    });
    expect(mocks.record).toHaveBeenCalledWith(
      {},
      "agent-a",
      expect.objectContaining({
        taskId: "task-a",
        runId: "run-a",
        toolsTotal: 2,
        toolsSucceeded: 1,
        skipBudgetCharge: true,
        modalityArtifacts: [{ toolName: "image_gen", relativePath: "out/image.png" }],
        acceptance: { status: "passed" },
        delivery: { status: "delivered" },
      }),
    );
    expect(recorder.hasToolResults()).toBe(false);
    expect(mocks.growth).toHaveBeenCalledTimes(1);
  });
  it("does not fabricate task identity when entry context is missing", async () => {
    const recorder = create({ readContext: () => ({ budgetCharged: false }) });
    await recorder.commit(false);
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.failure).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: null, reason: "chat_entry_task_missing" }),
    );
  });
  it("preserves heartbeat early return without consuming accumulated signals", async () => {
    const recorder = create({ isHeartbeat: true });
    recorder.recordToolResult(false);
    await recorder.commit(true);
    expect(recorder.hasToolResults()).toBe(true);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("keeps cancellation and explicit failure reason precedence", async () => {
    const controller = new AbortController();
    controller.abort();
    await create({ abortSignal: controller.signal }).commit(false);
    expect(mocks.record.mock.calls[0]?.[2]).toMatchObject({ failureReason: "user_cancelled" });
    await create({ abortSignal: controller.signal }).commit(false, {
      failureReason: "authz_denied",
    });
    expect(mocks.record.mock.calls[1]?.[2]).toMatchObject({ failureReason: "authz_denied" });
  });
  it("reports failed outcome persistence without rewriting the already-selected reply", async () => {
    mocks.record.mockRejectedValueOnce(new Error("write failed"));
    await expect(create().commit(true)).resolves.toBeUndefined();
    expect(mocks.failure).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-a", reason: "write failed" }),
    );
    expect(mocks.growth).not.toHaveBeenCalled();
  });
  it("reads current budget at commit and preserves repeat-call reset semantics", async () => {
    let budgetCharged = false;
    const recorder = create({ readContext: () => ({ taskId: "task-a", scope, budgetCharged }) });
    recorder.recordToolResult(false);
    await recorder.commit(true);
    budgetCharged = true;
    await recorder.commit(true);
    expect(mocks.record.mock.calls[0]?.[2]).toMatchObject({ toolsTotal: 1 });
    expect(mocks.record.mock.calls[0]?.[2]).not.toHaveProperty("skipBudgetCharge");
    expect(mocks.record.mock.calls[1]?.[2]).toMatchObject({
      toolsTotal: 0,
      skipBudgetCharge: true,
    });
  });
});
