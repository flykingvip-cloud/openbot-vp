import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-stage-c-prod-identity-wiring-shadow.json",
);
const scanPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
);
const decisionPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
);
const shadowModulePath = path.join(root, "src/gateway/item7-stage-c-identity-shadow.ts");
const memoryToolPath = path.join(root, "src/agents/tools/memory-tool.ts");
const BASELINE = "6722d3ff604f0b0726788b408f02286eda94250d";

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

void test("stage C prod identity wiring is shadow-only and changes no scan/baseline", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  assert.equal(packet.stage, "C");
  assert.equal(packet.changeRequestKind, "stage-c-prod-identity-wiring-shadow");
  assert.equal(packet.reviewRequest, "stage-c-production-identity-wiring-shadow-review-only");
  assert.equal(packet.reviewRequestIsBatchAccept, false);
  assert.equal(packet.shadowOnly, true);
  assert.equal(packet.productionSwitch, false);
  assert.equal(packet.legacyLocatorRetained, true);
  assert.equal(packet.gatedOffByDefault, true);
  assert.equal(packet.envFlag, "OPENBOT_ITEM7_STAGE_C_IDENTITY_SHADOW");
  assert.equal(packet.scanModified, false);
  assert.equal(packet.previousAcceptedBaseline, 10);
  assert.equal(packet.remaining, 10);
  assert.equal(packet.liveWriteWatchIndex, 10);
  assert.equal(packet.retiredThisChange, 0);
  assert.equal(packet.frozenWriteWatchIndex, 38);
  assert.equal(packet.c1c5StayInScan, true);
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.live, "forbidden");
  assert.equal(packet.productionCatalogWrite, "none");
  assert.equal(packet.schemaV2ProductionWrite, false);
  assert.equal(packet.freezeSafe, true);
  assert.equal(packet.freeze.ok, true);
  assert.deepEqual(packet.freeze.addedProductionCallSites, []);
  assert.deepEqual(packet.freeze.addedCatalogSynthesis, []);
  assert.equal(Array.isArray(packet.conclusions), true);
  assert.equal(packet.conclusions.length, 6);
  assert.deepEqual(packet.metricsRecorded, ["managed_success", "managed_deny", "managed_defer"]);
  assert.equal(packet.baseCommit, BASELINE);
  assert.equal(packet.originMainSha, BASELINE);
});

void test("the shadow module exists, is gated, reads canonical (freeze-safe); entrypoint wiring deferred", () => {
  const mod = fs.readFileSync(shadowModulePath, "utf8");
  assert.match(mod, /OPENBOT_ITEM7_STAGE_C_IDENTITY_SHADOW/);
  assert.match(mod, /runStageCManagedIdentityShadowIfEnabled/);
  // Reads the canonical binding (freeze-safe), never mints one.
  assert.match(mod, /resolveMemoryWorkspaceHandle/);
  // This CR does NOT modify the shared hot file memory-tool.ts (owned by codex-runtime-safety);
  // the packet records the live-entrypoint wiring as a deferred coordinated follow-up.
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  assert.equal(packet.entrypointWiring.status, "deferred");
  const tool = fs.readFileSync(memoryToolPath, "utf8");
  assert.doesNotMatch(tool, /runStageCManagedIdentityShadowIfEnabled/);
});

void test("stage C shadow leaves the retirement scan unchanged (C1-C5 + S01/S02 stay in scan)", () => {
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  assert.equal(scan.remaining, 10);
  assert.equal(scan.sites.length, 10);
  assert.equal(scan.liveWriteWatchIndex, 10);
  assert.equal(scan.frozenWriteWatchIndex, 38);
  assert.equal(scan.item7, "not-met");
  const files = new Set(scan.sites.map((s) => `${s.file}:${s.line}`));
  for (const site of [
    "src/memory/backend-config.ts:417",
    "src/memory/backend-config.ts:444",
    "src/memory/cogniweave-manager.ts:554",
    "src/memory/manager.ts:152",
    "src/memory/qmd-manager.ts:196",
  ]) {
    assert.equal(files.has(site), true, `${site} (C1-C5) must remain in the live scan`);
  }
});

void test("stage C shadow keeps canonical governance pointers locked", () => {
  const decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
  assert.equal(decision.unlock, "not-issued");
  assert.equal(decision.phase1bExecutionBlocked, true);
  assert.equal(decision.deployAuthorized, false);
  assert.equal(decision.live, "forbidden");
  assert.equal(decision.items["7"], "not-met");
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
});
