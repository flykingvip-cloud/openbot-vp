import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(root, "docs/design/evidence/memory-workspace-c1-c5-cutover-prep.json");
const scanPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
);
const decisionPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
);
const memoryToolPath = path.join(root, "src/agents/tools/memory-tool.ts");
const getReplyPath = path.join(root, "src/auto-reply/reply/get-reply.ts");
const managerSyncPath = path.join(root, "src/memory/manager-sync-ops.ts");
const BASELINE = "e6dd9c61bc4cc0c3cf014075bfaab7adc86a6c89";

const C1_C5 = [
  { file: "src/memory/backend-config.ts", line: 417, label: "C1" },
  { file: "src/memory/backend-config.ts", line: 444, label: "C2" },
  { file: "src/memory/cogniweave-manager.ts", line: 554, label: "C3" },
  { file: "src/memory/manager.ts", line: 152, label: "C4" },
  { file: "src/memory/qmd-manager.ts", line: 196, label: "C5" },
];

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

function gitStdout(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

void test("C1-C5 cutover PREP packet locks remaining=10 and forbids production switch", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  assert.equal(packet.schema, "memory-workspace-c1-c5-cutover-prep/v1");
  assert.equal(packet.stage, "C");
  assert.equal(packet.changeRequestKind, "c1-c5-cutover-prep");
  assert.equal(packet.reviewRequestIsBatchAccept, false);
  assert.equal(packet.shadowOnly, true);
  assert.equal(packet.productionSwitch, false);
  assert.equal(packet.implementationVerified, false);
  assert.equal(packet.c1c5StayLegacy, true);
  assert.equal(packet.legacyLocatorRetained, true);
  assert.equal(packet.scanModified, false);
  assert.equal(packet.canonicalScanUntouched, true);
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
  assert.equal(packet.i3Executed, false);
  assert.equal(packet.productionCatalogWrite, "none");
  assert.equal(packet.schemaV2ProductionWrite, false);
  assert.equal(packet.freezeSafe, true);
  assert.equal(packet.freeze.ok, true);
  assert.deepEqual(packet.freeze.addedProductionCallSites, []);
  assert.deepEqual(packet.freeze.addedCatalogSynthesis, []);
  assert.equal(packet.retirementScanExpectedChangeDraft.status, "draft-only");
  assert.equal(packet.retirementScanExpectedChangeDraft.canonicalScanModified, false);
  assert.equal(packet.retirementScanExpectedChangeDraft.applyForbidden, true);
  assert.equal(packet.baseCommit, BASELINE);
  assert.equal(packet.originMainSha, BASELINE);
  assert.equal(Array.isArray(packet.conclusions), true);
  assert.equal(packet.conclusions.length, 8);
  assert.equal(packet.sites.length, 5);
  assert.deepEqual(packet.batchCases, [
    "catalog_miss",
    "tenant_mismatch",
    "ownership_mismatch",
    "membership_grant_missing",
    "stale_epoch_fencing",
    "workspace_not_indexable",
    "background_identity_defer",
    "personal_local_regression",
  ]);
});

void test("canonical retirement scan is unmodified (10/10) and C1-C5 remain in the live scan", () => {
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  assert.equal(scan.remaining, 10);
  assert.equal(scan.sites.length, 10);
  assert.equal(scan.liveWriteWatchIndex, 10);
  assert.equal(scan.frozenWriteWatchIndex, 38);
  assert.equal(scan.item7, "not-met");
  const files = new Set(scan.sites.map((s) => `${s.file}:${s.line}`));
  for (const site of C1_C5) {
    assert.equal(
      files.has(`${site.file}:${site.line}`),
      true,
      `${site.label} ${site.file}:${site.line} must remain in the live scan`,
    );
  }
  const dirty = gitStdout([
    "diff",
    "--name-only",
    "HEAD",
    "--",
    "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
  ]);
  assert.equal(dirty, "", "canonical retirement scan must not be mutated");
  const vsMain = gitStdout([
    "diff",
    "--name-only",
    "origin/main",
    "--",
    "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
  ]);
  assert.equal(vsMain, "", "canonical retirement scan must match origin/main");
});

void test("C1-C5 source files still call resolveAgentWorkspaceDir at the verified lines", () => {
  for (const site of C1_C5) {
    const abs = path.join(root, site.file);
    const lines = fs.readFileSync(abs, "utf8").split("\n");
    const line = lines[site.line - 1] ?? "";
    assert.match(
      line,
      /resolveAgentWorkspaceDir/,
      `${site.label} ${site.file}:${site.line} must still be the legacy locator (got: ${JSON.stringify(line)})`,
    );
  }
});

void test("PREP does not wire memory-tool, get-reply, or manager-sync-ops", () => {
  const tool = fs.readFileSync(memoryToolPath, "utf8");
  assert.doesNotMatch(tool, /item7-c1-c5-cutover-prep/);
  assert.doesNotMatch(tool, /runStageCManagedIdentityShadowIfEnabled/);
  const getReplyDirty = gitStdout([
    "diff",
    "--name-only",
    "origin/main",
    "--",
    "src/auto-reply/reply/get-reply.ts",
  ]);
  assert.equal(getReplyDirty, "");
  const syncDirty = gitStdout([
    "diff",
    "--name-only",
    "origin/main",
    "--",
    "src/memory/manager-sync-ops.ts",
  ]);
  assert.equal(syncDirty, "");
  assert.equal(fs.existsSync(getReplyPath), true);
  assert.equal(fs.existsSync(managerSyncPath), true);
});

void test("canonical governance pointers stay locked", () => {
  const decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
  assert.equal(decision.unlock, "not-issued");
  assert.equal(decision.phase1bExecutionBlocked, true);
  assert.equal(decision.deployAuthorized, false);
  assert.equal(decision.live, "forbidden");
  assert.equal(decision.items["7"], "not-met");
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
});
