import fs from "node:fs";
import path from "node:path";

/** @typedef {{ id: string; pass: boolean; detail: string }} ExitGateCheck */

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

const REQUIRED_EVIDENCE = [
  "docs/design/memory-workspace-identity-remediation-2026-08-14.md",
  "docs/design/evidence/memory-workspace-phase0-20260814.call-sites.json",
  "docs/design/evidence/memory-workspace-phase0-20260814.catalog-candidate.json",
  "docs/design/evidence/memory-workspace-phase0-20260814.sqlite-risks.json",
  "docs/design/evidence/memory-workspace-phase0-20260814.summary.md",
  "docs/design/evidence/memory-workspace-phase0-live-20260814.summary.json",
  ".kiro/specs/memory-workspace-platform-remediation/ws-c-v1-bootstrap-receipt.json",
  ".github/workflows/memory-workspace-freeze.yml",
  "src/memory/v1-root-guard.ts",
  "src/memory/manager-sync-ops.ts",
];

const REQUIRED_CALL_SITE_PATHS = ["P1", "P2", "P3", "P4", "P5", "P6", "P8"];

/**
 * Phase 0 engineering exit gate (repo-verifiable).
 * Governance sign-off (official-review, runner persistence) is reported separately.
 *
 * @param {{ repoRoot?: string }} [options]
 */
export function evaluatePhase0ExitGate(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  /** @type {ExitGateCheck[]} */
  const checks = [];

  for (const rel of REQUIRED_EVIDENCE) {
    const abs = path.join(repoRoot, rel);
    checks.push({
      id: `file:${rel}`,
      pass: fs.existsSync(abs),
      detail: fs.existsSync(abs) ? "present" : "missing",
    });
  }

  const liveSummary = readJson(
    repoRoot,
    "docs/design/evidence/memory-workspace-phase0-live-20260814.summary.json",
  );
  const quarantineOpen = Array.isArray(liveSummary?.quarantineOpen)
    ? liveSummary.quarantineOpen
    : [];
  checks.push({
    id: "live:quarantine-disposition",
    pass: quarantineOpen.length >= 4,
    detail: `quarantineOpen entries=${quarantineOpen.length}`,
  });

  const notClassified = liveSummary?.p0ExitGate?.notClassifiedCount;
  checks.push({
    id: "live:not-classified-documented",
    pass: typeof notClassified === "number" && notClassified > 0,
    detail: `notClassifiedCount=${notClassified ?? "missing"}`,
  });

  const catalog = readJson(
    repoRoot,
    "docs/design/evidence/memory-workspace-phase0-20260814.catalog-candidate.json",
  );
  const conflictListed = catalog?.coverage?.conflict_or_unknown?.listed === true;
  checks.push({
    id: "catalog:conflict-unknown-listed",
    pass: conflictListed,
    detail: conflictListed
      ? "conflict/unknown inventory listed"
      : "missing conflict_or_unknown.listed",
  });
  checks.push({
    id: "catalog:coverage-reproducible",
    pass: catalog?.coverage != null && typeof catalog.sourceRootCount === "number",
    detail: `sourceRootCount=${catalog?.sourceRootCount ?? "missing"}`,
  });

  const sqliteRisks = readJson(
    repoRoot,
    "docs/design/evidence/memory-workspace-phase0-20260814.sqlite-risks.json",
  );
  checks.push({
    id: "sqlite:identified",
    pass: sqliteRisks?.gate?.identified === true,
    detail: sqliteRisks?.gate?.identified
      ? "v1 multi-root risks identified"
      : "gate.identified not true",
  });

  const callSites = readJson(
    repoRoot,
    "docs/design/evidence/memory-workspace-phase0-20260814.call-sites.json",
  );
  const presentPaths = new Set(Object.keys(callSites?.counts ?? callSites?.paths ?? {}));
  const missingPaths = REQUIRED_CALL_SITE_PATHS.filter((p) => !presentPaths.has(p));
  checks.push({
    id: "call-sites:baseline-paths",
    pass: missingPaths.length === 0,
    detail:
      missingPaths.length === 0 ? "P1-P8 baseline present" : `missing ${missingPaths.join(", ")}`,
  });

  const receipt = readJson(
    repoRoot,
    ".kiro/specs/memory-workspace-platform-remediation/ws-c-v1-bootstrap-receipt.json",
  );
  checks.push({
    id: "bootstrap:deploy-not-authorized",
    pass: receipt?.deployAuthorized === false,
    detail: `deployAuthorized=${String(receipt?.deployAuthorized)}`,
  });
  checks.push({
    id: "bootstrap:ws-c-not-closed",
    pass: receipt?.closesWsC === false,
    detail: `closesWsC=${String(receipt?.closesWsC)}`,
  });

  const managerSyncOps = readText(repoRoot, "src/memory/manager-sync-ops.ts");
  const v1GuardWiredStrict =
    managerSyncOps.includes("beginV1Operation") &&
    managerSyncOps.includes("assertV1RootGuardDecision") &&
    managerSyncOps.includes("v1-root-guard");
  checks.push({
    id: "runtime:v1-guard-wired",
    pass: v1GuardWiredStrict,
    detail: v1GuardWiredStrict
      ? "manager-sync-ops imports and calls v1 root guard via beginV1Operation"
      : "manager-sync-ops missing beginV1Operation / assertV1RootGuardDecision wiring",
  });

  const knownMultiRoot = Array.isArray(receipt?.classes?.known_multi_root)
    ? receipt.classes.known_multi_root.length
    : 0;
  const dualTree = Array.isArray(sqliteRisks?.dualTreeSqlite)
    ? sqliteRisks.dualTreeSqlite.length
    : 0;
  const manyToMany = Array.isArray(sqliteRisks?.manyToMany?.observed)
    ? sqliteRisks.manyToMany.observed.length
    : 0;
  checks.push({
    id: "bootstrap:known-multi-root-aligned",
    pass: knownMultiRoot >= dualTree && knownMultiRoot > 0,
    detail: `receipt=${knownMultiRoot} dualTree=${dualTree} manyToMany=${manyToMany}`,
  });

  const engineeringPass = checks.every((c) => c.pass);

  const signOff = readJson(
    repoRoot,
    "docs/design/evidence/memory-workspace-phase0-20260814.sign-off.json",
  );
  const phase0Accepted = signOff?.phase0Accepted === true && engineeringPass;
  /** @type {string[]} */
  const governanceBlockers = [];
  if (!engineeringPass) {
    governanceBlockers.push("engineering-exit-gate-failed");
  }
  if (!phase0Accepted) {
    if (signOff?.phase0Accepted !== true) {
      governanceBlockers.push("official-review-sign-off-missing");
    }
  }
  if (signOff?.liveDeployAuthorized === true) {
    governanceBlockers.push("invalid-live-deploy-authorized-in-sign-off");
  }

  return {
    schema: "memory-workspace-phase0-exit-gate/v1",
    evidenceId: "memory-workspace-phase0-20260814",
    evaluatedAt: new Date().toISOString(),
    engineeringGate: {
      pass: engineeringPass,
      checks,
    },
    governanceGate: {
      pass: phase0Accepted && governanceBlockers.length === 0,
      blockers: governanceBlockers,
      signOffMainSha: signOff?.mainSha ?? null,
      note: phase0Accepted
        ? "Phase 0 Mark Accepted per sign-off record. LIVE deploy, schema v2, and Resolver write switch remain blocked."
        : "Phase 0 Mark Accepted blocked until official-review sign-off record is present and engineering gate passes.",
    },
    phase0Accepted,
    deployAuthorized: receipt?.deployAuthorized === false ? false : null,
    closesWsC: receipt?.closesWsC === false ? false : null,
  };
}

/** @param {string} repoRoot @param {string} rel */
function readJson(repoRoot, rel) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

/** @param {string} repoRoot @param {string} rel */
function readText(repoRoot, rel) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    return "";
  }
  return fs.readFileSync(abs, "utf8");
}

function main() {
  const result = evaluatePhase0ExitGate();
  const json = JSON.stringify(result, null, 2);
  if (process.argv.includes("--json")) {
    process.stdout.write(`${json}\n`);
  } else {
    process.stdout.write(`${json}\n`);
  }
  if (!result.engineeringGate.pass) {
    process.exitCode = 1;
  }
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main();
}
