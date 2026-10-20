/**
 * glob.ts — shared path-glob matching + `git status` parsing for Loom core.
 *
 * Extracted verbatim from `scripts/agent-attribution.ts` so attribution, audit,
 * and learn share ONE implementation (Requirement 2.4: glob semantics must stay
 * identical to the legacy behavior). Do not fork these semantics.
 */

import { execFileSync } from "node:child_process";

export type StatusEntry = {
  xy: string;
  path: string;
  /** Rename/copy source path (porcelain `-z` emits it after the new path). */
  originalPath?: string;
};

export type StatusKind = "modified" | "added" | "deleted" | "renamed" | "untracked";

/**
 * Translate a path glob (`a/**`, `a/*.ts`, `a/foo*`) into an anchored RegExp.
 *
 * Semantics (kept identical to legacy `agent-attribution.ts`):
 * - `**` matches across path separators (`.*`), and a trailing `/` after `**`
 *   is swallowed so `a/**` matches both `a/x` and `a/`.
 * - a single `*` matches within one segment (`[^/]*`).
 * - regex metacharacters are escaped.
 */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i += 1;
        // swallow a trailing slash after ** so `a/**` matches `a/x` and `a/`
        if (glob[i + 1] === "/") {
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (".+?^${}()|[]\\".includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return new RegExp(`^${out}$`);
}

/** True if `path` matches any of the given globs. */
export function matchesAnyGlob(path: string, regexps: RegExp[]): boolean {
  return regexps.some((re) => re.test(path));
}

/** Literal prefix of a glob (everything before the first wildcard). */
export function literalPrefix(glob: string): string {
  const star = glob.indexOf("*");
  return star < 0 ? glob : glob.slice(0, star);
}

/**
 * Heuristic glob-overlap check: two globs overlap if their literal prefixes are
 * in a prefix relationship. Catches real nested overlaps like `src/**` vs
 * `src/auth/**` (and identical globs), not just byte-identical strings.
 */
export function globsOverlap(a: string, b: string): boolean {
  const pa = literalPrefix(a);
  const pb = literalPrefix(b);
  return pa.startsWith(pb) || pb.startsWith(pa);
}

/** Parse `git status --porcelain=v1 -z` output into status entries. */
export function parseStatus(output: Buffer | string): StatusEntry[] {
  const text = typeof output === "string" ? output : output.toString("utf8");
  const tokens = text.split("\0");
  const entries: StatusEntry[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    const xy = token.slice(0, 2);
    const path = token.slice(3);
    if (xy.includes("R") || xy.includes("C")) {
      // rename/copy: the destination path is what matters; the original path
      // is the following NUL-separated token.
      const originalPath = tokens[index + 1] || undefined;
      entries.push({ xy, path, originalPath });
      index += 1;
      continue;
    }
    entries.push({ xy, path });
  }
  return entries;
}

/** Classify a status XY code into a coarse kind. */
export function statusKind(xy: string): StatusKind {
  if (xy === "??") {
    return "untracked";
  }
  if (xy.includes("D")) {
    return "deleted";
  }
  if (xy.includes("A")) {
    return "added";
  }
  if (xy.includes("R")) {
    return "renamed";
  }
  return "modified";
}

/** Read the dirty working tree via `git status --porcelain=v1 -z`. */
export function loadDirtyStatus(cwd: string = process.cwd()): StatusEntry[] {
  const output = execFileSync("git", ["status", "--porcelain=v1", "-z"], { cwd });
  return parseStatus(output);
}

/** Read staged file paths via `git diff --cached --name-only -z`. */
export function loadStagedFiles(cwd: string = process.cwd()): string[] {
  const output = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
    { cwd },
  );
  return output.toString("utf8").split("\0").filter(Boolean);
}
