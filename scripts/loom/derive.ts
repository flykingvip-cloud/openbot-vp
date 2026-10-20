/**
 * derive.ts — generate the human-readable `## Agents` view from the Registry
 * (Requirement 5.1). This is a DERIVED VIEW only: it is never read back as an
 * attribution input (the Registry is authoritative). Per decision D3 we emit the
 * block on demand (stdout) rather than auto-writing into each spec's tasks.md.
 *
 * Also derives `.github/CODEOWNERS` from the same registry
 * (engineering-governance R11) — see `deriveCodeowners`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { TERMINAL_TASK_STATES } from "./attribution.js";
import type { Registry, Task } from "./registry.js";

function deriveRow(task: Task): string {
  const scope = typeof task.metadata?.spec === "string" ? task.metadata.spec : task.id;
  const since = task.since ?? new Date().toISOString().slice(0, 10);
  const paths = task.paths.join(", ");
  return `- ${task.owner} · role: owner · scope: ${scope} · paths: ${paths} · since: ${since}`;
}

/** Render the `## Agents` block (all ownership tasks as rows). */
export function deriveAgentsBlock(registry: Registry): string {
  const lines = ["## Agents", ""];
  for (const task of registry.tasks) {
    if (task.paths.length === 0) {
      continue; // a row without paths cannot be attributed; skip in the view
    }
    lines.push(deriveRow(task));
  }
  return lines.join("\n");
}

/** Group derived `## Agents` rows by spec (task.metadata.spec), for per-spec views. */
export function deriveAgentsBySpec(registry: Registry): Map<string, string[]> {
  const bySpec = new Map<string, string[]>();
  for (const task of registry.tasks) {
    if (task.paths.length === 0) {
      continue;
    }
    const spec = typeof task.metadata?.spec === "string" ? task.metadata.spec : task.id;
    const rows = bySpec.get(spec) ?? [];
    rows.push(deriveRow(task));
    bySpec.set(spec, rows);
  }
  return bySpec;
}
// ─────────────────────────────────────────────────────────────────────────────
// CODEOWNERS derivation (engineering-governance R11)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * IMPORTANT — CODEOWNERS is a SIGNAL, not a merge gate.
 *
 * `require_code_owner_review` only bites when a code owner has push access AND is
 * not the PR author. In a repository with a single human owner and
 * `required_approving_review_count: 0`, CODEOWNERS cannot block any merge no
 * matter how it is generated. Its value here is (a) surfacing registry ownership
 * in the PR UI and (b) drift detection against the registry. The real path
 * ownership gate is `loom lint`'s `ownership-overlap` check.
 *
 * Second constraint: registry owners are AGENT ids (`kiro-loom`), not GitHub
 * accounts — every agent commits through the same git identity. So agent ids must
 * be mapped to real handles; emitting `@kiro-loom` would produce an invalid
 * CODEOWNERS file that GitHub reports as an unknown owner. Unmapped agents are
 * returned to the caller so the CLI can fail loudly instead of shipping garbage.
 */

export const CODEOWNERS_FILE = ".github/CODEOWNERS";

export type CodeownersConfig = {
  /** Output path, relative to the repo root. */
  path: string;
  /** Handle used for any agent without an explicit mapping. */
  defaultHandle?: string;
  /** Explicit agent-id → GitHub handle mapping (e.g. `{ "kiro-loom": "@octocat" }`). */
  handles: Record<string, string>;
};

export type CodeownersResult = {
  content: string;
  /** Agent ids with no resolvable handle. Non-empty ⇒ do not write the file. */
  unmapped: string[];
  /** Registry path globs that cannot be expressed in CODEOWNERS, with a reason. */
  skipped: { path: string; reason: string }[];
};

const CODEOWNERS_HEADER = [
  "# GENERATED FILE — do not edit by hand.",
  "#",
  "# Source of truth: .loom/registry.yaml (ownership tasks).",
  "# Regenerate:  pnpm loom derive --codeowners --write",
  "# Verify:      pnpm loom derive --codeowners --check   (CI drift gate)",
  "#",
  "# This file is a SIGNAL (reviewer hint + registry drift detection), NOT a merge",
  "# gate: with a single human owner, code-owner review cannot block a merge. The",
  "# enforcing path-ownership check is `loom lint` (ownership-overlap).",
  "#",
  "# CODEOWNERS resolves LAST match wins, whereas Loom ownership is exclusive and",
  "# treats >1 match as a CONFLICT. Overlapping claims are therefore a registry",
  "# problem to fix in `loom lint`, not something this file silently resolves.",
  "#",
  "# Terminal-state tasks (landed/abandoned) claim nothing and are omitted.",
];

/**
 * Convert a registry path glob to a CODEOWNERS pattern, or explain why it cannot
 * be one. CODEOWNERS uses gitignore-style patterns; anchoring with a leading `/`
 * keeps a claim repo-root relative instead of matching the same name at any depth.
 */
export function toCodeownersPattern(glob: string): { pattern: string } | { reason: string } {
  const trimmed = glob.trim();
  if (trimmed.length === 0) {
    return { reason: "empty pattern" };
  }
  // `#` starts a comment in CODEOWNERS, so a sub-symbol claim such as
  // `foo.ts#someExport` cannot be represented as a path pattern at all.
  if (trimmed.includes("#")) {
    return { reason: "contains '#' (CODEOWNERS comment character); not a path" };
  }
  if (/\s/.test(trimmed)) {
    return { reason: "contains whitespace; CODEOWNERS separates fields on spaces" };
  }
  return { pattern: trimmed.startsWith("/") ? trimmed : `/${trimmed}` };
}

/**
 * Derive CODEOWNERS content from the registry. Pure — no fs, no config loading,
 * so it stays repo-agnostic (Requirement 7.1) and fully testable.
 */
export function deriveCodeowners(
  registry: Registry,
  opts: { handleFor: (agentId: string) => string | undefined },
): CodeownersResult {
  const lines = [...CODEOWNERS_HEADER];
  const unmapped = new Set<string>();
  const skipped: { path: string; reason: string }[] = [];

  for (const task of registry.tasks) {
    if (TERMINAL_TASK_STATES.has(task.state) || task.paths.length === 0) {
      continue;
    }
    const handle = opts.handleFor(task.owner);
    if (!handle) {
      unmapped.add(task.owner);
      continue;
    }
    const spec = typeof task.metadata?.spec === "string" ? task.metadata.spec : task.id;
    const patterns: string[] = [];
    for (const glob of task.paths) {
      const converted = toCodeownersPattern(glob);
      if ("reason" in converted) {
        skipped.push({ path: glob, reason: converted.reason });
        continue;
      }
      patterns.push(converted.pattern);
    }
    if (patterns.length === 0) {
      continue;
    }
    lines.push("", `# ${task.owner} — ${spec} (task: ${task.id}, state: ${task.state})`);
    for (const pattern of patterns) {
      lines.push(`${pattern} ${handle}`);
    }
  }

  return {
    content: `${lines.join("\n")}\n`,
    unmapped: [...unmapped].toSorted((a, b) => a.localeCompare(b)),
    skipped,
  };
}

/**
 * Read the `codeowners:` section of `.loom/config.yaml`. Separated from the pure
 * derivation above so `deriveCodeowners` never touches the filesystem.
 */
export function loadCodeownersConfig(cwd: string = process.cwd()): CodeownersConfig {
  const defaults: CodeownersConfig = { path: CODEOWNERS_FILE, handles: {} };
  const file = join(cwd, ".loom", "config.yaml");
  if (!existsSync(file)) {
    return defaults;
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(readFileSync(file, "utf8"));
  } catch {
    return defaults;
  }
  const raw = (parsed as { codeowners?: Partial<CodeownersConfig> } | null)?.codeowners;
  if (!raw || typeof raw !== "object") {
    return defaults;
  }
  const handles: Record<string, string> = {};
  if (raw.handles && typeof raw.handles === "object") {
    for (const [agent, handle] of Object.entries(raw.handles)) {
      if (typeof handle === "string" && handle.length > 0) {
        handles[agent] = handle;
      }
    }
  }
  return {
    path: typeof raw.path === "string" && raw.path.length > 0 ? raw.path : defaults.path,
    defaultHandle: typeof raw.defaultHandle === "string" ? raw.defaultHandle : undefined,
    handles,
  };
}

/** Build the agent-id → handle resolver from a loaded config. */
export function handleResolver(config: CodeownersConfig): (agentId: string) => string | undefined {
  return (agentId: string) => config.handles[agentId] ?? config.defaultHandle;
}
