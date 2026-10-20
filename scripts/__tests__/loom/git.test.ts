import { describe, expect, it } from "vitest";
import {
  assertSafeArg,
  defaultGitRunner,
  Git,
  GitError,
  type GitRunner,
  type GitRunResult,
  parseWorktreeList,
} from "../../loom/git.js";

/** A fake runner that records calls and replays scripted results. */
function fakeRunner(
  responses: Array<Partial<GitRunResult>> | ((args: string[]) => Partial<GitRunResult>),
): { runner: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  let index = 0;
  const runner: GitRunner = (args) => {
    calls.push(args);
    const raw = typeof responses === "function" ? responses(args) : responses[index++];
    return { stdout: "", stderr: "", status: 0, ...raw };
  };
  return { runner, calls };
}

describe("loom/git — assertSafeArg (option-injection guard)", () => {
  it("accepts a normal value", () => {
    expect(assertSafeArg("kiro-loom/loom-provisioning", "branch")).toBe(
      "kiro-loom/loom-provisioning",
    );
  });

  it("rejects values starting with '-'", () => {
    expect(() => assertSafeArg("--upload-pack=evil", "branch")).toThrow(GitError);
  });

  it("rejects empty and NUL-containing values", () => {
    expect(() => assertSafeArg("", "path")).toThrow(GitError);
    expect(() => assertSafeArg("a\0b", "path")).toThrow(GitError);
  });
});

describe("loom/git — command construction (argv array, no shell)", () => {
  it("worktreeAdd builds `worktree add -b <branch> -- <path> <base>`", () => {
    const { runner, calls } = fakeRunner([{}]);
    new Git(runner).worktreeAdd("../openbot-task", "kiro-loom/task", "main");
    expect(calls[0]).toEqual([
      "worktree",
      "add",
      "-b",
      "kiro-loom/task",
      "--",
      "../openbot-task",
      "main",
    ]);
  });

  it("worktreeRemove adds --force only when requested and terminates options", () => {
    const plain = fakeRunner([{}]);
    new Git(plain.runner).worktreeRemove("../wt");
    expect(plain.calls[0]).toEqual(["worktree", "remove", "--", "../wt"]);

    const forced = fakeRunner([{}]);
    new Git(forced.runner).worktreeRemove("../wt", { force: true });
    expect(forced.calls[0]).toEqual(["worktree", "remove", "--force", "--", "../wt"]);
  });

  it("deleteBranchRef uses recoverable update-ref -d", () => {
    const { runner, calls } = fakeRunner([{}]);
    new Git(runner).deleteBranchRef("kiro-loom/task");
    expect(calls[0]).toEqual(["update-ref", "-d", "refs/heads/kiro-loom/task"]);
  });

  it("push sets upstream and terminates options", () => {
    const { runner, calls } = fakeRunner([{}]);
    new Git(runner).push("kiro-loom/task", { setUpstream: true });
    expect(calls[0]).toEqual(["push", "-u", "--", "origin", "kiro-loom/task"]);
  });

  it("rejects an option-injecting branch name before running", () => {
    const { runner, calls } = fakeRunner([{}]);
    expect(() => new Git(runner).worktreeAdd("../wt", "--evil", "main")).toThrow(GitError);
    expect(calls).toHaveLength(0); // never reached the runner
  });
});

describe("loom/git — predicates and parsing", () => {
  it("branchExists maps exit status to boolean without throwing", () => {
    expect(new Git(fakeRunner([{ status: 0 }]).runner).branchExists("main")).toBe(true);
    expect(new Git(fakeRunner([{ status: 1 }]).runner).branchExists("gone")).toBe(false);
  });

  it("isDirty is true when porcelain output is non-empty", () => {
    expect(new Git(fakeRunner([{ stdout: " M a.ts\n" }]).runner).isDirty()).toBe(true);
    expect(new Git(fakeRunner([{ stdout: "" }]).runner).isDirty()).toBe(false);
  });

  it("aheadBehind parses `rev-list --left-right --count` (behind<TAB>ahead)", () => {
    const { runner } = fakeRunner([{ stdout: "2\t5\n" }]);
    expect(new Git(runner).aheadBehind("branch", "main")).toEqual({ behind: 2, ahead: 5 });
  });

  it("must() throws GitError on non-zero status", () => {
    const { runner } = fakeRunner([{ status: 128, stderr: "fatal: not a git repository\n" }]);
    expect(() => new Git(runner).worktreePrune()).toThrow(GitError);
  });
});

describe("loom/git — parseWorktreeList", () => {
  it("parses multiple records including branch, detached, and bare", () => {
    const output = [
      "worktree /repo",
      "HEAD aaaa",
      "branch refs/heads/main",
      "",
      "worktree /repo/../openbot-task",
      "HEAD bbbb",
      "branch refs/heads/kiro-loom/loom-provisioning",
      "",
      "worktree /repo/../detached",
      "HEAD cccc",
      "detached",
      "",
    ].join("\n");
    expect(parseWorktreeList(output)).toEqual([
      { path: "/repo", head: "aaaa", branch: "main", detached: false, bare: false, locked: false },
      {
        path: "/repo/../openbot-task",
        head: "bbbb",
        branch: "kiro-loom/loom-provisioning",
        detached: false,
        bare: false,
        locked: false,
      },
      {
        path: "/repo/../detached",
        head: "cccc",
        branch: undefined,
        detached: true,
        bare: false,
        locked: false,
      },
    ]);
  });

  it("handles a trailing record with no final blank line", () => {
    const output = "worktree /repo\nHEAD aaaa\nbranch refs/heads/main";
    const records = parseWorktreeList(output);
    expect(records).toHaveLength(1);
    expect(records[0].branch).toBe("main");
  });

  it("parses bare and locked flags", () => {
    const output = [
      "worktree /repo.git",
      "bare",
      "",
      "worktree /repo/../wt",
      "HEAD bbbb",
      "branch refs/heads/o/t",
      "locked",
      "",
    ].join("\n");
    const records = parseWorktreeList(output);
    expect(records[0]).toMatchObject({ path: "/repo.git", bare: true });
    expect(records[1]).toMatchObject({ branch: "o/t", locked: true });
  });
});

describe("loom/git — remaining command construction (coverage)", () => {
  it("worktreeAdd builds add -b with -- terminator", () => {
    const { runner, calls } = fakeRunner([{}]);
    new Git(runner).worktreeAdd("../wt", "o/t", "main");
    expect(calls[0]).toEqual(["worktree", "add", "-b", "o/t", "--", "../wt", "main"]);
  });

  it("worktreeAddExisting omits -b (existing branch)", () => {
    const { runner, calls } = fakeRunner([{}]);
    new Git(runner).worktreeAddExisting("../wt", "o/t");
    expect(calls[0]).toEqual(["worktree", "add", "--", "../wt", "o/t"]);
  });

  it("worktreePrune / worktreeList / currentBranch / fetch / mergeFfOnly / rebase", () => {
    const prune = fakeRunner([{}]);
    new Git(prune.runner).worktreePrune();
    expect(prune.calls[0]).toEqual(["worktree", "prune"]);

    const list = fakeRunner([{ stdout: "worktree /r\nHEAD a\nbranch refs/heads/main\n" }]);
    expect(new Git(list.runner).worktreeList()[0].branch).toBe("main");

    const cur = fakeRunner([{ stdout: "feature\n" }]);
    expect(new Git(cur.runner).currentBranch()).toBe("feature");

    const fetch = fakeRunner([{}]);
    new Git(fetch.runner).fetch();
    expect(fetch.calls[0]).toEqual(["fetch", "--", "origin"]);

    const merge = fakeRunner([{}]);
    new Git(merge.runner).mergeFfOnly("o/t");
    expect(merge.calls[0]).toEqual(["merge", "--ff-only", "o/t"]);

    const reb = fakeRunner([{ status: 0 }]);
    expect(new Git(reb.runner).rebase("main").status).toBe(0);
    const abort = fakeRunner([{}]);
    new Git(abort.runner).rebaseAbort();
    expect(abort.calls[0]).toEqual(["rebase", "--abort"]);
  });

  it("setIdentity sets user.name and user.email; rejects NUL", () => {
    const { runner, calls } = fakeRunner([{}, {}]);
    new Git(runner).setIdentity("Loom Test", "t@example.com", "/wt");
    expect(calls[0]).toEqual(["config", "user.name", "Loom Test"]);
    expect(calls[1]).toEqual(["config", "user.email", "t@example.com"]);
    expect(() => new Git(fakeRunner([{}]).runner).setIdentity("a\0b", "e")).toThrow(GitError);
  });

  it("currentBranch propagates GitError on failure", () => {
    const { runner } = fakeRunner([{ status: 1, stderr: "fatal\n" }]);
    expect(() => new Git(runner).currentBranch()).toThrow(GitError);
  });
});

describe("loom/git — branch coverage for options and runner", () => {
  it("push without setUpstream omits -u", () => {
    const { runner, calls } = fakeRunner([{}]);
    new Git(runner).push("o/t");
    expect(calls[0]).toEqual(["push", "--", "origin", "o/t"]);
  });

  it("aheadBehind tolerates missing fields", () => {
    const { runner } = fakeRunner([{ stdout: "" }]);
    expect(new Git(runner).aheadBehind("b", "main")).toEqual({ behind: 0, ahead: 0 });
  });

  it("GitError summary uses stdout when stderr is empty, and tolerates both empty", () => {
    const a = new GitError(["x"], 1, "stdout msg", "");
    expect(a.message).toContain("stdout msg");
    const b = new GitError(["x"], 1, "", "");
    expect(b.message).toContain("status 1");
  });

  it("defaultGitRunner executes real git and maps the result", () => {
    const out = defaultGitRunner(["--version"]);
    expect(out.status).toBe(0);
    expect(out.stdout.toLowerCase()).toContain("git version");
  });

  it("defaultGitRunner returns a non-zero status for a bad subcommand (no throw)", () => {
    const out = defaultGitRunner(["definitely-not-a-git-command"]);
    expect(out.status).not.toBe(0);
  });
});
