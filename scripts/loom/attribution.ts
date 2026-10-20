/**
 * attribution.ts — map dirty working-tree files to the task/owner that owns them.
 *
 * Reads ONLY the Registry (Requirement 2.1). Ownership is decided purely by
 * `task.paths` (HARD signal); `task.intent` is never consulted (Requirement 9.2,
 * Architecture Rule #1). Verdict semantics are kept identical to the legacy
 * `agent-attribution.ts`: 0 matches = UNATTRIBUTED, 1 = attributed, >1 = CONFLICT.
 */

import { globToRegExp, type StatusEntry, statusKind, type StatusKind } from "./glob.js";
import { type Registry, resolveLander, type SharedPath, type Task } from "./registry.js";

export type AttributionOwner = {
  taskId: string;
  owner: string;
};

/** A shared-path registration plus the lander resolved at read time. */
export type SharedBinding = {
  shared: SharedPath;
  /** Current owner of `shared.landerTask`; undefined when the reference dangles. */
  lander?: string;
};

export type Attribution = {
  path: string;
  status: StatusKind;
  owners: AttributionOwner[];
  /**
   * The `sharedPaths` registration covering this path, when one exists. Present
   * regardless of how many tasks matched — it is information, not a verdict. The
   * verdict only changes when it actually resolves something (owners > 1).
   */
  shared?: SharedBinding;
};

/**
 * SHARED = several tasks legitimately claim this path AND the path is registered
 * in `sharedPaths` with a designated lander. It is NOT a weaker CONFLICT: the
 * ownership question has an answer (`shared.lander`), which is the whole point.
 */
export type AttributionVerdict = "ATTRIBUTED" | "UNATTRIBUTED" | "CONFLICT" | "SHARED";

export type TaskMatcher = {
  task: Task;
  regexps: RegExp[];
};

export type SharedMatcher = {
  shared: SharedPath;
  regexp: RegExp;
};

/**
 * Terminal lifecycle states (see `lifecycle.ts` TASK_TRANSITIONS). A task in a
 * terminal state is finished, so it must stop claiming paths: otherwise the
 * registry only ever accumulates and every landed task keeps inflating CONFLICT
 * on the shared files it once touched (R10, R13).
 */
export const TERMINAL_TASK_STATES = new Set<Task["state"]>(["landed", "abandoned"]);

export type AttributionOptions = {
  /** Include terminal-state tasks (parity/history views only; default false). */
  includeTerminal?: boolean;
};

/**
 * Precompile each task's path globs into anchored regexps. Terminal-state tasks
 * are skipped unless `includeTerminal` is set, so closing a task actually frees
 * its paths.
 */
export function buildTaskMatchers(
  registry: Registry,
  options: AttributionOptions = {},
): TaskMatcher[] {
  const tasks = options.includeTerminal
    ? registry.tasks
    : registry.tasks.filter((task) => !TERMINAL_TASK_STATES.has(task.state));
  return tasks.map((task) => ({
    task,
    regexps: task.paths.map(globToRegExp),
  }));
}

/**
 * Precompile `sharedPaths` globs. Declaration order is preserved because the
 * FIRST declared match wins — the same convention `landingStreams` classification
 * already uses, so there is only one ordering rule to remember.
 */
export function buildSharedMatchers(registry: Registry): SharedMatcher[] {
  return registry.sharedPaths.map((shared) => ({ shared, regexp: globToRegExp(shared.glob) }));
}

/** Resolve the registration covering a path (first declared match), with its lander. */
export function sharedFor(
  registry: Registry,
  matchers: SharedMatcher[],
  path: string,
): SharedBinding | undefined {
  const hit = matchers.find((matcher) => matcher.regexp.test(path));
  if (!hit) {
    return undefined;
  }
  return { shared: hit.shared, lander: resolveLander(registry, hit.shared) };
}

/** Attribute each dirty entry to the set of tasks whose paths match it. */
export function attribute(
  registry: Registry,
  entries: StatusEntry[],
  options: AttributionOptions = {},
): Attribution[] {
  const matchers = buildTaskMatchers(registry, options);
  const sharedMatchers = buildSharedMatchers(registry);
  return entries.map((entry) => {
    const owners = matchers
      .filter((matcher) => matcher.regexps.some((re) => re.test(entry.path)))
      .map((matcher) => ({ taskId: matcher.task.id, owner: matcher.task.owner }));
    const shared = sharedFor(registry, sharedMatchers, entry.path);
    const result: Attribution = { path: entry.path, status: statusKind(entry.xy), owners };
    if (shared) {
      result.shared = shared;
    }
    return result;
  });
}

/**
 * Classify a single attribution result.
 *
 * A shared registration only changes the verdict when there is actually an
 * overlap to resolve. One matching task means ownership is already unambiguous,
 * so the verdict stays ATTRIBUTED even on a registered path — registering a path
 * must never dilute a clear single owner. Zero matches stays UNATTRIBUTED for the
 * same reason: a lander is not an owner, and inventing one would hide the fact
 * that nobody signed in.
 */
export function verdictOf(result: Attribution): AttributionVerdict {
  if (result.owners.length === 0) {
    return "UNATTRIBUTED";
  }
  if (result.owners.length > 1) {
    return result.shared ? "SHARED" : "CONFLICT";
  }
  return "ATTRIBUTED";
}

export type AttributionSummary = {
  total: number;
  attributed: number;
  unattributed: number;
  conflict: number;
  shared: number;
};

export function summarize(results: Attribution[]): AttributionSummary {
  let attributed = 0;
  let unattributed = 0;
  let conflict = 0;
  let shared = 0;
  for (const result of results) {
    const verdict = verdictOf(result);
    if (verdict === "UNATTRIBUTED") {
      unattributed += 1;
    } else if (verdict === "CONFLICT") {
      conflict += 1;
    } else if (verdict === "SHARED") {
      shared += 1;
    } else {
      attributed += 1;
    }
  }
  return { total: results.length, attributed, unattributed, conflict, shared };
}
