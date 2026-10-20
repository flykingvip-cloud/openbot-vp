/**
 * worktree-discard.ts — machine-check the Dirty-Tree Regression Discard Policy.
 *
 * WHY THIS EXISTS
 *
 * `docs/design/dirty-tree-regression-discard-policy-2026-08-01.md` §7 states its
 * acceptance criteria in fully mechanical terms:
 *
 *   1. `git diff origin/main -- <path>` is empty (tracked restore), or the path no
 *      longer appears in `git status` (untracked delete);
 *   2. the discard log has a matching line.
 *
 * Nothing checked either one. A discard log was therefore a SELF-REPORT: it
 * asserted what had been done rather than proving it. The policy's own §1 lists
 * the cost of getting this wrong — the same path reappearing in
 * `REVIEW_PORTABLE_HUNKS` round after round, and half-restored regressions
 * lingering next to already-landed fixes.
 *
 * The baseline is `origin/main`, never the overlay branch HEAD (policy §2.2).
 * That distinction is not academic: measured on `deploy/user-modeling-v92`, 31
 * tracked files showed as ` M` against the overlay HEAD while being byte-identical
 * to `origin/main`. Reviewing against HEAD keeps them in the queue forever; they
 * are not work, they are overlay noise.
 *
 * Usage:
 *   node --import tsx scripts/governance/worktree-discard.ts verify --log <file> [--json]
 *   node --import tsx scripts/governance/worktree-discard.ts triage [--json] [--baseline <ref>]
 *
 * READ-ONLY. This tool never restores, deletes, or stages anything — executing a
 * discard stays with the operator following the policy. It only reports whether
 * what the log claims is actually true.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_BASELINE = "origin/main";

/**
 * Actions the policy defines. `RESTORE_FROM_MAIN` and `DELETE_UNTRACKED_STALE` are
 * assertions to verify; `LEAVE_FOR_*` is a carve-out that must NOT be verified as
 * discarded — policy §3 lists those as explicitly out of scope for discard.
 */
export type DiscardAction = "RESTORE_FROM_MAIN" | "DELETE_UNTRACKED_STALE" | "LEAVE_FOR_REVIEW";

export type DiscardEntry = {
  action: DiscardAction;
  path: string;
  /** Parenthesised trailing note, when the log carries one. */
  note?: string;
  /** 1-based line number in the log, so a violation can be traced back. */
  line: number;
};

export type VerdictCode =
  | "OK"
  | "STILL_DIFFERS_FROM_BASELINE"
  | "STILL_UNTRACKED"
  | "CARVE_OUT"
  | "PATH_MISSING_FROM_BASELINE";

export type EntryVerdict = DiscardEntry & { verdict: VerdictCode; detail?: string };

export type VerifyReport = {
  baseline: string;
  log: string;
  total: number;
  ok: number;
  violations: EntryVerdict[];
  carveOuts: EntryVerdict[];
};

export class DiscardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscardError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Log parsing (pure)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip a trailing `(...)` note from a log path.
 *
 * Real logs carry notes like `ui/src/styles/trial-apply.css (pending #189 land)`.
 * Only a note at the very end is removed, so a path that legitimately contains
 * parentheses is left alone.
 */
export function splitPathAndNote(rest: string): { path: string; note?: string } {
  const trimmed = rest.trim();
  const match = /^(.*?)\s+\(([^()]*)\)$/.exec(trimmed);
  if (match) {
    return { path: match[1].trim(), note: match[2].trim() };
  }
  return { path: trimmed };
}

/**
 * Parse a discard log.
 *
 * TWO shapes coexist in practice and both are legitimate — policy §4.4 calls its
 * format "推荐" (recommended), not mandatory:
 *
 *   A. `RESTORE_FROM_MAIN <path> [(note)]`      — the recommended one-line form
 *   B. `<ts> discard regressions → origin/main:` followed by indented `- <path>`
 *      bullets, which inherit RESTORE_FROM_MAIN from their header
 *
 * Rejecting shape B would make the checker useless against the logs that exist,
 * which is the opposite of the point.
 */
export function parseDiscardLog(text: string): DiscardEntry[] {
  const entries: DiscardEntry[] = [];
  let bulletAction: DiscardAction | null = null;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = i + 1;
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    // Shape B header: a batch that sends everything below it back to the baseline.
    if (/discard\s+regressions/i.test(trimmed)) {
      bulletAction = "RESTORE_FROM_MAIN";
      continue;
    }

    // Shape B bullet.
    if (trimmed.startsWith("- ")) {
      if (!bulletAction) {
        continue; // a bullet with no batch header states no action; ignore it
      }
      const { path, note } = splitPathAndNote(trimmed.slice(2));
      if (path) {
        entries.push({ action: bulletAction, path, note, line });
      }
      continue;
    }

    // Shape A.
    const space = trimmed.indexOf(" ");
    if (space < 0) {
      continue;
    }
    const verb = trimmed.slice(0, space);
    const { path, note } = splitPathAndNote(trimmed.slice(space + 1));
    if (!path) {
      continue;
    }
    if (verb === "RESTORE_FROM_MAIN") {
      entries.push({ action: "RESTORE_FROM_MAIN", path, note, line });
      bulletAction = null;
    } else if (verb === "DELETE_UNTRACKED_STALE") {
      entries.push({ action: "DELETE_UNTRACKED_STALE", path, note, line });
      bulletAction = null;
    } else if (verb.startsWith("LEAVE_FOR_")) {
      // Carve-out: policy §3 says these are NOT discard targets. Recorded so the
      // report can show them, never verified as discarded.
      entries.push({ action: "LEAVE_FOR_REVIEW", path, note, line });
      bulletAction = null;
    }
  }
  return entries;
}

/** Deduplicate by path, keeping the LAST action — a later line supersedes earlier. */
export function dedupeByPath(entries: DiscardEntry[]): DiscardEntry[] {
  const byPath = new Map<string, DiscardEntry>();
  for (const entry of entries) {
    byPath.set(entry.path, entry);
  }
  return [...byPath.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// Git probes
// ─────────────────────────────────────────────────────────────────────────────

export type GitProbe = {
  /** True when the worktree copy is identical to the baseline (policy §7.1). */
  matchesBaseline: (path: string) => boolean;
  /** Paths currently reported dirty, expanded to file level. */
  dirtyPaths: () => Set<string>;
  /** True when the baseline contains the path at all. */
  existsInBaseline: (path: string) => boolean;
};

function run(args: string[], cwd: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { stdout, status: 0 };
  } catch (error) {
    const err = error as { status?: number; stdout?: string };
    return { stdout: err.stdout ?? "", status: err.status ?? 1 };
  }
}

export function createGitProbe(cwd: string, baseline: string): GitProbe {
  return {
    // `--quiet` exits 1 on any difference, which is exactly the §7.1 predicate.
    matchesBaseline: (path) => run(["diff", "--quiet", baseline, "--", path], cwd).status === 0,
    dirtyPaths: () => {
      // `-uall` is mandatory: git otherwise collapses untracked directories into a
      // single `?? dir/` entry, and a deleted-file check against the collapsed form
      // would pass while the files are still on disk.
      const out = run(["status", "--porcelain=v1", "-z", "-uall"], cwd).stdout;
      const set = new Set<string>();
      for (const token of out.split("\0")) {
        if (token) {
          set.add(token.slice(3));
        }
      }
      return set;
    },
    existsInBaseline: (path) => run(["cat-file", "-e", `${baseline}:${path}`], cwd).status === 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// verify (policy §7)
// ─────────────────────────────────────────────────────────────────────────────

/** Pure: judge one entry against the probes. */
export function judge(entry: DiscardEntry, probe: GitProbe, dirty: Set<string>): EntryVerdict {
  if (entry.action === "LEAVE_FOR_REVIEW") {
    return { ...entry, verdict: "CARVE_OUT" };
  }
  if (entry.action === "RESTORE_FROM_MAIN") {
    // A restore target must exist in the baseline; if it does not, the log is
    // asking for something impossible and the path likely needs deleting instead.
    if (!probe.existsInBaseline(entry.path)) {
      return {
        ...entry,
        verdict: "PATH_MISSING_FROM_BASELINE",
        detail: "baseline has no such path; RESTORE_FROM_MAIN cannot apply",
      };
    }
    return probe.matchesBaseline(entry.path)
      ? { ...entry, verdict: "OK" }
      : {
          ...entry,
          verdict: "STILL_DIFFERS_FROM_BASELINE",
          detail: "worktree still differs from the baseline",
        };
  }
  // DELETE_UNTRACKED_STALE: the path must be gone from `git status` entirely.
  return dirty.has(entry.path)
    ? { ...entry, verdict: "STILL_UNTRACKED", detail: "path is still reported dirty" }
    : { ...entry, verdict: "OK" };
}

export function verifyLog(
  entries: DiscardEntry[],
  probe: GitProbe,
  meta: { baseline: string; log: string },
): VerifyReport {
  const dirty = probe.dirtyPaths();
  const judged = dedupeByPath(entries).map((entry) => judge(entry, probe, dirty));
  const carveOuts = judged.filter((j) => j.verdict === "CARVE_OUT");
  const violations = judged.filter((j) => j.verdict !== "OK" && j.verdict !== "CARVE_OUT");
  return {
    baseline: meta.baseline,
    log: meta.log,
    total: judged.length,
    ok: judged.filter((j) => j.verdict === "OK").length,
    violations,
    carveOuts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// triage (policy §3 candidate classification)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Buckets are CANDIDATES, deliberately not verdicts. Policy §3 requires a written
 * judgement per path and §5 forbids automating the discard decision; this only
 * separates the mechanically decidable cases from the ones a human must read.
 */
export type TriageBucket =
  | "NOISE_VS_BASELINE"
  | "TRACKED_DIFFERS"
  | "UNTRACKED_STALE_CANDIDATE"
  | "UNTRACKED_NEW";

export type TriageRow = { path: string; xy: string; bucket: TriageBucket };

export function triageDirty(entries: { xy: string; path: string }[], probe: GitProbe): TriageRow[] {
  return entries.map(({ xy, path }) => {
    if (xy === "??") {
      return {
        path,
        xy,
        bucket: probe.existsInBaseline(path)
          ? ("UNTRACKED_STALE_CANDIDATE" as const)
          : ("UNTRACKED_NEW" as const),
      };
    }
    return {
      path,
      xy,
      // Identical to the baseline ⇒ already satisfies §7.1 and must drop out of the
      // review queue, even though it still shows as dirty against the overlay HEAD.
      bucket: probe.matchesBaseline(path)
        ? ("NOISE_VS_BASELINE" as const)
        : ("TRACKED_DIFFERS" as const),
    };
  });
}

export function readDirtyEntries(cwd: string): { xy: string; path: string }[] {
  const out = run(["status", "--porcelain=v1", "-z", "-uall"], cwd).stdout;
  const entries: { xy: string; path: string }[] = [];
  const tokens = out.split("\0");
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) {
      continue;
    }
    const xy = token.slice(0, 2);
    entries.push({ xy, path: token.slice(3) });
    if (xy.includes("R") || xy.includes("C")) {
      i += 1; // rename/copy source occupies the following token
    }
  }
  return entries;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function readOpt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function usage(): void {
  console.log("Usage: worktree-discard <verify|triage> [options]");
  console.log("  verify --log <file> [--baseline <ref>] [--json]");
  console.log("      check policy section 7 for every logged discard");
  console.log("  triage [--baseline <ref>] [--json]");
  console.log("      classify dirty paths against the baseline, not the overlay HEAD");
}

function cmdVerify(args: string[], cwd: string): number {
  const log = readOpt(args, "--log");
  if (!log) {
    console.error("verify requires --log <file>");
    return 1;
  }
  const file = join(cwd, log);
  const resolved = existsSync(file) ? file : log;
  if (!existsSync(resolved)) {
    console.error(`discard log not found: ${log}`);
    return 1;
  }
  const baseline = readOpt(args, "--baseline") ?? DEFAULT_BASELINE;
  const probe = createGitProbe(cwd, baseline);
  const report = verifyLog(parseDiscardLog(readFileSync(resolved, "utf8")), probe, {
    baseline,
    log,
  });

  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return report.violations.length === 0 ? 0 : 1;
  }

  console.log(`Discard log verification — policy section 7`);
  console.log(`- log:        ${report.log}`);
  console.log(`- baseline:   ${report.baseline}`);
  console.log(`- entries:    ${report.total}`);
  console.log(`- satisfied:  ${report.ok}`);
  console.log(`- carve-outs: ${report.carveOuts.length} (LEAVE_FOR_*, not discard targets)`);
  console.log(`- violations: ${report.violations.length}`);
  if (report.carveOuts.length > 0) {
    console.log("");
    for (const c of report.carveOuts) {
      console.log(`  CARVE-OUT  ${c.path}${c.note ? `  (${c.note})` : ""}`);
    }
  }
  if (report.violations.length > 0) {
    console.log("");
    for (const v of report.violations) {
      console.error(`  ${v.verdict}  ${v.path}  [log line ${v.line}]`);
      if (v.detail) {
        console.error(`      ${v.detail}`);
      }
    }
    console.error("");
    console.error("Verification FAILED: the log claims discards that are not in effect.");
    console.error("Either finish the discard, or remove the line if it was reverted.");
    return 1;
  }
  console.log("");
  console.log("Verification PASSED — every logged discard is in effect.");
  return 0;
}

function cmdTriage(args: string[], cwd: string): number {
  const baseline = readOpt(args, "--baseline") ?? DEFAULT_BASELINE;
  const probe = createGitProbe(cwd, baseline);
  const rows = triageDirty(readDirtyEntries(cwd), probe);
  const counts = new Map<TriageBucket, number>();
  for (const row of rows) {
    counts.set(row.bucket, (counts.get(row.bucket) ?? 0) + 1);
  }

  if (args.includes("--json")) {
    console.log(JSON.stringify({ baseline, rows, counts: Object.fromEntries(counts) }, null, 2));
    return 0;
  }

  console.log(`Dirty-tree triage against ${baseline}`);
  console.log(`- dirty paths: ${rows.length}`);
  console.log("");
  const labels: Record<TriageBucket, string> = {
    NOISE_VS_BASELINE:
      "identical to baseline — should leave the review queue (section 7.1 already met)",
    TRACKED_DIFFERS: "real difference — needs the written judgement of section 3",
    UNTRACKED_STALE_CANDIDATE: "untracked, baseline already has the path — section 4.2 candidate",
    UNTRACKED_NEW: "untracked, baseline lacks it — claim and extract, NOT discard",
  };
  for (const bucket of Object.keys(labels) as TriageBucket[]) {
    console.log(`${String(counts.get(bucket) ?? 0).padStart(4)}  ${bucket}`);
    console.log(`      ${labels[bucket]}`);
  }
  console.log("");
  console.log("Buckets are candidates, not verdicts: policy section 5 keeps the discard");
  console.log("decision with a human. Use --json for the per-path list.");
  return 0;
}

function main(argv: string[]): number {
  const [command, ...args] = argv;
  const cwd = process.cwd();
  if (!command || command === "--help" || command === "-h") {
    usage();
    return command ? 0 : 1;
  }
  if (command === "verify") {
    return cmdVerify(args, cwd);
  }
  if (command === "triage") {
    return cmdTriage(args, cwd);
  }
  console.error(`Unknown command: ${command}`);
  usage();
  return 1;
}

if (process.argv[1]?.endsWith(join("governance", "worktree-discard.ts"))) {
  process.exit(main(process.argv.slice(2)));
}

export { main as runCli };
