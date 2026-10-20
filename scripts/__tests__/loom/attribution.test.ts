import { describe, expect, it } from "vitest";
import { attribute, summarize, verdictOf } from "../../loom/attribution.js";
import type { StatusEntry } from "../../loom/glob.js";
import { type Registry, validateRegistry } from "../../loom/registry.js";

function registryOf(tasks: Array<{ id: string; owner: string; paths: string[] }>): Registry {
  return validateRegistry({
    version: 1,
    tasks: tasks.map((t) => ({ ...t, sessions: [] })),
  });
}

const entry = (xy: string, path: string): StatusEntry => ({ xy, path });

describe("loom/attribution", () => {
  const registry = registryOf([
    { id: "ui-stream", owner: "kiro-a", paths: ["ui/src/**"] },
    { id: "auth-stream", owner: "kiro-b", paths: ["src/auth/**", "src/session/**"] },
  ]);

  it("attributes a file to its single owning task", () => {
    const results = attribute(registry, [entry(" M", "ui/src/app.ts")]);
    expect(results[0].owners).toEqual([{ taskId: "ui-stream", owner: "kiro-a" }]);
    expect(verdictOf(results[0])).toBe("ATTRIBUTED");
    expect(results[0].status).toBe("modified");
  });

  it("flags a file matched by no task as UNATTRIBUTED", () => {
    const results = attribute(registry, [entry("??", "docs/readme.md")]);
    expect(results[0].owners).toEqual([]);
    expect(verdictOf(results[0])).toBe("UNATTRIBUTED");
    expect(results[0].status).toBe("untracked");
  });

  it("flags a file matched by >1 task as CONFLICT", () => {
    const shared = registryOf([
      { id: "stream-a", owner: "kiro-a", paths: ["ui/src/shared/**"] },
      { id: "stream-b", owner: "kiro-b", paths: ["ui/src/**"] },
    ]);
    const results = attribute(shared, [entry(" M", "ui/src/shared/model.ts")]);
    expect(results[0].owners).toHaveLength(2);
    expect(verdictOf(results[0])).toBe("CONFLICT");
  });

  it("ignores intent (HARD signal = paths only)", () => {
    const withIntent = validateRegistry({
      version: 1,
      tasks: [
        {
          id: "ui-stream",
          owner: "kiro-a",
          paths: ["ui/src/**"],
          intent: ["backend", "migration"],
          sessions: [],
        },
      ],
    });
    const withoutIntent = registryOf([{ id: "ui-stream", owner: "kiro-a", paths: ["ui/src/**"] }]);
    const e = [entry(" M", "ui/src/app.ts")];
    expect(attribute(withIntent, e)).toEqual(attribute(withoutIntent, e));
  });

  it("stops attributing to a task once it reaches a terminal state", () => {
    // A landed task must release its paths, otherwise the registry only ever
    // grows and every finished task keeps inflating CONFLICT (R13).
    const landed = validateRegistry({
      version: 1,
      tasks: [
        { id: "done-stream", owner: "kiro-a", paths: ["ui/src/**"], state: "landed", sessions: [] },
      ],
    });
    const results = attribute(landed, [entry(" M", "ui/src/app.ts")]);
    expect(results[0].owners).toEqual([]);
    expect(verdictOf(results[0])).toBe("UNATTRIBUTED");
  });

  it("stops attributing to an abandoned task", () => {
    const dropped = validateRegistry({
      version: 1,
      tasks: [
        {
          id: "dead-stream",
          owner: "kiro-a",
          paths: ["ui/src/**"],
          state: "abandoned",
          sessions: [],
        },
      ],
    });
    expect(verdictOf(attribute(dropped, [entry(" M", "ui/src/app.ts")])[0])).toBe("UNATTRIBUTED");
  });

  it("keeps attributing to paused and blocked tasks (still open work)", () => {
    for (const state of ["paused", "blocked", "claimed", "ready"] as const) {
      const open = validateRegistry({
        version: 1,
        tasks: [{ id: "open-stream", owner: "kiro-a", paths: ["ui/src/**"], state, sessions: [] }],
      });
      expect(verdictOf(attribute(open, [entry(" M", "ui/src/app.ts")])[0])).toBe("ATTRIBUTED");
    }
  });

  it("resolves a CONFLICT down to one owner when the other task landed", () => {
    const mixed = validateRegistry({
      version: 1,
      tasks: [
        { id: "live", owner: "kiro-a", paths: ["ui/src/**"], state: "active", sessions: [] },
        { id: "closed", owner: "kiro-b", paths: ["ui/src/**"], state: "landed", sessions: [] },
      ],
    });
    const results = attribute(mixed, [entry(" M", "ui/src/app.ts")]);
    expect(results[0].owners).toEqual([{ taskId: "live", owner: "kiro-a" }]);
    expect(verdictOf(results[0])).toBe("ATTRIBUTED");
  });

  it("includeTerminal restores the pre-filter view for parity checks", () => {
    const mixed = validateRegistry({
      version: 1,
      tasks: [
        { id: "live", owner: "kiro-a", paths: ["ui/src/**"], state: "active", sessions: [] },
        { id: "closed", owner: "kiro-b", paths: ["ui/src/**"], state: "landed", sessions: [] },
      ],
    });
    const results = attribute(mixed, [entry(" M", "ui/src/app.ts")], { includeTerminal: true });
    expect(results[0].owners).toHaveLength(2);
    expect(verdictOf(results[0])).toBe("CONFLICT");
  });

  it("summarizes verdict counts", () => {
    const results = attribute(registry, [
      entry(" M", "ui/src/app.ts"),
      entry(" M", "src/auth/login.ts"),
      entry("??", "unknown/x.ts"),
    ]);
    expect(summarize(results)).toEqual({
      total: 3,
      attributed: 2,
      unattributed: 1,
      conflict: 0,
      shared: 0,
    });
  });
});
// `tasks` is an exclusive partition, so a file shared BY DESIGN (AGENTS.md, the
// gateway registration hubs, i18n locales, ci.yml) produces a CONFLICT that never
// resolves. Registering it names ONE lander and turns the unresolvable CONFLICT
// into an actionable SHARED.
describe("loom/attribution — SHARED verdict (sharedPaths)", () => {
  function twoClaimants(sharedPaths: unknown[] = [], landerOwner = "kiro-loom"): Registry {
    return validateRegistry({
      version: 1,
      tasks: [
        { id: "task-a", owner: "kiro-a", paths: ["AGENTS.md", "src/a/**"], sessions: [] },
        { id: "task-b", owner: "kiro-b", paths: ["AGENTS.md", "src/b/**"], sessions: [] },
        { id: "lander-task", owner: landerOwner, paths: ["docs/**"], sessions: [] },
      ],
      sharedPaths,
    });
  }

  it("defaults to an empty sharedPaths, keeping today's CONFLICT behavior", () => {
    const results = attribute(twoClaimants(), [entry(" M", "AGENTS.md")]);
    expect(verdictOf(results[0])).toBe("CONFLICT");
    expect(results[0].shared).toBeUndefined();
  });

  it("returns SHARED and resolves the lander through the referenced task", () => {
    const registry = twoClaimants([
      { glob: "AGENTS.md", landerTask: "lander-task", reason: "repo-wide agent rulebook" },
    ]);
    const results = attribute(registry, [entry(" M", "AGENTS.md")]);
    expect(verdictOf(results[0])).toBe("SHARED");
    expect(results[0].owners).toHaveLength(2);
    expect(results[0].shared?.lander).toBe("kiro-loom");
    expect(results[0].shared?.shared.reason).toBe("repo-wide agent rulebook");
  });

  // The reason `landerTask` is a task reference and not an agent id: agent ids
  // expire on takeover. Same registration, task now owned by someone else, lander
  // follows automatically.
  it("follows a takeover without the registration changing", () => {
    const before = twoClaimants([{ glob: "AGENTS.md", landerTask: "lander-task" }], "kiro-loom");
    const after = twoClaimants(
      [{ glob: "AGENTS.md", landerTask: "lander-task" }],
      "kiro-successor",
    );
    const e = [entry(" M", "AGENTS.md")];
    expect(attribute(before, e)[0].shared?.lander).toBe("kiro-loom");
    expect(attribute(after, e)[0].shared?.lander).toBe("kiro-successor");
  });

  // A dangling reference silences the CONFLICT while naming nobody, which is worse
  // than the CONFLICT was. The verdict still moves to SHARED (the registration
  // exists), but the lander is undefined so the report and `loom lint` can shout.
  it("leaves the lander undefined when landerTask does not exist", () => {
    const registry = twoClaimants([{ glob: "AGENTS.md", landerTask: "ghost-task" }]);
    const results = attribute(registry, [entry(" M", "AGENTS.md")]);
    expect(verdictOf(results[0])).toBe("SHARED");
    expect(results[0].shared?.lander).toBeUndefined();
  });

  it("keeps unregistered overlaps as CONFLICT, so real takeover signals survive", () => {
    const registry = validateRegistry({
      version: 1,
      tasks: [
        { id: "task-a", owner: "kiro-a", paths: ["AGENTS.md", "src/hot.ts"], sessions: [] },
        { id: "task-b", owner: "kiro-b", paths: ["AGENTS.md", "src/hot.ts"], sessions: [] },
        { id: "lander-task", owner: "kiro-loom", paths: ["docs/**"], sessions: [] },
      ],
      sharedPaths: [{ glob: "AGENTS.md", landerTask: "lander-task" }],
    });
    const results = attribute(registry, [entry(" M", "AGENTS.md"), entry(" M", "src/hot.ts")]);
    expect(verdictOf(results[0])).toBe("SHARED");
    expect(verdictOf(results[1])).toBe("CONFLICT");
  });

  // Registering must not dilute an answer that already exists.
  it("stays ATTRIBUTED when only one task matches a registered path", () => {
    const registry = validateRegistry({
      version: 1,
      tasks: [
        { id: "task-a", owner: "kiro-a", paths: ["AGENTS.md"], sessions: [] },
        { id: "lander-task", owner: "kiro-loom", paths: ["docs/**"], sessions: [] },
      ],
      sharedPaths: [{ glob: "AGENTS.md", landerTask: "lander-task" }],
    });
    const results = attribute(registry, [entry(" M", "AGENTS.md")]);
    expect(verdictOf(results[0])).toBe("ATTRIBUTED");
    expect(results[0].shared?.lander).toBe("kiro-loom");
  });

  // A lander is not an owner. Promoting an unclaimed file would hide the fact that
  // nobody signed in for it.
  it("stays UNATTRIBUTED when no task matches a registered path", () => {
    const registry = validateRegistry({
      version: 1,
      tasks: [{ id: "lander-task", owner: "kiro-loom", paths: ["docs/**"], sessions: [] }],
      sharedPaths: [{ glob: "AGENTS.md", landerTask: "lander-task" }],
    });
    expect(verdictOf(attribute(registry, [entry(" M", "AGENTS.md")])[0])).toBe("UNATTRIBUTED");
  });

  it("supports globs, not just literal paths", () => {
    const registry = validateRegistry({
      version: 1,
      tasks: [
        { id: "task-a", owner: "kiro-a", paths: ["ui/src/i18n/**"], sessions: [] },
        { id: "task-b", owner: "kiro-b", paths: ["ui/src/**"], sessions: [] },
        { id: "i18n-task", owner: "kiro-i18n", paths: ["docs/**"], sessions: [] },
      ],
      sharedPaths: [{ glob: "ui/src/i18n/**", landerTask: "i18n-task" }],
    });
    const results = attribute(registry, [entry(" M", "ui/src/i18n/locales/en.ts")]);
    expect(verdictOf(results[0])).toBe("SHARED");
    expect(results[0].shared?.lander).toBe("kiro-i18n");
  });

  it("takes the first declared registration when several match", () => {
    const registry = twoClaimants([
      { glob: "AGENTS.md", landerTask: "task-a" },
      { glob: "*.md", landerTask: "task-b" },
    ]);
    expect(attribute(registry, [entry(" M", "AGENTS.md")])[0].shared?.lander).toBe("kiro-a");
  });

  it("counts SHARED separately from CONFLICT in the summary", () => {
    const registry = validateRegistry({
      version: 1,
      tasks: [
        { id: "task-a", owner: "kiro-a", paths: ["AGENTS.md", "src/hot.ts"], sessions: [] },
        { id: "task-b", owner: "kiro-b", paths: ["AGENTS.md", "src/hot.ts"], sessions: [] },
        { id: "lander-task", owner: "kiro-loom", paths: ["docs/**"], sessions: [] },
      ],
      sharedPaths: [{ glob: "AGENTS.md", landerTask: "lander-task" }],
    });
    const results = attribute(registry, [
      entry(" M", "AGENTS.md"),
      entry(" M", "src/hot.ts"),
      entry(" M", "src/a/only.ts"),
    ]);
    expect(summarize(results)).toEqual({
      total: 3,
      attributed: 0,
      unattributed: 1,
      conflict: 1,
      shared: 1,
    });
  });

  it("does not consult intent (Architecture Rule #1 still holds)", () => {
    const base = twoClaimants([{ glob: "AGENTS.md", landerTask: "lander-task" }]);
    const withIntent: Registry = {
      ...base,
      tasks: base.tasks.map((t) => ({ ...t, intent: ["whatever", "shared"] })),
    };
    const e = [entry(" M", "AGENTS.md")];
    expect(attribute(withIntent, e)).toEqual(attribute(base, e));
  });
});
