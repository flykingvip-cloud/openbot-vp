import { describe, expect, it } from "vitest";
import {
  assertTaskNotStopped,
  buildAcceptedTaskStopControl,
  isTaskStopAccepted,
  readTaskStopControl,
  TaskStoppedError,
} from "./task-stop-control.js";

describe("task-stop-control", () => {
  it("treats missing stopControl as not stopped", () => {
    const task = { taskId: "t1" };
    expect(isTaskStopAccepted(task)).toBe(false);
    expect(readTaskStopControl(task)).toBeNull();
    expect(() => assertTaskNotStopped(task)).not.toThrow();
  });

  it("assertTaskNotStopped throws TaskStoppedError when accepted", () => {
    const stop = buildAcceptedTaskStopControl({
      requestedBy: "owner-1",
      reason: "halt",
      externalEffect: "none",
      inFlightAbort: "best_effort",
    });
    const task = { taskId: "t1", stopControl: stop };
    expect(isTaskStopAccepted(task)).toBe(true);
    expect(() => assertTaskNotStopped(task)).toThrow(TaskStoppedError);
    try {
      assertTaskNotStopped(task);
    } catch (error) {
      expect(error).toBeInstanceOf(TaskStoppedError);
      expect((error as TaskStoppedError).code).toBe("TASK_STOPPED");
      expect((error as TaskStoppedError).taskId).toBe("t1");
    }
  });
});
