/**
 * Validate the capability convergence registry.
 *
 * Required by `docs/design/openbot-computer-network-capability-architecture-2026-09-29.md`
 * §6.7 ("no implementation task starts without a registry row") and §3.2 (the
 * REUSE / ADAPT / WIRE / EXTEND / NEW_PRIMITIVE / RETIRE mandate, where
 * NEW_PRIMITIVE is fail-closed).
 *
 * The checks that carry the weight:
 *
 *  - Declared owner paths must exist on disk. A registry whose ownership claims
 *    have gone stale is worse than no registry, because it is trusted.
 *  - `new-primitive` is only legal with zero owners, current or pending. This
 *    turns "prove you are not duplicating an existing module" from a review
 *    convention into a machine-enforced rule.
 *  - `pendingOwners` names work that is real but has not reached this base yet.
 *    It is deliberately the mirror image of `currentOwners`: a pending path must
 *    NOT exist. So the escape hatch cannot rot into a stale claim — the moment
 *    the work lands, the validator fails until the path is promoted to
 *    `currentOwners`. Pending claims also require a `pendingRef` so a reader can
 *    go find the branch or PR rather than taking the row's word for it.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY_PATH = path.join(REPO_ROOT, "docs/design/convergence-registry.yaml");
const REGISTRY_REL = "docs/design/convergence-registry.yaml";

const MODES = ["reuse", "adapt", "wire", "extend", "new-primitive", "retire"] as const;
const LIVE_STATES = ["live", "allowlisted", "shadow", "dormant", "missing"] as const;

/** Sentinel meaning "no subsystem owns the final contract yet". */
const UNASSIGNED = "unassigned";
/** Sentinel meaning "this row supersedes nothing". */
const NONE = "none";

type Mode = (typeof MODES)[number];
type LiveState = (typeof LIVE_STATES)[number];

type RegistryRow = {
  responsibility: string;
  intent: string;
  currentOwners: string[];
  /** Owners arriving with in-flight work. Must not exist yet (see validateRow). */
  pendingOwners: string[];
  /** Branch, PR or commit the pending owners arrive with. Required when pending. */
  pendingRef: string;
  canonicalOwner: string;
  mode: Mode;
  liveState: LiveState;
  gate: string;
  parityEvidence: string;
  retirementTarget: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Narrow an unknown field to a string without stringifying non-strings. */
function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A path claim is only checked when it is a real path rather than a sentinel. */
function isPathClaim(value: string): boolean {
  return value !== UNASSIGNED && value !== NONE;
}

function pathExists(claim: string): boolean {
  return fs.existsSync(path.join(REPO_ROOT, claim));
}

function validateRow(raw: unknown, index: number, violations: string[]): RegistryRow | null {
  const where = `${REGISTRY_REL} responsibilities[${index}]`;
  const row = asRecord(raw);
  if (!row) {
    violations.push(`${where}: row must be a mapping`);
    return null;
  }

  const id = row.responsibility;
  if (!isNonEmptyString(id)) {
    violations.push(`${where}: \`responsibility\` must be a non-empty string`);
    return null;
  }
  const label = `${REGISTRY_REL} [${id}]`;

  // Governance fields must be filled in. A blank gate or blank parity plan is how
  // a registry quietly becomes decoration.
  for (const field of ["intent", "canonicalOwner", "gate", "parityEvidence", "retirementTarget"]) {
    if (!isNonEmptyString(row[field])) {
      violations.push(`${label}: \`${field}\` must be a non-empty string`);
    }
  }

  if (!MODES.includes(row.mode as Mode)) {
    violations.push(
      `${label}: \`mode\` must be one of ${MODES.join(", ")} (got ${String(row.mode)})`,
    );
  }
  if (!LIVE_STATES.includes(row.liveState as LiveState)) {
    violations.push(
      `${label}: \`liveState\` must be one of ${LIVE_STATES.join(", ")} (got ${String(row.liveState)})`,
    );
  }

  if (!Array.isArray(row.currentOwners)) {
    violations.push(`${label}: \`currentOwners\` must be a list (use [] when nothing owns it)`);
    return null;
  }
  const owners: string[] = [];
  for (const owner of row.currentOwners) {
    if (!isNonEmptyString(owner)) {
      violations.push(`${label}: \`currentOwners\` entries must be non-empty strings`);
      continue;
    }
    owners.push(owner);
    if (!pathExists(owner)) {
      violations.push(
        `${label}: currentOwners path does not exist: ${owner} ` +
          `(the registry must not carry stale ownership claims; if the work has not ` +
          `landed on this base yet, declare it under \`pendingOwners\` instead)`,
      );
    }
  }

  // `pendingOwners` is optional; absent means the same as an empty list.
  const pending: string[] = [];
  if (row.pendingOwners !== undefined) {
    if (!Array.isArray(row.pendingOwners)) {
      violations.push(`${label}: \`pendingOwners\` must be a list when present`);
      return null;
    }
    for (const owner of row.pendingOwners) {
      if (!isNonEmptyString(owner)) {
        violations.push(`${label}: \`pendingOwners\` entries must be non-empty strings`);
        continue;
      }
      pending.push(owner);
      // The mirror rule. A pending path that already exists is no longer pending,
      // and leaving it here would let a row keep describing landed code as
      // in-flight forever.
      if (pathExists(owner)) {
        violations.push(
          `${label}: pendingOwners path already exists: ${owner} ` +
            `(the work has landed; promote it to \`currentOwners\`)`,
        );
      }
      if (owners.includes(owner)) {
        violations.push(
          `${label}: ${owner} is declared in both \`currentOwners\` and \`pendingOwners\` ` +
            `(a path is either here or it is not)`,
        );
      }
    }
  }

  const pendingRef = isNonEmptyString(row.pendingRef) ? row.pendingRef : "";
  if (pending.length > 0 && !pendingRef) {
    violations.push(
      `${label}: \`pendingRef\` is required when \`pendingOwners\` is non-empty ` +
        `(name the branch, PR or commit the pending work arrives with)`,
    );
  }
  if (pending.length === 0 && pendingRef) {
    violations.push(
      `${label}: \`pendingRef\` is set but \`pendingOwners\` is empty ` +
        `(drop the ref once the work has landed and been promoted)`,
    );
  }

  const canonicalOwner = isNonEmptyString(row.canonicalOwner) ? row.canonicalOwner : "";
  // The canonical owner may point at pending work, but only work this row itself
  // declares. Otherwise a non-existent canonicalOwner is just a typo.
  if (
    canonicalOwner &&
    isPathClaim(canonicalOwner) &&
    !pathExists(canonicalOwner) &&
    !pending.includes(canonicalOwner)
  ) {
    violations.push(
      `${label}: canonicalOwner path does not exist: ${canonicalOwner} ` +
        `(use \`${UNASSIGNED}\` when no subsystem owns the contract yet, or declare ` +
        `the path under \`pendingOwners\` when it is in flight)`,
    );
  }

  const retirementTarget = isNonEmptyString(row.retirementTarget) ? row.retirementTarget : "";
  if (retirementTarget && isPathClaim(retirementTarget) && !pathExists(retirementTarget)) {
    violations.push(
      `${label}: retirementTarget path does not exist: ${retirementTarget} ` +
        `(use \`${NONE}\` when this row supersedes nothing)`,
    );
  }

  // The fail-closed rule from §3.2. Claiming a new primitive while something
  // already implements part of the responsibility is the duplication this
  // registry exists to prevent. Pending owners count: in-flight work is still a
  // predecessor, and "it hasn't merged yet" is exactly the reasoning that
  // produces two parallel implementations.
  const allOwners = [...owners, ...pending];
  if (row.mode === "new-primitive" && allOwners.length > 0) {
    violations.push(
      `${label}: mode \`new-primitive\` requires both \`currentOwners\` and ` +
        `\`pendingOwners\` to be empty, but ${allOwners.length} owner(s) are declared ` +
        `(${allOwners.join(", ")}). ` +
        `Reclassify as reuse, adapt, wire or extend, or justify removing the existing owners.`,
    );
  }

  // `retire` without a target is a no-op that hides what is being removed.
  if (row.mode === "retire" && (!retirementTarget || retirementTarget === NONE)) {
    violations.push(`${label}: mode \`retire\` requires a concrete \`retirementTarget\` path`);
  }

  return {
    responsibility: id,
    intent: readString(row.intent),
    currentOwners: owners,
    pendingOwners: pending,
    pendingRef,
    canonicalOwner,
    mode: row.mode as Mode,
    liveState: row.liveState as LiveState,
    gate: readString(row.gate),
    parityEvidence: readString(row.parityEvidence),
    retirementTarget,
  };
}

export type CheckResult = { violations: string[]; rowCount: number; pendingRowCount: number };

/** Exported for tests so the rules can be exercised without spawning a process. */
export function checkRegistrySource(source: string): CheckResult {
  const violations: string[] = [];
  let parsed: unknown;
  try {
    parsed = parse(source) as unknown;
  } catch (error) {
    return {
      violations: [`${REGISTRY_REL}: not valid YAML: ${String(error)}`],
      rowCount: 0,
      pendingRowCount: 0,
    };
  }

  const doc = asRecord(parsed);
  if (!doc) {
    return {
      violations: [`${REGISTRY_REL}: top level must be a mapping`],
      rowCount: 0,
      pendingRowCount: 0,
    };
  }
  if (doc.version !== 1) {
    violations.push(`${REGISTRY_REL}: unsupported \`version\` ${String(doc.version)} (expected 1)`);
  }
  if (!Array.isArray(doc.responsibilities)) {
    violations.push(`${REGISTRY_REL}: \`responsibilities\` must be a list`);
    return { violations, rowCount: 0, pendingRowCount: 0 };
  }

  const seen = new Set<string>();
  const rows: RegistryRow[] = [];
  for (const [index, raw] of doc.responsibilities.entries()) {
    const row = validateRow(raw, index, violations);
    if (!row) {
      continue;
    }
    if (seen.has(row.responsibility)) {
      violations.push(`${REGISTRY_REL} [${row.responsibility}]: duplicate responsibility id`);
    }
    seen.add(row.responsibility);
    rows.push(row);
  }

  return {
    violations,
    rowCount: rows.length,
    pendingRowCount: rows.filter((candidate) => candidate.pendingOwners.length > 0).length,
  };
}

function main(): void {
  if (!fs.existsSync(REGISTRY_PATH)) {
    console.error(`missing convergence registry: ${REGISTRY_REL}`);
    process.exit(1);
  }
  const { violations, rowCount, pendingRowCount } = checkRegistrySource(
    fs.readFileSync(REGISTRY_PATH, "utf8"),
  );
  if (violations.length > 0) {
    console.error(`convergence registry check failed (${violations.length} violation(s)):\n`);
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    process.exit(1);
  }
  // Surfacing the pending count keeps in-flight rows visible instead of letting
  // them sit silently in a green check.
  const pendingNote =
    pendingRowCount > 0 ? ` (${pendingRowCount} with pending owners awaiting promotion)` : "";
  console.log(`convergence registry ok: ${rowCount} responsibilities${pendingNote}`);
}

// Only run when invoked directly, so tests can import the pure checker.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
