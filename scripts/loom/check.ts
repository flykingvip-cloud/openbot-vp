/**
 * check.ts — Shadow-mode zero-regression parity check (Requirement 2.3 / 4.3 /
 * 8.3; design §3.6). THE migration-critical command (Milestone M1).
 *
 * It runs the LEGACY tools (`worktree-audit.ts --json`, `agent-attribution.ts
 * --json`) as subprocesses against the current dirty tree, computes the SAME
 * verdicts from the imported Registry, and diffs them per file. Any difference
 * fails the check; `--strict` is the CI gate. We never silently accept drift.
 */

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { attribute, type AttributionVerdict, verdictOf } from "./attribution.js";
import { classifyWithRegistry, findRiskyMix } from "./audit.js";
import { loadDirtyStatus, type StatusEntry } from "./glob.js";
import { importFromLegacy } from "./import.js";
import type { Registry } from "./registry.js";

export type ParityDiff = {
  dimension: "attribution" | "audit" | "riskyMix" | "verdict";
  path: string; // "" for the global riskyMix diff
  legacy: string;
  registry: string;
};

/** A path the Registry now reports as SHARED where legacy reported CONFLICT. */
export type SharedTransition = {
  path: string;
  glob: string;
  lander?: string;
  reason?: string;
};

export type CheckResult = {
  ok: boolean;
  dirtyFiles: number;
  diffs: ParityDiff[];
  /**
   * The ONLY verdict change `sharedPaths` is allowed to introduce
   * (`CONFLICT → SHARED`). Listed explicitly rather than silently accepted, so a
   * reviewer can see exactly which paths changed classification and why.
   */
  sharedTransitions: SharedTransition[];
};

export type LegacyAudit = {
  groupByPath: Map<string, string>; // path -> group letter (or UNMATCHED sentinel)
  riskyMix: boolean;
};

export const UNMATCHED = "\u0000unmatched";

function sortedJoin(values: string[]): string {
  return values.length === 0 ? "(none)" : values.toSorted().join("+");
}

/**
 * Pure parity diff: compare legacy verdicts to the Registry's verdicts on the
 * same dirty entries. No I/O — fully unit-testable.
 */
export function computeDiffs(input: {
  entries: StatusEntry[];
  registry: Registry;
  legacyAudit: LegacyAudit;
  legacyAttribution: Map<string, string[]>;
}): { diffs: ParityDiff[]; sharedTransitions: SharedTransition[] } {
  const { entries, registry, legacyAudit, legacyAttribution } = input;
  const sharedTransitions: SharedTransition[] = [];
  const diffs: ParityDiff[] = [];

  // ── Audit parity (intersection only) ──
  // On a shared working tree other agents may add/remove files between our
  // snapshot and the legacy subprocess. Compare only files BOTH sides evaluated;
  // a real rule divergence (both saw it, classified differently) is still caught,
  // while appearing/disappearing files are skipped as race noise (not regressions).
  const classified = classifyWithRegistry(registry, entries);
  const auditSeen = classified.filter((entry) => legacyAudit.groupByPath.has(entry.path));
  for (const entry of auditSeen) {
    const registryGroup = entry.rule?.streamId ?? UNMATCHED;
    const legacyGroup = legacyAudit.groupByPath.get(entry.path) ?? UNMATCHED;
    if (registryGroup !== legacyGroup) {
      diffs.push({
        dimension: "audit",
        path: entry.path,
        legacy: legacyGroup === UNMATCHED ? "UNMATCHED" : legacyGroup,
        registry: registryGroup === UNMATCHED ? "UNMATCHED" : registryGroup,
      });
    }
  }
  // riskyMix is snapshot-sensitive; evaluate it over the shared (intersection) set.
  const registryRisky = findRiskyMix(auditSeen) !== null;
  if (registryRisky !== legacyAudit.riskyMix) {
    diffs.push({
      dimension: "riskyMix",
      path: "",
      legacy: String(legacyAudit.riskyMix),
      registry: String(registryRisky),
    });
  }

  // ── Attribution parity (intersection only) ──
  for (const result of attribute(registry, entries)) {
    if (!legacyAttribution.has(result.path)) {
      continue; // file not seen by the legacy snapshot (race) — skip
    }
    const registryOwners = result.owners.map((o) => o.owner);
    const legacyOwners = legacyAttribution.get(result.path) ?? [];
    if (sortedJoin(registryOwners) !== sortedJoin(legacyOwners)) {
      diffs.push({
        dimension: "attribution",
        path: result.path,
        legacy: sortedJoin(legacyOwners),
        registry: sortedJoin(registryOwners),
      });
      continue; // owners already differ; the verdict check below would be noise
    }

    // ── Verdict parity (P2.4) ──
    // `sharedPaths` cannot change owner SETS, only how an overlap is classified.
    // So compare verdicts too, and permit exactly one transition: CONFLICT →
    // SHARED on a registered path. Anything else means the registration leaked
    // into a decision it must not touch.
    const legacyVerdict = verdictFromOwnerCount(legacyOwners.length);
    const registryVerdict = verdictOf(result);
    if (legacyVerdict === registryVerdict) {
      continue;
    }
    if (legacyVerdict === "CONFLICT" && registryVerdict === "SHARED" && result.shared) {
      sharedTransitions.push({
        path: result.path,
        glob: result.shared.shared.glob,
        lander: result.shared.lander,
        reason: result.shared.shared.reason,
      });
      continue;
    }
    // Unreachable while both verdict functions derive from the owner count alone
    // (equal owner sets ⇒ equal counts ⇒ CONFLICT→SHARED is the only possible
    // difference). Kept as a structural guard: if `verdictOf` ever gains another
    // verdict, parity must fail loudly instead of quietly accepting it.
    diffs.push({
      dimension: "verdict",
      path: result.path,
      legacy: legacyVerdict,
      registry: registryVerdict,
    });
  }
  return { diffs, sharedTransitions };
}

/** Legacy verdicts are derived purely from the owner count (no shared concept). */
function verdictFromOwnerCount(count: number): AttributionVerdict {
  if (count === 0) {
    return "UNATTRIBUTED";
  }
  return count > 1 ? "CONFLICT" : "ATTRIBUTED";
}

function runLegacyJson(cwd: string, script: string): unknown {
  const out = execFileSync("node", ["--import", "tsx", script, "--json"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // Force the legacy path so the baseline is the true legacy behavior even
    // after `.loom/registry.yaml` is committed (otherwise the legacy entry
    // points would themselves read the Registry and the check would be vacuous).
    env: { ...process.env, LOOM_FORCE_LEGACY: "1" },
  });
  return JSON.parse(out);
}

function collectLegacyAudit(cwd: string): LegacyAudit {
  const payload = runLegacyJson(cwd, "scripts/worktree-audit.ts") as {
    groups: Array<{ id: string; group: string; paths: string[] }>;
    riskyMix: unknown;
  };
  const groupByPath = new Map<string, string>();
  for (const bucket of payload.groups) {
    const key = bucket.id === "unmatched" ? UNMATCHED : bucket.group;
    for (const path of bucket.paths) {
      groupByPath.set(path, key);
    }
  }
  return { groupByPath, riskyMix: payload.riskyMix !== null };
}

function collectLegacyAttribution(cwd: string): Map<string, string[]> {
  const payload = runLegacyJson(cwd, "scripts/agent-attribution.ts") as {
    results: Array<{ path: string; owners: Array<{ agentId: string }> }>;
  };
  const byPath = new Map<string, string[]>();
  for (const result of payload.results) {
    byPath.set(
      result.path,
      result.owners.map((o) => o.agentId),
    );
  }
  return byPath;
}

/** Compare legacy vs imported-Registry verdicts on the current dirty tree. */
export function runCheck(cwd: string = process.cwd()): CheckResult {
  const entries = loadDirtyStatus(cwd);
  const { registry } = importFromLegacy(cwd);
  const { diffs, sharedTransitions } = computeDiffs({
    entries,
    registry,
    legacyAudit: collectLegacyAudit(cwd),
    legacyAttribution: collectLegacyAttribution(cwd),
  });
  return { ok: diffs.length === 0, dirtyFiles: entries.length, diffs, sharedTransitions };
}

/** Render a human report; returns the report string. */
export function formatCheckReport(result: CheckResult): string {
  const lines: string[] = [];
  lines.push("Loom parity check (Shadow Mode) — legacy vs imported Registry");
  lines.push(`- dirty files: ${result.dirtyFiles}`);
  lines.push(`- diffs: ${result.diffs.length}`);
  lines.push(
    `- shared transitions (CONFLICT -> SHARED, allowed): ${result.sharedTransitions.length}`,
  );
  if (result.sharedTransitions.length > 0) {
    lines.push("");
    lines.push("Registered shared paths (each now has a designated lander):");
    for (const transition of result.sharedTransitions.toSorted((a, b) =>
      a.path.localeCompare(b.path),
    )) {
      const why = transition.reason ? ` — ${transition.reason}` : "";
      lines.push(
        `  CONFLICT -> SHARED  ${transition.path}  via ${transition.glob}  lander=${transition.lander ?? "(UNRESOLVED)"}${why}`,
      );
    }
  }
  if (result.diffs.length > 0) {
    lines.push("");
    for (const diff of result.diffs) {
      const where = diff.path ? ` ${diff.path}` : "";
      lines.push(`  [${diff.dimension}]${where}  legacy=${diff.legacy}  registry=${diff.registry}`);
    }
    lines.push("");
    lines.push("Parity FAILED: legacy and Registry disagree. Resolve before cutover (M1).");
  } else {
    lines.push("");
    lines.push("Parity OK: Registry reproduces legacy verdicts exactly.");
  }
  return lines.join("\n");
}

function main() {
  const args = new Set(process.argv.slice(2));
  const asJson = args.has("--json");
  const strict = args.has("--strict");
  const result = runCheck(process.cwd());
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatCheckReport(result));
  }
  if (strict && !result.ok) {
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
