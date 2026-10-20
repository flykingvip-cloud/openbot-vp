import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-batch33-s01-next-path-gate.json",
);
const scanPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
);
const getReplyPath = path.join(root, "src/auto-reply/reply/get-reply.ts");
const BASELINE = "959b367d7eb00545093b4d4dbcd028a48e412100";

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

void test("item 7 batch 33 keeps S01 semantic-gate blocked and scan=10", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  const getReply = fs.readFileSync(getReplyPath, "utf8");
  const s01 = scan.sites.find(
    (site) =>
      site.file === "src/auto-reply/reply/get-reply.ts" &&
      site.symbol === "resolveEmployeeBuiltinStewardWorkspaceDir",
  );

  assert.equal(packet.semanticGateBlocked, true);
  assert.equal(packet.s01RetiredThisRound, false);
  assert.equal(packet.thisPrIsNotS01RetirementAccepted, true);
  assert.equal(packet.independentRetirementReviewAccepted, false);
  assert.equal(packet.honestlyRetirableNow, false);
  assert.equal(packet.retirementExecuted, false);
  assert.equal(packet.trustedPrincipalPresent, false);
  assert.equal(packet.handlePresent, false);
  assert.equal(packet.productionReadPathWired, false);
  assert.equal(packet.w4CatalogResourceId, null);
  assert.equal(packet.personalFallbackMustNotBecomeCatalogLookup, true);
  assert.equal(packet.resolveAuthorizedToolCwdWiredIntoS01, false);
  assert.equal(packet.onSiteCatalogSynthesis, false);
  assert.equal(packet.newHostProcessCwdWorkspaceFallback, false);
  assert.equal(packet.getReplySourceModified, false);
  assert.equal(packet.scanModified, false);
  assert.equal(packet.scanRowDeleted, false);
  assert.equal(packet.remainingRewrittenToNine, false);
  assert.equal(packet.s02Touched, false);
  assert.equal(packet.memoryEightSitesTouched, false);
  assert.equal(packet.retiredThisChange, 0);
  assert.equal(packet.remaining, 10);
  assert.equal(packet.liveWriteWatchIndex, 10);
  assert.equal(packet.sitesLength, 10);
  assert.equal(packet.nextScanPath.stillInScan, true);
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.phase1bBlocked, true);
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.productionCatalogWrite, "none");
  assert.equal(packet.schemaV2Write, "disabled");
  assert.equal(packet.live, "forbidden");
  assert.equal(packet.i3Executed, false);

  assert.ok(s01, "S01 must remain in the live retirement scan");
  assert.equal(scan.remaining, 10);
  assert.equal(scan.liveWriteWatchIndex, 10);
  assert.equal(scan.sites.length, 10);
  assert.notEqual(scan.remaining, 9);
  assert.equal(scan.frozenWriteWatchIndex, 38);
  assert.equal(scan.item7, "not-met");

  assert.match(getReply, /resolveEmployeeBuiltinStewardWorkspaceDir\(employeeOwnerId\)/);
  assert.match(getReply, /catalogResourceId: null/);
  assert.doesNotMatch(getReply, /buildUserOwnedWorkspaceCatalogEntry\s*\(/);
  assert.ok(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]));
});
