import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-batch9-12-cr.json",
);
const sourcePath = path.join(root, "src/gateway/server-methods/agents.ts");
const helperPath = path.join(
  root,
  "src/gateway/server-methods/agents-handler-workspace-locator.ts",
);
const unlockPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-current.json",
);
const decisionPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
);
const BASELINE = "d3f59d55d82d89af8d0b9575afe5259e2366fbca";

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

void test("item 7 batch 9-12 CR keeps remaining at the floor of 22", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const unlock = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
  const decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
  const source = fs.readFileSync(sourcePath, "utf8");
  const helper = fs.readFileSync(helperPath, "utf8");
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.batch9to12Accepted, false);
  assert.equal(packet.retiredThisChange, 0);
  assert.equal(packet.remaining, 22);
  assert.equal(packet.liveWriteWatchIndex, 22);
  assert.ok(packet.remaining >= 22);
  assert.ok(packet.liveWriteWatchIndex >= 22);
  assert.notEqual(packet.liveWriteWatchIndex, 0);
  assert.equal(packet.nextBatchForbidden, true);
  assert.equal(packet.phase1bUnlock, "not-issued");
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.live, "forbidden");
  assert.equal(packet.productionWrite, false);
  assert.equal(packet.productionCatalogWrite, "none");
  assert.equal(packet.schemaV2ProductionWrite, false);
  assert.equal(packet.sitesFixed.length, 4);
  assert.equal(packet.sitesFixed[0].ledgerId, "S10");
  assert.equal(packet.sitesFixed[1].ledgerId, "S11");
  assert.equal(packet.sitesFixed[2].ledgerId, "S12");
  assert.equal(packet.sitesFixed[3].ledgerId, "S13");
  assert.doesNotMatch(source, /resolveWorkspaceLocator\(\{\s*cfg/);
  assert.doesNotMatch(source, /r\.ok \? r\.handle\.locator : ""/);
  assert.match(source, /resolveAgentsHandlerWorkspaceLocator/);
  assert.match(helper, /tenantContext/);
  assert.match(helper, /resourceId/);
  assert.match(helper, /agentAssetId/);
  assert.match(helper, /catalog/);
  assert.doesNotMatch(helper, /resolveWorkspaceLocator\(\{\s*cfg\s*\}\s*\)/);
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.fullUnlock, "not-issued");
  assert.equal(decision.phase1bExecutionBlocked, true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
});
