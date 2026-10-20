import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelSupervisorRun,
  clearSupervisorRunsForTest,
  getSupervisorRun,
  getSupervisorRunByRunId,
  hasSupervisorRun,
  registerSupervisorRun,
  unregisterSupervisorRun,
} from "./run-registry.js";

describe("run-registry", () => {
  afterEach(() => {
    clearSupervisorRunsForTest();
  });

  it("registers and unregisters active runs", () => {
    const worker = { cancel: vi.fn(async () => undefined) };
    registerSupervisorRun({
      taskId: "t1",
      runId: "run-1",
      workerId: "w1",
      worker,
    });
    expect(hasSupervisorRun("t1")).toBe(true);
    expect(getSupervisorRun("t1")?.runId).toBe("run-1");

    unregisterSupervisorRun("t1");
    expect(hasSupervisorRun("t1")).toBe(false);
  });

  it("cancelSupervisorRun invokes worker.cancel and returns true", async () => {
    const cancel = vi.fn(async () => undefined);
    registerSupervisorRun({
      taskId: "t2",
      runId: "run-2",
      workerId: "w2",
      worker: { cancel },
    });
    const ok = await cancelSupervisorRun("t2");
    expect(ok).toBe(true);
    expect(cancel).toHaveBeenCalledWith("run-2");
  });

  it("cancelSupervisorRun returns false when no run registered", async () => {
    expect(await cancelSupervisorRun("missing")).toBe(false);
  });

  it("indexes runs by authoritative runId", () => {
    registerSupervisorRun({
      taskId: "t3",
      runId: "run-auth-3",
      workerId: "w3",
      worker: { cancel: vi.fn(async () => undefined) },
    });
    expect(getSupervisorRunByRunId("run-auth-3")?.taskId).toBe("t3");
    unregisterSupervisorRun("t3");
    expect(getSupervisorRunByRunId("run-auth-3")).toBeUndefined();
  });
});
