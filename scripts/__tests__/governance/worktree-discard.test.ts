import { describe, expect, it } from "vitest";
import {
  dedupeByPath,
  type DiscardEntry,
  type GitProbe,
  judge,
  parseDiscardLog,
  splitPathAndNote,
  triageDirty,
  verifyLog,
} from "../../governance/worktree-discard.js";

/** Probe stub: everything is stated explicitly so a verdict is never accidental. */
function probeOf(opts: { matches?: string[]; dirty?: string[]; inBaseline?: string[] }): GitProbe {
  const matches = new Set(opts.matches ?? []);
  const dirty = new Set(opts.dirty ?? []);
  const inBaseline = new Set(opts.inBaseline ?? []);
  return {
    matchesBaseline: (p) => matches.has(p),
    dirtyPaths: () => dirty,
    existsInBaseline: (p) => inBaseline.has(p),
  };
}

const entry = (action: DiscardEntry["action"], path: string, line = 1): DiscardEntry => ({
  action,
  path,
  line,
});

// ─────────────────────────────────────────────────────────────────────────────
// Log parsing
// ─────────────────────────────────────────────────────────────────────────────

describe("worktree-discard — splitPathAndNote", () => {
  it("returns a bare path unchanged", () => {
    expect(splitPathAndNote("src/a.ts")).toEqual({ path: "src/a.ts" });
  });

  it("strips a trailing parenthesised note", () => {
    expect(splitPathAndNote("ui/src/styles/trial-apply.css (pending #189 land)")).toEqual({
      path: "ui/src/styles/trial-apply.css",
      note: "pending #189 land",
    });
  });

  // Only a note at the very end is removed, so a path that itself contains
  // parentheses survives.
  it("leaves parentheses inside a path alone", () => {
    expect(splitPathAndNote("src/weird(name).ts")).toEqual({ path: "src/weird(name).ts" });
  });
});

describe("worktree-discard — parseDiscardLog", () => {
  it("parses the policy's recommended one-line form", () => {
    const entries = parseDiscardLog(
      ["# comment", "", "RESTORE_FROM_MAIN src/a.ts", "DELETE_UNTRACKED_STALE src/b.ts"].join("\n"),
    );
    expect(entries).toEqual([
      { action: "RESTORE_FROM_MAIN", path: "src/a.ts", note: undefined, line: 3 },
      { action: "DELETE_UNTRACKED_STALE", path: "src/b.ts", note: undefined, line: 4 },
    ]);
  });

  it("skips comments and blank lines", () => {
    expect(parseDiscardLog("# only a comment\n\n   \n")).toEqual([]);
  });

  // Shape B exists in the real logs. Policy 4.4 calls its format "recommended",
  // so rejecting this would make the checker useless against what is written.
  it("parses the timestamped batch form, inheriting the action from the header", () => {
    const entries = parseDiscardLog(
      [
        "2026-08-01T00:34Z discard regressions → origin/main:",
        "  - ui/src/ui/tool-display.ts (path regress vs #178)",
        "  - ui/src/ui/controllers/channels.ts (drops tenantId option)",
      ].join("\n"),
    );
    expect(entries).toEqual([
      {
        action: "RESTORE_FROM_MAIN",
        path: "ui/src/ui/tool-display.ts",
        note: "path regress vs #178",
        line: 2,
      },
      {
        action: "RESTORE_FROM_MAIN",
        path: "ui/src/ui/controllers/channels.ts",
        note: "drops tenantId option",
        line: 3,
      },
    ]);
  });

  it("handles both shapes in one file", () => {
    const entries = parseDiscardLog(
      [
        "RESTORE_FROM_MAIN src/a.ts",
        "2026-08-01T00:34Z discard regressions → origin/main:",
        "  - src/b.ts",
      ].join("\n"),
    );
    expect(entries.map((e) => e.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(entries.every((e) => e.action === "RESTORE_FROM_MAIN")).toBe(true);
  });

  it("records LEAVE_FOR_* as a carve-out action", () => {
    const entries = parseDiscardLog("LEAVE_FOR_BRAND_REVIEW a/colors.xml (#DD1A08 to #FF000000)");
    expect(entries[0]).toMatchObject({
      action: "LEAVE_FOR_REVIEW",
      path: "a/colors.xml",
      note: "#DD1A08 to #FF000000",
    });
  });

  it("ignores an unknown verb rather than guessing an action", () => {
    expect(parseDiscardLog("SOMETHING_ELSE src/a.ts")).toEqual([]);
  });

  // A bullet with no batch header states no action, so inventing one would be a
  // fabricated assertion.
  it("ignores a bullet that has no batch header", () => {
    expect(parseDiscardLog("  - src/orphan.ts")).toEqual([]);
  });

  it("stops inheriting the batch action after an explicit one-line entry", () => {
    const entries = parseDiscardLog(
      [
        "2026-08-01T00:34Z discard regressions → origin/main:",
        "  - src/a.ts",
        "DELETE_UNTRACKED_STALE src/b.ts",
        "  - src/c.ts",
      ].join("\n"),
    );
    expect(entries.map((e) => [e.action, e.path])).toEqual([
      ["RESTORE_FROM_MAIN", "src/a.ts"],
      ["DELETE_UNTRACKED_STALE", "src/b.ts"],
    ]);
  });
});

describe("worktree-discard — dedupeByPath", () => {
  // Logs are appended to over several rounds, so the last word on a path wins.
  it("keeps the last action for a repeated path", () => {
    const result = dedupeByPath([
      entry("RESTORE_FROM_MAIN", "src/a.ts", 1),
      entry("DELETE_UNTRACKED_STALE", "src/a.ts", 9),
    ]);
    expect(result).toEqual([entry("DELETE_UNTRACKED_STALE", "src/a.ts", 9)]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// judge — policy section 7
// ─────────────────────────────────────────────────────────────────────────────

describe("worktree-discard — judge", () => {
  it("passes a restore whose worktree copy matches the baseline", () => {
    const probe = probeOf({ matches: ["src/a.ts"], inBaseline: ["src/a.ts"] });
    expect(judge(entry("RESTORE_FROM_MAIN", "src/a.ts"), probe, new Set())).toMatchObject({
      verdict: "OK",
    });
  });

  // The whole point: a logged restore that was never actually performed.
  it("fails a restore that still differs from the baseline", () => {
    const probe = probeOf({ inBaseline: ["src/a.ts"] });
    const result = judge(entry("RESTORE_FROM_MAIN", "src/a.ts"), probe, new Set());
    expect(result.verdict).toBe("STILL_DIFFERS_FROM_BASELINE");
    expect(result.detail).toContain("still differs");
  });

  // Asking to restore a path the baseline does not have is impossible, and quietly
  // treating it as satisfied would hide a mis-classified entry that needs deleting.
  it("fails a restore whose path is absent from the baseline", () => {
    const probe = probeOf({});
    expect(judge(entry("RESTORE_FROM_MAIN", "src/new.ts"), probe, new Set())).toMatchObject({
      verdict: "PATH_MISSING_FROM_BASELINE",
    });
  });

  it("passes a delete once the path is gone from git status", () => {
    const probe = probeOf({});
    expect(judge(entry("DELETE_UNTRACKED_STALE", "src/b.ts"), probe, new Set())).toMatchObject({
      verdict: "OK",
    });
  });

  it("fails a delete while the path is still reported dirty", () => {
    const probe = probeOf({});
    const result = judge(entry("DELETE_UNTRACKED_STALE", "src/b.ts"), probe, new Set(["src/b.ts"]));
    expect(result.verdict).toBe("STILL_UNTRACKED");
  });

  // Policy section 3 lists LEAVE_FOR_* as explicitly NOT a discard target, so
  // verifying it as discarded would invert the policy.
  it("treats LEAVE_FOR_* as a carve-out rather than a failure", () => {
    const probe = probeOf({});
    expect(
      judge(entry("LEAVE_FOR_REVIEW", "a/colors.xml"), probe, new Set(["a/colors.xml"])),
    ).toMatchObject({ verdict: "CARVE_OUT" });
  });

  it("does not use git status to judge a restore", () => {
    // A restored tracked file still shows as ` M` against the overlay HEAD; only
    // the baseline comparison decides (policy section 4.1 says so explicitly).
    const probe = probeOf({ matches: ["src/a.ts"], inBaseline: ["src/a.ts"] });
    expect(
      judge(entry("RESTORE_FROM_MAIN", "src/a.ts"), probe, new Set(["src/a.ts"])),
    ).toMatchObject({ verdict: "OK" });
  });
});

describe("worktree-discard — verifyLog", () => {
  const meta = { baseline: "origin/main", log: "log.txt" };

  it("summarises a fully satisfied log", () => {
    const probe = probeOf({ matches: ["src/a.ts"], inBaseline: ["src/a.ts"] });
    const report = verifyLog(
      [entry("RESTORE_FROM_MAIN", "src/a.ts"), entry("DELETE_UNTRACKED_STALE", "src/b.ts")],
      probe,
      meta,
    );
    expect(report).toMatchObject({ total: 2, ok: 2 });
    expect(report.violations).toEqual([]);
  });

  it("separates violations from carve-outs", () => {
    const probe = probeOf({ inBaseline: ["src/a.ts"] });
    const report = verifyLog(
      [
        entry("RESTORE_FROM_MAIN", "src/a.ts"),
        entry("LEAVE_FOR_REVIEW", "a/colors.xml"),
        entry("DELETE_UNTRACKED_STALE", "src/b.ts"),
      ],
      probe,
      { ...meta },
    );
    expect(report.violations.map((v) => v.path)).toEqual(["src/a.ts"]);
    expect(report.carveOuts.map((c) => c.path)).toEqual(["a/colors.xml"]);
    expect(report.ok).toBe(1);
  });

  it("carries the log line number so a violation is traceable", () => {
    const probe = probeOf({ inBaseline: ["src/a.ts"] });
    const report = verifyLog([entry("RESTORE_FROM_MAIN", "src/a.ts", 42)], probe, meta);
    expect(report.violations[0].line).toBe(42);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// triage
// ─────────────────────────────────────────────────────────────────────────────

describe("worktree-discard — triageDirty", () => {
  // The measured case that motivates a baseline other than the overlay HEAD: 31
  // files on deploy/user-modeling-v92 showed ` M` while matching origin/main
  // exactly. Against HEAD they look like work; against the baseline they are noise.
  it("classifies a tracked file identical to the baseline as noise", () => {
    const probe = probeOf({ matches: ["src/a.ts"] });
    expect(triageDirty([{ xy: " M", path: "src/a.ts" }], probe)).toEqual([
      { path: "src/a.ts", xy: " M", bucket: "NOISE_VS_BASELINE" },
    ]);
  });

  it("classifies a tracked file that differs as needing judgement", () => {
    const probe = probeOf({});
    expect(triageDirty([{ xy: " M", path: "src/a.ts" }], probe)[0].bucket).toBe("TRACKED_DIFFERS");
  });

  it("classifies an untracked path the baseline already has as a stale candidate", () => {
    const probe = probeOf({ inBaseline: ["src/b.ts"] });
    expect(triageDirty([{ xy: "??", path: "src/b.ts" }], probe)[0].bucket).toBe(
      "UNTRACKED_STALE_CANDIDATE",
    );
  });

  // Policy section 3 is explicit: a genuinely new file goes through claim and
  // extract, never discard. Mixing it into the stale bucket would delete new work.
  it("classifies an untracked path absent from the baseline as new, not stale", () => {
    const probe = probeOf({});
    expect(triageDirty([{ xy: "??", path: "src/new.ts" }], probe)[0].bucket).toBe("UNTRACKED_NEW");
  });

  it("classifies a mixed tree into all four buckets", () => {
    const probe = probeOf({ matches: ["noise.ts"], inBaseline: ["stale.ts"] });
    const rows = triageDirty(
      [
        { xy: " M", path: "noise.ts" },
        { xy: " M", path: "differs.ts" },
        { xy: "??", path: "stale.ts" },
        { xy: "??", path: "new.ts" },
      ],
      probe,
    );
    expect(rows.map((r) => r.bucket)).toEqual([
      "NOISE_VS_BASELINE",
      "TRACKED_DIFFERS",
      "UNTRACKED_STALE_CANDIDATE",
      "UNTRACKED_NEW",
    ]);
  });
});
