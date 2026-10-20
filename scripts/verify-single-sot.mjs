#!/usr/bin/env node
/**
 * S01 R6 single-SoT machine check.
 *
 * Aligned with the current architecture:
 *   - Catalog SoT is WorkspaceResourceCatalog in src/gateway/workspace-resolver/catalog.ts
 *   - Projection helpers live in src/gateway/data-governance/workspace-catalog-projection.ts
 *   - S01 D1–D5 contract is non-production: docs/design/contracts/
 *   - There is no src/gateway/workspace-catalog/ tree and no SQL migrations dir
 *
 * This is a design-slice machine check, not implementation verification.
 * P99, production security tests, and audit-failure behavior remain design targets.
 *
 * Usage:
 *   pnpm verify:single-sot
 *   node scripts/verify-single-sot.mjs
 *   node scripts/verify-single-sot.mjs --write-evidence
 *
 * Exit: 0 pass / 1 fail / 2 fatal
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");

const FORBIDDEN_TABLES = ["workspace_handles", "authorized_cwds", "tenant_memberships"];
const PHANTOM_PATHS = ["src/gateway/workspace-catalog", "src/gateway/workspace-catalog/migrations"];
const REQUIRED_PATHS = {
  uniqueHandoff:
    ".kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md",
  designPackage: ".kiro/specs/memory-workspace-platform-remediation/s01-d1-d5-design-package.md",
  reviewGuide: "docs/design/handoff-s01-design-review-guide.md",
  contract: "docs/design/contracts/s01-trusted-principal-handle-contract.ts",
  contractTest: "docs/design/contracts/s01-trusted-principal-handle-contract.test.ts",
  catalogPort: "src/gateway/workspace-resolver/catalog.ts",
  catalogProjection: "src/gateway/data-governance/workspace-catalog-projection.ts",
};
const SCAN_FILES = [REQUIRED_PATHS.contract, REQUIRED_PATHS.contractTest];
const FORBIDDEN_IMPORTS = [
  /\bfrom\s+["']pg["']/,
  /\bfrom\s+["']mysql2?["']/,
  /\bfrom\s+["']mongodb["']/,
  /\brequire\(\s*["']pg["']\s*\)/,
];
const CREATE_FORBIDDEN_TABLE = new RegExp(
  String.raw`CREATE\s+TABLE[\s\S]{0,80}(${FORBIDDEN_TABLES.join("|")})`,
  "i",
);

function gitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function readRel(fileRel) {
  return readFileSync(path.join(ROOT, fileRel), "utf8");
}

function checkRequiredPaths() {
  const violations = [];
  for (const [name, fileRel] of Object.entries(REQUIRED_PATHS)) {
    if (!existsSync(path.join(ROOT, fileRel))) {
      violations.push(`missing required path (${name}): ${fileRel}`);
    }
  }
  return violations;
}

function checkPhantomPaths() {
  const violations = [];
  for (const fileRel of PHANTOM_PATHS) {
    if (existsSync(path.join(ROOT, fileRel))) {
      violations.push(
        `phantom architecture path exists: ${fileRel} (current SoT is workspace-resolver catalog + data-governance projection; do not add this tree)`,
      );
    }
  }
  return violations;
}

function checkStaticScan() {
  const violations = [];
  for (const fileRel of SCAN_FILES) {
    const abs = path.join(ROOT, fileRel);
    if (!existsSync(abs)) {
      continue;
    }
    const content = readFileSync(abs, "utf8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of FORBIDDEN_IMPORTS) {
        if (pattern.test(line)) {
          violations.push(`${fileRel}:${i + 1} forbidden database import: ${line.trim()}`);
        }
      }
    }
    if (CREATE_FORBIDDEN_TABLE.test(content)) {
      violations.push(`${fileRel} contains CREATE TABLE for a forbidden independent Catalog table`);
    }
  }
  return violations;
}

function checkCatalogEncapsulation() {
  const violations = [];
  const contract = readRel(REQUIRED_PATHS.contract);
  const contractTest = readRel(REQUIRED_PATHS.contractTest);
  const catalogPort = readRel(REQUIRED_PATHS.catalogPort);

  if (!contract.includes("S01CatalogViewPort")) {
    violations.push("contract does not define S01CatalogViewPort");
  }
  if (!contract.includes("evaluateS01AuthorizedToolCwd")) {
    violations.push("contract does not export evaluateS01AuthorizedToolCwd");
  }
  if (!contract.includes("S01_INDEPENDENT_CATALOG_TABLES")) {
    violations.push("contract does not list forbidden independent Catalog tables");
  }
  for (const table of FORBIDDEN_TABLES) {
    if (!contract.includes(`"${table}"`)) {
      violations.push(`contract missing forbidden table name ${table}`);
    }
  }
  if (!contractTest.includes("InMemoryWorkspaceResourceCatalog")) {
    violations.push("contract test does not inject InMemoryWorkspaceResourceCatalog");
  }
  if (!contractTest.includes("workspace-resolver/catalog.js")) {
    violations.push("contract test must import the existing workspace-resolver catalog adapter");
  }
  if (!catalogPort.includes("export class InMemoryWorkspaceResourceCatalog")) {
    violations.push("workspace-resolver catalog is missing InMemoryWorkspaceResourceCatalog");
  }
  return violations;
}

function checkHandoffNormativeSource() {
  const violations = [];
  const handoff = readRel(REQUIRED_PATHS.uniqueHandoff);
  const pack = readRel(REQUIRED_PATHS.designPackage);
  const guide = readRel(REQUIRED_PATHS.reviewGuide);

  for (const [label, text] of [
    ["unique handoff marker", /唯一 handoff/],
    ["design vs implementation", /designComplete/],
    ["implementation not verified", /implementationVerified:\s*false/],
    ["R6 script citation", /scripts\/verify-single-sot\.mjs/],
    ["contract path", /docs\/design\/contracts\/s01-trusted-principal-handle-contract\.ts/],
    ["catalog port path", /src\/gateway\/workspace-resolver\/catalog\.ts/],
    ["no phantom migrations", /workspace-catalog\/migrations/],
    ["P99 design-only", /design target, not verified/],
  ]) {
    if (!text.test(handoff)) {
      violations.push(`unique handoff missing ${label}`);
    }
  }
  if (!pack.includes("docs/design/contracts/s01-trusted-principal-handle-contract.ts")) {
    violations.push("design package has the wrong contract path");
  }
  if (!pack.includes("scripts/verify-single-sot.mjs")) {
    violations.push("design package does not cite the R6 machine check");
  }
  if (!guide.includes("唯一 handoff") || !guide.includes("SUPERSEDED")) {
    violations.push(
      "review guide must point at the unique handoff and mark branch-only patches superseded",
    );
  }
  if (
    /契约模块：`src\/gateway\/data-governance\/s01-trusted-principal-handle-contract\.ts`/.test(
      handoff,
    )
  ) {
    violations.push(
      "unique handoff still cites the removed production-src contract path as the live module",
    );
  }
  return violations;
}

function buildEvidence(result) {
  return {
    taskId: "cursor-s01-r6-replay-v2",
    purpose: "S01 R6 single-SoT machine check against the current Catalog architecture",
    status: result.passed ? "passed" : "failed",
    classification: {
      designComplete: true,
      implementationVerified: false,
      r6MachineCheck: result.passed ? "passed" : "failed",
      p99: "design-target-not-verified",
      r1r3SecurityTests: "design-target-not-verified",
      r5AuditFailureBehavior: "design-target-not-verified",
    },
    architecture: {
      catalogPort: REQUIRED_PATHS.catalogPort,
      catalogProjection: REQUIRED_PATHS.catalogProjection,
      nonProductionContract: REQUIRED_PATHS.contract,
      phantomPathsMustNotExist: PHANTOM_PATHS,
      forbiddenIndependentTables: FORBIDDEN_TABLES,
    },
    normativeSources: {
      uniqueHandoff: REQUIRED_PATHS.uniqueHandoff,
      designPackage: REQUIRED_PATHS.designPackage,
      reviewGuide: REQUIRED_PATHS.reviewGuide,
      branchOnlySupersededAsSecondSpec: [
        "docs/design/handoff-s01-d1-convergence-patch.md",
        "docs/design/handoff-s01-d2-d4-d5-convergence-patches.md",
        "docs/design/handoff-s01-revision-r1-anonymous-local-security.md",
        "docs/design/handoff-s01-revision-r3-trusted-proxy-threat-model.md",
        "docs/design/handoff-s01-revision-r4-performance-benchmark.md",
        "docs/design/handoff-s01-revision-r5-audit-failure-semantics.md",
        "docs/design/handoff-s01-revision-r6-single-sot-verification.md",
      ],
    },
    command: "node scripts/verify-single-sot.mjs",
    pnpmScript: "pnpm verify:single-sot",
    ciGate: ".github/workflows/ci-gate.yml job check step S01 R6 single-SoT machine check",
    gitSha: gitSha(),
    checks: result.checks,
    violations: result.violations,
  };
}

function main() {
  const writeEvidence = process.argv.includes("--write-evidence");
  const checks = {};
  const violations = [];

  const required = checkRequiredPaths();
  checks.requiredPaths = required.length === 0;
  violations.push(...required);

  const phantom = checkPhantomPaths();
  checks.phantomPathsAbsent = phantom.length === 0;
  violations.push(...phantom);

  if (required.length === 0) {
    const scan = checkStaticScan();
    checks.staticScan = scan.length === 0;
    violations.push(...scan);

    const api = checkCatalogEncapsulation();
    checks.catalogEncapsulation = api.length === 0;
    violations.push(...api);

    const docs = checkHandoffNormativeSource();
    checks.normativeSources = docs.length === 0;
    violations.push(...docs);
  } else {
    checks.staticScan = false;
    checks.catalogEncapsulation = false;
    checks.normativeSources = false;
  }

  const passed = violations.length === 0;
  const evidence = buildEvidence({ passed, checks, violations });

  if (writeEvidence) {
    const outRel = "docs/design/evidence/memory-workspace-s01-r6-single-sot.json";
    const outAbs = path.join(ROOT, outRel);
    mkdirSync(path.dirname(outAbs), { recursive: true });
    writeFileSync(outAbs, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`wrote ${outRel}`);
  }

  const why = {
    requiredPaths:
      "unique handoff, D1-D5 package, review guide, non-prod contract, catalog port, and projection must exist",
    phantomPathsAbsent:
      "src/gateway/workspace-catalog and .../migrations must be absent; existence is a violation (current SoT is workspace-resolver + projection)",
    staticScan:
      "non-prod contract/test must not CREATE forbidden tables or import pg/mysql/mongodb",
    catalogEncapsulation:
      "contract exposes S01CatalogViewPort / evaluateS01AuthorizedToolCwd; tests inject InMemoryWorkspaceResourceCatalog",
    normativeSources:
      "unique handoff must keep designComplete + implementationVerified:false and must not require phantom migrations",
  };

  console.log("S01 R6 single-SoT machine check");
  console.log(`gitSha=${evidence.gitSha}`);
  console.log(`designComplete=${evidence.classification.designComplete}`);
  console.log(`implementationVerified=${evidence.classification.implementationVerified}`);
  for (const [name, ok] of Object.entries(checks)) {
    console.log(`  ${ok ? "PASS" : "FAIL"} ${name}`);
    console.log(`    why: ${why[name] ?? "see violations"}`);
  }
  if (!passed) {
    console.log("violations:");
    for (const item of violations) {
      console.log(`  - ${item}`);
    }
  }
  console.log(JSON.stringify({ passed, violationCount: violations.length }));
  process.exit(passed ? 0 : 1);
}

main();
