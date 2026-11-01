/**
 * agent-attribution.ts — map dirty working-tree files to the agent that owns them.
 *
 * Why: every IDE agent (Kiro/Cursor/Codex/Windsurf) commits through the SAME git
 * identity, so `git log --author` cannot attribute changes. The only durable
 * attribution is the `## Agents` sign-in block each spec's `tasks.md` carries
 * (see AGENTS.md "Multi-Agent Collaboration & Commit Governance"). This script
 * reads every spec's `## Agents` block, builds a path-glob -> agent map, and
 * reports which agent owns each dirty file (or flags it UNATTRIBUTED).
 *
 * Usage:
 *   bun scripts/agent-attribution.ts                       # human-readable report
 *   bun scripts/agent-attribution.ts --json                # machine-readable JSON
 *   bun scripts/agent-attribution.ts --fail-on-unattributed # exit 1 if any file is UNATTRIBUTED
 *   bun scripts/agent-attribution.ts --fail-on-conflict     # exit 1 if any file is CONFLICT (>1 owner)
 *   bun scripts/agent-attribution.ts --fail-on-shared       # exit 1 if any file is SHARED (strict audit)
 *   bun scripts/agent-attribution.ts --check                # alias: fail on unattributed
 *
 * UNATTRIBUTED = no spec `## Agents` row claims the path (identity unrecoverable).
 * CONFLICT      = >1 agent claims the path and it is NOT registered as shared —
 *                 an unresolved overlap, i.e. a takeover-pending signal.
 * SHARED        = >1 agent claims the path AND `.loom/registry.yaml` `sharedPaths`
 *                 registers it with a `landerTask`, whose current owner lands it.
 *                 Ownership has an answer, so this is reported separately and does
 *                 not fail `--fail-on-conflict`. AGENTS.md rule 2 still applies:
 *                 the lander is exactly the agent that rule points to.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { attribute as attributeFromRegistry } from "./loom/attribution.js";
import { loadRegistry, type Registry, registryPath } from "./loom/registry.js";

const rawArgs = new Set(process.argv.slice(2));
const asJson = rawArgs.has("--json");
const failOnUnattributed = rawArgs.has("--fail-on-unattributed") || rawArgs.has("--check");
const failOnConflict = rawArgs.has("--fail-on-conflict");
const failOnShared = rawArgs.has("--fail-on-shared");

type AgentClaim = {
  agentId: string;
  spec: string;
  role: string;
  globs: string[];
};

type StatusEntry = {
  xy: string;
  path: string;
};

type Attribution = {
  path: string;
  status: string;
  owners: { agentId: string; spec: string }[];
  /**
   * Set only in registry mode, from `sharedPaths`. Legacy `## Agents` mode has no
   * equivalent, so it stays undefined there — which is what keeps the legacy
   * baseline (and therefore `loom check` parity) unchanged.
   */
  shared?: { glob: string; lander?: string; reason?: string };
};

const SPECS_DIR = ".kiro/specs";

/** Strip markdown noise (bold markers, backticks, stray escapes) from a row. */
function sanitize(line: string): string {
  return line
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\\([*_])/g, "$1");
}

/**
 * Parse a single `## Agents` row of the form:
 *   - <agent-id> · role: <role> · scope: <desc> · paths: <glob, glob> · since: <date>
 * `paths:` is the machine-readable field; rows without it are skipped (cannot attribute).
 */
function parseAgentRow(rawLine: string, spec: string): AgentClaim | null {
  const line = sanitize(rawLine).trim();
  if (!line.startsWith("-")) {
    return null;
  }
  const body = line.replace(/^-\s*/, "");
  const fields = body.split("·").map((part) => part.trim());
  if (fields.length === 0) {
    return null;
  }
  const agentId = fields[0].trim();
  if (!agentId) {
    return null;
  }
  let role = "unknown";
  let pathsRaw = "";
  for (const field of fields.slice(1)) {
    const colon = field.indexOf(":");
    if (colon < 0) {
      continue;
    }
    const key = field.slice(0, colon).trim().toLowerCase();
    const value = field.slice(colon + 1).trim();
    if (key === "role") {
      role = value;
    } else if (key === "paths") {
      pathsRaw = value;
    }
  }
  if (!pathsRaw) {
    return null;
  }
  const globs = pathsRaw
    .split(",")
    .map((glob) => glob.trim())
    .filter(Boolean);
  if (globs.length === 0) {
    return null;
  }
  return { agentId, spec, role, globs };
}

/** Read the `## Agents` block (rows until the next `## ` heading) from a tasks.md. */
function parseAgentsBlock(taskFile: string, spec: string): AgentClaim[] {
  const text = readFileSync(taskFile, "utf8");
  const lines = text.split("\n");
  const claims: AgentClaim[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (/^##\s+Agents\b/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock && /^##\s+/.test(line)) {
      break;
    }
    if (inBlock) {
      const claim = parseAgentRow(line, spec);
      if (claim) {
        claims.push(claim);
      }
    }
  }
  return claims;
}

function loadAllClaims(): AgentClaim[] {
  const claims: AgentClaim[] = [];
  let specEntries: string[] = [];
  try {
    specEntries = readdirSync(SPECS_DIR);
  } catch {
    return claims;
  }
  for (const spec of specEntries) {
    const taskFile = join(SPECS_DIR, spec, "tasks.md");
    try {
      if (!statSync(taskFile).isFile()) {
        continue;
      }
    } catch {
      continue;
    }
    claims.push(...parseAgentsBlock(taskFile, spec));
  }
  return claims;
}

/** Translate a path glob (`a/**`, `a/*.ts`, `a/foo*`) into an anchored RegExp. */
function globToRegExp(glob: string): RegExp {
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

function buildMatchers(claims: AgentClaim[]) {
  return claims.map((claim) => ({
    claim,
    regexps: claim.globs.map(globToRegExp),
  }));
}

function parseStatus(output: Buffer): StatusEntry[] {
  const tokens = output.toString("utf8").split("\0");
  const entries: StatusEntry[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    const xy = token.slice(0, 2);
    const path = token.slice(3);
    if (xy.includes("R") || xy.includes("C")) {
      // rename/copy: the destination path is what matters; skip the source token
      entries.push({ xy, path });
      index += 1;
      continue;
    }
    entries.push({ xy, path });
  }
  return entries;
}

function statusKind(xy: string): string {
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

function loadDirty(): StatusEntry[] {
  const output = execFileSync("git", ["status", "--porcelain=v1", "-z"], {
    cwd: process.cwd(),
  });
  return parseStatus(output);
}

/**
 * Registry-mode attribution (Loom cutover, registry-gated). When a committed
 * `.loom/registry.yaml` exists it becomes the single source of truth; we shape
 * Loom's `{ taskId, owner }` owners back into this script's `{ agentId, spec }`
 * report shape. M1 parity (`loom check`) guarantees identical verdicts.
 */
function attributeViaRegistry(registry: Registry): Attribution[] {
  const specById = new Map<string, string>();
  for (const task of registry.tasks) {
    const spec = task.metadata?.spec;
    specById.set(task.id, typeof spec === "string" ? spec : task.id);
  }
  return attributeFromRegistry(registry, loadDirty()).map((result) => {
    const shaped: Attribution = {
      path: result.path,
      status: result.status,
      owners: result.owners.map((owner) => ({
        agentId: owner.owner,
        spec: specById.get(owner.taskId) ?? owner.taskId,
      })),
    };
    if (result.shared) {
      shaped.shared = {
        glob: result.shared.shared.glob,
        lander: result.shared.lander,
        reason: result.shared.shared.reason,
      };
    }
    return shaped;
  });
}

function attribute(): Attribution[] {
  // Cutover: prefer the committed Registry when present; else legacy `## Agents`.
  // `LOOM_FORCE_LEGACY=1` forces the legacy path (used by `loom check` to get a
  // true legacy baseline even after the Registry file is committed).
  if (!process.env.LOOM_FORCE_LEGACY && existsSync(registryPath())) {
    return attributeViaRegistry(loadRegistry());
  }
  const matchers = buildMatchers(loadAllClaims());
  return loadDirty().map((entry) => {
    const owners = matchers
      .filter((matcher) => matcher.regexps.some((re) => re.test(entry.path)))
      .map((matcher) => ({ agentId: matcher.claim.agentId, spec: matcher.claim.spec }));
    // Deduplicate identical Agents lines within one spec (same agentId+spec).
    // Multiple ## Agents bullets in a single tasks.md otherwise inflate owner
    // lists and break loom check parity against the Registry (one task per id).
    const seen = new Set<string>();
    const deduped = owners.filter((owner) => {
      const key = `${owner.agentId}\0${owner.spec}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    return { path: entry.path, status: statusKind(entry.xy), owners: deduped };
  });
}

function main() {
  const results = attribute();
  const unattributed = results.filter((r) => r.owners.length === 0);
  // A registered shared path is NOT a conflict: its lander answers the ownership
  // question, so it is tracked and gated separately.
  const overlaps = results.filter((r) => r.owners.length > 1);
  const conflicts = overlaps.filter((r) => !r.shared);
  const sharedFiles = overlaps.filter((r) => r.shared);
  const attributedCount = results.length - unattributed.length - overlaps.length;

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          results,
          attributedCount,
          unattributedCount: unattributed.length,
          conflictCount: conflicts.length,
          sharedCount: sharedFiles.length,
        },
        null,
        2,
      ),
    );
  } else {
    const byAgent = new Map<string, Attribution[]>();
    for (const result of results) {
      if (result.owners.length !== 1) {
        continue;
      }
      const owner = result.owners[0];
      const key = `${owner.agentId} (${owner.spec})`;
      const list = byAgent.get(key) ?? [];
      list.push(result);
      byAgent.set(key, list);
    }

    console.log("Agent Attribution — dirty working tree");
    console.log(`- dirty files: ${results.length}`);
    console.log(`- attributed: ${attributedCount}`);
    console.log(`- shared (registered, >1 owner): ${sharedFiles.length}`);
    console.log(`- conflict (unregistered, >1 owner): ${conflicts.length}`);
    console.log(`- unattributed: ${unattributed.length}`);
    console.log("");

    for (const [agent, files] of [...byAgent.entries()].toSorted((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      console.log(`## ${agent} — ${files.length}`);
      for (const file of files.toSorted((a, b) => a.path.localeCompare(b.path))) {
        console.log(`   ${file.status.padEnd(9)} ${file.path}`);
      }
      console.log("");
    }

    if (sharedFiles.length > 0) {
      console.log(
        `## SHARED (registered, lands via its designated lander) — ${sharedFiles.length}`,
      );
      console.log("   (declared in .loom/registry.yaml sharedPaths; the lander lands it — rule 2)");
      for (const file of sharedFiles.toSorted((a, b) => a.path.localeCompare(b.path))) {
        const owners = file.owners.map((o) => `${o.agentId} (${o.spec})`).join(" + ");
        // The lander is the only actionable part, so it leads the line. An
        // unresolved lander is shown loudly rather than blank: `loom lint` errors
        // on a dangling landerTask, and this is where it becomes visible.
        const lander = file.shared?.lander ?? "UNRESOLVED (dangling landerTask)";
        console.log(`   ${file.status.padEnd(9)} ${file.path}  lander=${lander}  <-  ${owners}`);
        if (file.shared?.reason) {
          console.log(`             reason: ${file.shared.reason}`);
        }
      }
      console.log("");
    }

    if (conflicts.length > 0) {
      console.log(`## CONFLICT (unregistered shared hot file, >1 owner) — ${conflicts.length}`);
      console.log(
        "   (the file's task-owner lands it; do not commit another agent's WIP — rule 2)",
      );
      console.log(
        "   (if the overlap is BY DESIGN, register the path in .loom/registry.yaml sharedPaths",
      );
      console.log("    with a landerTask — that is a human decision, never inferred)");
      for (const file of conflicts.toSorted((a, b) => a.path.localeCompare(b.path))) {
        const owners = file.owners.map((o) => `${o.agentId} (${o.spec})`).join(" + ");
        console.log(`   ${file.status.padEnd(9)} ${file.path}  <-  ${owners}`);
      }
      console.log("");
    }

    if (unattributed.length > 0) {
      console.log(`## UNATTRIBUTED — ${unattributed.length}`);
      console.log("   (no spec's ## Agents block claims these paths; the owning agent");
      console.log("    must sign in via tasks.md `## Agents` with a matching `paths:`)");
      for (const file of unattributed.toSorted((a, b) => a.path.localeCompare(b.path))) {
        console.log(`   ${file.status.padEnd(9)} ${file.path}`);
      }
      console.log("");
    }
  }

  let failed = false;
  if (failOnUnattributed && unattributed.length > 0) {
    if (!asJson) {
      console.error(
        `\nattribution check FAILED: ${unattributed.length} dirty file(s) have no owning agent.`,
      );
      console.error(
        "Each active spec must carry a `## Agents` sign-in with `paths:` covering its files.",
      );
    }
    failed = true;
  }
  if (failOnConflict && conflicts.length > 0) {
    if (!asJson) {
      console.error(
        `\nattribution check FAILED: ${conflicts.length} dirty file(s) are claimed by >1 agent and are not registered as shared (CONFLICT).`,
      );
      console.error(
        "Resolve by transferring ownership to one executor, or — if the overlap is by design —",
      );
      console.error("register the path in .loom/registry.yaml `sharedPaths` with a `landerTask`.");
    }
    failed = true;
  }
  if (failOnShared && sharedFiles.length > 0) {
    if (!asJson) {
      console.error(
        `\nattribution check FAILED: ${sharedFiles.length} dirty file(s) are on registered shared paths (SHARED).`,
      );
      console.error("Each must be landed by its declared lander (see the SHARED section above).");
    }
    failed = true;
  }
  if (failed) {
    process.exit(1);
  }
}

main();
