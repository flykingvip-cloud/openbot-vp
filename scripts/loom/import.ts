/**
 * import.ts — one-time migration: build an initial `.loom/registry.yaml` from
 * the legacy sources (Requirement 7.3, design §3.5).
 *
 * Option A two-table model:
 * - `landingStreams` ← legacy `worktree-audit.ts` rules (audit partition;
 *   overlap-OK, first-match). One stream per legacy `group`.
 * - `tasks` ← legacy `## Agents` blocks (ownership partition; exclusive).
 *   One task per (spec, agentId) sign-in.
 *
 * The two partitions are independent, so audit-group overlaps (e.g. `package.json`
 * in multiple groups) never pollute ownership attribution. Conflicts that DO need
 * human review (overlapping ownership globs across agents) are reported, not guessed.
 */

import {
  allowedLinkedPrimaryGroups,
  type AuditRule,
  extractRulePatterns,
  LEGACY_RULES as legacyRules,
} from "../worktree-audit.js";
import { globsOverlap } from "./glob.js";
import { loadAgentClaims } from "./legacy-agents.js";
import { type LegacyDisposition, policyForLegacyRule } from "./policy-map.js";
import { LATEST_VERSION, type LandingStream, type Registry, type Task } from "./registry.js";

export type ImportConflict = {
  kind: "ownership-overlap";
  detail: string;
};

export type ImportResult = {
  registry: Registry;
  conflicts: ImportConflict[];
};

/** A legacy `prefix("a/b")` matches via startsWith; the equivalent glob is `a/b**`. */
function prefixToGlob(prefix: string): string {
  return `${prefix}**`;
}

/** Build the audit partition (landing streams) from the legacy rule table. */
export function buildLandingStreams(ruleTable: AuditRule[] = legacyRules): LandingStream[] {
  const byId = new Map<string, LandingStream>();
  for (const rule of ruleTable) {
    const { exact, prefix } = extractRulePatterns(rule);
    const paths = [...exact, ...prefix.map(prefixToGlob)];
    const existing = byId.get(rule.group);
    if (existing) {
      for (const path of paths) {
        if (!existing.paths.includes(path)) {
          existing.paths.push(path);
        }
      }
      continue;
    }
    byId.set(rule.group, {
      id: rule.group,
      landingPolicy: policyForLegacyRule(rule.group, rule.disposition as LegacyDisposition),
      paths,
      canLandWith: [],
      metadata: {
        legacyRuleId: rule.id,
        legacyTitle: rule.title,
        legacyDisposition: rule.disposition,
      },
    });
  }
  // Expand allowedLinkedPrimaryGroups into symmetric canLandWith declarations.
  for (const group of allowedLinkedPrimaryGroups) {
    const members = [...group];
    for (const id of members) {
      const stream = byId.get(id);
      if (!stream) {
        continue;
      }
      for (const other of members) {
        if (other !== id && !stream.canLandWith.includes(other)) {
          stream.canLandWith.push(other);
        }
      }
    }
  }
  return [...byId.values()];
}

/** Build the ownership partition (tasks) from the legacy `## Agents` blocks. */
export function buildOwnershipTasks(cwd: string = process.cwd()): {
  tasks: Task[];
  conflicts: ImportConflict[];
} {
  const tasks: Task[] = [];
  const byId = new Map<string, Task>();
  for (const claim of loadAgentClaims(cwd)) {
    const id = `${claim.spec}:${claim.agentId}`;
    const existing = byId.get(id);
    if (existing) {
      for (const glob of claim.globs) {
        if (!existing.paths.includes(glob)) {
          existing.paths.push(glob);
        }
      }
      continue;
    }
    const task: Task = {
      id,
      owner: claim.agentId,
      intent: [],
      paths: [...claim.globs],
      state: "active",
      sessions: [],
      ownerHistory: [],
      metadata: { spec: claim.spec, role: claim.role },
    };
    byId.set(id, task);
    tasks.push(task);
  }

  // Surface overlapping ownership globs (a real attribution CONFLICT risk) for
  // review. Uses prefix-relationship overlap so nested globs (src/** vs
  // src/auth/**) are caught, not just byte-identical strings.
  const conflicts: ImportConflict[] = [];
  for (let i = 0; i < tasks.length; i += 1) {
    for (let j = i + 1; j < tasks.length; j += 1) {
      const shared = tasks[i].paths.filter((pa) =>
        tasks[j].paths.some((pb) => globsOverlap(pa, pb)),
      );
      if (shared.length > 0) {
        conflicts.push({
          kind: "ownership-overlap",
          detail: `${tasks[i].id} and ${tasks[j].id} have overlapping path globs: ${shared.join(", ")}`,
        });
      }
    }
  }
  return { tasks, conflicts };
}

/**
 * Produce an initial Registry from the legacy audit rules + `## Agents` blocks.
 *
 * WRITE-PATH WARNING: this is a ONE-TIME migration. The result has empty
 * `sessions` / `ownerHistory` and only legacy-expressible streams, so persisting
 * it (`saveRegistry`) over a live registry destroys all registry-native state.
 * The `.loom/registry.yaml` is now the stateful source of truth (see
 * `.loom/README.md`). Do NOT wire this into any write path except the guarded
 * `loom import --write` CLI (which refuses destructive overwrites). Read-only use
 * (e.g. `check.ts` parity baseline) is fine.
 */
export function importFromLegacy(cwd: string = process.cwd()): ImportResult {
  const landingStreams = buildLandingStreams();
  const { tasks, conflicts } = buildOwnershipTasks(cwd);
  return {
    // `sharedPaths` is deliberately empty: it has no legacy equivalent, and this
    // is the parity baseline `check.ts` compares against. Inferring shared paths
    // from observed overlap would defeat the point — registration is a human
    // decision (spec task P2.5).
    registry: { version: LATEST_VERSION, tasks, landingStreams, sharedPaths: [] },
    conflicts,
  };
}
