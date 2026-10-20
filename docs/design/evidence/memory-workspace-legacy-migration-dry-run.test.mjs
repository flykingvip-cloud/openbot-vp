#!/usr/bin/env node --no-warnings
/**
 * Evidence test: legacy data migration inventory + dry-run only.
 *
 * Locks productionWrite/catalogMutation/migrationExecuted/delete/cutover false,
 * scan 10/10, implementationVerified=false, deployAuthorized=false,
 * live=forbidden, item7=not-met. Does not mutate Catalog or production files.
 */

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  decideMigration,
  detectCrossTenant,
  evaluateLegacyMigrationDryRun,
  parseResourceId,
  REQUIRED_DOMAINS,
  sha256Text,
  stableStringify,
  TASK_ID,
} from "./memory-workspace-legacy-migration-dry-run.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");

function load(name) {
  return JSON.parse(readFileSync(join(here, name), "utf8"));
}

function gitDiffVsMain(file) {
  const base = execFileSync("git", ["merge-base", "origin/main", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  return execFileSync("git", ["diff", "--name-only", base, "HEAD", "--", file], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

void test("locks productionWrite catalogMutation migrationExecuted delete cutover scan and gates", () => {
  const packet = load("memory-workspace-legacy-migration-dry-run.json");
  assert.equal(packet.kind, "legacy-migration-dry-run");
  assert.equal(packet.taskId, TASK_ID);
  assert.equal(packet.owner, "kiro-data-governance");
  assert.equal(packet.selfAccepted, false);
  assert.equal(packet.productionWrite, false);
  assert.equal(packet.catalogMutation, false);
  assert.equal(packet.migrationExecuted, false);
  assert.equal(packet.delete, false);
  assert.equal(packet.cutover, false);
  assert.equal(packet.remaining, 10);
  assert.equal(packet.liveWriteWatchIndex, 10);
  assert.equal(packet.implementationVerified, false);
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.live, "forbidden");
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.locks.productionWrite, false);
  assert.equal(packet.locks.catalogMutation, false);
  assert.equal(packet.locks.migrationExecuted, false);
  assert.equal(packet.locks.delete, false);
  assert.equal(packet.locks.cutover, false);
  assert.equal(packet.locks.remaining, 10);
  assert.equal(packet.locks.liveWriteWatchIndex, 10);
  assert.equal(packet.locks.implementationVerified, false);
  assert.equal(packet.locks.deployAuthorized, false);
  assert.equal(packet.locks.live, "forbidden");
  assert.equal(packet.locks.item7, "not-met");
  assert.equal(packet.catalogMinted, false);
  assert.equal(packet.guessedOwnership, false);
});

void test("retirement-scan remaining=10 and liveWriteWatchIndex=10", () => {
  const scan = load("memory-workspace-phase1b-item7-retirement-scan.json");
  assert.equal(scan.remaining, 10);
  assert.equal(scan.liveWriteWatchIndex, 10);
  assert.equal(scan.item7, "not-met");
  const packet = load("memory-workspace-legacy-migration-dry-run.json");
  assert.equal(packet.remaining, scan.remaining);
  assert.equal(packet.liveWriteWatchIndex, scan.liveWriteWatchIndex);
});

void test("get-reply.ts:164 still resolveEmployeeBuiltinStewardWorkspaceDir", () => {
  const getReply = readFileSync(join(repoRoot, "src/auto-reply/reply/get-reply.ts"), "utf8");
  const lines = getReply.split("\n");
  assert.match(lines[163] ?? "", /resolveEmployeeBuiltinStewardWorkspaceDir/);
});

void test("manager-sync-ops.ts not modified by this branch", () => {
  assert.equal(gitDiffVsMain("src/memory/manager-sync-ops.ts"), "");
  assert.equal(
    gitDiffVsMain("docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json"),
    "",
  );
  assert.equal(gitDiffVsMain("src/auto-reply/reply/get-reply.ts"), "");
});

void test("replayable manifests match simulator checksums and execute nothing", () => {
  const result = evaluateLegacyMigrationDryRun(repoRoot);
  const packet = load("memory-workspace-legacy-migration-dry-run.json");
  const manifest = load("memory-workspace-legacy-migration-dry-run.manifest.json");
  const rollback = load("memory-workspace-legacy-migration-dry-run.rollback.json");
  const quarantine = load("memory-workspace-legacy-migration-dry-run.quarantine.json");

  assert.equal(sha256Text(stableStringify(manifest)), packet.checksums.migrationManifest);
  assert.equal(sha256Text(stableStringify(rollback)), packet.checksums.rollbackManifest);
  assert.equal(sha256Text(stableStringify(quarantine)), packet.checksums.quarantineManifest);
  assert.equal(result.checksums.migrationManifest, packet.checksums.migrationManifest);
  assert.equal(result.checksums.rollbackManifest, packet.checksums.rollbackManifest);
  assert.equal(result.checksums.quarantineManifest, packet.checksums.quarantineManifest);

  assert.equal(manifest.executed, false);
  assert.equal(manifest.catalogMutation, false);
  assert.equal(manifest.productionWrite, false);
  assert.equal(manifest.delete, false);
  assert.equal(manifest.cutover, false);
  assert.equal(rollback.executed, false);
  assert.deepEqual(rollback.executedMoves, []);
  assert.deepEqual(rollback.executedDeletes, []);
  assert.deepEqual(rollback.executedCatalogMutations, []);
  assert.deepEqual(rollback.rollbackActions, []);
  assert.equal(quarantine.guessedOwnership, false);
});

void test("inventory covers required domains and every record has required fields", () => {
  const manifest = load("memory-workspace-legacy-migration-dry-run.manifest.json");
  const domains = new Set(manifest.records.map((row) => row.domain));
  for (const domain of REQUIRED_DOMAINS) {
    assert.ok(domains.has(domain), "missing domain " + domain);
  }
  const required = [
    "sourceLocator",
    "resourceId",
    "tenantId",
    "ownerScope",
    "ownerId",
    "agentAssetId",
    "classification",
    "canonicalBinding",
    "contentHash",
    "fileCount",
    "byteCount",
    "migrationDecision",
    "blocker",
  ];
  for (const record of manifest.records) {
    for (const key of required) {
      assert.ok(key in record, "missing field " + key + " on " + record.candidateId);
    }
    assert.equal(record.catalogMinted, false);
    assert.equal(record.productionTouched, false);
    assert.notEqual(record.migrationDecision, "migrate");
  }
});

void test("unknown ownership quarantines; missing catalog does not mint; preserve legal hold", () => {
  const unknown = decideMigration(
    {
      classification: "unknown",
      ownerId: null,
      ownerScope: "unknown",
      legalHold: false,
      catalogBindingPresent: false,
      sourceLocator: "/tmp/x",
    },
    {
      catalogExists: false,
      canonicalLocatorCounts: new Map(),
      canonicalResourceIdCounts: new Map(),
    },
  );
  assert.equal(unknown.migrationDecision, "quarantine");
  assert.equal(unknown.blocker, "unknown-ownership");

  const classified = decideMigration(
    {
      classification: "classified",
      ownerId: "user-1",
      ownerScope: "user",
      legalHold: false,
      catalogBindingPresent: false,
      canonicalBinding: { role: "canonical", locator: "/ws/a" },
      resourceId: "ws:t1:user:user-1:asset:a1",
      sourceLocator: "/ws/a",
      crossTenant: false,
    },
    {
      catalogExists: false,
      canonicalLocatorCounts: new Map([["/ws/a", 1]]),
      canonicalResourceIdCounts: new Map([["ws:t1:user:user-1:asset:a1", 1]]),
    },
  );
  assert.equal(classified.migrationDecision, "do-not-mint");
  assert.equal(classified.blocker, "missing-catalog-binding");

  const dup = decideMigration(
    {
      classification: "classified",
      ownerId: "user-1",
      ownerScope: "user",
      legalHold: false,
      catalogBindingPresent: true,
      canonicalBinding: { role: "canonical", locator: "/ws/a" },
      resourceId: "ws:t1:user:user-1:asset:a1",
      sourceLocator: "/ws/a",
      crossTenant: false,
    },
    {
      catalogExists: true,
      canonicalLocatorCounts: new Map([["/ws/a", 2]]),
      canonicalResourceIdCounts: new Map([["ws:t1:user:user-1:asset:a1", 1]]),
    },
  );
  assert.equal(dup.migrationDecision, "block");
  assert.equal(dup.blocker, "duplicate-canonical-binding");

  const cross = decideMigration(
    {
      classification: "classified",
      ownerId: "user-1",
      ownerScope: "user",
      legalHold: false,
      catalogBindingPresent: true,
      canonicalBinding: { role: "canonical", locator: "tenants/tenant-B/users/u/ws" },
      resourceId: "ws:tenant-A:user:user-1:asset:a1",
      sourceLocator: "tenants/tenant-B/users/u/ws",
      crossTenant: true,
    },
    {
      catalogExists: true,
      canonicalLocatorCounts: new Map([["tenants/tenant-B/users/u/ws", 1]]),
      canonicalResourceIdCounts: new Map([["ws:tenant-A:user:user-1:asset:a1", 1]]),
    },
  );
  assert.equal(cross.migrationDecision, "block");
  assert.equal(cross.blocker, "cross-tenant");

  const hold = decideMigration(
    {
      classification: "unknown",
      ownerId: null,
      ownerScope: "unknown",
      legalHold: false,
      retention: true,
      lifecycle: "retention",
      catalogBindingPresent: false,
      sourceLocator: "tenants/<tenantId>/archive/",
    },
    {
      catalogExists: false,
      canonicalLocatorCounts: new Map(),
      canonicalResourceIdCounts: new Map(),
    },
  );
  assert.equal(hold.migrationDecision, "preserve");
  assert.equal(hold.blocker, "legal-hold-or-retention-or-tombstone");

  assert.equal(
    detectCrossTenant(
      "ws:tenant-A:user:user-1:asset:a1",
      "tenants/tenant-B/users/u/OpenBot/workspace",
    ),
    true,
  );
  assert.equal(
    detectCrossTenant(
      "ws:tenant-A:user:user-1:asset:a1",
      "tenants/<tid>/users/u/OpenBot/workspace",
    ),
    false,
  );
  const parsed = parseResourceId(
    "ws:tenant-7a3e6b16cb75:user:user-7b745952c1b9:asset:asset-c5daccd7846d",
  );
  assert.equal(parsed.tenantId, "tenant-7a3e6b16cb75");
  assert.equal(parsed.ownerScope, "user");
  assert.equal(parsed.ownerId, "user-7b745952c1b9");
  assert.equal(parsed.agentAssetId, "asset-c5daccd7846d");
});

void test("simulator source cannot write Catalog or production files", () => {
  const src = readFileSync(join(here, "memory-workspace-legacy-migration-dry-run.mjs"), "utf8");
  assert.doesNotMatch(src, /writeFileSync/);
  assert.doesNotMatch(src, /renameSync/);
  assert.doesNotMatch(src, /unlinkSync/);
  assert.doesNotMatch(src, /rmSync/);
  assert.doesNotMatch(src, /mkdirSync/);
  assert.doesNotMatch(src, /copyFileSync/);
  const packet = load("memory-workspace-legacy-migration-dry-run.json");
  assert.ok(packet.notDone.includes("did not write Catalog"));
  assert.ok(packet.notDone.includes("did not guess unknown ownership"));
});
