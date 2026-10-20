import { describe, expect, it, vi } from "vitest";
import { forwardSupervisorWorkerProgress } from "./node-progress.js";
import {
  clearSupervisorRunsForTest,
  registerSupervisorRun,
  unregisterSupervisorRun,
} from "./run-registry.js";

describe("forwardSupervisorWorkerProgress", () => {
  it("forwards progress to the active supervisor run handler", () => {
    const onProgress = vi.fn();
    registerSupervisorRun({
      taskId: "task-1",
      runId: "run-1",
      workerId: "cursor-cli",
      worker: { cancel: async () => undefined },
      onProgress,
    });

    const handled = forwardSupervisorWorkerProgress({
      taskId: "task-1",
      runId: "run-1",
      type: "stdout",
      data: "working…",
    });

    expect(handled).toBe(true);
    expect(onProgress).toHaveBeenCalledWith({ type: "stdout", data: "working…" });
    unregisterSupervisorRun("task-1");
    clearSupervisorRunsForTest();
  });

  it("forwards structured progress with phase", () => {
    const onProgress = vi.fn();
    registerSupervisorRun({
      taskId: "task-2",
      runId: "run-2",
      workerId: "cursor-cli",
      worker: { cancel: async () => undefined },
      onProgress,
    });

    const handled = forwardSupervisorWorkerProgress({
      taskId: "task-2",
      runId: "run-2",
      type: "progress",
      phase: "tool",
      data: "tool: shell",
    });

    expect(handled).toBe(true);
    expect(onProgress).toHaveBeenCalledWith({
      type: "progress",
      phase: "tool",
      data: "tool: shell",
    });
    unregisterSupervisorRun("task-2");
    clearSupervisorRunsForTest();
  });

  it("returns false when no active run exists", () => {
    expect(
      forwardSupervisorWorkerProgress({
        taskId: "missing",
        type: "stdout",
        data: "noop",
      }),
    ).toBe(false);
  });
});
