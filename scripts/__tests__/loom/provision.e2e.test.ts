/**
 * provision.e2e.test.ts — real-git end-to-end for Loom Provisioning (task 7.2/7.3).
 *
 * Drives start / land / abandon / list / reconcile against an actual temporary
 * git repository (no OpenBot paths — proves repo-agnostic, R7.2). The worktree
 * root default is `<repoRoot>/..`, so worktrees land as siblings inside the temp
 * area and are removed with it. Milestone M-Prov-1 acceptance evidence.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Git } from "../../loom/git.js";
import { abandon, land, reconcile, start, taskList } from "../../loom/provision.js";
import {
  emptyRegistry,
  loadRegistry,
  RegistryNotFoundError,
  saveRegistry,
} from "../../loom/registry.js";

const git = new Git();

function g(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function loadOrEmpty(cwd: string) {
  try {
    return loadRegistry(cwd);
  } catch (error) {
    if (error instanceof RegistryNotFoundError) {
      return emptyRegistry();
    }
    throw error;
  }
}

function makeIo(repo: string) {
  return {
    git,
    loadRegistry: () => loadOrEmpty(repo),
    saveRegistry: (r: ReturnType<typeof emptyRegistry>) => saveRegistry(r, repo),
  };
}

describe("loom/provision — real git e2e (M-Prov-1)", () => {
  let area: string;
  let repo: string;

  beforeEach(() => {
    area = mkdtempSync(join(tmpdir(), "loom-e2e-"));
    repo = join(area, "repo");
    g(area, "init", "repo");
    g(repo, "symbolic-ref", "HEAD", "refs/heads/main"); // set unborn default branch (old git)
    g(repo, "config", "user.email", "test@example.com");
    g(repo, "config", "user.name", "Loom Test");
    writeFileSync(join(repo, "README.md"), "# test\n");
    g(repo, "add", "-A");
    g(repo, "commit", "-m", "init");
  });

  afterEach(() => {
    rmSync(area, { recursive: true, force: true });
  });

  it("start creates a worktree + branch and records the binding", () => {
    const result = start({ taskId: "feat-x", owner: "kiro-loom" }, makeIo(repo), repo);
    expect(result.dryRun).toBe(false);
    expect(existsSync(result.worktreePath)).toBe(true);
    // Branch exists and the worktree is on it.
    expect(git.branchExists("kiro-loom/feat-x", repo)).toBe(true);
    const reg = loadRegistry(repo);
    const session = reg.tasks[0].sessions[0];
    expect(session.worktree).toBe(result.worktreePath);
    expect(reg.tasks[0].state).toBe("active");
  });

  it("start refuses to overwrite an existing branch", () => {
    start({ taskId: "feat-x", owner: "kiro-loom" }, makeIo(repo), repo);
    expect(() => start({ taskId: "feat-x", owner: "kiro-loom" }, makeIo(repo), repo)).toThrow();
  });

  it("land --mode merge integrates the branch into main and GCs the worktree", () => {
    const s = start({ taskId: "feat-y", owner: "kiro-loom" }, makeIo(repo), repo);
    // Make a commit in the worktree.
    writeFileSync(join(s.worktreePath, "feature.txt"), "hello\n");
    g(s.worktreePath, "add", "-A");
    g(s.worktreePath, "commit", "-m", "add feature");

    const outcome = land(
      { taskId: "feat-y", owner: "kiro-loom", mode: "merge" },
      makeIo(repo),
      repo,
    );
    expect(outcome.result).toBe("SUCCESS");
    // main now contains the feature file.
    expect(existsSync(join(repo, "feature.txt"))).toBe(true);
    // worktree GC'd; task landed.
    expect(existsSync(s.worktreePath)).toBe(false);
    expect(loadRegistry(repo).tasks[0].state).toBe("landed");
  });

  it("land refuses a dirty worktree (DIRTY_WORKTREE, retryable)", () => {
    const s = start({ taskId: "feat-d", owner: "kiro-loom" }, makeIo(repo), repo);
    writeFileSync(join(s.worktreePath, "wip.txt"), "uncommitted\n"); // untracked => dirty
    const outcome = land(
      { taskId: "feat-d", owner: "kiro-loom", mode: "merge" },
      makeIo(repo),
      repo,
    );
    expect(outcome.result).toBe("DIRTY_WORKTREE");
    expect(existsSync(s.worktreePath)).toBe(true); // not removed
  });

  it("abandon refuses dirty without --force, then removes with --force --yes", () => {
    const s = start({ taskId: "feat-a", owner: "kiro-loom" }, makeIo(repo), repo);
    writeFileSync(join(s.worktreePath, "wip.txt"), "uncommitted\n");

    const refused = abandon({ taskId: "feat-a", owner: "kiro-loom" }, makeIo(repo), repo);
    expect(refused.blocked).toBe("dirty");
    expect(existsSync(s.worktreePath)).toBe(true);

    // --force alone still needs secondary confirmation.
    const needsYes = abandon(
      { taskId: "feat-a", owner: "kiro-loom", force: true },
      makeIo(repo),
      repo,
    );
    expect(needsYes.needsConfirm).toBe(true);
    expect(existsSync(s.worktreePath)).toBe(true);

    const forced = abandon(
      { taskId: "feat-a", owner: "kiro-loom", force: true, yes: true },
      makeIo(repo),
      repo,
    );
    expect(forced.removed).toBe(true);
    expect(existsSync(s.worktreePath)).toBe(false);
    expect(loadRegistry(repo).tasks[0].state).toBe("abandoned");
  });

  it("reconcile detects an externally-deleted worktree as ORPHANED and repairs it", () => {
    const s = start({ taskId: "feat-o", owner: "kiro-loom" }, makeIo(repo), repo);
    // Externally remove the worktree directory (simulate a lost workspace).
    rmSync(s.worktreePath, { recursive: true, force: true });

    const report = reconcile({ mode: "report" }, makeIo(repo), repo);
    const row = report.rows.find((r) => r.taskId === "feat-o");
    expect(row?.finding).toBe("ORPHANED");
    expect(report.repaired).toHaveLength(0); // report is read-only

    // Repair (apply) recreates the worktree from the still-existing branch.
    g(repo, "worktree", "prune"); // clear the stale admin entry first
    const applied = reconcile({ mode: "apply" }, makeIo(repo), repo);
    expect(applied.repaired.some((r) => r.taskId === "feat-o")).toBe(true);
    expect(existsSync(s.worktreePath)).toBe(true);
  });

  it("list shows the provisioned worktree with health flags", () => {
    const s = start({ taskId: "feat-l", owner: "kiro-loom" }, makeIo(repo), repo);
    writeFileSync(join(s.worktreePath, "wip.txt"), "x\n"); // dirty
    const rows = taskList({ git, loadRegistry: () => loadOrEmpty(repo) }, repo);
    const row = rows.find((r) => r.taskId === "feat-l");
    expect(row).toBeDefined();
    expect(row!.finding).toBe("OK");
    expect(row!.dirty).toBe(true);
    expect(row!.branch).toBe("kiro-loom/feat-l");
  });
});
