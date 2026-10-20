import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-provision-command-hardening.json",
);
const scanPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
);
const commandPath = path.join(root, "src/gateway/workspace-resolver/provision-steward-cutover.ts");
const policyPath = path.join(root, "src/gateway/workspace-resolver/steward-placement-policy.ts");
const materializePath = path.join(root, "src/gateway/workspace-resolver/steward-materialize.ts");
const stewardWritePath = path.join(root, "src/gateway/workspace-resolver/steward-write.ts");
// Baseline this change is built on (worktree base a2cae6e938, the #696 merge commit).
const BASELINE = "a2cae6e93845a1cbc29c8f0ea30f7b7a64ea0c98";

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

void test("command-hardening packet: hardening only, retires nothing, baseline stays 10", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));

  assert.equal(packet.changeKind, "hardening");
  assert.equal(packet.command, "provisionEmployeeStewardCutoverWorkspace");
  assert.equal(
    packet.reviewRequest,
    "provision-command-hardening-independent-acceptance-review-only",
  );
  assert.equal(packet.reviewRequestIsRetirementOrAccept, false);

  // Scope: hardens command; no new production wiring, no retirement, no scan/baseline change.
  assert.equal(packet.scopeBoundaries.hardensCommandAndTests, true);
  assert.equal(packet.scopeBoundaries.pilotStaysTestOnly, true);
  assert.equal(packet.scopeBoundaries.addsNewProductionWiring, false);
  assert.equal(packet.scopeBoundaries.wiresPilotToProductionOrLive, false);
  assert.equal(packet.scopeBoundaries.retiresAnySite, false);
  assert.equal(packet.scopeBoundaries.modifiesRetirementScan, false);
  assert.equal(packet.scopeBoundaries.changesBaseline, false);
  assert.equal(packet.scopeBoundaries.persistsToProductionCatalog, false);
  assert.equal(packet.scopeBoundaries.callsFrozenHostPathResolvers, false);

  // P0 invariants.
  assert.equal(packet.invariants.realpathContainmentEnforced, true);
  assert.equal(packet.invariants.symlinkEscapeRejected, true);
  assert.equal(packet.invariants.sourceTargetDistinctByRealpath, true);
  assert.equal(packet.invariants.copyToStagingNotTarget, true);
  assert.equal(packet.invariants.atomicPublishViaRename, true);
  assert.equal(packet.invariants.neverClobbersPublishedTarget, true);
  assert.equal(packet.invariants.quarantineOnFailureWithResidualPath, true);
  assert.equal(packet.invariants.noPartialTargetExposed, true);
  assert.equal(packet.invariants.verifiedCopyReturnsStructuredFailure, true);
  assert.equal(packet.invariants.fencingRejectsConcurrentOperation, true);
  assert.equal(packet.invariants.noHostFallback, true);
  assert.equal(packet.invariants.addsNoFrozenPhase0CallSites, true);
  assert.equal(packet.invariants.noProductionCatalogWrite, true);

  // Fail-closed reasons cover the P0 additions.
  for (const reason of [
    "placement_outside_allowed_root",
    "placement_symlink_escape",
    "concurrent_operation",
    "target_exists",
    "publish_failed",
    "post_publish_digest_mismatch",
    "copy_failed",
  ]) {
    assert.equal(packet.failClosedReasons.includes(reason), true, `missing reason ${reason}`);
  }

  // No retirement / baseline preserved / locks.
  assert.equal(packet.retiredThisChange, 0);
  assert.equal(packet.previousAcceptedBaseline, 10);
  assert.equal(packet.remaining, 10);
  assert.equal(packet.liveWriteWatchIndex, 10);
  assert.equal(packet.proposedRemaining, 10);
  assert.equal(packet.scanModified, false);
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.phase1bUnlock, "not-issued");
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.live, "forbidden");
  assert.equal(packet.productionCatalogWrite, "none");
  assert.equal(packet.schemaV2ProductionWrite, false);
  assert.equal(packet.absorbsUnacceptedBatches, false);
  assert.equal(packet.stageCStarted, false);
  assert.equal(packet.stageDStarted, false);
  assert.equal(packet.baseCommit, BASELINE);
});

void test("placement policy module enforces containment + symlink-escape + distinct roots", () => {
  const src = fs.readFileSync(policyPath, "utf8");
  assert.match(src, /export function resolveStewardPlacement\(/);
  assert.match(src, /realpathSync/);
  assert.match(src, /placement_symlink_escape/);
  assert.match(src, /placement_outside_allowed_root/);
  assert.match(src, /placement_source_target_collision/);
  // Freeze-safe: does not name a frozen helper and calls no watched resolver.
  assert.doesNotMatch(src, /resolve\w*WorkspaceDir/);
  assert.doesNotMatch(src, /\bimport\(/);
});

void test("materialization module stages, publishes atomically, and quarantines partials", () => {
  const src = fs.readFileSync(materializePath, "utf8");
  assert.match(src, /export function materializeStewardCutover\(/);
  assert.match(src, /renameSync/);
  assert.match(src, /target_exists/);
  assert.match(src, /publish_failed/);
  assert.match(src, /post_publish_digest_mismatch/);
  assert.match(src, /residualPath/);
  assert.doesNotMatch(src, /resolve\w*WorkspaceDir/);
  assert.doesNotMatch(src, /\bimport\(/);
});

void test("verifiedCopyStewardWorkspace converts a thrown copy into a structured failure", () => {
  const src = fs.readFileSync(stewardWritePath, "utf8");
  // The copy primitive now guards mkdir/cpSync and returns copy_failed instead of throwing.
  assert.match(src, /try \{[\s\S]*fs\.cpSync\([\s\S]*\} catch \{[\s\S]*copy_failed/);
});

void test("command wires placement policy + safe materialization + fencing, no host fallback", () => {
  const src = fs.readFileSync(commandPath, "utf8");
  assert.match(src, /resolveStewardPlacement\(/);
  assert.match(src, /materializeStewardCutover\(/);
  assert.match(src, /findActiveCutoverOperation\(/);
  assert.match(src, /concurrent_operation/);
  assert.match(src, /placementRoot: string/);
  // Command still calls no frozen host-path resolver (freeze-safe).
  assert.doesNotMatch(src, /resolveEmployeeStewardSourceWorkspaceDir\(/);
  assert.doesNotMatch(src, /resolveEmployeeStewardTargetWorkspaceDir\(/);
  assert.doesNotMatch(src, /resolveAgentWorkspaceDir\(/);
});

void test("retirement scan unchanged: S26/S27 stay retired, baseline stays 10", () => {
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  assert.equal(scan.remaining, 10);
  assert.equal(scan.sites.length, 10);
  assert.equal(scan.liveWriteWatchIndex, 10);
  assert.equal(scan.frozenWriteWatchIndex, 38);
  // S26/S27 (steward-write.ts host-path resolver call sites) remain retired (absent from the live scan).
  assert.equal(
    scan.sites.some(
      (s) =>
        s.file === "src/gateway/workspace-resolver/steward-write.ts" &&
        (s.symbol === "resolveEmployeeStewardSourceWorkspaceDir" ||
          s.symbol === "resolveEmployeeStewardTargetWorkspaceDir"),
    ),
    false,
  );
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
});
