import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch17-deployment-preflight.json",
);
const scanPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
);
const decisionPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
);
const unlockPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-current.json",
);
const batch17Path = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch17-s28.json",
);
const CANDIDATE = "9b1833490424a0eaaf99fa6b64268a9254249d37";
const LIVE = "a12e4c59e5754e0c280b423c68c989c6973ac9b0";
const BATCH17 = "47d6934c34dced654652f027f2c66fedea35a67f";

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

void test("item 7 batch 17 deployment preflight stays locked and does not cut over", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  const decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
  const unlock = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
  const batch17 = JSON.parse(fs.readFileSync(batch17Path, "utf8"));
  assert.equal(packet.status, "deployment-preflight-only");
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.retiredThisChange, 0);
  assert.equal(packet.previousAcceptedBaseline, 13);
  assert.equal(packet.remaining, 13);
  assert.equal(packet.liveWriteWatchIndex, 13);
  assert.notEqual(packet.liveWriteWatchIndex, 0);
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.phase1bUnlock, "not-issued");
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.live, "forbidden");
  assert.equal(packet.liveCutover, false);
  assert.equal(packet.cutoverAuthorized, false);
  assert.equal(packet.productionCatalogWrite, "none");
  assert.equal(packet.schemaV2ProductionWrite, false);
  assert.equal(packet.rollbackProof, true);
  assert.equal(packet.quarantineProof, true);
  assert.equal(packet.absorbsUnacceptedBatches, false);
  assert.equal(packet.i3Executed, false);
  assert.equal(packet.productionImageBuildManifest.builtThisPacket, false);
  assert.equal(packet.deliveryAlignment.currentMainProvenanceTagMissing, true);
  assert.equal(packet.candidateSha, CANDIDATE);
  assert.equal(packet.originMainSha, CANDIDATE);
  assert.equal(packet.liveSha, LIVE);
  assert.equal(packet.batch17.status, "already-accepted-on-origin-main");
  assert.equal(packet.batch17.mergeSha, BATCH17);
  assert.equal(packet.batch17.previousAcceptedBaselineAtBatch17, 18);
  assert.equal(packet.batch17.remainingAfterBatch17, 17);
  assert.equal(batch17.remaining, 17);
  assert.equal(batch17.item7, "not-met");
  assert.equal(scan.remaining, 13);
  assert.equal(scan.liveWriteWatchIndex, 13);
  assert.equal(scan.sites.length, 13);
  assert.equal(scan.frozenWriteWatchIndex, 38);
  assert.equal(decision.unlock, "not-issued");
  assert.equal(decision.items["7"], "not-met");
  assert.equal(decision.phase1bExecutionBlocked, true);
  assert.equal(unlock.fullUnlock, "not-issued");
  assert.equal(unlock.retirementExecuted, false);
  assert.equal(packet.remainingSites.length, 13);
  assert.equal(
    packet.remainingSites.some((site) => site.ledgerId === "S28"),
    false,
  );
  assert.equal(gitOk(["merge-base", "--is-ancestor", LIVE, CANDIDATE]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", CANDIDATE, "origin/main"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", BATCH17, CANDIDATE]), true);
});
