import { describe, expect, it } from "vitest";
import {
  canTransition,
  DEFAULT_DEAD_THRESHOLD_MS,
  IllegalTransitionError,
  isSessionDead,
  touchSignal,
  transitionTask,
} from "../../loom/lifecycle.js";
import type { Session, Task } from "../../loom/registry.js";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t",
    owner: "kiro",
    intent: [],
    paths: [],
    state: "active",
    sessions: [],
    metadata: {},
    ...overrides,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s",
    taskId: "t",
    ide: "kiro",
    agent: "kiro",
    status: "active",
    metadata: {},
    ...overrides,
  };
}

describe("loom/lifecycle — task state machine", () => {
  it("allows valid transitions", () => {
    expect(canTransition("claimed", "active")).toBe(true);
    expect(canTransition("active", "ready")).toBe(true);
    expect(canTransition("ready", "landed")).toBe(true);
    expect(canTransition("blocked", "active")).toBe(true);
  });

  it("rejects illegal transitions (e.g. landed → active)", () => {
    expect(canTransition("landed", "active")).toBe(false);
    expect(canTransition("abandoned", "active")).toBe(false);
    expect(canTransition("claimed", "landed")).toBe(false);
  });

  it("transitionTask throws IllegalTransitionError on an illegal move", () => {
    expect(() => transitionTask(task({ state: "landed" }), "active")).toThrow(
      IllegalTransitionError,
    );
  });

  it("transitionTask returns a new task with the new state and refreshes signals", () => {
    const now = new Date("2026-06-12T00:00:00.000Z");
    const t = task({ state: "active", sessions: [session()] });
    const next = transitionTask(t, "ready", now);
    expect(next.state).toBe("ready");
    expect(next.sessions[0].lastSignalAt).toBe(now.toISOString());
  });

  it("is a no-op when transitioning to the same state", () => {
    const t = task({ state: "active" });
    expect(transitionTask(t, "active")).toBe(t);
  });
});

describe("loom/lifecycle — session liveness", () => {
  const now = new Date("2026-06-12T12:00:00.000Z");

  it("flags a session whose signal is older than the threshold as dead", () => {
    const stale = session({
      lastSignalAt: new Date(now.getTime() - DEFAULT_DEAD_THRESHOLD_MS - 1000).toISOString(),
    });
    expect(isSessionDead(stale, now)).toBe(true);
  });

  it("does not flag a recently-signalled session", () => {
    const fresh = session({ lastSignalAt: new Date(now.getTime() - 1000).toISOString() });
    expect(isSessionDead(fresh, now)).toBe(false);
  });

  it("does not auto-kill a session that has no recorded signal", () => {
    expect(isSessionDead(session({ lastSignalAt: undefined }), now)).toBe(false);
  });

  it("treats done/error sessions as not-dead, and dead as dead", () => {
    expect(isSessionDead(session({ status: "done" }), now)).toBe(false);
    expect(isSessionDead(session({ status: "error" }), now)).toBe(false);
    expect(isSessionDead(session({ status: "dead" }), now)).toBe(true);
  });

  it("touchSignal stamps lastSignalAt", () => {
    const now2 = new Date("2026-06-12T00:00:00.000Z");
    expect(touchSignal(session(), now2).lastSignalAt).toBe(now2.toISOString());
  });
});
