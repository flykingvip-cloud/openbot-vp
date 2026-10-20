#!/usr/bin/env node --no-warnings
/**
 * Evidence test: S01 read-only production object inventory.
 * Locks productionScanExecuted/catalogWrite/moved/deleted/LIVE/remaining.
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

function load(name) {
  return JSON.parse(readFileSync(join(__dirname, name), "utf8"));
}

void test("locks production object inventory gates", () => {
  const packet = load("memory-workspace-s01-production-object-inventory.json");
  assert.equal(packet.schema, "memory-workspace-s01-production-object-inventory/v1");
  assert.equal(packet.kind, "s01-production-object-inventory");
  assert.equal(packet.productionScanExecuted, false);
  assert.equal(packet.catalogWrite, false);
  assert.equal(packet.catalogMutation, false);
  assert.equal(packet.moved, false);
  assert.equal(packet.deleted, false);
  assert.equal(packet.productionWrite, false);
  assert.equal(packet.cutover, false);
  assert.equal(packet.stageC, "prepared-not-accepted");
  assert.equal(packet.authorizesStageCAccept, false);
  assert.equal(packet.implementationVerified, false);
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.remaining, 10);
  assert.equal(packet.liveWriteWatchIndex, 10);
  assert.equal(packet.LIVE, "forbidden");
  assert.equal(packet.productionReceiptsObserved, 0);
  assert.equal(packet.byosEnabled, false);
  assert.equal(packet.guessesOwnerFromDirectoryName, false);
  assert.equal(packet.readsActualObjects, true);
  assert.equal(packet.selfAccepted, false);
  assert.equal(packet.locks.productionScanExecuted, false);
  assert.equal(packet.locks.catalogWrite, false);
  assert.equal(packet.locks.catalogMutation, false);
  assert.equal(packet.locks.moved, false);
  assert.equal(packet.locks.deleted, false);
  assert.equal(packet.locks.productionWrite, false);
  assert.equal(packet.locks.cutover, false);
  assert.equal(packet.locks.stageC, "prepared-not-accepted");
  assert.equal(packet.locks.authorizesStageCAccept, false);
  assert.equal(packet.locks.implementationVerified, false);
  assert.equal(packet.locks.deployAuthorized, false);
  assert.equal(packet.locks.phase1bExecutionBlocked, true);
  assert.equal(packet.locks.item7, "not-met");
  assert.equal(packet.locks.remaining, 10);
  assert.equal(packet.locks.liveWriteWatchIndex, 10);
  assert.equal(packet.locks.LIVE, "forbidden");
  assert.equal(packet.locks.productionReceiptsObserved, 0);
  assert.equal(packet.locks.byosEnabled, false);
  assert.equal(packet.locks.guessesOwnerFromDirectoryName, false);
  assert.equal(packet.locks.readsActualObjects, true);
});

void test("ExplicitlyForbidden covers catalog/move/LIVE/dirname/BYOS/scan/cwd", () => {
  const packet = load("memory-workspace-s01-production-object-inventory.json");
  const forbidden = packet.ExplicitlyForbidden;
  const required = [
    "Catalog write",
    "move/delete",
    "Stage C Accept",
    "Stage D",
    "LIVE",
    "guess owner from dirname",
    "treat repo-tree dry-run as production inventory",
    "enable BYOS",
    "change retirement scan",
    "change get-reply helper cwd",
  ];
  for (const item of required) {
    assert.ok(forbidden.includes(item), "missing ExplicitlyForbidden: " + item);
  }
});

void test("retirement-scan remaining stays 10/10", () => {
  const scanPath = join(__dirname, "memory-workspace-phase1b-item7-retirement-scan.json");
  assert.equal(existsSync(scanPath), true);
  const scan = JSON.parse(readFileSync(scanPath, "utf8"));
  assert.equal(scan.remaining, 10);
  assert.equal(scan.liveWriteWatchIndex, 10);
  const packet = load("memory-workspace-s01-production-object-inventory.json");
  assert.equal(packet.remaining, scan.remaining);
  assert.equal(packet.liveWriteWatchIndex, scan.liveWriteWatchIndex);
});

void test("scanner source is read-only and does not guess owner from dirname", () => {
  const src = readFileSync(
    join(repoRoot, "src/gateway/data-governance/production-object-inventory.ts"),
    "utf8",
  );
  assert.match(src, /scanProductionObjects/);
  assert.match(src, /scanLocalRootToObjects/);
  assert.match(src, /refuseOwnerFromDirectoryName/);
  assert.match(src, /refuseMtimeAsInventoryTruth/);
  assert.match(src, /inventoryMigrationCandidates/);
  assert.match(src, /later_wave_adapter_locked/);
  assert.match(src, /productionScanExecuted/);
  assert.doesNotMatch(src, /implementationVerified\s*=\s*true/);
  assert.doesNotMatch(src, /deployAuthorized\s*=\s*true/);
  assert.doesNotMatch(src, /aliyun/i);
  assert.doesNotMatch(src, /oss\.aliyuncs\.com/);
  assert.match(src, /NEVER parsed for owner/);
});

void test("decision doc and packet do not accept Stage C/D or LIVE", () => {
  const packet = load("memory-workspace-s01-production-object-inventory.json");
  const doc = readFileSync(
    join(
      repoRoot,
      ".kiro/specs/memory-workspace-platform-remediation/s01-production-object-inventory.md",
    ),
    "utf8",
  );
  assert.match(doc, /productionScanExecuted:\s*false/);
  assert.match(doc, /productionReceiptsObserved:\s*0/);
  assert.ok(packet.doesNotAuthorize.includes("Stage C Accept"));
  assert.ok(packet.doesNotAuthorize.includes("Stage D cutover"));
  assert.ok(packet.doesNotAuthorize.includes("LIVE authorized"));
  assert.ok(packet.notDone.includes("did not write Catalog"));
  assert.ok(packet.notDone.includes("did not guess owner from directory names"));
});
