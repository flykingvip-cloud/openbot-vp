/**
 * discard-verify.ts — acceptance check for the dirty-tree regression discard
 * policy (`docs/design/dirty-tree-regression-discard-policy-2026-08-01.md` §7).
 *
 * WHY THIS EXISTS
 *
 * The policy makes discarding confirmed regressions mandatory and requires a
 * discard log, but nothing verified that the log matches reality. A log line
 * saying `RESTORE_FROM_MAIN <path>` is a claim; until someone re-runs
 * `git diff origin/main -- <path>` it is not evidence. Unverified lines are how
 * a path gets "discarded" on paper and keeps polluting the next triage round —
 * exactly the waste the policy was written to stop.
 *
 * This checker turns §7 into a command:
 *   - `RESTORE_FROM_MAIN <path>`      -> the worktree copy must equal the baseline copy
 *                                        (blob id AND file mode; see `gitProbes` for why
 *                                        `git diff` is the wrong question here)
 *   - `DELETE_UNTRACKED_STALE <path>` -> the path must no longer exist in the worktree
 *   - `LEAVE_FOR_*_REVIEW <path>`     -> carve-out; reported, never failed
 *   - `== errors ==` section entries  -> the original run failed, so they are checked
 *                                        like a restore rather than exempted
 *
 * WHERE IT RUNS
 *
 * On the dirty-tree host only. CI checks out a clean tree, so a CI run would
 * trivially pass and prove nothing; wiring this into CI would create a green
 * check that never looks at the tree it is supposed to police. Run it locally
 * before handing the tree off.
 *
 * Usage:
 *   bun scripts/governance/discard-verify.ts [--log <file>] [--json] [--strict]
 *   bun scripts/governance/discard-verify.ts --log reports/worktree-discard-regression-2026-08-01.txt
 *
 * This tool NEVER writes, restores, deletes, stages, or commits. It reads the
 * log, asks git, and reports.
 */

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Log verbs the policy defines, plus one derived from the section format.
 *
 * `ERROR_UNFINISHED` covers the 2026-07-31 `== errors ==` block: that run's restore
 * FAILED for those paths, so they were never discarded. Treating them as exempt
 * would let the §8 terminal condition pass with a still-dirty tree, so they are
 * checked like a restore and only pass once the path actually matches the baseline.
 */
export type DiscardAction =
  | "RESTORE_FROM_MAIN"
  | "DELETE_UNTRACKED_STALE"
  | "LEAVE_FOR_REVIEW"
  | "ERROR_UNFINISHED";

export type DiscardEntry = {
  action: DiscardAction;
  path: string;
  /** Trailing parenthetical reason, kept for the carve-out report. */
  note?: string;
  /** 1-based line number in the log, so a failure points at the line to fix. */
  line: number;
  /** Raw verb as written, e.g. `LEAVE_FOR_BRAND_REVIEW`. */
  verb: string;
};

export type EntryVerdict = {
  entry: DiscardEntry;
  status: "pass" | "fail" | "carve-out";
  detail: string;
};

/** A line that looked like it might be a claim but matched no known shape. */
export type UnparsedLine = { line: number; text: string; reason: string };

export type ParsedLog = { entries: DiscardEntry[]; unparsed: UnparsedLine[] };

export type VerifyReport = {
  log: string;
  baseline: string;
  counts: { total: number; pass: number; fail: number; carveOut: number; unparsed: number };
  verdicts: EntryVerdict[];
  /** Reported so silent under-counting is impossible: a dropped claim is visible. */
  unparsed: UnparsedLine[];
};

/**
 * Outcome of comparing one worktree path against the baseline.
 *
 * `absent-in-baseline` matters: a `RESTORE_FROM_MAIN` line for a path the baseline
 * does not have is a misclassification, not a success, and must not pass silently.
 */
export type BaselineComparison =
  | "match"
  | "differs"
  | "absent-in-worktree"
  | "absent-in-baseline"
  | "error";

/** Probes are injected so the parser/evaluator stay testable without a git tree. */
export type Probes = {
  /** How the worktree copy of `path` relates to the baseline. */
  compareToBaseline: (path: string) => BaselineComparison;
  /** True when `path` exists in the worktree. */
  exists: (path: string) => boolean;
};

export class DiscardVerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscardVerifyError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a discard log, in either format found in `reports/`.
 *
 * Two formats exist because the tooling predates the policy:
 *   - verb format (policy §4.4): `RESTORE_FROM_MAIN <path>` per line;
 *   - section format (2026-07-31 run): a `restored=N removed=N ...` header,
 *     then `== restored ==` / `== removed ==` / `== skipped ==` / `== errors ==`
 *     blocks listing bare paths, errors carrying a tab-separated message.
 *
 * Both are accepted so every existing log is auditable. Comments, blank lines,
 * and the free-form timestamp summaries (`2026-08-01T00:46Z discard ...` plus
 * `  - path (reason)` bullets) are ignored, so prose is never read as an assertion.
 */
export function parseDiscardLog(text: string): ParsedLog {
  const entries: DiscardEntry[] = [];
  const unparsed: UnparsedLine[] = [];
  let section: { action: DiscardAction; verb: string } | undefined;
  let bullet: { action: DiscardAction; verb: string } | undefined;

  text.split("\n").forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();

    if (trimmed === "" || trimmed.startsWith("#")) {
      return;
    }

    // `== restored ==` opens a section block and closes any bullet block.
    const header = /^==\s+(\w+)\s+==$/.exec(trimmed);
    if (header) {
      section = SECTION_ACTIONS[header[1].toLowerCase()];
      bullet = undefined;
      if (!section) {
        unparsed.push({ line, text: trimmed, reason: "unknown section header" });
      }
      return;
    }

    // `restored=66 removed=0 ...` counter line of the section format.
    if (/^(?:\w+=\d+\s*)+$/.test(trimmed)) {
      return;
    }

    // `2026-08-01T00:46Z discard regressions → origin/main:` opens a bullet block.
    // The header names the action, so its bullets are restore claims like any
    // `RESTORE_FROM_MAIN` line. These were previously dropped, which under-counted
    // the 2026-08-01 log by 13 claims.
    if (/^\S.*discard.*(?:→|->)\s*origin\/main\s*:$/.test(trimmed)) {
      bullet = { action: "RESTORE_FROM_MAIN", verb: "BULLET_DISCARD_TO_MAIN" };
      section = undefined;
      return;
    }

    // `  - <path> (<reason>)` inside a bullet block.
    const bulletMatch = /^-\s+(\S+)(?:\s+\((.*)\))?$/.exec(trimmed);
    if (bulletMatch) {
      if (!bullet) {
        unparsed.push({ line, text: trimmed, reason: "bullet outside a claim block" });
        return;
      }
      entries.push({
        action: bullet.action,
        path: bulletMatch[1],
        note: bulletMatch[2],
        line,
        verb: bullet.verb,
      });
      return;
    }

    // `RESTORE_FROM_MAIN <path> (<reason>)`.
    const verbMatch = /^([A-Z][A-Z_]*)\s+(\S+)(?:\s+\((.*)\))?$/.exec(trimmed);
    if (verbMatch) {
      const [, verb, path, note] = verbMatch;
      const action = actionOf(verb);
      if (action) {
        entries.push({ action, path, note, line, verb });
      } else {
        unparsed.push({ line, text: trimmed, reason: `unknown verb "${verb}"` });
      }
      return;
    }

    // Bare path line inside a section block; errors carry `path<TAB>message`.
    if (section) {
      const [pathPart, message] = raw.split("\t");
      const path = pathPart.trim();
      if (path !== "" && !path.includes(" ")) {
        entries.push({
          action: section.action,
          path,
          note: message?.trim(),
          line,
          verb: section.verb,
        });
        return;
      }
    }

    unparsed.push({ line, text: trimmed, reason: "no claim recognized" });
  });

  return { entries, unparsed };
}

/**
 * Section verbs map to the policy's actions:
 *   restored -> the run claims the path was restored, so §7.1 applies;
 *   removed  -> the run claims the path was deleted, so §7.1 applies;
 *   skipped  -> a deliberate non-action; reported as a carve-out;
 *   errors   -> the restore FAILED, so the path was never discarded; checked, not exempt.
 */
const SECTION_ACTIONS: Record<string, { action: DiscardAction; verb: string }> = {
  restored: { action: "RESTORE_FROM_MAIN", verb: "SECTION_RESTORED" },
  removed: { action: "DELETE_UNTRACKED_STALE", verb: "SECTION_REMOVED" },
  skipped: { action: "LEAVE_FOR_REVIEW", verb: "SECTION_SKIPPED" },
  errors: { action: "ERROR_UNFINISHED", verb: "SECTION_ERRORS" },
};

/** Map a log verb to its action, or `undefined` when the verb is not a policy verb. */
export function actionOf(verb: string): DiscardAction | undefined {
  if (verb === "RESTORE_FROM_MAIN") {
    return "RESTORE_FROM_MAIN";
  }
  if (verb === "DELETE_UNTRACKED_STALE") {
    return "DELETE_UNTRACKED_STALE";
  }
  // The policy writes carve-outs as LEAVE_FOR_<TOPIC>_REVIEW, so match the shape.
  if (verb.startsWith("LEAVE_FOR_") && verb.endsWith("_REVIEW")) {
    return "LEAVE_FOR_REVIEW";
  }
  return undefined;
}

/** Apply §7 to each entry. Pure: all git access arrives through `probes`. */
export function evaluate(entries: DiscardEntry[], probes: Probes): EntryVerdict[] {
  return entries.map((entry) => {
    if (entry.action === "LEAVE_FOR_REVIEW") {
      // A section-format `skipped` line has no reason FIELD. Its trailing text is a
      // status the tool emitted (`already gone`), not a human judgement, so it never
      // satisfies §8. Grading those notes as reasons would exempt 37 of the 07-31
      // log's 120 claims forever.
      const hasWrittenReason = entry.note !== undefined && !entry.verb.startsWith("SECTION_");
      return {
        entry,
        status: "carve-out" as const,
        detail: hasWrittenReason
          ? `left for review: ${entry.note}`
          : "no written reason; §8 requires migrating this line to the verb format",
      };
    }

    if (entry.action === "DELETE_UNTRACKED_STALE") {
      return probes.exists(entry.path)
        ? {
            entry,
            status: "fail" as const,
            detail: "still present in the worktree; delete it or reclassify the line",
          }
        : { entry, status: "pass" as const, detail: "absent from the worktree" };
    }

    // RESTORE_FROM_MAIN and ERROR_UNFINISHED share one question: does the worktree
    // copy equal the baseline copy now?
    const comparison = probes.compareToBaseline(entry.path);
    const failedRun = entry.action === "ERROR_UNFINISHED";

    switch (comparison) {
      case "match":
        return {
          entry,
          status: "pass" as const,
          detail: failedRun
            ? "the original run errored, but the path matches the baseline now"
            : "worktree matches baseline",
        };
      case "differs":
        return {
          entry,
          status: "fail" as const,
          detail: failedRun
            ? "the original run failed and the path still differs from the baseline"
            : "still differs from baseline; restore it or reclassify the line",
        };
      case "absent-in-worktree":
        return {
          entry,
          status: "fail" as const,
          detail: "missing from the worktree while the baseline has it; restore it",
        };
      case "absent-in-baseline":
        return {
          entry,
          status: "fail" as const,
          detail:
            "the baseline has no such path, so a restore cannot apply; reclassify as a delete or an extract",
        };
      default:
        return { entry, status: "fail" as const, detail: "could not compare against the baseline" };
    }
  });
}

/**
 * What `--strict` refuses to pass.
 *
 * Unparsed lines count: a log written entirely in prose would otherwise audit zero
 * claims and exit 0, which would leave §8's `unparsed == 0` condition with no
 * command behind it.
 */
export function blocking(counts: VerifyReport["counts"]): number {
  return counts.fail + counts.unparsed;
}

/** Tally verdicts for the report header and the exit decision. */
export function summarize(
  verdicts: EntryVerdict[],
  unparsed: UnparsedLine[] = [],
): VerifyReport["counts"] {
  return {
    total: verdicts.length,
    pass: verdicts.filter((v) => v.status === "pass").length,
    fail: verdicts.filter((v) => v.status === "fail").length,
    carveOut: verdicts.filter((v) => v.status === "carve-out").length,
    unparsed: unparsed.length,
  };
}

/**
 * Every discard log under `reports/`, oldest first.
 *
 * Both naming conventions are included (`worktree-discard-log-*` for the
 * 2026-07-31 section format, `worktree-discard-regression-*` for the verb format).
 * Auditing only the newest file would have skipped 120 of the 176 recorded claims,
 * so the default run covers all of them. The filenames carry an ISO date, so a
 * lexical sort is chronological.
 */
export function discardLogs(reportsDir: string): string[] {
  if (!existsSync(reportsDir)) {
    return [];
  }
  return readdirSync(reportsDir)
    .filter((f) => /^worktree-discard-.*\.txt$/.test(f))
    .toSorted()
    .map((f) => join(reportsDir, f));
}

// ─────────────────────────────────────────────────────────────────────────────
// git-backed probes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run git and capture stdout.
 *
 * stderr is discarded on purpose: probing a path the baseline lacks makes
 * `rev-parse` print `fatal: Needed a single revision`, which is an expected
 * answer here, not an error to show the operator.
 */
function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/**
 * Build probes against a real git worktree.
 *
 * Compares CONTENT HASHES, not `git diff`. `git diff <baseline> -- <path>` looks
 * only at tracked paths, so an untracked file that is byte-identical to the
 * baseline is reported as a deletion — and the §4.1 git-2.15 fallback
 * (`git checkout origin/main -- <path>` then `git reset -q HEAD -- <path>`)
 * produces exactly that state. Verified in a scratch repo and on the real tree,
 * where untracked paths hash-identical to the baseline still yielded multi-hundred
 * byte "deletion" diffs. Hashing answers the question the policy actually asks:
 * does the worktree copy equal the baseline copy?
 *
 * Deliberately NOT comparing against the current branch HEAD: on an overlay branch
 * a correctly restored file still shows as `M` against that HEAD, which policy §4.1
 * calls the expected phenomenon.
 *
 * Failures are contained per path: a git error yields `"error"` for that entry
 * instead of aborting the whole audit with no verdicts at all.
 */
export function gitProbes(cwd: string, baseline: string): Probes {
  /** Baseline mode and blob id, e.g. `100644`/`120000`, via ls-tree. */
  const baselineEntry = (path: string): { mode: string; blob: string } | undefined => {
    try {
      const line = git(["ls-tree", baseline, "--", path], cwd).trim();
      const match = /^(\d{6})\s+\w+\s+([0-9a-f]{40})/.exec(line);
      return match ? { mode: match[1], blob: match[2] } : undefined;
    } catch {
      return undefined;
    }
  };

  /**
   * Hash the worktree copy the way git would store it.
   *
   * Symlinks must be hashed as their LINK TEXT, not their target's contents:
   * git stores mode 120000 with the target path as the blob, while
   * `git hash-object -- <link>` follows the link and hashes the file it points at.
   * This repository tracks `CLAUDE.md` as a symlink to `AGENTS.md`, so without this
   * branch every tracked symlink would be permanently unmatchable.
   */
  const worktreeEntry = (path: string): { mode: string; blob: string } | undefined => {
    const absolute = join(cwd, path);
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch {
      return undefined;
    }

    try {
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(absolute);
        const blob = execFileSync("git", ["hash-object", "--stdin"], {
          cwd,
          encoding: "utf8",
          input: target,
        }).trim();
        return { mode: "120000", blob };
      }

      const blob = git(["hash-object", "--", path], cwd).trim();
      // Git records only the owner-execute bit for regular files.
      const mode = (stat.mode & 0o100) === 0 ? "100644" : "100755";
      return { mode, blob };
    } catch {
      return undefined;
    }
  };

  return {
    compareToBaseline: (path) => {
      const expected = baselineEntry(path);
      const actual = worktreeEntry(path);

      if (!expected) {
        return actual ? "absent-in-baseline" : "error";
      }
      if (!actual) {
        return existsSync(join(cwd, path)) ? "error" : "absent-in-worktree";
      }
      // Mode is part of what git restores, so a mode-only divergence is a difference.
      return actual.blob === expected.blob && actual.mode === expected.mode ? "match" : "differs";
    },
    exists: (path) => {
      try {
        lstatSync(join(cwd, path));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Fail closed when the baseline ref is missing; a stale baseline invalidates §7. */
export function resolveBaseline(cwd: string, baseline: string): string {
  try {
    return git(["rev-parse", "--verify", baseline], cwd).trim();
  } catch {
    throw new DiscardVerifyError(
      `baseline ref "${baseline}" not found. Run \`git fetch origin main\` first (policy §2.2).`,
    );
  }
}

export function verify(opts: {
  cwd: string;
  log: string;
  baseline: string;
  probes?: Probes;
}): VerifyReport {
  if (!existsSync(opts.log)) {
    throw new DiscardVerifyError(`discard log not found: ${opts.log}`);
  }
  const baselineSha = opts.probes ? opts.baseline : resolveBaseline(opts.cwd, opts.baseline);
  const probes = opts.probes ?? gitProbes(opts.cwd, opts.baseline);
  const { entries, unparsed } = parseDiscardLog(readFileSync(opts.log, "utf8"));
  const verdicts = evaluate(entries, probes);

  return {
    log: opts.log,
    baseline: `${opts.baseline} (${baselineSha})`,
    counts: summarize(verdicts, unparsed),
    verdicts,
    unparsed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function readOpt(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function usage(): void {
  console.log("Usage: discard-verify [--log <file>] [--baseline <ref>] [--json] [--strict]");
  console.log(
    "  --log <file>        one discard log (default: every worktree-discard-*.txt in reports/)",
  );
  console.log("  --baseline <ref>    comparison baseline (default: origin/main)");
  console.log("  --json              machine-readable report");
  console.log("  --strict            exit 1 on any failure or unparsed line (default: exit 0)");
  console.log("");
  console.log("Read-only. Run on the dirty-tree host, not in CI (CI has a clean tree).");
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return 0;
  }

  const cwd = process.cwd();
  const baseline = readOpt(args, "--baseline") ?? "origin/main";
  const requested = readOpt(args, "--log");
  const logs = requested ? [requested] : discardLogs(join(cwd, "reports"));

  if (logs.length === 0) {
    console.error("No discard log given and none found under reports/. Pass --log <file>.");
    return 1;
  }

  const reports: VerifyReport[] = [];
  for (const log of logs) {
    try {
      reports.push(verify({ cwd, log, baseline }));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  const blocked = reports.reduce((sum, r) => sum + blocking(r.counts), 0);

  if (args.includes("--json")) {
    console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
  } else {
    console.log("Discard log acceptance (policy §7)");
    console.log(`- baseline: ${reports[0].baseline}`);
    for (const report of reports) {
      const { counts } = report;
      console.log(`- log: ${report.log}`);
      console.log(
        `  claims: ${counts.total} (pass ${counts.pass}, fail ${counts.fail}, carve-out ${counts.carveOut}), unparsed ${counts.unparsed}`,
      );
      for (const v of report.verdicts) {
        if (v.status === "pass") {
          continue;
        }
        const tag = v.status === "fail" ? "FAIL" : "CARVE-OUT";
        console.log(
          `    ${tag} ${v.entry.verb} ${v.entry.path} (line ${v.entry.line}) — ${v.detail}`,
        );
      }
      for (const u of report.unparsed) {
        console.log(`    UNPARSED line ${u.line} (${u.reason}): ${u.text}`);
      }
    }
    if (blocked > 0 && !args.includes("--strict")) {
      console.log("");
      console.log("Re-run with --strict to make failures and unparsed lines exit non-zero.");
    }
  }

  return args.includes("--strict") && blocked > 0 ? 1 : 0;
}

/**
 * Run as a CLI only when this module is the entrypoint, so tests can import it.
 *
 * Compares resolved paths rather than matching a filename: an earlier version
 * tested `argv[1].endsWith("discard-verify.ts")`, which silently did nothing when
 * the file was invoked through a copy or a symlink under another name.
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  process.exit(main(process.argv));
}
