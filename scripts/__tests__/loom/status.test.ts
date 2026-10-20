import { describe, expect, it } from "vitest";
import { DEFAULT_DEAD_THRESHOLD_MS } from "../../loom/lifecycle.js";
import { type Registry, validateRegistry } from "../../loom/registry.js";
import { buildStatus, formatStatus } from "../../loom/status.js";

const now = new Date("2026-06-12T12:00:00.000Z");
const stale = new Date(now.getTime() - DEFAULT_DEAD_THRESHOLD_MS - 1000).toISOString();
const fresh = new Date(now.getTime() - 1000).toISOString();

function registry(): Registry {
  return validateRegistry({
    version: 1,
    tasks: [
      {
        id: "auth-refactor",
        owner: "kiro-auth",
        state: "blocked",
        paths: ["src/auth/**"],
        sessions: [
          {
            id: "s1",
            taskId: "auth-refactor",
            ide: "cursor",
            agent: "a",
            status: "active",
            lastSignalAt: fresh,
          },
          {
            id: "s2",
            taskId: "auth-refactor",
            ide: "kiro",
            agent: "b",
            status: "active",
            lastSignalAt: stale,
          },
        ],
      },
      {
        id: "docs",
        owner: "kiro-docs",
        state: "active",
        paths: ["docs/**"],
        sessions: [],
      },
    ],
    landingStreams: [{ id: "A", paths: ["src/auth/**"] }],
  });
}

describe("loom/status — buildStatus", () => {
  it("summarizes tasks, states, blocked flag, and dead sessions", () => {
    const view = buildStatus(registry(), now);
    expect(view.totals.tasks).toBe(2);
    expect(view.totals.byState).toEqual({ blocked: 1, active: 1 });
    expect(view.landingStreamCount).toBe(1);
    expect(view.totals.deadSessions).toBe(1);

    const auth = view.tasks.find((t) => t.id === "auth-refactor");
    expect(auth?.blocked).toBe(true);
    expect(auth?.sessions.find((s) => s.id === "s2")?.dead).toBe(true);
    expect(auth?.sessions.find((s) => s.id === "s1")?.dead).toBe(false);
  });
});

describe("loom/status — formatStatus", () => {
  it("renders blocked and dead markers", () => {
    const text = formatStatus(buildStatus(registry(), now));
    expect(text).toContain("auth-refactor");
    expect(text).toContain("[BLOCKED]");
    expect(text).toContain("dead");
    expect(text).toContain("dead sessions: 1");
  });
});
