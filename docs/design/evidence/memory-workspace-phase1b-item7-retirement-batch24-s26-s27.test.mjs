import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch24-s26-s27.json",
);
const scanPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
);
const stewardPath = path.join(root, "src/gateway/workspace-resolver/steward-write.ts");
const provisionPath = path.join(
  root,
  "src/gateway/workspace-resolver/provision-steward-cutover.ts",
);
const indexPath = path.join(root, "src/gateway/workspace-resolver/index.ts");
const unlockPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-current.json",
);
const decisionPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
);
const phase0Path = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase0-20260814.call-sites.json",
);
// Baseline this batch builds on (worktree base 3db1aa85d0, the #679 merge commit that landed the
// accepted provisionEmployeeStewardCutoverWorkspace command). Linear ancestor of origin/main.
const BASELINE = "3db1aa85d0710c9d95ce84eeaa6253b82aebfb88";

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

void test("item 7 batch 24 atomically retires S26+S27 to a proposed baseline of 10", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  const unlock = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
  const decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
  const phase0 = JSON.parse(fs.readFileSync(phase0Path, "utf8"));
  const steward = fs.readFileSync(stewardPath, "utf8");
  const provision = fs.readFileSync(provisionPath, "utf8");
  const index = fs.readFileSync(indexPath, "utf8");

  // Batch 24 packet (immutable record of this batch's proposed effect).
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.batch, "S26+S27");
  assert.equal(packet.atomic, true);
  assert.equal(packet.retiredThisChange, 2);
  assert.equal(packet.previousAcceptedBaseline, 12);
  assert.equal(packet.remaining, 10);
  assert.equal(packet.liveWriteWatchIndex, 10);
  assert.equal(packet.proposedRemaining, 10);
  assert.equal(packet.proposedLiveWriteWatchIndex, 10);
  assert.equal(packet.absorbsUnacceptedBatches, false);
  assert.notEqual(packet.liveWriteWatchIndex, 0);
  assert.equal(packet.batch24Accepted, true);
  assert.equal(packet.reviewRequestIsBatchAccept, true);
  assert.equal(packet.lastAcceptedRetirementBaseline, 10);

  // Supersedes the Batch 23 S26 semantic gate (#674) without touching its author's WIP.
  assert.equal(packet.supersedes.pr, 674);
  assert.equal(packet.supersedes.loomState, "abandoned");
  assert.equal(packet.supersedes.wipUntouched, true);

  // Shared ledger dropped by exactly 2 (12 -> 10); watch index tracks remaining; freeze baseline intact.
  assert.equal(scan.remaining, 10);
  assert.equal(scan.sites.length, 10);
  assert.equal(scan.liveWriteWatchIndex, scan.remaining);
  assert.equal(scan.remaining, scan.sites.length);
  assert.equal(scan.retiredThisChange, 2);
  assert.notEqual(scan.liveWriteWatchIndex, 0);
  assert.equal(scan.frozenWriteWatchIndex, 38);
  assert.equal(phase0.productionWriteWatchIndex, 38);
  assert.equal(scan.phase0Rewritten, false);
  assert.equal(scan.i3Executed, false);

  // S26 + S27 (steward-write.ts host-path resolver call sites) removed from the live ledger.
  const stewardHostSites = scan.sites.filter(
    (site) =>
      site.file === "src/gateway/workspace-resolver/steward-write.ts" &&
      (site.symbol === "resolveEmployeeStewardSourceWorkspaceDir" ||
        site.symbol === "resolveEmployeeStewardTargetWorkspaceDir"),
  );
  assert.equal(stewardHostSites.length, 0);

  // Source posture (steward-write.ts): the pilot moved out and no host-path resolver is called there.
  assert.doesNotMatch(steward, /export function runEmployeeStewardCutoverPilot/);
  assert.doesNotMatch(steward, /resolveEmployeeStewardSourceWorkspaceDir\(userId/);
  assert.doesNotMatch(steward, /resolveEmployeeStewardTargetWorkspaceDir\(\{/);
  assert.doesNotMatch(steward, /process\.cwd\(/);
  // Two now-unused cutover imports removed.
  assert.doesNotMatch(steward, /^\s*advanceCutoverOperation,\s*$/m);
  assert.doesNotMatch(steward, /^\s*createWorkspaceCutoverOperation,\s*$/m);
  // Accepted neighbours S24 (source) + S25 (target) are preserved at their writable-dir sites.
  const stewardLines = steward.split("\n");
  const sourceRootSite = stewardLines.find((line) => line.includes("const sourceRoot ="));
  const targetRootSite = stewardLines.find((line) => line.includes("const targetRoot ="));
  assert.match(sourceRootSite ?? "", /resolveWorkspaceLocator/);
  assert.match(targetRootSite ?? "", /resolveWorkspaceTargetBinding/);

  // Source posture (provision-steward-cutover.ts): the pilot lives here, is wired to the command,
  // and reads the source canonical binding (S26) + target compatibility/read_only binding (S27).
  assert.match(provision, /export function runEmployeeStewardCutoverPilot/);
  assert.match(provision, /export function provisionEmployeeStewardCutoverWorkspace/);
  assert.match(provision, /provisionEmployeeStewardCutoverWorkspace\(\{/);
  assert.match(provision, /provision\.catalog\.getBinding\(provision\.sourceBindingId\)/);
  assert.match(provision, /provision\.catalog\.getBinding\(provision\.targetBindingId\)/);
  assert.match(provision, /materialize:\s*true/);
  // index.ts must NOT re-export the test-only pilot (barrel boundary enforced by
  // pilot-test-only-boundary.test.ts); production code must not reach the pilot.
  assert.doesNotMatch(index, /runEmployeeStewardCutoverPilot/);
  assert.match(index, /provisionEmployeeStewardCutoverWorkspace/);

  // Retirement mechanism: command + caller placement, no host fallback, no prod Catalog row.
  assert.equal(packet.retirementMechanism.command, "provisionEmployeeStewardCutoverWorkspace");
  assert.equal(packet.retirementMechanism.commandLandedPr, 679);
  assert.equal(packet.retirementMechanism.s26.hostResolverCallRemoved, true);
  assert.equal(packet.retirementMechanism.s26.readsSourceCanonicalBinding, true);
  assert.equal(packet.retirementMechanism.s27.hostResolverCallRemoved, true);
  assert.equal(packet.retirementMechanism.s27.readsTargetCompatibilityReadOnlyBinding, true);
  assert.equal(packet.retirementMechanism.ownershipModelChanged, false);
  assert.equal(packet.retirementMechanism.createsProductionCatalogRow, false);
  assert.equal(packet.retirementMechanism.failClosed.fallbackToHostResolver, false);
  assert.equal(packet.retirementMechanism.failClosed.partialBinding, false);
  assert.equal(packet.retirementMechanism.failClosed.partialDirectory, false);
  assert.equal(packet.retirementMechanism.failClosed.doubleWrite, false);
  assert.equal(packet.retirementMechanism.failClosed.mutatesProductionCatalog, false);

  // Provisioning recovery: Catalog-before-filesystem, halt on failure, no partial state.
  assert.equal(packet.provisioningRecovery.catalogBeforeFilesystem, true);
  assert.equal(packet.provisioningRecovery.mkdirCopyOnlyAfterCatalogSuccess, true);
  assert.equal(packet.provisioningRecovery.noPartialBinding, true);
  assert.equal(packet.provisioningRecovery.noPartialDirectory, true);
  assert.equal(packet.provisioningRecovery.noDoubleWrite, true);

  // Phase 0 freeze honesty gate: no new production frozen call sites were introduced.
  assert.equal(packet.freezeScan.ok, true);
  assert.deepEqual(packet.freezeScan.addedProductionCallSites, []);
  assert.deepEqual(packet.freezeScan.addedProductionHelpers, []);
  assert.deepEqual(packet.freezeScan.addedCatalogSynthesis, []);
  assert.equal(packet.freezeScan.trusted, true);

  // Locks unchanged.
  assert.equal(packet.productionCatalogWrite, "none");
  assert.equal(packet.productionWrite, false);
  assert.equal(packet.schemaV2ProductionWrite, false);
  assert.equal(packet.schemaV2Write, "disabled");
  assert.equal(packet.live, "forbidden");
  assert.equal(packet.liveCutover, false);
  assert.equal(packet.deleteCallSites, false);
  assert.equal(packet.retirementExecuted, false);
  assert.equal(packet.i3Executed, false);
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.phase1bUnlock, "not-issued");
  assert.equal(packet.fullUnlock, "not-issued");
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.rollbackProof, true);
  assert.equal(packet.quarantineProof, true);
  assert.equal(packet.rollback.rewriteFreezeBaselineToZero, false);

  // Batch 24 did not start any follow-on batch / stage.
  assert.equal(packet.batch25Started, false);
  assert.equal(packet.stageCStarted, false);
  assert.equal(packet.stageDStarted, false);

  // Canonical governance pointers stay blocked.
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.fullUnlock, "not-issued");
  assert.equal(unlock.retirementExecuted, false);
  assert.equal(unlock.item7RetirementUnlocked, true);
  assert.equal(decision.phase1bExecutionBlocked, true);

  // Built on the accepted command baseline.
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
});
