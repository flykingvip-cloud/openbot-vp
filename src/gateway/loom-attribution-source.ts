/**
 * loom-attribution-source.ts — gateway-side, compile-time Loom attribution
 * resolver for Fabric Stage-2 (openbot-fabric M4).
 *
 * This is the BOOTSTRAP adapter that turns the Loom registry (`.loom/registry.yaml`)
 * into the stable `LoomAttribution` shape Fabric consumes. It lives in `src/gateway`
 * (NOT `src/fabric`) and reads the registry ONCE at construction, caching a
 * path-glob → owner matcher in memory. Per-request resolution is a pure in-memory
 * match — there is NO runtime registry lookup and NO `src → scripts` coupling
 * (D2/D4): we parse the YAML directly here rather than importing `scripts/loom`.
 *
 * Attribution basis = the registry task `paths` (the documented HARD ownership
 * signal). A request's candidate paths (its `cwd` + path-like args, relativized
 * to the repo root) are matched against every task's globs:
 *   - exactly one owner matched  → `{ owner, taskId, matchedRules }`
 *   - more than one owner matched → `{ conflict: true }`
 *   - no owner matched           → `{ unattributed: true }`
 *
 * In a production install there is usually no `.loom/registry.yaml`; the loader
 * then returns `null` and Fabric simply runs with no Stage-2 signal (neutral,
 * zero behavior change).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { ToolRequest } from "../fabric/contract.js";
import type { LoomAttribution } from "../fabric/mappers.js";

interface RegistryTaskView {
  id: string;
  owner: string;
  spec?: string;
  matchers: RegExp[];
}

/** Translate a registry path glob (`**`, `*`, exact) into an anchored RegExp. */
export function loomGlobToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++; // consume the second '*'
        if (glob[i + 1] === "/") {
          i++; // consume the trailing '/'
          out += "(?:.*/)?"; // '**/' → zero-or-more leading segments
        } else if (out.endsWith("/")) {
          out = `${out.slice(0, -1)}(?:/.*)?`; // '/**' → the dir itself OR any subtree
        } else {
          out += ".*"; // bare '**' → anything (may cross '/')
        }
      } else {
        out += "[^/]*"; // single '*' → within a single path segment
      }
      continue;
    }
    out += /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${out}$`);
}

function parseRegistryTasks(text: string): RegistryTaskView[] {
  const parsed = parseYaml(text) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }
  const tasks = (parsed as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) {
    return [];
  }
  const out: RegistryTaskView[] = [];
  for (const raw of tasks) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const t = raw as { id?: unknown; owner?: unknown; paths?: unknown; metadata?: unknown };
    const id = typeof t.id === "string" ? t.id : "";
    const owner = typeof t.owner === "string" ? t.owner : "";
    if (!id || !owner) {
      continue;
    }
    const globs = Array.isArray(t.paths)
      ? t.paths.filter((p): p is string => typeof p === "string")
      : [];
    if (globs.length === 0) {
      continue;
    }
    const spec =
      typeof t.metadata === "object" && t.metadata !== null
        ? typeof (t.metadata as { spec?: unknown }).spec === "string"
          ? (t.metadata as { spec: string }).spec
          : undefined
        : undefined;
    out.push({
      id,
      owner,
      ...(spec ? { spec } : {}),
      matchers: globs.map(loomGlobToRegExp),
    });
  }
  return out;
}

/** Collect repo-relative candidate paths from a request (cwd + path-like args). */
function candidatePaths(request: ToolRequest, repoRoot: string): string[] {
  const candidates: string[] = [];
  const add = (raw: string) => {
    if (!raw) {
      return;
    }
    const abs = path.isAbsolute(raw) ? raw : path.resolve(repoRoot, raw);
    const rel = path.relative(repoRoot, abs);
    // Skip anything outside the repo root (rel starts with ".." or is absolute).
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      candidates.push(rel.split(path.sep).join("/"));
    }
  };
  if (request.input.cwd) {
    add(request.input.cwd);
  }
  for (const arg of request.input.args ?? []) {
    // Only treat path-like tokens (contain a separator) as candidates.
    if (typeof arg === "string" && arg.includes("/")) {
      add(arg);
    }
  }
  return candidates;
}

export interface LoomAttributionSource {
  attributionFor: (request: ToolRequest) => LoomAttribution | undefined;
}

export interface LoadLoomAttributionOptions {
  /** Repo root that contains `.loom/registry.yaml` (defaults to process.cwd()). */
  cwd?: string;
  /** Test seam: provide registry text directly instead of reading from disk. */
  registryText?: string;
}

/**
 * Build a compile-time attribution resolver from the Loom registry. Returns
 * `null` when no registry is present (production installs) so the caller can
 * skip wiring a Stage-2 signal entirely.
 */
export function loadLoomAttributionSource(
  opts: LoadLoomAttributionOptions = {},
): LoomAttributionSource | null {
  const repoRoot = opts.cwd ?? process.cwd();
  let text = opts.registryText;
  if (text === undefined) {
    try {
      text = readFileSync(path.join(repoRoot, ".loom", "registry.yaml"), "utf8");
    } catch {
      return null; // no registry → no Stage-2 signal (neutral)
    }
  }
  const tasks = parseRegistryTasks(text);
  if (tasks.length === 0) {
    return null;
  }
  return {
    attributionFor(request: ToolRequest): LoomAttribution | undefined {
      const candidates = candidatePaths(request, repoRoot);
      if (candidates.length === 0) {
        return undefined;
      }
      const matched = new Map<string, RegistryTaskView>();
      for (const task of tasks) {
        const hit = candidates.some((c) => task.matchers.some((re) => re.test(c)));
        if (hit) {
          matched.set(task.owner, task);
        }
      }
      if (matched.size === 0) {
        return { unattributed: true };
      }
      if (matched.size > 1) {
        return { conflict: true, matchedRules: [...matched.values()].map((t) => `loom:${t.id}`) };
      }
      const [task] = matched.values();
      return {
        owner: task.owner,
        taskId: task.id,
        matchedRules: [`loom:${task.id}`],
      };
    },
  };
}
