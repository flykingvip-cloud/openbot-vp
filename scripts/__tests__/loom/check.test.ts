import { describe, expect, it } from "vitest";
import {
  computeDiffs,
  formatCheckReport,
  type LegacyAudit,
  runCheck,
  UNMATCHED,
} from "../../loom/check.js";
import type { StatusEntry } from "../../loom/glob.js";
import { type Registry, validateRegistry } from "../../loom/registry.js";

const entry = (path: string): StatusEntry => ({ xy: " M", path });

function registry(opts: {
  tasks?: Array<{ id: string; owner: string; paths: string[] }>;
  landingStreams?: Array<{ id: string; paths: string[]; landingPolicy?: string }>;
  sharedPaths?: Array<{ glob: string; landerTask: string; reason?: string }>;
}): Registry {
  return validateRegistry({
    version: 1,
    tasks: (opts.tasks ?? []).map((t) => ({ ...t, sessions: [] })),
    landingStreams: opts.landingStreams ?? [],
    sharedPaths: opts.sharedPaths ?? [],
  });
}

function legacyAudit(groupByPath: Record<string, string>, riskyMix = false): LegacyAudit {
  return {
    groupByPath: new Map(Object.entries(groupByPath)),
    riskyMix,
  };
}

describe("loom/check — computeDiffs (deterministic parity)", () => {
  it("reports no diffs when legacy and registry agree", () => {
    const { diffs, sharedTransitions } = computeDiffs({
      entries: [entry("ui/src/app.ts"), entry("docs/x.md")],
      registry: registry({
        tasks: [{ id: "spec:kiro", owner: "kiro", paths: ["ui/src/**"] }],
        landingStreams: [
          { id: "A", paths: ["ui/src/**"] },
          { id: "F", paths: ["docs/**"], landingPolicy: "parallel" },
        ],
      }),
      legacyAudit: legacyAudit({ "ui/src/app.ts": "A", "docs/x.md": "F" }),
      legacyAttribution: new Map([
        ["ui/src/app.ts", ["kiro"]],
        ["docs/x.md", []],
      ]),
    });
    expect(diffs).toEqual([]);
    expect(sharedTransitions).toEqual([]);
  });

  it("detects an audit-group divergence both sides saw", () => {
    const { diffs } = computeDiffs({
      entries: [entry("ui/src/app.ts")],
      registry: registry({ landingStreams: [{ id: "B", paths: ["ui/src/**"] }] }),
      legacyAudit: legacyAudit({ "ui/src/app.ts": "A" }),
      legacyAttribution: new Map([["ui/src/app.ts", []]]),
    });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ dimension: "audit", legacy: "A", registry: "B" });
  });

  it("detects an unmatched-vs-matched divergence both sides saw", () => {
    const { diffs } = computeDiffs({
      entries: [entry("weird/x.ts")],
      registry: registry({ landingStreams: [] }), // registry: unmatched
      legacyAudit: legacyAudit({ "weird/x.ts": "A" }), // legacy: A
      legacyAttribution: new Map([["weird/x.ts", []]]),
    });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ dimension: "audit", legacy: "A", registry: "UNMATCHED" });
  });

  it("detects an attribution owner-set divergence", () => {
    const { diffs } = computeDiffs({
      entries: [entry("src/auth/x.ts")],
      registry: registry({
        tasks: [{ id: "spec:kiro", owner: "kiro", paths: ["src/auth/**"] }],
      }),
      legacyAudit: legacyAudit({ "src/auth/x.ts": UNMATCHED }),
      legacyAttribution: new Map([["src/auth/x.ts", ["someone-else"]]]),
    });
    expect(diffs.some((d) => d.dimension === "attribution")).toBe(true);
  });

  it("detects a riskyMix divergence over the shared set", () => {
    const { diffs } = computeDiffs({
      entries: [entry("a/x.ts"), entry("b/y.ts")],
      registry: registry({
        landingStreams: [
          { id: "A", paths: ["a/**"] },
          { id: "B", paths: ["b/**"] },
        ],
      }),
      // two unrelated serial primaries → registry riskyMix=true; legacy says false
      legacyAudit: legacyAudit({ "a/x.ts": "A", "b/y.ts": "B" }, false),
      legacyAttribution: new Map([
        ["a/x.ts", []],
        ["b/y.ts", []],
      ]),
    });
    expect(diffs.some((d) => d.dimension === "riskyMix")).toBe(true);
  });

  it("skips files only one side saw (shared-tree race), not a real diff", () => {
    const { diffs } = computeDiffs({
      entries: [entry("ui/src/app.ts"), entry("only-in-my-snapshot.ts")],
      registry: registry({
        landingStreams: [{ id: "A", paths: ["ui/**", "only-in-my-snapshot.ts"] }],
      }),
      // legacy never saw only-in-my-snapshot.ts (added after legacy ran)
      legacyAudit: legacyAudit({ "ui/src/app.ts": "A" }),
      legacyAttribution: new Map([["ui/src/app.ts", []]]),
    });
    expect(diffs).toEqual([]);
  });
});

// P2.4 — `sharedPaths` cannot change owner SETS, only how an overlap is
// classified. The gate therefore compares VERDICTS too and permits exactly one
// transition; anything else means the registration leaked into a decision it must
// not touch.
describe("loom/check — verdict parity for sharedPaths (P2.4)", () => {
  const twoOwners = { "AGENTS.md": ["kiro-a", "kiro-b"] };
  const tasks = [
    { id: "task-a", owner: "kiro-a", paths: ["AGENTS.md"] },
    { id: "task-b", owner: "kiro-b", paths: ["AGENTS.md"] },
  ];

  it("records CONFLICT -> SHARED as an allowed transition, not a diff", () => {
    const { diffs, sharedTransitions } = computeDiffs({
      entries: [entry("AGENTS.md")],
      registry: registry({
        tasks,
        sharedPaths: [
          { glob: "AGENTS.md", landerTask: "task-a", reason: "repo-wide agent rulebook" },
        ],
      }),
      legacyAudit: legacyAudit({ "AGENTS.md": UNMATCHED }),
      legacyAttribution: new Map(Object.entries(twoOwners)),
    });
    expect(diffs).toEqual([]);
    expect(sharedTransitions).toEqual([
      {
        path: "AGENTS.md",
        glob: "AGENTS.md",
        lander: "kiro-a",
        reason: "repo-wide agent rulebook",
      },
    ]);
  });

  it("keeps an unregistered overlap as a plain CONFLICT with no transition", () => {
    const { diffs, sharedTransitions } = computeDiffs({
      entries: [entry("AGENTS.md")],
      registry: registry({ tasks }),
      legacyAudit: legacyAudit({ "AGENTS.md": UNMATCHED }),
      legacyAttribution: new Map(Object.entries(twoOwners)),
    });
    expect(diffs).toEqual([]);
    expect(sharedTransitions).toEqual([]);
  });

  it("does not touch verdicts on paths with a single owner", () => {
    const { diffs, sharedTransitions } = computeDiffs({
      entries: [entry("AGENTS.md")],
      registry: registry({
        tasks: [tasks[0]],
        sharedPaths: [{ glob: "AGENTS.md", landerTask: "task-a" }],
      }),
      legacyAudit: legacyAudit({ "AGENTS.md": UNMATCHED }),
      legacyAttribution: new Map([["AGENTS.md", ["kiro-a"]]]),
    });
    expect(diffs).toEqual([]);
    expect(sharedTransitions).toEqual([]);
  });

  it("does not promote an unclaimed registered path (a lander is not an owner)", () => {
    const { diffs, sharedTransitions } = computeDiffs({
      entries: [entry("AGENTS.md")],
      registry: registry({
        tasks: [],
        sharedPaths: [{ glob: "AGENTS.md", landerTask: "ghost:nobody" }],
      }),
      legacyAudit: legacyAudit({ "AGENTS.md": UNMATCHED }),
      legacyAttribution: new Map([["AGENTS.md", []]]),
    });
    expect(diffs).toEqual([]);
    expect(sharedTransitions).toEqual([]);
  });

  it("reports a non-sanctioned verdict change instead of accepting it", () => {
    const { diffs, sharedTransitions } = computeDiffs({
      entries: [entry("AGENTS.md")],
      registry: registry({
        tasks,
        sharedPaths: [{ glob: "AGENTS.md", landerTask: "task-a" }],
      }),
      legacyAudit: legacyAudit({ "AGENTS.md": UNMATCHED }),
      legacyAttribution: new Map([["AGENTS.md", ["kiro-a"]]]),
    });
    expect(diffs.some((d) => d.dimension === "attribution")).toBe(true);
    expect(sharedTransitions).toEqual([]);
  });

  it("still transitions when landerTask dangles, and shows the lander as unresolved", () => {
    const { diffs, sharedTransitions } = computeDiffs({
      entries: [entry("AGENTS.md")],
      registry: registry({
        tasks,
        sharedPaths: [{ glob: "AGENTS.md", landerTask: "ghost:nobody" }],
      }),
      legacyAudit: legacyAudit({ "AGENTS.md": UNMATCHED }),
      legacyAttribution: new Map(Object.entries(twoOwners)),
    });
    expect(sharedTransitions[0]?.lander).toBeUndefined();
    const report = formatCheckReport({ ok: true, dirtyFiles: 1, diffs, sharedTransitions });
    expect(report).toContain("lander=(UNRESOLVED)");
  });

  it("leaves non-shared paths byte-identical when sharedPaths is populated", () => {
    const { diffs, sharedTransitions } = computeDiffs({
      entries: [entry("AGENTS.md"), entry("src/other.ts")],
      registry: registry({
        tasks: [
          { id: "task-a", owner: "kiro-a", paths: ["AGENTS.md", "src/other.ts"] },
          { id: "task-b", owner: "kiro-b", paths: ["AGENTS.md", "src/other.ts"] },
        ],
        sharedPaths: [{ glob: "AGENTS.md", landerTask: "task-a" }],
      }),
      legacyAudit: legacyAudit({ "AGENTS.md": UNMATCHED, "src/other.ts": UNMATCHED }),
      legacyAttribution: new Map([
        ["AGENTS.md", ["kiro-a", "kiro-b"]],
        ["src/other.ts", ["kiro-a", "kiro-b"]],
      ]),
    });
    expect(diffs).toEqual([]);
    expect(sharedTransitions.map((t) => t.path)).toEqual(["AGENTS.md"]);
  });
});

describe("loom/check — runCheck against the live repo (Milestone M1)", () => {
  it("imported Registry reproduces legacy verdicts on the current dirty tree", () => {
    const result = runCheck(process.cwd());
    if (!result.ok) {
      console.error(JSON.stringify(result.diffs, null, 2));
    }
    expect(result.ok).toBe(true);
  }, 60_000);
});
