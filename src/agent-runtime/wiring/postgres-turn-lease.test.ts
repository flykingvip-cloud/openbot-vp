import { afterEach, expect, it, vi } from "vitest";
import type {
  AgentTurnExecutionParams,
  AgentRunLoopResult,
} from "../execution/runner/turn-contract.js";
import { runWithPostgresTurnLease } from "./postgres-turn-lease.js";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
function request(signal?: AbortSignal) {
  return {
    followupRun: {
      run: {
        executionIdentity: { enterpriseId: "tenant" },
        taskCompletionBinding: { taskId: "task", executionAttempt: "execution" },
      },
    },
    opts: { abortSignal: signal },
  } as AgentTurnExecutionParams;
}
const result: AgentRunLoopResult = { kind: "final", payload: { text: "done" } };
it("passes through unchanged when database mode is disabled", async () => {
  vi.stubEnv("OPENBOT_RUNTIME_DATABASE_URL", "");
  const run = vi.fn(async () => result);
  const pool = vi.fn();
  const input = request();
  expect(await runWithPostgresTurnLease(input, run, pool)).toBe(result);
  expect(run).toHaveBeenCalledWith(input);
  expect(pool).not.toHaveBeenCalled();
});
it("claims trusted identity and propagates parent cancellation with connection cleanup", async () => {
  vi.stubEnv("OPENBOT_RUNTIME_DATABASE_URL", "postgresql://test");
  const parent = new AbortController();
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ fence: "1", version: "1" }], rowCount: 1 });
  const end = vi.fn(async () => {});
  await expect(
    runWithPostgresTurnLease(
      request(parent.signal),
      async (input) => {
        expect(input.opts?.abortSignal).not.toBe(parent.signal);
        parent.abort(new Error("cancelled"));
        expect(input.opts?.abortSignal?.aborted).toBe(true);
        return result;
      },
      () => ({ query, end }),
    ),
  ).rejects.toThrow("cancelled");
  expect(query.mock.calls[0][1]).toEqual([
    "tenant",
    "execution",
    JSON.stringify({ taskId: "task" }),
  ]);
  expect(end).toHaveBeenCalledTimes(1);
});
it("does not run the model or fall back when database admission fails", async () => {
  vi.stubEnv("OPENBOT_RUNTIME_DATABASE_URL", "postgresql://test");
  const run = vi.fn();
  const end = vi.fn(async () => {});
  const query = vi.fn().mockRejectedValue(new Error("database unavailable"));
  await expect(runWithPostgresTurnLease(request(), run, () => ({ query, end }))).rejects.toThrow(
    "database unavailable",
  );
  expect(run).not.toHaveBeenCalled();
  expect(end).toHaveBeenCalledTimes(1);
});

it("holds ownership until verified delivery acceptance and closes after terminal commit", async () => {
  vi.stubEnv("OPENBOT_RUNTIME_DATABASE_URL", "postgresql://test");
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ fence: "1", version: "1" }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ event_id: "completion" }], rowCount: 1 });
  const end = vi.fn(async () => {});
  const commit = vi.fn(async () => {});
  const outcome = await runWithPostgresTurnLease(
    request(),
    async () =>
      ({
        kind: "success",
        commitGrowthOutcome: commit,
      }) as unknown as AgentRunLoopResult,
    () => ({ query, end }),
  );
  expect(end).not.toHaveBeenCalled();
  if (outcome.kind !== "success") {
    throw new Error("Expected success");
  }
  await outcome.commitGrowthOutcome(true, {
    acceptance: { status: "passed" },
    delivery: { status: "delivered" },
    deliveryId: "receipt",
  });
  expect(query).toHaveBeenCalledTimes(3);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(end).toHaveBeenCalledTimes(1);
});
