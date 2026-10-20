import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-batch9-12-cr2.json",
);
const helperPath = path.join(
  root,
  "src/gateway/server-methods/agents-handler-workspace-locator.ts",
);
const sourcePath = path.join(root, "src/gateway/server-methods/agents.ts");
const unlockPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-current.json",
);
const decisionPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
);
const BASELINE = "697c65c905c624ec80aba2a3386a00a7d0cc818a";

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

void test("item 7 batch 9-12 CR2 keeps the last accepted baseline of 29", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const unlock = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
  const decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
  const helper = fs.readFileSync(helperPath, "utf8");
  const source = fs.readFileSync(sourcePath, "utf8");
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.batch9to12Accepted, false);
  assert.equal(packet.absorbsUnacceptedBatches, false);
  assert.equal(packet.lastAcceptedRetirementBaseline, 29);
  assert.equal(packet.retiredThisChange, 0);
  assert.equal(packet.remaining, 29);
  assert.equal(packet.liveWriteWatchIndex, 29);
  assert.ok(packet.remaining >= 29);
  assert.ok(packet.liveWriteWatchIndex >= 29);
  assert.notEqual(packet.liveWriteWatchIndex, 0);
  assert.equal(packet.nextBatchForbidden, true);
  assert.equal(packet.nextRetirementBatchFrozen, true);
  assert.equal(packet.phase1bUnlock, "not-issued");
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.live, "forbidden");
  assert.equal(packet.productionWrite, false);
  assert.equal(packet.productionCatalogWrite, "none");
  assert.equal(packet.schemaV2ProductionWrite, false);
  assert.equal(packet.evidenceRebindOnly, true);
  assert.equal(packet.originMainSha, BASELINE);
  assert.equal(packet.candidateSha, BASELINE);
  assert.equal(packet.originMainSha, packet.candidateSha);
  assert.equal(packet.catalogSelection.firstMatchForbidden, true);
  assert.equal(packet.enterpriseAuth.membershipFromWire, false);
  assert.doesNotMatch(helper, /matching\[0\]/);
  assert.match(helper, /loadPlatformAuthStore/);
  assert.match(helper, /loadSeatAssetsStoreForTenantId/);
  assert.match(helper, /loadAuthoritativeGroupMembers/);
  assert.doesNotMatch(helper, /resolveWorkspaceLocator\(\{\s*cfg\s*\}\s*\)/);
  assert.match(source, /resolveAgentsHandlerWorkspaceLocator/);
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.fullUnlock, "not-issued");
  assert.equal(decision.phase1bExecutionBlocked, true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "origin/main"]), true);
});
