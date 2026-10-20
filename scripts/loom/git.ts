/**
 * git.ts — thin, testable git wrapper for Loom Provisioning (task 1.1).
 *
 * Centralizes every `git` invocation behind an injectable runner so the
 * orchestration layer (`provision.ts`) stays pure and unit-testable with a fake
 * runner (no real git). Two hard safety rules live here:
 *
 *  1. Command-injection safety: arguments are ALWAYS passed as an argv array to
 *     the runner (spawnSync), NEVER interpolated into a shell string.
 *  2. Option-injection safety: caller-supplied positional values (branch names,
 *     paths, refs) are validated to not start with `-`, so a value like
 *     `--upload-pack=evil` can never be reinterpreted as a git option.
 *
 * Design: `.kiro/specs/loom-provisioning/design.md` (Components and Interfaces).
 */

import { spawnSync } from "node:child_process";

// ─────────────────────────────────────────────────────────────────────────────
// Runner abstraction (injectable for tests)
// ─────────────────────────────────────────────────────────────────────────────

export interface GitRunResult {
  stdout: string;
  stderr: string;
  /** Process exit status; non-zero means git reported failure. */
  status: number;
}

export interface GitRunOptions {
  cwd?: string;
}

/** A runnable command boundary. Default runs the real `git`; tests inject a fake. */
export type GitRunner = (args: string[], opts?: GitRunOptions) => GitRunResult;

/** Default runner: real `git` via spawnSync (argv array, no shell). */
export const defaultGitRunner: GitRunner = (args, opts = {}) => {
  const result = spawnSync("git", args, { cwd: opts.cwd, encoding: "utf8" });
  if (result.error) {
    throw new GitError(args, -1, "", String(result.error.message ?? result.error));
  }
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: typeof result.status === "number" ? result.status : -1,
  };
};

export class GitError extends Error {
  constructor(
    public readonly args: string[],
    public readonly status: number,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    const summary = (stderr || stdout || "").trim().split("\n")[0] ?? "";
    super(`git ${args.join(" ")} failed (status ${status})${summary ? `: ${summary}` : ""}`);
    this.name = "GitError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Safety guards
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reject a positional value that could be reinterpreted as a git option.
 * (We pass argv arrays so shell injection is impossible; this closes the
 * remaining option-injection hole.)
 */
export function assertSafeArg(value: string, label: string): string {
  if (value.length === 0) {
    throw new GitError([label], -1, "", `${label} must not be empty`);
  }
  if (value.startsWith("-")) {
    throw new GitError([label], -1, "", `${label} must not start with "-" (got ${value})`);
  }
  if (value.includes("\0")) {
    throw new GitError([label], -1, "", `${label} must not contain NUL`);
  }
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// Git operations
// ─────────────────────────────────────────────────────────────────────────────

/** A parsed `git worktree list --porcelain` record. */
export interface WorktreeRecord {
  path: string;
  head?: string;
  branch?: string; // short branch name (refs/heads/ stripped); absent if detached
  detached: boolean;
  bare: boolean;
  locked: boolean;
}

export class Git {
  constructor(private readonly run: GitRunner = defaultGitRunner) {}

  /** Run a command that MUST succeed; throw GitError on non-zero. */
  private must(args: string[], opts?: GitRunOptions): GitRunResult {
    const result = this.run(args, opts);
    if (result.status !== 0) {
      throw new GitError(args, result.status, result.stdout, result.stderr);
    }
    return result;
  }

  /** Run a predicate command; return exit status without throwing. */
  private probe(args: string[], opts?: GitRunOptions): number {
    return this.run(args, opts).status;
  }

  /** `git -C <cwd> rev-parse --abbrev-ref HEAD` → current branch (or "HEAD" if detached). */
  currentBranch(cwd?: string): string {
    return this.must(["rev-parse", "--abbrev-ref", "HEAD"], { cwd }).stdout.trim();
  }

  /** True if a local branch ref exists. */
  branchExists(branch: string, cwd?: string): boolean {
    assertSafeArg(branch, "branch");
    return this.probe(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd }) === 0;
  }

  /** Add a worktree at `path` with a new branch `branch` based on `base`. */
  worktreeAdd(
    path: string,
    branch: string,
    base: string,
    opts: { cwd?: string } = {},
  ): GitRunResult {
    assertSafeArg(path, "worktree path");
    assertSafeArg(branch, "branch");
    assertSafeArg(base, "base ref");
    // `--` terminates options; path/branch/base already validated.
    return this.must(["worktree", "add", "-b", branch, "--", path, base], { cwd: opts.cwd });
  }

  /** Add a worktree for an EXISTING branch (no -b). Used by reconcile repair. */
  worktreeAddExisting(path: string, branch: string, opts: { cwd?: string } = {}): GitRunResult {
    assertSafeArg(path, "worktree path");
    assertSafeArg(branch, "branch");
    return this.must(["worktree", "add", "--", path, branch], { cwd: opts.cwd });
  }

  /** Remove a worktree (optionally force when it has changes — caller gated). */
  worktreeRemove(path: string, opts: { force?: boolean; cwd?: string } = {}): GitRunResult {
    assertSafeArg(path, "worktree path");
    const args = ["worktree", "remove"];
    if (opts.force) {
      args.push("--force");
    }
    args.push("--", path);
    return this.must(args, { cwd: opts.cwd });
  }

  /** Prune stale worktree administrative files. */
  worktreePrune(cwd?: string): GitRunResult {
    return this.must(["worktree", "prune"], { cwd });
  }

  /** List worktrees via porcelain output. */
  worktreeList(cwd?: string): WorktreeRecord[] {
    const out = this.must(["worktree", "list", "--porcelain"], { cwd }).stdout;
    return parseWorktreeList(out);
  }

  /**
   * Delete a local branch ref safely (recoverable; aligns with AGENTS Git Notes
   * preference for `update-ref -d` over `branch -D`). Caller decides policy.
   */
  deleteBranchRef(branch: string, cwd?: string): GitRunResult {
    assertSafeArg(branch, "branch");
    return this.must(["update-ref", "-d", `refs/heads/${branch}`], { cwd });
  }

  /** True if the working tree at cwd has staged or unstaged changes. */
  isDirty(cwd?: string): boolean {
    return this.must(["status", "--porcelain"], { cwd }).stdout.trim().length > 0;
  }

  /** Commits a branch is ahead/behind a base: `{ ahead, behind }` via rev-list. */
  aheadBehind(branch: string, base: string, cwd?: string): { ahead: number; behind: number } {
    assertSafeArg(branch, "branch");
    assertSafeArg(base, "base ref");
    const out = this.must(["rev-list", "--left-right", "--count", `${base}...${branch}`], {
      cwd,
    }).stdout.trim();
    const [behindStr, aheadStr] = out.split(/\s+/);
    return { behind: Number(behindStr ?? 0), ahead: Number(aheadStr ?? 0) };
  }

  /** Fetch from a remote (default origin). */
  fetch(remote = "origin", cwd?: string): GitRunResult {
    assertSafeArg(remote, "remote");
    return this.must(["fetch", "--", remote], { cwd });
  }

  /** Push a branch; optionally set upstream. NEVER used to push the default branch. */
  push(
    branch: string,
    opts: { remote?: string; setUpstream?: boolean; cwd?: string } = {},
  ): GitRunResult {
    const remote = opts.remote ?? "origin";
    assertSafeArg(remote, "remote");
    assertSafeArg(branch, "branch");
    const args = ["push"];
    if (opts.setUpstream) {
      args.push("-u");
    }
    args.push("--", remote, branch);
    return this.must(args, { cwd: opts.cwd });
  }

  /** Fast-forward-only merge of `branch` into the current branch. */
  mergeFfOnly(branch: string, cwd?: string): GitRunResult {
    assertSafeArg(branch, "branch");
    return this.must(["merge", "--ff-only", branch], { cwd });
  }

  /** Rebase the current branch onto `onto`. Non-zero status indicates conflict. */
  rebase(onto: string, cwd?: string): GitRunResult {
    assertSafeArg(onto, "onto ref");
    return this.run(["rebase", onto], { cwd });
  }

  /** Abort an in-progress rebase (best-effort cleanup after a conflict). */
  rebaseAbort(cwd?: string): GitRunResult {
    return this.run(["rebase", "--abort"], { cwd });
  }

  /** Set per-worktree git identity (optional; default keeps global identity). */
  setIdentity(name: string, email: string, cwd?: string): void {
    if (name.includes("\0") || email.includes("\0")) {
      throw new GitError(["config"], -1, "", "identity must not contain NUL");
    }
    this.must(["config", "user.name", name], { cwd });
    this.must(["config", "user.email", email], { cwd });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing (pure)
// ─────────────────────────────────────────────────────────────────────────────

/** Parse `git worktree list --porcelain` (blank-line separated records). */
export function parseWorktreeList(output: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = [];
  let current: Partial<WorktreeRecord> | undefined;

  const flush = () => {
    if (current?.path) {
      records.push({
        path: current.path,
        head: current.head,
        branch: current.branch,
        detached: current.detached ?? false,
        bare: current.bare ?? false,
        locked: current.locked ?? false,
      });
    }
    current = undefined;
  };

  for (const rawLine of output.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.length === 0) {
      flush();
      continue;
    }
    const sep = line.indexOf(" ");
    const key = sep < 0 ? line : line.slice(0, sep);
    const value = sep < 0 ? "" : line.slice(sep + 1);
    current ??= {};
    switch (key) {
      case "worktree":
        current.path = value;
        break;
      case "HEAD":
        current.head = value;
        break;
      case "branch":
        current.branch = value.replace(/^refs\/heads\//, "");
        break;
      case "detached":
        current.detached = true;
        break;
      case "bare":
        current.bare = true;
        break;
      case "locked":
        current.locked = true;
        break;
      default:
        break;
    }
  }
  flush();
  return records;
}
