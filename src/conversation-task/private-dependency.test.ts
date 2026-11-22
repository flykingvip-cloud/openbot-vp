import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { sessionTaskState } from "../agent-runtime/state/index.js";
import {
  seedSessionTaskBoard,
  readSessionTaskBoard,
  mutateSessionTaskBoard,
} from "../agent-runtime/state/repository/task-board-file.js";
import {
  tickPrivateDependencies,
  observePrivateDependencyEvent,
  dependencyCapabilityMatches,
} from "./private-dependency-runtime.js";
import {
  reservePrivateDependency,
  readPrivateDependency,
  updatePrivateDependency,
  type PrivateDependency,
} from "./private-dependency-store.js";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "private-dependency-"));
  roots.push(root);
  const sessionFile = path.join(root, "parent.jsonl");
  fs.writeFileSync(sessionFile, "");
  seedSessionTaskBoard(sessionFile, {
    focusRevision: 2,
    parked: [],
    current: {
      taskId: "task",
      title: "Report",
      goalText: "Report",
      executionAttempt: "parent-run",
      unfinished: true,
      createdAtMs: 1,
      stop: { summary: "", workspacePaths: [] },
    },
  });
  const input = {
    toolCallId: "tool-1",
    ownerId: "owner",
    tenantId: "tenant",
    parent: {
      sessionKey: "agent:main:employee:owner",
      sessionFile,
      taskId: "task",
      executionAttempt: "parent-run",
      focusRevision: 2,
    },
    child: { agentId: "child", sessionKey: "agent:child:main", runId: "" },
    successCriteria: "Checked source report",
    deadlineAtMs: 1000,
  };
  const { row } = await reservePrivateDependency(input, root);
  await updatePrivateDependency(row.id, (r) => ({ ...r, state: "waiting" }), root);
  return { root, row, input, sessionFile };
}
const ports = () => ({
  authorize: vi.fn(async () => true),
  childCompleted: vi.fn(async () => false),
  parentBusy: vi.fn(() => false),
  wakeRunning: vi.fn(() => false),
  wake: vi.fn(async (_row: PrivateDependency) => {}),
});
it("durably reserves before send, returns the same child/wake keys on restart and never exposes a guessable capability", async () => {
  const { root, row, input } = await fixture();
  const again = await reservePrivateDependency(input, root);
  expect(again.created).toBe(false);
  expect(again.row.child.runId).toBe(row.child.runId);
  expect(again.row.wakeRunId).toBe(row.wakeRunId);
  expect(dependencyCapabilityMatches(row, row.capability)).toBe(true);
  expect(dependencyCapabilityMatches(row, "f".repeat(64))).toBe(false);
  expect(dependencyCapabilityMatches(row, row.id)).toBe(false);
});
it("progress is not completion; partial terminal selects host parent_review and queues a durable same-task wake", async () => {
  const { root, row } = await fixture();
  const p = ports();
  await observePrivateDependencyEvent(
    {
      runId: row.child.runId,
      sessionKey: row.child.sessionKey,
      stream: "assistant",
      seq: 1,
      ts: 2,
      data: { text: "done" },
    },
    { root, ports: p },
  );
  expect(readPrivateDependency(row.id, root)?.state).toBe("waiting");
  await observePrivateDependencyEvent(
    {
      runId: row.child.runId,
      sessionKey: row.child.sessionKey,
      stream: "lifecycle",
      seq: 2,
      ts: 3,
      data: { phase: "end" },
    },
    { root, ports: p },
  );
  expect(readPrivateDependency(row.id, root)).toMatchObject({
    state: "partial",
    wakeState: "pending",
    resolution: { kind: "fallback", fallbackId: "parent_review" },
  });
  await tickPrivateDependencies({ root, nowMs: 500, ports: p });
  expect(p.wake).toHaveBeenCalledTimes(1);
  expect(p.wake.mock.calls[0][0].parent.taskId).toBe("task");
  await tickPrivateDependencies({ root, nowMs: 501, ports: p });
  expect(p.wake).toHaveBeenCalledTimes(1);
});
it("restarts a timed-out wait, persists a wake lease and retries an interrupted enqueue with the same key", async () => {
  const { root, row } = await fixture();
  const p = ports();
  p.wake.mockRejectedValueOnce(new Error("disconnected"));
  await tickPrivateDependencies({ root, nowMs: 1001, ports: p });
  expect(readPrivateDependency(row.id, root)).toMatchObject({
    state: "timed_out",
    wakeState: "sending",
  });
  await tickPrivateDependencies({ root, nowMs: 40_000, ports: p });
  expect(p.wake).toHaveBeenCalledTimes(2);
  expect(p.wake.mock.calls[0][0].wakeRunId).toBe(p.wake.mock.calls[1][0].wakeRunId);
  await tickPrivateDependencies({ root, nowMs: 80_000, ports: p });
  expect(readPrivateDependency(row.id, root)).toMatchObject({
    wakeState: "needs_user",
    reason: "wake_failed",
  });
});
it.each(["paused", "cancelled", "switched", "attempt"] as const)(
  "does not resurrect a %s parent on late receipt",
  async (change) => {
    const { root, row, sessionFile } = await fixture();
    const p = ports();
    p.childCompleted.mockResolvedValue(true);
    mutateSessionTaskBoard(sessionFile, (board) => ({
      board: {
        ...board,
        current: {
          ...board.current!,
          ...(change === "paused"
            ? { wakeSuppress: true }
            : change === "cancelled"
              ? { unfinished: false }
              : change === "switched"
                ? { taskId: "other" }
                : { executionAttempt: "new-attempt" }),
        },
      },
      value: undefined,
    }));
    await observePrivateDependencyEvent(
      { runId: row.child.runId, stream: "lifecycle", seq: 3, ts: 4, data: { phase: "end" } },
      { root, ports: p },
    );
    await tickPrivateDependencies({ root, nowMs: 500, ports: p });
    expect(p.wake).not.toHaveBeenCalled();
    expect(readPrivateDependency(row.id, root)?.wakeState).toBe("invalidated");
  },
);
it("accepts verified child delivery once, ignores late duplicate receipts and tolerates unrelated board epochs", async () => {
  const { root, row, sessionFile } = await fixture();
  const p = ports();
  p.childCompleted.mockResolvedValue(true);
  mutateSessionTaskBoard(sessionFile, (board) => ({
    board: { ...board, writeEpoch: (board.writeEpoch ?? 0) + 5 },
    value: undefined,
  }));
  const event = {
    runId: row.child.runId,
    stream: "lifecycle",
    seq: 4,
    ts: 5,
    data: { phase: "end" },
  };
  await observePrivateDependencyEvent(event, { root, ports: p });
  await observePrivateDependencyEvent(event, { root, ports: p });
  p.wake.mockImplementation(async (r) => {
    const binding = sessionTaskState.captureBinding(sessionFile);
    sessionTaskState.startExecution(sessionFile, binding, r.wakeRunId);
  });
  await tickPrivateDependencies({ root, nowMs: 500, ports: p });
  p.parentBusy.mockReturnValue(true);
  p.wakeRunning.mockReturnValue(true);
  await tickPrivateDependencies({ root, nowMs: 501, ports: p });
  expect(p.wake).toHaveBeenCalledTimes(1);
  expect(readPrivateDependency(row.id, root)).toMatchObject({
    state: "completed",
    wakeState: "accepted",
  });
  expect(readSessionTaskBoard(sessionFile).current?.taskId).toBe("task");
});
it("revoked permissions form a durable owner pending item and never run fallback", async () => {
  const { root, row } = await fixture();
  const p = ports();
  p.authorize.mockResolvedValue(false);
  await tickPrivateDependencies({ root, nowMs: 2000, ports: p });
  expect(readPrivateDependency(row.id, root)).toMatchObject({
    wakeState: "needs_user",
    reason: "permission",
  });
  expect(p.wake).not.toHaveBeenCalled();
});

it("replays an enqueue interrupted after board claim with the same run and no new task", async () => {
  const { root, row, sessionFile } = await fixture();
  const p = ports();
  p.childCompleted.mockResolvedValue(true);
  await tickPrivateDependencies({ root, nowMs: 500, ports: p });
  sessionTaskState.startExecution(
    sessionFile,
    sessionTaskState.captureBinding(sessionFile),
    row.wakeRunId,
  );
  await tickPrivateDependencies({ root, nowMs: 40_000, ports: p });
  expect(p.wake).toHaveBeenCalledTimes(2);
  expect(p.wake.mock.calls[1][0].wakeRunId).toBe(row.wakeRunId);
  expect(readSessionTaskBoard(sessionFile).current?.taskId).toBe(row.parent.taskId);
});
it("failed children use one host review and an unsuccessful review becomes a persisted user pending item", async () => {
  const { root, row, sessionFile } = await fixture();
  const p = ports();
  await observePrivateDependencyEvent(
    { runId: row.child.runId, seq: 2, ts: 3, stream: "lifecycle", data: { phase: "error" } },
    { root, ports: p },
  );
  expect(readPrivateDependency(row.id, root)).toMatchObject({
    state: "failed",
    resolution: { kind: "fallback", fallbackId: "parent_review" },
  });
  p.wake.mockImplementation(async (r) => {
    sessionTaskState.startExecution(
      sessionFile,
      sessionTaskState.captureBinding(sessionFile),
      r.wakeRunId,
    );
  });
  await tickPrivateDependencies({ root, nowMs: 500, ports: p });
  await observePrivateDependencyEvent(
    {
      runId: row.wakeRunId,
      sessionKey: row.parent.sessionKey,
      seq: 1,
      ts: 5,
      stream: "lifecycle",
      data: { phase: "end" },
    },
    { root, ports: p },
  );
  expect(readPrivateDependency(row.id, root)).toMatchObject({
    wakeState: "needs_user",
    resolution: { kind: "needs_user", reason: "retry_budget_exhausted" },
  });
});
