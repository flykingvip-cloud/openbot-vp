/**
 * claim.ts — sign-in helpers for the "agent didn't sign in" gap (Requirement
 * 1.x / 2.x). Pure logic; git I/O + writes live in the CLI.
 *
 * Rationale: uncommitted edits have no git author, so the WHOLE dirty tree
 * cannot be attributed centrally. Sign-in belongs at the COMMIT boundary, keyed
 * to the committing agent. `loom claim` is the one-step sign-in; `loom
 * unattributed` is the triage report.
 */

import { globToRegExp } from "./glob.js";
import type { Registry } from "./registry.js";

/** Files not matched by any task's `paths` (i.e. no agent has signed in for them). */
export function findUnattributedPaths(registry: Registry, paths: string[]): string[] {
  const taskMatchers = registry.tasks.map((task) => task.paths.map(globToRegExp));
  return paths.filter(
    (path) => !taskMatchers.some((regexps) => regexps.some((re) => re.test(path))),
  );
}

/** Group paths by parent directory for a compact triage view. */
export function groupByDir(paths: string[]): Map<string, string[]> {
  const byDir = new Map<string, string[]>();
  for (const path of paths) {
    const slash = path.lastIndexOf("/");
    const dir = slash < 0 ? "." : path.slice(0, slash);
    const bucket = byDir.get(dir) ?? [];
    bucket.push(path);
    byDir.set(dir, bucket);
  }
  return byDir;
}

/** The default catch-all ownership task id for an agent's sign-in. */
export function claimTaskId(owner: string): string {
  return `agent:${owner}`;
}
