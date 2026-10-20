/**
 * register.ts — create/update ownership tasks and sessions (Requirement 1.1,
 * 3.1, 10.1). Pure `applyRegister` (testable); CLI wiring lives in loom.ts.
 *
 * Any successful write refreshes the touched session's `lastSignalAt`, closing
 * the `dead`-detection loop (design §3.8). State changes go through the
 * lifecycle state machine (validated transitions).
 */

import { transitionTask, touchSignal } from "./lifecycle.js";
import type { Registry, SessionStatus, Task, TaskState } from "./registry.js";

export type RegisterSession = {
  id: string;
  ide: string;
  agent: string;
  status?: SessionStatus;
  /** Optional session metadata (e.g. worktree, branch, provisionId); merged, not replaced. */
  metadata?: Record<string, unknown>;
};

export type RegisterOptions = {
  taskId: string;
  owner?: string;
  /** GitHub issue this task implements (the intent → code → release join key, R2.2). */
  issue?: number;
  intent?: string[];
  paths?: string[];
  state?: TaskState;
  session?: RegisterSession;
  /** How a takeover was authorized (verify-then-take vs system-prompted confirm). */
  via?: "verified" | "confirmed";
  now?: Date;
};

/** Order-preserving set union (dedup); intent/paths stay stable across re-registers. */
function unionInto(existing: string[], incoming: string[]): string[] {
  return [...new Set([...existing, ...incoming])];
}

/**
 * Transfer task ownership to a new accountable executor, recording the outgoing
 * owner in `ownerHistory` for accountability (追责). `owner` stays single-valued
 * — exactly one accountable executor at any time. No-op when owner is unchanged,
 * so ownership never changes silently without leaving an audit entry.
 */
function applyOwnershipTransfer(
  task: Task,
  newOwner: string,
  via: "verified" | "confirmed",
  now: Date,
): Task {
  if (newOwner === task.owner) {
    return task;
  }
  return {
    ...task,
    ownerHistory: [
      ...task.ownerHistory,
      { fromOwner: task.owner, toOwner: newOwner, at: now.toISOString(), via },
    ],
    owner: newOwner,
  };
}

/**
 * Bind the task to a GitHub issue (R2.2). Idempotent when the issue is unchanged.
 *
 * Re-pointing an already-bound task at a DIFFERENT issue is refused: the whole
 * value of the field is that a landed commit can be traced to the requirement it
 * implements, and silently swapping that target rewrites history for every commit
 * already made under the task. The correct move is a new task, which is also what
 * "one task = one issue" means for the minimal governance unit.
 */
function applyIssueBinding(task: Task, issue: number): Task {
  if (task.issue === issue) {
    return task;
  }
  if (task.issue != null) {
    throw new Error(
      `Task "${task.id}" is already bound to issue #${task.issue}; refusing to rebind to #${issue}. ` +
        `Traceability would break for commits already made under this task — create a new task instead.`,
    );
  }
  return { ...task, issue };
}

function upsertSession(task: Task, input: RegisterSession, now: Date): Task {
  const index = task.sessions.findIndex((s) => s.id === input.id);
  const sessions =
    index >= 0
      ? task.sessions.map((s, i) =>
          i === index
            ? touchSignal(
                {
                  ...s,
                  ide: input.ide,
                  agent: input.agent,
                  status: input.status ?? s.status,
                  // merge, never clobber: keep prior worktree/branch/provisionId etc.
                  metadata: { ...s.metadata, ...input.metadata },
                },
                now,
              )
            : s,
        )
      : [
          ...task.sessions,
          touchSignal(
            {
              id: input.id,
              taskId: task.id,
              ide: input.ide,
              agent: input.agent,
              status: input.status ?? "active",
              metadata: input.metadata ?? {},
            },
            now,
          ),
        ];
  return { ...task, sessions };
}

/** Refresh every session's activity signal (any successful write is a signal). */
function touchAllSessions(task: Task, now: Date): Task {
  if (task.sessions.length === 0) {
    return task;
  }
  return { ...task, sessions: task.sessions.map((s) => touchSignal(s, now)) };
}

/**
 * Apply a register operation, returning a NEW registry. Creating a task
 * requires an owner; updating merges intent/paths (additive) and validates any
 * state change through the lifecycle machine. Any successful write refreshes
 * the task's sessions' `lastSignalAt` (closes the dead-detection loop, R10.3).
 */
export function applyRegister(registry: Registry, opts: RegisterOptions): Registry {
  const now = opts.now ?? new Date();
  const index = registry.tasks.findIndex((t) => t.id === opts.taskId);

  if (index < 0) {
    if (!opts.owner) {
      throw new Error(`Cannot create task "${opts.taskId}" without --owner.`);
    }
    let task: Task = {
      id: opts.taskId,
      owner: opts.owner,
      issue: opts.issue,
      intent: opts.intent ?? [],
      paths: opts.paths ?? [],
      state: opts.state ?? "active",
      sessions: [],
      ownerHistory: [],
      since: now.toISOString().slice(0, 10),
      metadata: {},
    };
    if (opts.session) {
      task = upsertSession(task, opts.session, now);
    }
    task = touchAllSessions(task, now);
    return { ...registry, tasks: [...registry.tasks, task] };
  }

  let task = registry.tasks[index];
  if (opts.owner) {
    task = applyOwnershipTransfer(task, opts.owner, opts.via ?? "confirmed", now);
  }
  if (opts.issue != null) {
    task = applyIssueBinding(task, opts.issue);
  }
  if (opts.intent) {
    task = { ...task, intent: unionInto(task.intent, opts.intent) };
  }
  if (opts.paths) {
    task = { ...task, paths: unionInto(task.paths, opts.paths) };
  }
  if (opts.state && opts.state !== task.state) {
    task = transitionTask(task, opts.state, now); // validated; throws on illegal
  }
  if (opts.session) {
    task = upsertSession(task, opts.session, now);
  }
  task = touchAllSessions(task, now);
  const tasks = registry.tasks.map((t, i) => (i === index ? task : t));
  return { ...registry, tasks };
}
