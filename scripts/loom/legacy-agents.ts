/**
 * legacy-agents.ts — read the legacy `## Agents` sign-in blocks from spec
 * `tasks.md` files. This is a MIGRATION READER only: it reproduces the parser
 * in `scripts/agent-attribution.ts` so `loom import` can enrich task owners and
 * so parity tooling can compare against the legacy attribution source. Going
 * forward the Registry is authoritative; this is not used at runtime.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_SPECS_DIR = ".kiro/specs";

export type AgentClaim = {
  agentId: string;
  spec: string;
  role: string;
  globs: string[];
};

/** Strip markdown noise (bold markers, backticks, stray escapes) from a row. */
function sanitize(line: string): string {
  return line
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\\([*_])/g, "$1");
}

/**
 * Parse a single `## Agents` row:
 *   - <agent-id> · role: <role> · scope: <desc> · paths: <glob, glob> · since: <date>
 * Rows without a `paths:` clause are skipped (cannot be attributed), matching
 * the legacy behavior.
 */
export function parseAgentRow(rawLine: string, spec: string): AgentClaim | null {
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
export function parseAgentsBlock(text: string, spec: string): AgentClaim[] {
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

/** Load every spec's `## Agents` claims under `<cwd>/<specsDir>`. */
export function loadAgentClaims(
  cwd: string = process.cwd(),
  specsDir: string = DEFAULT_SPECS_DIR,
): AgentClaim[] {
  const root = join(cwd, specsDir);
  let specEntries: string[];
  try {
    specEntries = readdirSync(root);
  } catch {
    return [];
  }
  const claims: AgentClaim[] = [];
  for (const spec of specEntries) {
    const taskFile = join(root, spec, "tasks.md");
    try {
      if (!statSync(taskFile).isFile()) {
        continue;
      }
    } catch {
      continue;
    }
    claims.push(...parseAgentsBlock(readFileSync(taskFile, "utf8"), spec));
  }
  return claims;
}
