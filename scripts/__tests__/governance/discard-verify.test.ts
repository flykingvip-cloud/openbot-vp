import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  actionOf,
  blocking,
  discardLogs,
  DiscardVerifyError,
  evaluate,
  gitProbes,
  parseDiscardLog,
  summarize,
  verify,
  type BaselineComparison,
  type DiscardEntry,
  type Probes,
} from "../../governance/discard-verify.js";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "discard-verify-"));
}

/** Probes that answer from explicit maps, so no git tree is involved. */
function fakeProbes(opts: {
  comparisons?: Record<string, BaselineComparison>;
  existing?: string[];
}): Probes {
  return {
    compareToBaseline: (p) => opts.comparisons?.[p] ?? "differs",
    exists: (p) => (opts.existing ?? []).includes(p),
  };
}

/** Init a repo with one committed file, returning the repo dir and baseline ref. */
function repoWithBaseline(content = "baseline\n"): { repo: string; baseline: string } {
  const repo = scratch();
  const g = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  g("init", "--quiet");
  g("config", "user.email", "test@example.com");
  g("config", "user.name", "test");
  writeFileSync(join(repo, "a.ts"), content);
  g("add", "a.ts");
  g("commit", "--quiet", "-m", "baseline");
  return { repo, baseline: g("rev-parse", "HEAD").trim() };
}

describe("parseDiscardLog", () => {
  it("parses the three policy verbs and keeps line numbers", () => {
    const { entries } = parseDiscardLog(
      [
        "# Discard confirmed regression overlays (2026-08-01)",
        "",
        "RESTORE_FROM_MAIN src/gateway/control-ui.ts",
        "DELETE_UNTRACKED_STALE src/gateway/enterprise-model/audit.ts",
        "LEAVE_FOR_BRAND_REVIEW ui/src/ui/brand-assets.ts (favicon set still under review)",
      ].join("\n"),
    );

    expect(entries.map((e) => [e.action, e.path, e.line])).toEqual([
      ["RESTORE_FROM_MAIN", "src/gateway/control-ui.ts", 3],
      ["DELETE_UNTRACKED_STALE", "src/gateway/enterprise-model/audit.ts", 4],
      ["LEAVE_FOR_REVIEW", "ui/src/ui/brand-assets.ts", 5],
    ]);
    expect(entries[2].verb).toBe("LEAVE_FOR_BRAND_REVIEW");
    expect(entries[2].note).toBe("favicon set still under review");
  });

  it("parses bullet claims under a timestamped discard header", () => {
    // These lines are real claims in the 2026-08-01 log. Dropping them under-counted
    // that log by 13 entries, so the parser must pick them up.
    const { entries, unparsed } = parseDiscardLog(
      [
        "2026-08-01T00:46Z discard regressions → origin/main:",
        "  - ui/src/ui/controllers/chat.ts (drops history pagination)",
        "  - ui/src/ui/chat-session-key-match.node.test.ts (companion)",
      ].join("\n"),
    );

    expect(entries.map((e) => [e.action, e.path, e.verb])).toEqual([
      ["RESTORE_FROM_MAIN", "ui/src/ui/controllers/chat.ts", "BULLET_DISCARD_TO_MAIN"],
      [
        "RESTORE_FROM_MAIN",
        "ui/src/ui/chat-session-key-match.node.test.ts",
        "BULLET_DISCARD_TO_MAIN",
      ],
    ]);
    expect(unparsed).toEqual([]);
  });

  it("parses the 2026-07-31 section format, including tab-separated errors", () => {
    const { entries } = parseDiscardLog(
      [
        "restored=2 removed=1 skipped=1 errors=1",
        "== restored ==",
        "a.ts",
        "b.ts",
        "== removed ==",
        "stale.ts",
        "== skipped ==",
        "hot.ts",
        "== errors ==",
        "icon.png\tCommand '['git', 'checkout', 'HEAD', '--', 'icon.png']' returned non-zero exit status 128.",
      ].join("\n"),
    );

    expect(entries.map((e) => [e.verb, e.action, e.path])).toEqual([
      ["SECTION_RESTORED", "RESTORE_FROM_MAIN", "a.ts"],
      ["SECTION_RESTORED", "RESTORE_FROM_MAIN", "b.ts"],
      ["SECTION_REMOVED", "DELETE_UNTRACKED_STALE", "stale.ts"],
      ["SECTION_SKIPPED", "LEAVE_FOR_REVIEW", "hot.ts"],
      // The original run failed here, so this is checked, not exempt.
      ["SECTION_ERRORS", "ERROR_UNFINISHED", "icon.png"],
    ]);
    expect(entries[4].note).toContain("exit status 128");
  });

  it("handles both formats in one file instead of letting a section header hide verb lines", () => {
    const { entries } = parseDiscardLog(
      ["RESTORE_FROM_MAIN verb.ts", "== removed ==", "section.ts"].join("\n"),
    );
    expect(entries.map((e) => e.path)).toEqual(["verb.ts", "section.ts"]);
  });

  it("reports unparsed lines rather than dropping them silently", () => {
    const { entries, unparsed } = parseDiscardLog(
      ["EXTRACT_TO_MAIN src/foo.ts", "  - orphan.ts (no block header)", "some free prose"].join(
        "\n",
      ),
    );

    expect(entries).toEqual([]);
    expect(unparsed.map((u) => u.line)).toEqual([1, 2, 3]);
    expect(unparsed[0].reason).toContain("EXTRACT_TO_MAIN");
    expect(unparsed[1].reason).toContain("outside a claim block");
  });

  it("does not read the section header counters as paths", () => {
    const { entries, unparsed } = parseDiscardLog(
      ["restored=66 removed=0 skipped=37 errors=17", "== removed =="].join("\n"),
    );
    expect(entries).toEqual([]);
    expect(unparsed).toEqual([]);
  });

  it("maps carve-out verbs by shape and refuses unknown verbs", () => {
    expect(actionOf("LEAVE_FOR_PRODUCT_REVIEW")).toBe("LEAVE_FOR_REVIEW");
    expect(actionOf("EXTRACT_TO_MAIN")).toBeUndefined();
  });
});

describe("evaluate", () => {
  const restore: DiscardEntry = {
    action: "RESTORE_FROM_MAIN",
    path: "a.ts",
    line: 1,
    verb: "RESTORE_FROM_MAIN",
  };
  const remove: DiscardEntry = {
    action: "DELETE_UNTRACKED_STALE",
    path: "b.ts",
    line: 2,
    verb: "DELETE_UNTRACKED_STALE",
  };

  it("passes a restored file and an actually deleted file", () => {
    const verdicts = evaluate(
      [restore, remove],
      fakeProbes({ comparisons: { "a.ts": "match" }, existing: [] }),
    );
    expect(verdicts.map((v) => v.status)).toEqual(["pass", "pass"]);
  });

  it("fails a restore line whose file still differs from the baseline", () => {
    const verdicts = evaluate([restore], fakeProbes({ comparisons: { "a.ts": "differs" } }));
    expect(verdicts[0].status).toBe("fail");
    expect(verdicts[0].detail).toContain("still differs");
  });

  it("fails a restore line for a path the baseline does not have", () => {
    // Previously this passed, which let a misclassified line look clean.
    const verdicts = evaluate(
      [restore],
      fakeProbes({ comparisons: { "a.ts": "absent-in-baseline" } }),
    );
    expect(verdicts[0].status).toBe("fail");
    expect(verdicts[0].detail).toContain("reclassify");
  });

  it("fails a restore line whose file is missing from the worktree", () => {
    const verdicts = evaluate(
      [restore],
      fakeProbes({ comparisons: { "a.ts": "absent-in-worktree" } }),
    );
    expect(verdicts[0].status).toBe("fail");
    expect(verdicts[0].detail).toContain("missing from the worktree");
  });

  it("fails a delete line whose file is still on disk", () => {
    const verdicts = evaluate([remove], fakeProbes({ existing: ["b.ts"] }));
    expect(verdicts[0].status).toBe("fail");
    expect(verdicts[0].detail).toContain("still present");
  });

  it("fails an errored section line until the path actually matches the baseline", () => {
    const errored: DiscardEntry = {
      action: "ERROR_UNFINISHED",
      path: "icon.png",
      line: 3,
      verb: "SECTION_ERRORS",
      note: "exit status 128",
    };

    const stillDirty = evaluate([errored], fakeProbes({ comparisons: { "icon.png": "differs" } }));
    expect(stillDirty[0].status).toBe("fail");
    expect(stillDirty[0].detail).toContain("original run failed");

    const nowClean = evaluate([errored], fakeProbes({ comparisons: { "icon.png": "match" } }));
    expect(nowClean[0].status).toBe("pass");
  });

  it("never fails a carve-out, and flags one with no written reason", () => {
    const withReason: DiscardEntry = {
      action: "LEAVE_FOR_REVIEW",
      path: "c.ts",
      line: 4,
      verb: "LEAVE_FOR_BRAND_REVIEW",
      note: "pending brand decision",
    };
    const withoutReason: DiscardEntry = {
      action: "LEAVE_FOR_REVIEW",
      path: "d.ts",
      line: 5,
      verb: "SECTION_SKIPPED",
    };

    const verdicts = evaluate(
      [withReason, withoutReason],
      fakeProbes({ existing: ["c.ts", "d.ts"] }),
    );
    expect(verdicts.map((v) => v.status)).toEqual(["carve-out", "carve-out"]);
    expect(verdicts[1].detail).toContain("no written reason");
    // All 37 skipped entries in the 07-31 log carry the tool's own status text
    // `already gone`; grading that as a human reason would exempt them forever.
    const statusNoted = evaluate([{ ...withoutReason, note: "already gone" }], fakeProbes({}));
    expect(statusNoted[0].detail).toContain("no written reason");
    expect(summarize(verdicts)).toEqual({ total: 2, pass: 0, fail: 0, carveOut: 2, unparsed: 0 });
  });
});

describe("gitProbes", () => {
  // Locks policy §4.1: on an overlay branch a restored file still differs from
  // that branch's HEAD, and that must NOT be treated as a failed restore.
  it("compares against the baseline only, ignoring the overlay HEAD diff", () => {
    const { repo, baseline } = repoWithBaseline();
    const g = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });

    g("checkout", "--quiet", "-b", "overlay");
    writeFileSync(join(repo, "a.ts"), "overlay regression\n");
    g("add", "a.ts");
    g("commit", "--quiet", "-m", "overlay");

    // Restore the worktree copy to the baseline content, as policy §4.1 prescribes.
    writeFileSync(join(repo, "a.ts"), "baseline\n");

    const probes = gitProbes(repo, baseline);
    expect(probes.compareToBaseline("a.ts")).toBe("match");
    // Sanity: the file really does differ from the overlay HEAD.
    expect(g("diff", "--", "a.ts")).not.toBe("");

    writeFileSync(join(repo, "a.ts"), "overlay regression\n");
    expect(probes.compareToBaseline("a.ts")).toBe("differs");
  });

  // Regression test for the first implementation, which used `git diff <baseline> -- <path>`
  // and reported untracked-but-identical files as deletions.
  it("treats an untracked file identical to the baseline as a match", () => {
    const { repo, baseline } = repoWithBaseline();
    const g = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });

    g("checkout", "--quiet", "-b", "overlay");
    g("rm", "--quiet", "--cached", "a.ts");
    g("commit", "--quiet", "-m", "untrack a.ts");
    writeFileSync(join(repo, "a.ts"), "baseline\n");

    // The path is untracked here, which is what the §4.1 git-2.15 fallback leaves behind.
    expect(g("status", "--porcelain", "a.ts").trim()).toBe("?? a.ts");
    expect(g("diff", baseline, "--", "a.ts")).not.toBe("");

    expect(gitProbes(repo, baseline).compareToBaseline("a.ts")).toBe("match");
  });

  it("distinguishes a path the baseline lacks from one missing on disk", () => {
    const { repo, baseline } = repoWithBaseline();
    writeFileSync(join(repo, "new-only-here.ts"), "x\n");
    const probes = gitProbes(repo, baseline);

    expect(probes.compareToBaseline("new-only-here.ts")).toBe("absent-in-baseline");
    rmSync(join(repo, "a.ts"));
    expect(probes.compareToBaseline("a.ts")).toBe("absent-in-worktree");
  });

  it("contains a git failure as one entry instead of aborting the audit", () => {
    const { repo, baseline } = repoWithBaseline();
    // A path outside the repo makes git exit non-zero.
    expect(gitProbes(repo, baseline).compareToBaseline("../outside.ts")).toBe("error");
  });

  it("reports worktree presence for delete lines", () => {
    const { repo, baseline } = repoWithBaseline();
    const probes = gitProbes(repo, baseline);
    expect(probes.exists("a.ts")).toBe(true);
    expect(probes.exists("gone.ts")).toBe(false);
  });

  // This repository tracks CLAUDE.md as a symlink to AGENTS.md (mode 120000). git
  // stores the link TEXT as the blob, while `git hash-object -- <link>` follows the
  // link and hashes its target, so a naive hash compare can never match a symlink.
  it("matches a tracked symlink by its link text, not its target contents", () => {
    const repo = scratch();
    const g = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
    g("init", "--quiet");
    g("config", "user.email", "test@example.com");
    g("config", "user.name", "test");
    writeFileSync(join(repo, "AGENTS.md"), "agents\n");
    symlinkSync("AGENTS.md", join(repo, "CLAUDE.md"));
    g("add", "-A");
    g("commit", "--quiet", "-m", "baseline");
    const baseline = g("rev-parse", "HEAD").trim();

    expect(g("ls-tree", baseline, "--", "CLAUDE.md")).toContain("120000");
    const probes = gitProbes(repo, baseline);
    expect(probes.compareToBaseline("CLAUDE.md")).toBe("match");

    // Re-point the link: same target contents are irrelevant, the link text changed.
    rmSync(join(repo, "CLAUDE.md"));
    writeFileSync(join(repo, "OTHER.md"), "agents\n");
    symlinkSync("OTHER.md", join(repo, "CLAUDE.md"));
    expect(probes.compareToBaseline("CLAUDE.md")).toBe("differs");
  });

  it("treats a mode-only divergence as a difference", () => {
    const { repo, baseline } = repoWithBaseline();
    chmodSync(join(repo, "a.ts"), 0o755);
    expect(gitProbes(repo, baseline).compareToBaseline("a.ts")).toBe("differs");
  });
});

describe("blocking", () => {
  it("counts unparsed lines, so a prose-only log cannot pass --strict", () => {
    expect(blocking({ total: 0, pass: 0, fail: 0, carveOut: 0, unparsed: 3 })).toBe(3);
    expect(blocking({ total: 2, pass: 2, fail: 0, carveOut: 0, unparsed: 0 })).toBe(0);
  });
});

describe("discardLogs", () => {
  // Auditing only the newest file skipped 120 of 176 recorded claims, because the
  // 2026-07-31 section-format log uses the other naming convention.
  it("returns both log naming conventions oldest first, ignoring other files", () => {
    const dir = scratch();
    const reports = join(dir, "reports");
    mkdirSync(reports);
    writeFileSync(join(reports, "worktree-discard-regression-2026-08-01.txt"), "");
    writeFileSync(join(reports, "worktree-discard-log-2026-07-31.txt"), "");
    writeFileSync(join(reports, "worktree-triage-vs-main-2026-07-31.md"), "");

    expect(discardLogs(reports)).toEqual([
      join(reports, "worktree-discard-log-2026-07-31.txt"),
      join(reports, "worktree-discard-regression-2026-08-01.txt"),
    ]);
    expect(discardLogs(join(dir, "missing"))).toEqual([]);
  });
});

describe("verify", () => {
  it("reports counts and unparsed lines for a log file using injected probes", () => {
    const dir = scratch();
    const log = join(dir, "log.txt");
    writeFileSync(
      log,
      ["RESTORE_FROM_MAIN a.ts", "DELETE_UNTRACKED_STALE b.ts", "EXTRACT_TO_MAIN c.ts"].join("\n"),
    );

    const report = verify({
      cwd: dir,
      log,
      baseline: "origin/main",
      probes: fakeProbes({ comparisons: { "a.ts": "match" }, existing: ["b.ts"] }),
    });

    expect(report.counts).toEqual({ total: 2, pass: 1, fail: 1, carveOut: 0, unparsed: 1 });
    expect(report.unparsed[0].line).toBe(3);
  });

  it("fails closed when the log is missing", () => {
    expect(() =>
      verify({
        cwd: scratch(),
        log: join(scratch(), "nope.txt"),
        baseline: "origin/main",
        probes: fakeProbes({}),
      }),
    ).toThrow(DiscardVerifyError);
  });
});
