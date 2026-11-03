import { describe, expect, it, vi } from "vitest";
import { amendActiveTask } from "./amend-active-task.js";

function ports(persisted = true, steered = true) {
  const events: string[] = [];
  return {
    events,
    readTaskId: vi.fn(() => {
      events.push("read");
      return "task-a";
    }),
    persist: vi.fn((id: string) => {
      events.push(`persist:${id}`);
      return persisted;
    }),
    steer: vi.fn(() => {
      events.push("steer");
      return steered;
    }),
  };
}
describe("active-task amendment transaction", () => {
  it("records restrictions before steering and persists only once", () => {
    const p = ports();
    expect(amendActiveTask(true, p)).toEqual({ kind: "injected", persisted: true });
    expect(p.events).toEqual(["read", "persist:task-a", "steer"]);
  });
  it("does not steer after a rejected restriction write", () => {
    const p = ports(false);
    expect(amendActiveTask(true, p)).toEqual({ kind: "barrier-rejected" });
    expect(p.steer).not.toHaveBeenCalled();
  });
  it("preserves ordinary steer-before-persist order", () => {
    const p = ports();
    expect(amendActiveTask(false, p)).toEqual({ kind: "injected", persisted: true });
    expect(p.events).toEqual(["read", "steer", "persist:task-a"]);
  });
  it("defers missed ordinary steering without consuming persistence", () => {
    const p = ports(true, false);
    expect(amendActiveTask(false, p)).toEqual({ kind: "defer" });
    expect(p.persist).not.toHaveBeenCalled();
  });
  it("reports recorded-only restrictions and injection persistence failures distinctly", () => {
    expect(amendActiveTask(true, ports(true, false))).toEqual({ kind: "barrier-recorded" });
    expect(amendActiveTask(false, ports(false))).toEqual({ kind: "injected", persisted: false });
  });
  it("preserves missing-identity behavior without inventing an early rejection", () => {
    for (const steered of [true, false]) {
      const p = ports(true, steered);
      p.readTaskId.mockReturnValue("");
      expect(amendActiveTask(true, p)).toEqual(
        steered ? { kind: "injected", persisted: false } : { kind: "defer" },
      );
      expect(p.persist).not.toHaveBeenCalled();
    }
  });
  it("propagates state and steering errors without silently deferring", () => {
    const p = ports();
    p.persist.mockImplementation(() => {
      throw new Error("state failure");
    });
    expect(() => amendActiveTask(true, p)).toThrow("state failure");
    expect(p.steer).not.toHaveBeenCalled();
  });
});
