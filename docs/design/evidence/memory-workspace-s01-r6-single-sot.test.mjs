#!/usr/bin/env node --no-warnings
/**
 * Evidence test: S01 R6 single-SoT machine check.
 *
 * Design-slice only. Does not mark P99 / R1 / R3 / R5 as implementation-verified.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");
const evidencePath = join(__dirname, "memory-workspace-s01-r6-single-sot.json");
const scriptPath = join(repoRoot, "scripts/verify-single-sot.mjs");

void test("phantom workspace-catalog migrations directory is absent", () => {
  assert.equal(existsSync(join(repoRoot, "src/gateway/workspace-catalog")), false);
  assert.equal(existsSync(join(repoRoot, "src/gateway/workspace-catalog/migrations")), false);
  assert.equal(existsSync(join(repoRoot, "src/gateway/workspace-resolver/catalog.ts")), true);
});

void test("committed evidence snapshot classifies design vs implementation", () => {
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  assert.strictEqual(evidence.classification.designComplete, true);
  assert.strictEqual(evidence.classification.implementationVerified, false);
  assert.strictEqual(evidence.classification.p99, "design-target-not-verified");
  assert.strictEqual(evidence.classification.r1r3SecurityTests, "design-target-not-verified");
  assert.strictEqual(evidence.classification.r5AuditFailureBehavior, "design-target-not-verified");
  assert.deepStrictEqual(evidence.architecture.phantomPathsMustNotExist, [
    "src/gateway/workspace-catalog",
    "src/gateway/workspace-catalog/migrations",
  ]);
  assert.strictEqual(evidence.command, "node scripts/verify-single-sot.mjs");
});

void test("live verify-single-sot.mjs exits 0 and reports passed", () => {
  const run = spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.strictEqual(run.status, 0, run.stderr || run.stdout);
  const lines = run.stdout.trim().split("\n");
  const summary = JSON.parse(lines.at(-1));
  assert.strictEqual(summary.passed, true);
  assert.strictEqual(summary.violationCount, 0);
  assert.match(run.stdout, /implementationVerified=false/);
  assert.match(run.stdout, /PASS phantomPathsAbsent/);
});
