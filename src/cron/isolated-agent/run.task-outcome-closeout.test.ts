import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeIsolatedAgentJobFixture } from "./job-fixtures.js";
import {
  makeIsolatedAgentTurnParams,
  setupRunCronIsolatedAgentTurnSuite,
} from "./run.suite-helpers.js";
import {
  loadRunCronIsolatedAgentTurn,
  resolveAgentDirMock,
  runWithModelFallbackMock,
} from "./run.test-harness.js";

const recordRunnerTurnOutcomeMock = vi.fn();

vi.mock("../../task-outcome/runtime-from-runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../task-outcome/runtime-from-runner.js")>();
  return {
    ...actual,
    recordRunnerTurnOutcome: (...args: unknown[]) => recordRunnerTurnOutcomeMock(...args),
  };
});

const runCronIsolatedAgentTurn = await loadRunCronIsolatedAgentTurn();

describe("askOutcome W1 cron unified closeout through runCronIsolatedAgentTurn", () => {
  setupRunCronIsolatedAgentTurnSuite();

  beforeEach(() => {
    resolveAgentDirMock.mockReturnValue("/tmp/agent-dir");
    recordRunnerTurnOutcomeMock.mockReset();
    recordRunnerTurnOutcomeMock.mockImplementation(async (...args: unknown[]) => {
      resolveAgentDirMock.mockReturnValue("/tmp/agent-dir");
      return {
        record: {
          taskId: (args[2] as { taskId: string }).taskId,
          runs: [
            {
              runId: "x",
              attemptIds: [],
              fencingToken: "f",
              status: (args[2] as { success: boolean }).success ? "succeeded" : "failed",
            },
          ],
          attempts: [],
          delivery: { status: "pending" },
          entrypoint: "cron",
        },
        evolution: { written: false, reason: "test" },
      };
    });
  });

  it("records ordinary success closeout for persisted fireId", async () => {
    const fireId = "sched-fire-success-1";
    const res = await runCronIsolatedAgentTurn(
      makeIsolatedAgentTurnParams({
        fireId,
        job: makeIsolatedAgentJobFixture({ id: "job-close-ok", name: "Close OK" }),
      }) as never,
    );
    expect(res.status).toBe("ok");
    expect(recordRunnerTurnOutcomeMock).toHaveBeenCalled();
    const call = recordRunnerTurnOutcomeMock.mock.calls.find(
      (c) => (c[2] as { taskId?: string }).taskId === `cron:job-close-ok:${fireId}`,
    );
    expect(call).toBeTruthy();
    expect(call![2]).toMatchObject({
      success: true,
      taskId: `cron:job-close-ok:${fireId}`,
      entrypoint: "cron",
    });
    // Real evidence only: delivered true/false may set gate; never invent not_required.
    const delivery = (call![2] as { delivery?: { status?: string } }).delivery;
    if (delivery) {
      expect(delivery.status).not.toBe("not_required");
    }
  });

  it("reuses same fireId task identity across retry re-entry", async () => {
    const fireId = "sched-fire-retry-1";
    const params = makeIsolatedAgentTurnParams({
      fireId,
      job: makeIsolatedAgentJobFixture({
        id: "job-close-retry",
        name: "Retry",
        state: { currentFireId: fireId },
      }),
    });
    await runCronIsolatedAgentTurn(params as never);
    await runCronIsolatedAgentTurn(params as never);
    const calls = recordRunnerTurnOutcomeMock.mock.calls.filter(
      (c) => (c[2] as { taskId?: string }).taskId === `cron:job-close-retry:${fireId}`,
    );
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const runIds = calls.map((c) => (c[2] as { runId: string }).runId);
    // Per-execution tip runIds differ; taskId stable.
    expect(new Set(runIds).size).toBe(runIds.length);
  });

  it("records run_failed closeout on ordinary agent error", async () => {
    runWithModelFallbackMock.mockRejectedValueOnce(new Error("model boom"));
    const fireId = "sched-fire-fail-1";
    const res = await runCronIsolatedAgentTurn(
      makeIsolatedAgentTurnParams({
        fireId,
        job: makeIsolatedAgentJobFixture({ id: "job-close-fail", name: "Fail" }),
      }) as never,
    );
    expect(res.status).toBe("error");
    const call = recordRunnerTurnOutcomeMock.mock.calls.find(
      (c) => (c[2] as { taskId?: string }).taskId === `cron:job-close-fail:${fireId}`,
    );
    expect(call).toBeTruthy();
    expect(call![2]).toMatchObject({
      success: false,
      failureReason: "run_failed",
      entrypoint: "cron",
    });
  });

  it("records user_cancelled closeout when abortSignal aborted", async () => {
    const fireId = "sched-fire-cancel-1";
    const ac = new AbortController();
    ac.abort(new Error("cancelled by test"));
    await runCronIsolatedAgentTurn(
      makeIsolatedAgentTurnParams({
        fireId,
        abortSignal: ac.signal,
        job: makeIsolatedAgentJobFixture({ id: "job-close-cancel", name: "Cancel" }),
      }) as never,
    );
    const call = recordRunnerTurnOutcomeMock.mock.calls.find(
      (c) => (c[2] as { taskId?: string }).taskId === `cron:job-close-cancel:${fireId}`,
    );
    expect(call).toBeTruthy();
    expect(call![2]).toMatchObject({
      success: false,
      failureReason: "user_cancelled",
      entrypoint: "cron",
    });
  });
});
