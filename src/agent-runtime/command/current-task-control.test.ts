import { describe, expect, it, vi } from "vitest";
import type { IncomingTurnResult } from "../contracts/task.js";
import { controlCurrentTask } from "./current-task-control.js";

function setup(abortInFlight: boolean) {
  const events: string[] = [];
  const result: IncomingTurnResult = {
    board: { parked: [], focusRevision: 0 },
    action: "continue",
    taskId: "a",
    cutContext: false,
    abortInFlight,
  };
  const ports = {
    applyControl: vi.fn((prompt: string) => {
      events.push(`persist:${prompt}`);
      return result;
    }),
    abortMain: vi.fn(() => {
      events.push("main");
    }),
    abortAsides: vi.fn(() => {
      events.push("asides");
    }),
    clearPending: vi.fn(() => {
      events.push("queue");
    }),
  };
  return { events, result, ports };
}
describe("current task control transaction", () => {
  it("persists before aborting main, asides and queued work", () => {
    const { events, result, ports } = setup(true);
    expect(controlCurrentTask("暂停", ports)).toBe(result);
    expect(events).toEqual(["persist:暂停", "main", "asides", "queue"]);
  });
  it("does not stop unrelated work when original state result requests no abort", () => {
    const { events, ports } = setup(false);
    controlCurrentTask("暂停", ports);
    expect(events).toEqual(["persist:暂停"]);
  });
  it("preserves failures rather than claiming a successful stop", () => {
    const { ports } = setup(true);
    ports.applyControl.mockImplementation(() => {
      throw new Error("write failed");
    });
    expect(() => controlCurrentTask("取消任务", ports)).toThrow("write failed");
    expect(ports.abortMain).not.toHaveBeenCalled();
  });
});
