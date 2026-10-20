/**
 * provision.ts — Loom Provisioning orchestration (tasks 2.1, 2.2, 2.3, 3.1+).
 *
 * Decision pure functions + thin IO boundary. The orchestration layer calls
 * `git.ts` for all git side-effects and `registry.ts` for persistence.
 *
 * Core principle: this is a WORKSPACE LIFECYCLE MANAGER, not an execution state
 * machine. Registry is the canonical source of truth; git/worktree are
 * projections. All worktree ownership checks use the provisionId binding, never
 * dirty-file path inference.
 *
 * Design: `.kiro/specs/loom-provisioning/design.md`
 */

import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { Git } from "./git.js";
import type { WorktreeRecord } from "./git.js";
import { transitionTask } from "./lifecycle.js";
import { applyRegister } from "./register.js";
import type { Registry, Session, Task } from "./registry.js";

// ─────────────────────────────────────────────────────────────────────────────
// Config (task 2.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface ProvisionConfig {
  worktreeRoot: string;
  branchTemplate: string;
  defaultBase: string;
  defaultLandMode: "merge" | "pr";
}

const CONFIG_FILE = ".loom/config.yaml";

const DEFAULTS: ProvisionConfig = {
  worktreeRoot: "..",
  branchTemplate: "{owner}/{task}",
  defaultBase: "main",
  defaultLandMode: "pr",
};

/** Load `.loom/config.yaml` provisioning section, with built-in defaults. */
export function loadProvisionConfig(cwd: string = process.cwd()): ProvisionConfig {
  const path = join(cwd, CONFIG_FILE);
  if (!existsSync(path)) {
    return resolveConfig(DEFAULTS, cwd);
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(readFileSync(path, "utf8"));
  } catch {
    return resolveConfig(DEFAULTS, cwd);
  }
  const raw = (parsed as { provisioning?: Partial<ProvisionConfig> } | null)?.provisioning ?? {};
  return resolveConfig({ ...DEFAULTS, ...raw }, cwd);
}

function resolveConfig(cfg: ProvisionConfig, cwd: string): ProvisionConfig {
  // Resolve worktreeRoot relative to cwd (the repo root).
  const worktreeRoot = resolve(cwd, cfg.worktreeRoot);
  return { ...cfg, worktreeRoot };
}

// ─────────────────────────────────────────────────────────────────────────────
// Naming (task 2.1)
// ─────────────────────────────────────────────────────────────────────────────

/** Characters forbidden in branch names and worktree paths (git constraints). */
const UNSAFE_BRANCH_LITERAL = new Set(" ~^:?*[]\\@{}&$!'\"`<>|#%()+;=,".split(""));

function hasUnsafeBranchChar(name: string): boolean {
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    // Control characters (0x00–0x1F) and DEL (0x7F) are forbidden.
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
    if (UNSAFE_BRANCH_LITERAL.has(name[i])) {
      return true;
    }
  }
  return false;
}
const RESERVED_BRANCH_PREFIXES = ["-", "."];
const RESERVED_BRANCH_SEQS = ["..", "//", "@{"];

/** Render the branch name from template + validate. Pure function. */
export function renderBranch(template: string, vars: { owner: string; task: string }): string {
  const rendered = template.replace(/\{owner\}/g, vars.owner).replace(/\{task\}/g, vars.task);
  validateBranchName(rendered);
  return rendered;
}

/** Validate a branch name against git's ref-name constraints. */
function validateBranchName(name: string): void {
  if (name.length === 0) {
    throw new ProvisionError("branch name must not be empty");
  }
  if (RESERVED_BRANCH_PREFIXES.some((p) => name.startsWith(p))) {
    throw new ProvisionError(`branch name must not start with "${name[0]}" (got: ${name})`);
  }
  if (name.endsWith(".lock") || name.endsWith(".") || name.endsWith("/")) {
    throw new ProvisionError(`branch name has forbidden suffix (got: ${name})`);
  }
  if (hasUnsafeBranchChar(name)) {
    throw new ProvisionError(`branch name contains forbidden characters (got: ${name})`);
  }
  for (const seq of RESERVED_BRANCH_SEQS) {
    if (name.includes(seq)) {
      throw new ProvisionError(`branch name contains forbidden sequence "${seq}" (got: ${name})`);
    }
  }
}

/**
 * Does the task id reference its issue number, so the branch name carries it too?
 *
 * The branch is `<owner>/<task>` and is the only durable agent identity (every IDE
 * agent commits through the same git identity), so an issue-prefixed task id is
 * what makes the branch self-describing: `cursor-agent/234-enterprise-plan`.
 *
 * This is advisory only — a `warn`, never a hard failure. Two task-id conventions
 * coexist in this repo: import-derived ownership ids (`<spec>:<agent>`, which
 * cannot be branch names at all because `:` is a forbidden ref character) and
 * provisioning slugs. Enforcing a single shape here would break the former.
 */
export function issueMatchesTaskId(taskId: string, issue: number): boolean {
  return new RegExp(`(^|[^0-9])${issue}([^0-9]|$)`).test(taskId);
}

/** Compute the worktree filesystem path. */
export function worktreePathFor(
  config: ProvisionConfig,
  task: string,
  cwd: string = process.cwd(),
): string {
  // Use the repo base name + task to form a distinct directory.
  const repoBase = basename(resolve(cwd));
  const dirName = `${repoBase}-${task}`;
  return join(config.worktreeRoot, dirName);
}

// ─────────────────────────────────────────────────────────────────────────────
// Safety judgments — pure functions (task 2.2)
// ─────────────────────────────────────────────────────────────────────────────

export class ProvisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvisionError";
  }
}

export interface WorktreeStatus {
  dirty: boolean;
  unpushed: boolean; // ahead > 0
}

/**
 * Can the worktree be safely destroyed? Property 1 (data safety).
 * Returns `true` only if the worktree is clean OR the caller has accepted force.
 */
export function canDestroy(status: WorktreeStatus, force: boolean): boolean {
  if (!status.dirty && !status.unpushed) {
    return true;
  }
  return force;
}

/**
 * Ownership check via recorded provisionId binding. Property 2+7 (no path
 * inference; the immutable binding is the identity, not the path/branch).
 */
export function ownsWorktree(session: Session, caller: { owner: string; taskId: string }): boolean {
  if (session.taskId !== caller.taskId) {
    return false;
  }
  // The session must have a provisionId binding to be considered provisioned.
  const meta = session.metadata;
  return typeof meta.provisionId === "string" && meta.provisionId.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Land result (task 4, defined here for type completeness)
// ─────────────────────────────────────────────────────────────────────────────

/** Standardized land result (R9). */
export type LandResult =
  | "SUCCESS"
  | "CONFLICTED"
  | "NON_FAST_FORWARD"
  | "DIRTY_WORKTREE"
  | "POLICY_BLOCKED";

/** Is the land result retryable after fixing the blocker? */
export function isRetryable(result: LandResult): boolean {
  return result === "CONFLICTED" || result === "NON_FAST_FORWARD" || result === "DIRTY_WORKTREE";
}

// ─────────────────────────────────────────────────────────────────────────────
// Stable binding + bounded audit trail (task 2.3)
// ─────────────────────────────────────────────────────────────────────────────

/** Max number of events to retain per session (bounded, avoids unbounded growth). */
export const MAX_EVENTS = 50;

export type ProvisionEventKind =
  | "worktree_created"
  | "branch_created"
  | "landed"
  | "abandoned"
  | "reconciled"
  | "repaired";

export interface ProvisionEvent {
  ts: string;
  kind: ProvisionEventKind;
}

/** Generate a new immutable provision binding identifier. */
export function newProvisionId(): string {
  return randomUUID();
}

/**
 * Bind a session to a provisioned worktree. Returns a new session with the
 * provisionId, branch, and worktree recorded in metadata. Pure.
 */
export function bindProvision(
  session: Session,
  binding: { provisionId: string; branch: string; worktree: string },
): Session {
  const meta = { ...session.metadata };
  meta.provisionId = binding.provisionId;
  meta.branch = binding.branch;
  return { ...session, worktree: binding.worktree, metadata: meta };
}

/**
 * Append a bounded event to the session's metadata.events[].
 * Keeps only the latest MAX_EVENTS entries. Pure.
 */
export function appendEvent(session: Session, kind: ProvisionEventKind): Session {
  const meta = { ...session.metadata };
  const existing: ProvisionEvent[] = Array.isArray(meta.events)
    ? (meta.events as ProvisionEvent[])
    : [];
  const newEvent: ProvisionEvent = { ts: new Date().toISOString(), kind };
  const updated = [...existing, newEvent].slice(-MAX_EVENTS);
  meta.events = updated;
  return { ...session, metadata: meta };
}

/**
 * Get the provisionId from a session (convenience getter).
 */
export function getProvisionId(session: Session): string | undefined {
  const meta = session.metadata;
  return typeof meta.provisionId === "string" ? meta.provisionId : undefined;
}

/**
 * Get the recorded branch from a session binding.
 */
export function getProvisionBranch(session: Session): string | undefined {
  const meta = session.metadata;
  return typeof meta.branch === "string" ? meta.branch : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconcile health findings (task 6.2 — types defined here for completeness)
// ─────────────────────────────────────────────────────────────────────────────

export type ReconcileFinding =
  | "OK"
  | "ORPHANED"
  | "MISSING_BRANCH"
  | "UNTRACKED_WORKTREE"
  | "STALE";

export type ReconcileMode = "dry" | "report" | "apply";

// ─────────────────────────────────────────────────────────────────────────────
// start orchestration (task 3.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface StartArgs {
  taskId: string;
  owner: string;
  /** GitHub issue this task implements (R2.2). Bound into the registry task. */
  issue?: number;
  from?: string;
  identity?: { name: string; email: string };
  ide?: string;
  sessionId?: string;
  dryRun?: boolean;
}

export interface StartPlan {
  branch: string;
  worktreePath: string;
  base: string;
}

export interface StartResult extends StartPlan {
  taskId: string;
  owner: string;
  issue?: number;
  provisionId: string;
  dryRun: boolean;
}

/** Pure: compute branch / worktree path / base from config + args. */
export function planStart(
  config: ProvisionConfig,
  args: { owner: string; taskId: string; from?: string },
  cwd: string = process.cwd(),
): StartPlan {
  const branch = renderBranch(config.branchTemplate, { owner: args.owner, task: args.taskId });
  const worktreePath = worktreePathFor(config, args.taskId, cwd);
  const base = args.from ?? config.defaultBase;
  return { branch, worktreePath, base };
}

/**
 * Pure: produce the registry mutation for a start (ensure task active + a
 * session bound to the provisioned worktree via provisionId, with events).
 */
export function applyStart(
  registry: Registry,
  input: {
    taskId: string;
    owner: string;
    issue?: number;
    sessionId: string;
    ide: string;
    agent: string;
    provisionId: string;
    branch: string;
    worktreePath: string;
    now?: Date;
  },
): Registry {
  const now = input.now ?? new Date();
  const next = applyRegister(registry, {
    taskId: input.taskId,
    owner: input.owner,
    issue: input.issue,
    state: "active",
    session: { id: input.sessionId, ide: input.ide, agent: input.agent, status: "active" },
    now,
  });
  return {
    ...next,
    tasks: next.tasks.map((task) => {
      if (task.id !== input.taskId) {
        return task;
      }
      return {
        ...task,
        sessions: task.sessions.map((session) => {
          if (session.id !== input.sessionId) {
            return session;
          }
          let bound = bindProvision(session, {
            provisionId: input.provisionId,
            branch: input.branch,
            worktree: input.worktreePath,
          });
          bound = appendEvent(bound, "branch_created");
          bound = appendEvent(bound, "worktree_created");
          return bound;
        }),
      };
    }),
  };
}

/** Side-effecting IO boundary for start. Injectable for testing. */
export interface StartIo {
  git: Git;
  loadRegistry: () => Registry;
  saveRegistry: (registry: Registry) => void;
  /** Defaults to fs.existsSync; injectable for tests. */
  pathExists?: (path: string) => boolean;
}

/**
 * Orchestrate `loom task start`: validate, create worktree+branch, bind in the
 * registry. Does NOT switch the caller's cwd/branch (R1.5).
 */
export function start(args: StartArgs, io: StartIo, cwd: string = process.cwd()): StartResult {
  const config = loadProvisionConfig(cwd);
  const plan = planStart(config, { owner: args.owner, taskId: args.taskId, from: args.from }, cwd);
  const pathExists = io.pathExists ?? existsSync;

  // Safety preconditions (R1.3): never overwrite an existing branch or worktree.
  if (io.git.branchExists(plan.branch, cwd)) {
    throw new ProvisionError(`branch "${plan.branch}" already exists; refusing to overwrite`);
  }
  if (pathExists(plan.worktreePath)) {
    throw new ProvisionError(
      `worktree path "${plan.worktreePath}" already exists; refusing to overwrite`,
    );
  }

  const provisionId = newProvisionId();
  const result: StartResult = {
    ...plan,
    taskId: args.taskId,
    owner: args.owner,
    issue: args.issue,
    provisionId,
    dryRun: Boolean(args.dryRun),
  };
  if (args.dryRun) {
    return result;
  }

  // Side effects: create the worktree + branch, then record the binding.
  io.git.worktreeAdd(plan.worktreePath, plan.branch, plan.base, { cwd });
  if (args.identity) {
    io.git.setIdentity(args.identity.name, args.identity.email, plan.worktreePath);
  }
  // Record the canonical (realpath) worktree location so it matches git's own
  // view (e.g. macOS /var -> /private/var) for later list/land/abandon/reconcile.
  const recordedWorktree = realpathOrResolve(plan.worktreePath);
  result.worktreePath = recordedWorktree;
  const registry = io.loadRegistry();
  const next = applyStart(registry, {
    taskId: args.taskId,
    owner: args.owner,
    issue: args.issue,
    sessionId: args.sessionId ?? `${args.owner}:${args.taskId}`,
    ide: args.ide ?? "cli",
    agent: args.owner,
    provisionId,
    branch: plan.branch,
    worktreePath: recordedWorktree,
  });
  io.saveRegistry(next);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// land lock (R9.6) — file-based, cross-process, with stale cleanup
// ─────────────────────────────────────────────────────────────────────────────

/** Stale-lock threshold: a lock older than this (and whose pid is gone) is reclaimed. */
export const LOCK_STALE_MS = 60 * 60 * 1000;

export interface LandLock {
  release: () => void;
}

function lockNameOf(taskId: string): string {
  return taskId.replace(/[^A-Za-z0-9._-]/g, "_");
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH = no such process; EPERM = exists but not ours (still alive).
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Acquire an exclusive land lock for a task (R9.6). Serializes concurrent /
 * repeated land so prepare/finalize retries cannot fire duplicate PR/merge.
 * Reclaims a stale lock (dead pid or older than LOCK_STALE_MS).
 */
export function acquireLandLock(taskId: string, cwd: string = process.cwd()): LandLock {
  const dir = join(cwd, ".loom", ".locks");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${lockNameOf(taskId)}.lock`);

  if (existsSync(path)) {
    let stale = false;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { pid?: number; ts?: number };
      const ageOk = typeof raw.ts === "number" && Date.now() - raw.ts <= LOCK_STALE_MS;
      const pidOk = typeof raw.pid === "number" && pidAlive(raw.pid);
      stale = !(ageOk && pidOk);
    } catch {
      stale = true; // unreadable lock is treated as stale
    }
    if (stale) {
      rmSync(path, { force: true });
    }
  }

  let fd: number;
  try {
    fd = openSync(path, "wx"); // exclusive create; fails if a live lock exists
  } catch {
    throw new ProvisionError(`task "${taskId}" already has a land in progress (lock: ${path})`);
  }
  writeFileSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now() }));
  closeSync(fd);
  return {
    release: () => {
      try {
        rmSync(path, { force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// land orchestration (tasks 4.1 prepare / 4.2 finalize)
// ─────────────────────────────────────────────────────────────────────────────

export interface LandArgs {
  taskId: string;
  owner: string;
  mode?: "merge" | "pr";
  keepBranch?: boolean;
  dryRun?: boolean;
}

export interface LandOutcome {
  result: LandResult;
  taskId: string;
  branch?: string;
  worktreePath?: string;
  mode: "merge" | "pr";
  dryRun: boolean;
  detail?: string;
}

/** Locate the caller-owned, provisioned session for a task (by provisionId binding). */
export function findProvisionedSession(
  registry: Registry,
  caller: { owner: string; taskId: string },
): { task: Task; session: Session } | undefined {
  const task = registry.tasks.find((t) => t.id === caller.taskId);
  if (!task) {
    return undefined;
  }
  const session = task.sessions.find((s) => ownsWorktree(s, caller));
  return session ? { task, session } : undefined;
}

/** Pure: transition a task to landed (via ready if needed) and record the event. */
export function applyLanded(registry: Registry, taskId: string, now: Date = new Date()): Registry {
  return {
    ...registry,
    tasks: registry.tasks.map((task) => {
      if (task.id !== taskId) {
        return task;
      }
      let next = task.state === "ready" ? task : transitionTask(task, "ready", now);
      next = transitionTask(next, "landed", now);
      next = {
        ...next,
        sessions: next.sessions.map((s) => appendEvent(s, "landed")),
      };
      return next;
    }),
  };
}

/** Pure: transition a task to abandoned and record the event. */
export function applyAbandoned(
  registry: Registry,
  taskId: string,
  now: Date = new Date(),
): Registry {
  return {
    ...registry,
    tasks: registry.tasks.map((task) => {
      if (task.id !== taskId) {
        return task;
      }
      const next = transitionTask(task, "abandoned", now);
      return { ...next, sessions: next.sessions.map((s) => appendEvent(s, "abandoned")) };
    }),
  };
}

export interface LandIo {
  git: Git;
  loadRegistry: () => Registry;
  saveRegistry: (registry: Registry) => void;
  /** Policy/audit gate run on the worktree; false => POLICY_BLOCKED. Default: pass. */
  runGate?: (worktreePath: string) => boolean;
  /** Open a PR for a pushed branch (mode=pr). Wired to `gh` in the CLI. */
  prCreate?: (branch: string, worktreePath: string) => void;
  /** Lock acquisition; default = file-based acquireLandLock. Injectable for tests. */
  acquireLock?: (taskId: string) => LandLock;
}

/**
 * Orchestrate `loom task land` as two phases (R9.3/R9.4):
 *  - prepare (reversible): lock, locate, dirty guard, policy gate, rebase preview
 *  - finalize (irreversible): merge/pr, registry landed, GC, release lock
 * Returns a standardized LandResult; never leaves a "landed-but-not-integrated"
 * inconsistency (registry write happens after irreversible integration).
 */
export function land(args: LandArgs, io: LandIo, cwd: string = process.cwd()): LandOutcome {
  const config = loadProvisionConfig(cwd);
  const mode = args.mode ?? config.defaultLandMode;
  const caller = { owner: args.owner, taskId: args.taskId };
  const found = findProvisionedSession(io.loadRegistry(), caller);
  if (!found) {
    throw new ProvisionError(
      `no provisioned worktree for task "${args.taskId}" owned by "${args.owner}"`,
    );
  }
  const branch = getProvisionBranch(found.session);
  const worktreePath = found.session.worktree;
  if (!branch || !worktreePath) {
    throw new ProvisionError(`task "${args.taskId}" session is missing branch/worktree binding`);
  }
  const base = config.defaultBase;
  const outcome = (result: LandResult, detail?: string): LandOutcome => ({
    result,
    taskId: args.taskId,
    branch,
    worktreePath,
    mode,
    dryRun: Boolean(args.dryRun),
    detail,
  });

  const acquire = io.acquireLock ?? ((taskId: string) => acquireLandLock(taskId, cwd));
  const lock = args.dryRun ? { release: () => {} } : acquire(args.taskId);
  try {
    // ── Phase 1: prepare (reversible) ──────────────────────────────────────
    if (io.git.isDirty(worktreePath)) {
      return outcome("DIRTY_WORKTREE", "commit or discard changes before landing");
    }
    const gate = io.runGate ?? (() => true);
    if (!gate(worktreePath)) {
      return outcome("POLICY_BLOCKED", "attribution/audit gate failed");
    }
    if (args.dryRun) {
      return outcome("SUCCESS", "[dry-run] prepare checks passed; finalize skipped");
    }
    // Best-effort: refresh the base from origin. A missing remote / offline must
    // not block a local rebase+merge (the rebase below is onto the local base).
    try {
      io.git.fetch("origin", worktreePath);
    } catch {
      /* offline or no remote: proceed with the local base */
    }
    const rebase = io.git.rebase(base, worktreePath);
    if (rebase.status !== 0) {
      io.git.rebaseAbort(worktreePath);
      return outcome("CONFLICTED", `rebase onto ${base} conflicted`);
    }

    // ── Phase 2: finalize (irreversible) ───────────────────────────────────
    if (mode === "merge") {
      try {
        // Integrate into the default branch from the main worktree (cwd).
        io.git.mergeFfOnly(branch, cwd);
      } catch {
        return outcome("NON_FAST_FORWARD", `${base} moved; ff-only merge failed, retry`);
      }
    } else {
      io.git.push(branch, { setUpstream: true, cwd: worktreePath });
      io.prCreate?.(branch, worktreePath);
    }

    // Registry write only AFTER successful integration (R9.4 atomicity).
    io.saveRegistry(applyLanded(io.loadRegistry(), args.taskId));

    // GC the worktree (caller already confirmed clean above).
    removeWorktree(io.git, worktreePath, false, cwd);
    if (!args.keepBranch && mode === "merge") {
      io.git.deleteBranchRef(branch, cwd);
    }
    return outcome("SUCCESS");
  } finally {
    lock.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// abandon orchestration (task 5.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface AbandonArgs {
  taskId: string;
  owner: string;
  force?: boolean;
  /** Secondary confirmation required to discard uncommitted/unpushed work. */
  yes?: boolean;
  deleteBranch?: boolean;
  dryRun?: boolean;
}

export interface LossSummary {
  dirty: boolean;
  unpushed: boolean;
  ahead: number;
}

export interface AbandonOutcome {
  taskId: string;
  branch?: string;
  worktreePath?: string;
  removed: boolean;
  dryRun: boolean;
  blocked?: "dirty" | "unpushed";
  /** Set when a forced destructive abandon needs a secondary --yes confirmation. */
  needsConfirm?: boolean;
  /** What would be lost on a forced removal (printed before destruction). */
  lossSummary?: LossSummary;
}

export interface AbandonIo {
  git: Git;
  loadRegistry: () => Registry;
  saveRegistry: (registry: Registry) => void;
}

/**
 * Orchestrate `loom task abandon`: refuse to discard uncommitted/unpushed work
 * unless --force (Property 1); never touches another agent's worktree
 * (Property 2/7). Branch is kept unless --delete-branch.
 */
export function abandon(
  args: AbandonArgs,
  io: AbandonIo,
  cwd: string = process.cwd(),
): AbandonOutcome {
  const config = loadProvisionConfig(cwd);
  const caller = { owner: args.owner, taskId: args.taskId };
  const found = findProvisionedSession(io.loadRegistry(), caller);
  if (!found) {
    throw new ProvisionError(
      `no provisioned worktree for task "${args.taskId}" owned by "${args.owner}"`,
    );
  }
  const branch = getProvisionBranch(found.session);
  const worktreePath = found.session.worktree;
  if (!branch || !worktreePath) {
    throw new ProvisionError(`task "${args.taskId}" session is missing branch/worktree binding`);
  }

  const dirty = io.git.isDirty(worktreePath);
  const ahead = branch ? io.git.aheadBehind(branch, config.defaultBase, worktreePath).ahead : 0;
  const unpushed = ahead > 0;

  const base: AbandonOutcome = {
    taskId: args.taskId,
    branch,
    worktreePath,
    removed: false,
    dryRun: Boolean(args.dryRun),
  };

  // Clean worktree: safe to remove without --force.
  if (!dirty && !unpushed) {
    if (args.dryRun) {
      return base;
    }
    removeWorktree(io.git, worktreePath, false, cwd);
    if (args.deleteBranch) {
      io.git.deleteBranchRef(branch, cwd);
    }
    io.saveRegistry(applyAbandoned(io.loadRegistry(), args.taskId));
    return { ...base, removed: true };
  }

  // Dirty/unpushed: destructive. Refuse without --force (Property 1)...
  const lossSummary: LossSummary = { dirty, unpushed, ahead };
  // canDestroy is the single destroy gate (A1.4): clean OR explicitly forced.
  if (!canDestroy({ dirty, unpushed }, Boolean(args.force))) {
    return { ...base, blocked: dirty ? "dirty" : "unpushed", lossSummary };
  }
  // Even with --force, require a secondary --yes confirmation (R3.2),
  // always surfacing the loss summary first.
  if (!args.yes) {
    return { ...base, needsConfirm: true, lossSummary };
  }
  if (args.dryRun) {
    return { ...base, lossSummary }; // would force-remove; no side effects
  }

  removeWorktree(io.git, worktreePath, true, cwd);
  if (args.deleteBranch) {
    io.git.deleteBranchRef(branch, cwd);
  }
  io.saveRegistry(applyAbandoned(io.loadRegistry(), args.taskId));
  return { ...base, removed: true, lossSummary };
}

// ─────────────────────────────────────────────────────────────────────────────
// list + reconcile/repair (tasks 6.1, 6.2)
// ─────────────────────────────────────────────────────────────────────────────

export interface ReconcileRow {
  taskId: string;
  owner: string;
  branch?: string;
  worktreePath?: string;
  finding: ReconcileFinding;
}

/**
 * Pure: reconcile registry bindings against the actual git worktrees. Registry
 * is the canonical source of truth; git/worktree are projections. Findings are
 * derived health states, NOT persisted TaskState (R8.1/R8.3).
 */
export function computeReconcile(
  registry: Registry,
  worktrees: WorktreeRecord[],
  opts: {
    cwd: string;
    branchExists: (branch: string) => boolean;
    normalize?: (p: string) => string;
    pathExists?: (p: string) => boolean;
  },
): ReconcileRow[] {
  const rows: ReconcileRow[] = [];
  const norm = opts.normalize ?? ((p: string) => resolve(p));
  const onDisk = opts.pathExists ?? ((p: string) => existsSync(p));
  const mainPath = norm(opts.cwd);
  const recorded = new Set<string>();

  for (const task of registry.tasks) {
    for (const session of task.sessions) {
      const provisionId = getProvisionId(session);
      if (!provisionId || !session.worktree) {
        continue;
      }
      const wtPath = norm(session.worktree);
      recorded.add(wtPath);
      const branch = getProvisionBranch(session);
      let finding: ReconcileFinding;
      if (!onDisk(session.worktree)) {
        // Directory gone (git may still list a stale entry until prune).
        finding = "ORPHANED";
      } else if (branch && !opts.branchExists(branch)) {
        finding = "MISSING_BRANCH";
      } else if (task.state === "landed" || task.state === "abandoned") {
        finding = "STALE";
      } else {
        finding = "OK";
      }
      rows.push({
        taskId: task.id,
        owner: task.owner,
        branch,
        worktreePath: session.worktree,
        finding,
      });
    }
  }

  // Untracked: a real, on-disk git worktree (not the main one) with no binding.
  for (const w of worktrees) {
    const p = norm(w.path);
    if (p === mainPath || w.bare || !onDisk(w.path)) {
      continue;
    }
    if (!recorded.has(p)) {
      rows.push({
        taskId: "(untracked)",
        owner: "?",
        branch: w.branch,
        worktreePath: w.path,
        finding: "UNTRACKED_WORKTREE",
      });
    }
  }
  return rows;
}

/** Pure: append a provision event to every session of a task. */
function appendEventToTask(registry: Registry, taskId: string, kind: ProvisionEventKind): Registry {
  return {
    ...registry,
    tasks: registry.tasks.map((task) =>
      task.id === taskId
        ? { ...task, sessions: task.sessions.map((s) => appendEvent(s, kind)) }
        : task,
    ),
  };
}

/** Resolve a path to its canonical realpath, falling back to logical resolve. */
function realpathOrResolve(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/**
 * Remove a worktree robustly. `git worktree remove` (git >= 2.17) is preferred;
 * on older git it is unavailable, so fall back to deleting the directory, then
 * always prune the administrative entry.
 */
function removeWorktree(git: Git, path: string, force: boolean, cwd: string): void {
  try {
    git.worktreeRemove(path, { force, cwd });
  } catch {
    rmSync(path, { recursive: true, force: true });
  }
  git.worktreePrune(cwd);
}

export interface ReconcileArgs {
  taskId?: string;
  mode?: ReconcileMode; // default "report"
}

export interface ReconcileReport {
  mode: ReconcileMode;
  rows: ReconcileRow[];
  repaired: { taskId: string; action: string }[];
}

export interface ReconcileIo {
  git: Git;
  loadRegistry: () => Registry;
  saveRegistry: (registry: Registry) => void;
}

/**
 * `loom task reconcile`. Default mode is `report` (read-only). `dry` lists the
 * repairs that WOULD run. Only `apply` mutates — and only the non-destructive
 * repair (recreate an ORPHANED worktree from its still-existing branch); other
 * findings are reported for human action (R8.2/R8.4). reconcile is NEVER a
 * silent mutation engine.
 */
export function reconcile(
  args: ReconcileArgs,
  io: ReconcileIo,
  cwd: string = process.cwd(),
): ReconcileReport {
  const mode = args.mode ?? "report";
  const registry = io.loadRegistry();
  const worktrees = io.git.worktreeList(cwd);
  let rows = computeReconcile(registry, worktrees, {
    cwd,
    branchExists: (branch) => io.git.branchExists(branch, cwd),
    normalize: realpathOrResolve,
  });
  if (args.taskId) {
    rows = rows.filter((row) => row.taskId === args.taskId);
  }

  const repaired: { taskId: string; action: string }[] = [];
  if (mode === "apply") {
    let next = registry;
    for (const row of rows) {
      // Only the data-safe repair is automated: recreate an orphaned worktree
      // from its branch (no data loss). Everything else is human-reviewed.
      if (
        row.finding === "ORPHANED" &&
        row.branch &&
        row.worktreePath &&
        io.git.branchExists(row.branch, cwd)
      ) {
        io.git.worktreePrune(cwd); // clear any stale admin entry first
        io.git.worktreeAddExisting(row.worktreePath, row.branch, { cwd });
        next = appendEventToTask(next, row.taskId, "repaired");
        repaired.push({ taskId: row.taskId, action: "recreated worktree from branch" });
      }
    }
    if (repaired.length > 0) {
      io.saveRegistry(next);
    }
  }
  return { mode, rows, repaired };
}

// ── list ─────────────────────────────────────────────────────────────────────

export interface TaskListRow {
  taskId: string;
  owner: string;
  branch?: string;
  worktreePath?: string;
  state?: Task["state"];
  finding: ReconcileFinding;
  dirty: boolean;
  ahead: number;
  behind: number;
}

export interface TaskListIo {
  git: Git;
  loadRegistry: () => Registry;
  /** Existence check (default fs.existsSync); injectable for tests. */
  pathExists?: (p: string) => boolean;
}

/** `loom task list`: reconcile rows augmented with dirty / ahead-behind. */
export function taskList(io: TaskListIo, cwd: string = process.cwd()): TaskListRow[] {
  const config = loadProvisionConfig(cwd);
  const registry = io.loadRegistry();
  const worktrees = io.git.worktreeList(cwd);
  const rows = computeReconcile(registry, worktrees, {
    cwd,
    branchExists: (branch) => io.git.branchExists(branch, cwd),
    normalize: realpathOrResolve,
    pathExists: io.pathExists,
  });
  const stateByTask = new Map(registry.tasks.map((t) => [t.id, t.state]));
  return rows.map((row) => {
    const present = row.finding !== "ORPHANED";
    let dirty = false;
    let ahead = 0;
    let behind = 0;
    if (present && row.worktreePath) {
      dirty = io.git.isDirty(row.worktreePath);
      if (row.branch) {
        const ab = io.git.aheadBehind(row.branch, config.defaultBase, row.worktreePath);
        ahead = ab.ahead;
        behind = ab.behind;
      }
    }
    return {
      taskId: row.taskId,
      owner: row.owner,
      branch: row.branch,
      worktreePath: row.worktreePath,
      state: stateByTask.get(row.taskId),
      finding: row.finding,
      dirty,
      ahead,
      behind,
    };
  });
}
