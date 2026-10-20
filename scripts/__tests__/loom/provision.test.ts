import { describe, expect, it } from "vitest";
import { Git, type GitRunner, type WorktreeRecord } from "../../loom/git.js";
import {
  abandon,
  appendEvent,
  applyLanded,
  applyStart,
  bindProvision,
  canDestroy,
  computeReconcile,
  getProvisionBranch,
  getProvisionId,
  isRetryable,
  land,
  MAX_EVENTS,
  newProvisionId,
  ownsWorktree,
  planStart,
  ProvisionError,
  issueMatchesTaskId,
  reconcile,
  renderBranch,
  start,
  taskList,
  worktreePathFor,
  type ProvisionConfig,
} from "../../loom/provision.js";
import { emptyRegistry, type Registry, type Session } from "../../loom/registry.js";

// ─────────────────────────────────────────────────────────────────────────────
// 2.1 Config & naming
// ─────────────────────────────────────────────────────────────────────────────

describe("loom/provision — renderBranch (naming template + validation)", () => {
  it("renders a simple template", () => {
    expect(renderBranch("{owner}/{task}", { owner: "kiro-loom", task: "my-task" })).toBe(
      "kiro-loom/my-task",
    );
  });

  it("rejects a branch starting with '-'", () => {
    expect(() => renderBranch("{owner}/{task}", { owner: "-evil", task: "x" })).toThrow(
      ProvisionError,
    );
  });

  it("rejects a branch ending with .lock", () => {
    expect(() => renderBranch("{owner}/{task}", { owner: "a", task: "x.lock" })).toThrow(
      ProvisionError,
    );
  });

  it("rejects a branch containing ..  or //", () => {
    expect(() => renderBranch("{owner}/{task}", { owner: "a..b", task: "x" })).toThrow(
      ProvisionError,
    );
    expect(() => renderBranch("{owner}/{task}", { owner: "a//b", task: "x" })).toThrow(
      ProvisionError,
    );
  });

  it("rejects a branch containing special characters (space, ~, ^, :)", () => {
    expect(() => renderBranch("{owner}/{task}", { owner: "a b", task: "x" })).toThrow(
      ProvisionError,
    );
    expect(() => renderBranch("{owner}/{task}", { owner: "a~b", task: "x" })).toThrow(
      ProvisionError,
    );
  });
});

describe("loom/provision — worktreePathFor", () => {
  it("uses repo basename + task to form the path", () => {
    const config: ProvisionConfig = {
      worktreeRoot: "/projects",
      branchTemplate: "{owner}/{task}",
      defaultBase: "main",
      defaultLandMode: "pr",
    };
    const result = worktreePathFor(config, "my-task", "/projects/openbot");
    expect(result).toBe("/projects/openbot-my-task");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2.2 Safety judgments
// ─────────────────────────────────────────────────────────────────────────────

describe("loom/provision — canDestroy (Property 1: data safety)", () => {
  it("allows destruction of clean worktree without force", () => {
    expect(canDestroy({ dirty: false, unpushed: false }, false)).toBe(true);
  });

  it("rejects dirty worktree without force", () => {
    expect(canDestroy({ dirty: true, unpushed: false }, false)).toBe(false);
  });

  it("rejects unpushed worktree without force", () => {
    expect(canDestroy({ dirty: false, unpushed: true }, false)).toBe(false);
  });

  it("allows with force even if dirty and unpushed", () => {
    expect(canDestroy({ dirty: true, unpushed: true }, true)).toBe(true);
  });
});

describe("loom/provision — ownsWorktree (Property 2+7: identity binding)", () => {
  const baseSession: Session = {
    id: "s1",
    taskId: "task-a",
    ide: "kiro",
    agent: "kiro-loom",
    status: "active",
    metadata: { provisionId: "uuid-1", branch: "kiro-loom/task-a" },
  };

  it("returns true for matching taskId with provisionId", () => {
    expect(ownsWorktree(baseSession, { owner: "kiro-loom", taskId: "task-a" })).toBe(true);
  });

  it("returns false for non-matching taskId", () => {
    expect(ownsWorktree(baseSession, { owner: "kiro-loom", taskId: "other" })).toBe(false);
  });

  it("returns false if no provisionId (not provisioned)", () => {
    const unprovisioned: Session = { ...baseSession, metadata: {} };
    expect(ownsWorktree(unprovisioned, { owner: "kiro-loom", taskId: "task-a" })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Land result semantics
// ─────────────────────────────────────────────────────────────────────────────

describe("loom/provision — LandResult retryable classification", () => {
  it("CONFLICTED/NON_FAST_FORWARD/DIRTY_WORKTREE are retryable", () => {
    expect(isRetryable("CONFLICTED")).toBe(true);
    expect(isRetryable("NON_FAST_FORWARD")).toBe(true);
    expect(isRetryable("DIRTY_WORKTREE")).toBe(true);
  });

  it("SUCCESS and POLICY_BLOCKED are not retryable", () => {
    expect(isRetryable("SUCCESS")).toBe(false);
    expect(isRetryable("POLICY_BLOCKED")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2.3 Stable binding + bounded audit trail
// ─────────────────────────────────────────────────────────────────────────────

describe("loom/provision — newProvisionId + bindProvision", () => {
  it("generates unique UUIDs", () => {
    const a = newProvisionId();
    const b = newProvisionId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });

  it("bindProvision writes provisionId, branch, worktree without mutating", () => {
    const session: Session = {
      id: "s1",
      taskId: "t1",
      ide: "kiro",
      agent: "kiro-loom",
      status: "active",
      metadata: {},
    };
    const bound = bindProvision(session, {
      provisionId: "uuid-test",
      branch: "kiro-loom/t1",
      worktree: "/wt",
    });
    expect(bound.worktree).toBe("/wt");
    expect(getProvisionId(bound)).toBe("uuid-test");
    expect(getProvisionBranch(bound)).toBe("kiro-loom/t1");
    // Original unmodified
    expect(session.worktree).toBeUndefined();
  });
});

describe("loom/provision — appendEvent (bounded audit trail)", () => {
  const baseSession: Session = {
    id: "s1",
    taskId: "t1",
    ide: "kiro",
    agent: "kiro-loom",
    status: "active",
    metadata: {},
  };

  it("appends an event with timestamp", () => {
    const result = appendEvent(baseSession, "worktree_created");
    const events = (result.metadata as { events: unknown[] }).events;
    expect(events).toHaveLength(1);
    expect(events[0]).toHaveProperty("kind", "worktree_created");
    expect(events[0]).toHaveProperty("ts");
  });

  it("bounds to MAX_EVENTS, dropping oldest", () => {
    let session = baseSession;
    // Append MAX_EVENTS + 10 events
    for (let i = 0; i < MAX_EVENTS + 10; i++) {
      session = appendEvent(session, "worktree_created");
    }
    const events = (session.metadata as { events: unknown[] }).events;
    expect(events).toHaveLength(MAX_EVENTS);
  });

  it("does not mutate original session", () => {
    const result = appendEvent(baseSession, "landed");
    expect(baseSession.metadata.events).toBeUndefined();
    expect((result.metadata as { events: unknown[] }).events).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3.1 start orchestration
// ─────────────────────────────────────────────────────────────────────────────

const startConfig: ProvisionConfig = {
  worktreeRoot: "/projects",
  branchTemplate: "{owner}/{task}",
  defaultBase: "main",
  defaultLandMode: "pr",
};

describe("loom/provision — planStart (pure)", () => {
  it("computes branch, worktree path, and base", () => {
    const plan = planStart(
      startConfig,
      { owner: "kiro-loom", taskId: "loom-provisioning" },
      "/projects/openbot",
    );
    expect(plan.branch).toBe("kiro-loom/loom-provisioning");
    expect(plan.worktreePath).toBe("/projects/openbot-loom-provisioning");
    expect(plan.base).toBe("main");
  });

  it("honors --from override for base", () => {
    const plan = planStart(
      startConfig,
      { owner: "kiro-loom", taskId: "t", from: "develop" },
      "/projects/openbot",
    );
    expect(plan.base).toBe("develop");
  });
});

// R1.4/R2.5: the branch is `<owner>/<task>`, so an issue-prefixed task id is what
// makes the branch self-describing. Advisory only — two id conventions coexist.
describe("loom/provision — issueMatchesTaskId (advisory naming check)", () => {
  it("accepts the <issue>-<slug> convention", () => {
    expect(issueMatchesTaskId("234-enterprise-plan", 234)).toBe(true);
  });

  it("accepts the issue number anywhere as a whole number", () => {
    expect(issueMatchesTaskId("plan-234", 234)).toBe(true);
    expect(issueMatchesTaskId("fix-234-retry", 234)).toBe(true);
  });

  it("rejects a task id that does not reference the issue", () => {
    expect(issueMatchesTaskId("enterprise-plan", 234)).toBe(false);
  });

  it("does not match a digit substring of a longer number", () => {
    expect(issueMatchesTaskId("1234-plan", 234)).toBe(false);
    expect(issueMatchesTaskId("2345-plan", 234)).toBe(false);
  });

  it("works for the import-derived <spec>:<agent> id shape (no false positive)", () => {
    expect(issueMatchesTaskId("cross-session-user-modeling:cursor-user-modeling", 234)).toBe(false);
  });
});

describe("loom/provision — applyStart (pure registry mutation)", () => {
  it("creates an active task with a bound session carrying events", () => {
    const next = applyStart(emptyRegistry(), {
      taskId: "t1",
      owner: "kiro-loom",
      sessionId: "s1",
      ide: "cli",
      agent: "kiro-loom",
      provisionId: "uuid-1",
      branch: "kiro-loom/t1",
      worktreePath: "/wt/t1",
    });
    const task = next.tasks.find((t) => t.id === "t1")!;
    expect(task.state).toBe("active");
    const session = task.sessions.find((s) => s.id === "s1")!;
    expect(getProvisionId(session)).toBe("uuid-1");
    expect(getProvisionBranch(session)).toBe("kiro-loom/t1");
    expect(session.worktree).toBe("/wt/t1");
    const events = (session.metadata as { events: { kind: string }[] }).events;
    expect(events.map((e) => e.kind)).toEqual(["branch_created", "worktree_created"]);
  });

  it("binds the issue onto the created task (R2.5)", () => {
    const next = applyStart(emptyRegistry(), {
      taskId: "234-enterprise-plan",
      owner: "cursor-agent",
      issue: 234,
      sessionId: "s1",
      ide: "cli",
      agent: "cursor-agent",
      provisionId: "uuid-1",
      branch: "cursor-agent/234-enterprise-plan",
      worktreePath: "/wt/234",
    });
    expect(next.tasks[0].issue).toBe(234);
  });

  it("leaves issue unset when none is supplied (backward compatible)", () => {
    const next = applyStart(emptyRegistry(), {
      taskId: "t1",
      owner: "kiro-loom",
      sessionId: "s1",
      ide: "cli",
      agent: "kiro-loom",
      provisionId: "uuid-1",
      branch: "kiro-loom/t1",
      worktreePath: "/wt/t1",
    });
    expect(next.tasks[0].issue).toBeUndefined();
  });
});

/** Fake Git driven by argv[0] (and argv[1] for worktree subcommands). */
function fakeGit(opts: { branchExists?: boolean } = {}): { git: Git; calls: string[][] } {
  const calls: string[][] = [];
  const runner: GitRunner = (args) => {
    calls.push(args);
    if (args[0] === "show-ref") {
      return { stdout: "", stderr: "", status: opts.branchExists ? 0 : 1 };
    }
    return { stdout: "", stderr: "", status: 0 };
  };
  return { git: new Git(runner), calls };
}

describe("loom/provision — start (orchestration with fake git)", () => {
  function makeIo(opts: { branchExists?: boolean; pathExists?: boolean } = {}) {
    let saved: Registry | undefined;
    const { git, calls } = fakeGit({ branchExists: opts.branchExists });
    const io = {
      git,
      loadRegistry: () => emptyRegistry(),
      saveRegistry: (r: Registry) => {
        saved = r;
      },
      pathExists: () => Boolean(opts.pathExists),
    };
    return { io, calls, getSaved: () => saved };
  }

  it("dry-run produces a plan without any side effects", () => {
    const { io, calls, getSaved } = makeIo();
    const result = start(
      { taskId: "t1", owner: "kiro-loom", dryRun: true },
      io,
      "/projects/openbot",
    );
    expect(result.dryRun).toBe(true);
    expect(result.branch).toBe("kiro-loom/t1");
    expect(calls).toHaveLength(1); // only the branchExists probe; no worktree add
    expect(calls[0][0]).toBe("show-ref");
    expect(getSaved()).toBeUndefined(); // registry not written
  });

  it("happy path creates worktree and writes a bound session", () => {
    const { io, calls, getSaved } = makeIo();
    const result = start({ taskId: "t1", owner: "kiro-loom" }, io, "/projects/openbot");
    expect(result.dryRun).toBe(false);
    expect(calls.some((c) => c[0] === "worktree" && c[1] === "add")).toBe(true);
    const saved = getSaved()!;
    const session = saved.tasks[0].sessions[0];
    expect(session.worktree).toBe("/projects/openbot-t1");
    expect(getProvisionId(session)).toBeDefined();
  });

  it("refuses when the branch already exists", () => {
    const { io } = makeIo({ branchExists: true });
    expect(() => start({ taskId: "t1", owner: "kiro-loom" }, io, "/projects/openbot")).toThrow(
      ProvisionError,
    );
  });

  it("refuses when the worktree path already exists", () => {
    const { io } = makeIo({ pathExists: true });
    expect(() => start({ taskId: "t1", owner: "kiro-loom" }, io, "/projects/openbot")).toThrow(
      ProvisionError,
    );
  });

  it("threads --issue into the registry and the result (R2.5)", () => {
    const { io, getSaved } = makeIo();
    const result = start(
      { taskId: "234-enterprise-plan", owner: "cursor-agent", issue: 234 },
      io,
      "/projects/openbot",
    );
    expect(result.issue).toBe(234);
    expect(result.branch).toBe("cursor-agent/234-enterprise-plan");
    expect(getSaved()!.tasks[0].issue).toBe(234);
  });

  it("dry-run reports the issue without writing the registry", () => {
    const { io, getSaved } = makeIo();
    const result = start(
      { taskId: "234-plan", owner: "cursor-agent", issue: 234, dryRun: true },
      io,
      "/projects/openbot",
    );
    expect(result.issue).toBe(234);
    expect(getSaved()).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4.x land + 5.x abandon
// ─────────────────────────────────────────────────────────────────────────────

/** Build an in-memory registry with one provisioned task/session. */
function provisionedRegistry(): Registry {
  return applyStart(emptyRegistry(), {
    taskId: "t1",
    owner: "kiro-loom",
    sessionId: "s1",
    ide: "cli",
    agent: "kiro-loom",
    provisionId: "uuid-1",
    branch: "kiro-loom/t1",
    worktreePath: "/projects/openbot-t1",
  });
}

/** Scriptable fake git for land/abandon: control isDirty, rebase, merge, ahead. */
function scriptedGit(opts: {
  dirty?: boolean;
  rebaseConflict?: boolean;
  mergeFails?: boolean;
  ahead?: number;
}): { git: Git; calls: string[][] } {
  const calls: string[][] = [];
  const runner: GitRunner = (args) => {
    calls.push(args);
    if (args[0] === "status") {
      return { stdout: opts.dirty ? " M f.ts\n" : "", stderr: "", status: 0 };
    }
    if (args[0] === "rebase" && args[1] !== "--abort") {
      return { stdout: "", stderr: "", status: opts.rebaseConflict ? 1 : 0 };
    }
    if (args[0] === "merge") {
      return {
        stdout: "",
        stderr: opts.mergeFails ? "not ff\n" : "",
        status: opts.mergeFails ? 1 : 0,
      };
    }
    if (args[0] === "rev-list") {
      return { stdout: `0\t${opts.ahead ?? 0}\n`, stderr: "", status: 0 };
    }
    return { stdout: "", stderr: "", status: 0 };
  };
  return { git: new Git(runner), calls };
}

function landIo(git: Git, opts: { gate?: boolean } = {}) {
  let saved: Registry | undefined;
  return {
    io: {
      git,
      loadRegistry: () => saved ?? provisionedRegistry(),
      saveRegistry: (r: Registry) => {
        saved = r;
      },
      runGate: () => opts.gate ?? true,
      acquireLock: () => ({ release: () => {} }),
    },
    getSaved: () => saved,
  };
}

describe("loom/provision — land (two-phase, LandResult)", () => {
  it("returns DIRTY_WORKTREE when the worktree has uncommitted changes", () => {
    const { git } = scriptedGit({ dirty: true });
    const { io } = landIo(git);
    const outcome = land(
      { taskId: "t1", owner: "kiro-loom", mode: "merge" },
      io,
      "/projects/openbot",
    );
    expect(outcome.result).toBe("DIRTY_WORKTREE");
  });

  it("returns POLICY_BLOCKED when the gate fails", () => {
    const { git } = scriptedGit({});
    const { io } = landIo(git, { gate: false });
    const outcome = land(
      { taskId: "t1", owner: "kiro-loom", mode: "merge" },
      io,
      "/projects/openbot",
    );
    expect(outcome.result).toBe("POLICY_BLOCKED");
  });

  it("returns CONFLICTED when rebase conflicts (and aborts)", () => {
    const { git, calls } = scriptedGit({ rebaseConflict: true });
    const { io } = landIo(git);
    const outcome = land(
      { taskId: "t1", owner: "kiro-loom", mode: "merge" },
      io,
      "/projects/openbot",
    );
    expect(outcome.result).toBe("CONFLICTED");
    expect(calls.some((c) => c[0] === "rebase" && c[1] === "--abort")).toBe(true);
  });

  it("returns NON_FAST_FORWARD when ff-only merge fails in finalize", () => {
    const { git } = scriptedGit({ mergeFails: true });
    const { io } = landIo(git);
    const outcome = land(
      { taskId: "t1", owner: "kiro-loom", mode: "merge" },
      io,
      "/projects/openbot",
    );
    expect(outcome.result).toBe("NON_FAST_FORWARD");
  });

  it("merge mode succeeds: registry landed + worktree GC'd", () => {
    const { git, calls } = scriptedGit({});
    const { io, getSaved } = landIo(git);
    const outcome = land(
      { taskId: "t1", owner: "kiro-loom", mode: "merge" },
      io,
      "/projects/openbot",
    );
    expect(outcome.result).toBe("SUCCESS");
    expect(getSaved()!.tasks[0].state).toBe("landed");
    expect(calls.some((c) => c[0] === "worktree" && c[1] === "remove")).toBe(true);
  });

  it("dry-run passes prepare checks without side effects", () => {
    const { git, calls } = scriptedGit({});
    const { io, getSaved } = landIo(git);
    const outcome = land(
      { taskId: "t1", owner: "kiro-loom", mode: "merge", dryRun: true },
      io,
      "/projects/openbot",
    );
    expect(outcome.result).toBe("SUCCESS");
    expect(outcome.dryRun).toBe(true);
    expect(calls.some((c) => c[0] === "worktree" && c[1] === "remove")).toBe(false);
    expect(getSaved()).toBeUndefined();
  });

  it("throws when the task is not provisioned by the caller", () => {
    const { git } = scriptedGit({});
    const io = {
      git,
      loadRegistry: () => emptyRegistry(),
      saveRegistry: () => {},
      acquireLock: () => ({ release: () => {} }),
    };
    expect(() => land({ taskId: "ghost", owner: "kiro-loom" }, io, "/projects/openbot")).toThrow(
      ProvisionError,
    );
  });
});

describe("loom/provision — abandon", () => {
  function abandonIo(git: Git) {
    let saved: Registry | undefined;
    return {
      io: {
        git,
        loadRegistry: () => saved ?? provisionedRegistry(),
        saveRegistry: (r: Registry) => {
          saved = r;
        },
      },
      getSaved: () => saved,
    };
  }

  it("blocks a dirty worktree without --force", () => {
    const { git } = scriptedGit({ dirty: true });
    const { io, getSaved } = abandonIo(git);
    const outcome = abandon({ taskId: "t1", owner: "kiro-loom" }, io, "/projects/openbot");
    expect(outcome.blocked).toBe("dirty");
    expect(outcome.removed).toBe(false);
    expect(getSaved()).toBeUndefined();
  });

  it("blocks an unpushed worktree without --force", () => {
    const { git } = scriptedGit({ ahead: 3 });
    const { io } = abandonIo(git);
    const outcome = abandon({ taskId: "t1", owner: "kiro-loom" }, io, "/projects/openbot");
    expect(outcome.blocked).toBe("unpushed");
  });

  it("requires secondary --yes even with --force, surfacing a loss summary", () => {
    const { git, calls } = scriptedGit({ dirty: true, ahead: 2 });
    const { io, getSaved } = abandonIo(git);
    const outcome = abandon(
      { taskId: "t1", owner: "kiro-loom", force: true },
      io,
      "/projects/openbot",
    );
    expect(outcome.needsConfirm).toBe(true);
    expect(outcome.removed).toBe(false);
    expect(outcome.lossSummary).toMatchObject({ dirty: true, unpushed: true, ahead: 2 });
    expect(calls.some((c) => c[0] === "worktree" && c[1] === "remove")).toBe(false);
    expect(getSaved()).toBeUndefined();
  });

  it("force-removes a dirty worktree with --force --yes and marks abandoned", () => {
    const { git, calls } = scriptedGit({ dirty: true, ahead: 2 });
    const { io, getSaved } = abandonIo(git);
    const outcome = abandon(
      { taskId: "t1", owner: "kiro-loom", force: true, yes: true },
      io,
      "/projects/openbot",
    );
    expect(outcome.removed).toBe(true);
    expect(outcome.lossSummary).toMatchObject({ dirty: true, ahead: 2 });
    expect(getSaved()!.tasks[0].state).toBe("abandoned");
    expect(
      calls.some((c) => c[0] === "worktree" && c[1] === "remove" && c.includes("--force")),
    ).toBe(true);
  });

  it("keeps the branch by default, deletes only with --delete-branch", () => {
    const clean = scriptedGit({});
    const kept = abandonIo(clean.git);
    abandon({ taskId: "t1", owner: "kiro-loom" }, kept.io, "/projects/openbot");
    expect(clean.calls.some((c) => c[0] === "update-ref")).toBe(false);

    const clean2 = scriptedGit({});
    const del = abandonIo(clean2.git);
    abandon({ taskId: "t1", owner: "kiro-loom", deleteBranch: true }, del.io, "/projects/openbot");
    expect(clean2.calls.some((c) => c[0] === "update-ref" && c[1] === "-d")).toBe(true);
  });

  it("dry-run reports without side effects", () => {
    const { git, calls } = scriptedGit({});
    const { io, getSaved } = abandonIo(git);
    const outcome = abandon(
      { taskId: "t1", owner: "kiro-loom", dryRun: true },
      io,
      "/projects/openbot",
    );
    expect(outcome.dryRun).toBe(true);
    expect(outcome.removed).toBe(false);
    expect(calls.some((c) => c[0] === "worktree" && c[1] === "remove")).toBe(false);
    expect(getSaved()).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6.1 list + 6.2 reconcile/repair
// ─────────────────────────────────────────────────────────────────────────────

describe("loom/provision — computeReconcile (pure)", () => {
  const cwd = "/projects/openbot";
  const mainWt: WorktreeRecord = {
    path: cwd,
    head: "aaa",
    branch: "main",
    detached: false,
    bare: false,
    locked: false,
  };
  const taskWt: WorktreeRecord = {
    path: "/projects/openbot-t1",
    head: "bbb",
    branch: "kiro-loom/t1",
    detached: false,
    bare: false,
    locked: false,
  };

  it("reports OK when binding matches an existing worktree and branch", () => {
    const rows = computeReconcile(provisionedRegistry(), [mainWt, taskWt], {
      cwd,
      branchExists: () => true,
      pathExists: () => true,
    });
    expect(rows).toEqual([
      expect.objectContaining({ taskId: "t1", finding: "OK", branch: "kiro-loom/t1" }),
    ]);
  });

  it("reports ORPHANED when the recorded worktree is gone", () => {
    const rows = computeReconcile(provisionedRegistry(), [mainWt], {
      cwd,
      branchExists: () => true,
      pathExists: () => false,
    });
    expect(rows[0].finding).toBe("ORPHANED");
  });

  it("reports MISSING_BRANCH when the branch was deleted", () => {
    const rows = computeReconcile(provisionedRegistry(), [mainWt, taskWt], {
      cwd,
      branchExists: () => false,
      pathExists: () => true,
    });
    expect(rows[0].finding).toBe("MISSING_BRANCH");
  });

  it("reports UNTRACKED_WORKTREE for a git worktree with no binding", () => {
    const stray: WorktreeRecord = {
      path: "/projects/openbot-stray",
      head: "ccc",
      branch: "someone/stray",
      detached: false,
      bare: false,
      locked: false,
    };
    const rows = computeReconcile(emptyRegistry(), [mainWt, stray], {
      cwd,
      branchExists: () => true,
      pathExists: () => true,
    });
    expect(rows).toEqual([
      expect.objectContaining({
        finding: "UNTRACKED_WORKTREE",
        worktreePath: "/projects/openbot-stray",
      }),
    ]);
  });

  it("reports STALE when a landed task still has its worktree", () => {
    const landed = applyLanded(provisionedRegistry(), "t1");
    const rows = computeReconcile(landed, [mainWt, taskWt], {
      cwd,
      branchExists: () => true,
      pathExists: () => true,
    });
    expect(rows[0].finding).toBe("STALE");
  });
});

describe("loom/provision — reconcile (modes)", () => {
  const cwd = "/projects/openbot";
  function reconcileIo(opts: { branchExists?: boolean } = {}) {
    let saved: Registry | undefined;
    const calls: string[][] = [];
    const runner: GitRunner = (args) => {
      calls.push(args);
      if (args[0] === "worktree" && args[1] === "list") {
        // main only; the task worktree is ORPHANED (missing).
        return {
          stdout: `worktree ${cwd}\nHEAD aaa\nbranch refs/heads/main\n`,
          stderr: "",
          status: 0,
        };
      }
      if (args[0] === "show-ref") {
        return { stdout: "", stderr: "", status: opts.branchExists === false ? 1 : 0 };
      }
      return { stdout: "", stderr: "", status: 0 };
    };
    return {
      io: {
        git: new Git(runner),
        loadRegistry: () => saved ?? provisionedRegistry(),
        saveRegistry: (r: Registry) => {
          saved = r;
        },
      },
      calls,
      getSaved: () => saved,
    };
  }

  it("report mode is read-only (no mutation, no worktree add)", () => {
    const { io, calls, getSaved } = reconcileIo();
    const report = reconcile({ mode: "report" }, io, cwd);
    expect(report.rows[0].finding).toBe("ORPHANED");
    expect(report.repaired).toHaveLength(0);
    expect(calls.some((c) => c[0] === "worktree" && c[1] === "add")).toBe(false);
    expect(getSaved()).toBeUndefined();
  });

  it("default mode is report", () => {
    const { io } = reconcileIo();
    const report = reconcile({}, io, cwd);
    expect(report.mode).toBe("report");
  });

  it("apply mode recreates an orphaned worktree from its branch", () => {
    const { io, calls, getSaved } = reconcileIo({ branchExists: true });
    const report = reconcile({ mode: "apply" }, io, cwd);
    expect(report.repaired).toHaveLength(1);
    expect(calls.some((c) => c[0] === "worktree" && c[1] === "add")).toBe(true);
    expect(getSaved()).toBeDefined();
  });
});

describe("loom/provision — taskList", () => {
  const cwd = "/projects/openbot";
  it("augments reconcile rows with dirty / ahead-behind for present worktrees", () => {
    const runner: GitRunner = (args) => {
      if (args[0] === "worktree" && args[1] === "list") {
        return {
          stdout:
            `worktree ${cwd}\nHEAD a\nbranch refs/heads/main\n\n` +
            `worktree /projects/openbot-t1\nHEAD b\nbranch refs/heads/kiro-loom/t1\n`,
          stderr: "",
          status: 0,
        };
      }
      if (args[0] === "show-ref") {
        return { stdout: "", stderr: "", status: 0 };
      }
      if (args[0] === "status") {
        return { stdout: " M f.ts\n", stderr: "", status: 0 };
      }
      if (args[0] === "rev-list") {
        return { stdout: "1\t2\n", stderr: "", status: 0 };
      }
      return { stdout: "", stderr: "", status: 0 };
    };
    const rows = taskList(
      { git: new Git(runner), loadRegistry: () => provisionedRegistry(), pathExists: () => true },
      cwd,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      taskId: "t1",
      finding: "OK",
      dirty: true,
      ahead: 2,
      behind: 1,
      state: "active",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Coverage: config, lock, pr-mode land, applyAbandoned
// ─────────────────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLandLock, applyAbandoned, loadProvisionConfig } from "../../loom/provision.js";

describe("loom/provision — loadProvisionConfig", () => {
  it("returns built-in defaults when no config file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-cfg-"));
    try {
      const cfg = loadProvisionConfig(dir);
      expect(cfg.branchTemplate).toBe("{owner}/{task}");
      expect(cfg.defaultBase).toBe("main");
      expect(cfg.defaultLandMode).toBe("pr");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads provisioning overrides from .loom/config.yaml", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-cfg-"));
    try {
      mkdirSync(join(dir, ".loom"), { recursive: true });
      writeFileSync(
        join(dir, ".loom", "config.yaml"),
        "provisioning:\n  defaultBase: trunk\n  defaultLandMode: merge\n",
      );
      const cfg = loadProvisionConfig(dir);
      expect(cfg.defaultBase).toBe("trunk");
      expect(cfg.defaultLandMode).toBe("merge");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("loom/provision — acquireLandLock", () => {
  it("acquires, blocks a second acquire, and releases", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-lock-"));
    try {
      const lock = acquireLandLock("t1", dir);
      expect(() => acquireLandLock("t1", dir)).toThrow(ProvisionError);
      lock.release();
      // After release a fresh acquire succeeds.
      acquireLandLock("t1", dir).release();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("loom/provision — applyAbandoned", () => {
  it("transitions a task to abandoned with an event", () => {
    const next = applyAbandoned(provisionedRegistry(), "t1");
    expect(next.tasks[0].state).toBe("abandoned");
    const events = (next.tasks[0].sessions[0].metadata as { events: { kind: string }[] }).events;
    expect(events.some((e) => e.kind === "abandoned")).toBe(true);
  });
});

describe("loom/provision — land pr mode", () => {
  const cwd = "/projects/openbot";
  it("pushes the branch and opens a PR, then GCs and lands", () => {
    const calls: string[][] = [];
    const runner: GitRunner = (args) => {
      calls.push(args);
      return { stdout: "", stderr: "", status: 0 };
    };
    let saved: Registry | undefined;
    let prOpened = false;
    const outcome = land(
      { taskId: "t1", owner: "kiro-loom", mode: "pr" },
      {
        git: new Git(runner),
        loadRegistry: () => saved ?? provisionedRegistry(),
        saveRegistry: (r: Registry) => {
          saved = r;
        },
        runGate: () => true,
        acquireLock: () => ({ release: () => {} }),
        prCreate: () => {
          prOpened = true;
        },
      },
      cwd,
    );
    expect(outcome.result).toBe("SUCCESS");
    expect(prOpened).toBe(true);
    expect(calls.some((c) => c[0] === "push")).toBe(true);
    expect(saved!.tasks[0].state).toBe("landed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2 Property tests: P3 determinism, P4 intent invariance (Architecture Rule #1)
// ─────────────────────────────────────────────────────────────────────────────

describe("loom/provision — Property 3: reconcile determinism", () => {
  it("same inputs produce identical findings", () => {
    const reg = provisionedRegistry();
    const wts = [
      {
        path: "/projects/openbot",
        head: "a",
        branch: "main",
        detached: false,
        bare: false,
        locked: false,
      },
    ];
    const opts = { cwd: "/projects/openbot", branchExists: () => true, pathExists: () => false };
    expect(computeReconcile(reg, wts, opts)).toEqual(computeReconcile(reg, wts, opts));
  });
});

describe("loom/provision — Property 4: intent does not change outcome (Rule #1)", () => {
  it("adding intent to a task changes neither ownership nor reconcile finding", () => {
    const reg = provisionedRegistry();
    const regWithIntent: Registry = {
      ...reg,
      tasks: reg.tasks.map((t) => ({ ...t, intent: ["ui", "migration", "whatever"] })),
    };
    const wts = [
      {
        path: "/projects/openbot",
        head: "a",
        branch: "main",
        detached: false,
        bare: false,
        locked: false,
      },
      {
        path: "/projects/openbot-t1",
        head: "b",
        branch: "kiro-loom/t1",
        detached: false,
        bare: false,
        locked: false,
      },
    ];
    const opts = { cwd: "/projects/openbot", branchExists: () => true, pathExists: () => true };
    expect(computeReconcile(regWithIntent, wts, opts)).toEqual(computeReconcile(reg, wts, opts));

    const session = reg.tasks[0].sessions[0];
    const caller = { owner: "kiro-loom", taskId: "t1" };
    expect(ownsWorktree(session, caller)).toBe(
      ownsWorktree(regWithIntent.tasks[0].sessions[0], caller),
    );
  });
});
