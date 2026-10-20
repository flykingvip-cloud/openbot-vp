import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-preflight.json",
);
const unlockPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-current.json",
);
const scanPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
);
const handoffPath = path.join(
  root,
  ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-item7-retirement-preflight.md",
);
const getReplyPath = path.join(root, "src/auto-reply/reply/get-reply.ts");

void test("item 7 retirement preflight keeps locks and does not delete call-sites", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const unlock = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.itemMet, false);
  assert.equal(packet.phase1bUnlock, "not-issued");
  assert.equal(packet.fullUnlock, "not-issued");
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.wiredToProductionResolver, false);
  assert.equal(packet.productionCatalogWrite, "none");
  assert.equal(packet.schemaV2Write, "disabled");
  assert.equal(packet.live, "forbidden");
  assert.equal(packet.deleteCallSites, false);
  assert.equal(packet.retiredThisChange, 0);
  assert.equal(packet.liveWriteWatchIndex, 37);
  assert.equal(packet.rollbackProof, true);
  assert.equal(packet.quarantineProof, true);
  assert.equal(packet.independentRetirementReviewAccepted, true);
  assert.equal(packet.status, "retirement-preflight-accepted");
  assert.equal(packet.preflightMerge, "e5e707264498a9b29fe92acb3d3df42d3c6c5816");
  assert.equal(packet.locatorContractMerge, "751c9af985d05d7b73f59fe785cef9d5fccda2f4");
  assert.equal(packet.liveCallSiteCount, 37);
  assert.equal(scan.remaining, scan.sites.length);
  assert.ok(scan.remaining > 0);
  assert.ok(scan.remaining <= 37);
  assert.notEqual(scan.liveWriteWatchIndex, 0);
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.fullUnlock, "not-issued");
  assert.equal(unlock.retirementExecuted, false);
  assert.equal(unlock.liveCutover, false);
});

void test("item 7 retirement preflight is not wired into a production P1 caller", () => {
  const getReply = fs.readFileSync(getReplyPath, "utf8");
  assert.match(getReply, /resolveAgentWorkspaceDir/);
  assert.doesNotMatch(getReply, /resolveWorkspaceLocator\(/);
});

void test("item 7 retirement preflight handoff requests preflight review only", () => {
  const handoff = fs.readFileSync(handoffPath, "utf8");
  assert.match(handoff, /Retirement Preflight Review only/);
  assert.match(handoff, /independentRetirementReviewAccepted=false/);
  assert.doesNotMatch(handoff, /liveWriteWatchIndex=0/);
});
