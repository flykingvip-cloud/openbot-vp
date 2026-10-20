import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch22-s25.json",
);
const scanPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
);
const sourcePath = path.join(root, "src/gateway/workspace-resolver/steward-write.ts");
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
// Baseline this batch builds on (origin/main tip ae7168f7, #669).
const BASELINE = "ae7168f7a54a96a23aa77171dce5cce8af160b2e";

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

void test("item 7 batch 22 retires S25 target binding and keeps remaining above zero", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  const unlock = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
  const decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
  const phase0 = JSON.parse(fs.readFileSync(phase0Path, "utf8"));
  const source = fs.readFileSync(sourcePath, "utf8");
  const lines = source.split("\n");

  // Batch 22 packet (immutable record of this batch's proposed effect).
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.retiredThisChange, 1);
  assert.equal(packet.previousAcceptedBaseline, 13);
  assert.equal(packet.remaining, 12);
  assert.equal(packet.liveWriteWatchIndex, 12);
  assert.equal(packet.proposedRemaining, 12);
  assert.equal(packet.proposedLiveWriteWatchIndex, 12);
  assert.equal(packet.absorbsUnacceptedBatches, false);
  assert.notEqual(packet.liveWriteWatchIndex, 0);

  // Shared ledger (proposed 12 in this PR; canonical only after Codex accepts).
  assert.equal(scan.remaining, 12);
  assert.equal(scan.sites.length, 12);
  assert.equal(scan.liveWriteWatchIndex, scan.remaining);
  assert.equal(scan.remaining, scan.sites.length);
  assert.notEqual(scan.liveWriteWatchIndex, 0);
  assert.equal(scan.frozenWriteWatchIndex, 38);
  assert.equal(phase0.productionWriteWatchIndex, 38);
  assert.equal(scan.phase0Rewritten, false);
  assert.equal(scan.i3Executed, false);

  // S25 (steward-write.ts:153 target host helper) removed from the live ledger.
  assert.equal(
    scan.sites.some(
      (site) =>
        site.file === "src/gateway/workspace-resolver/steward-write.ts" &&
        site.symbol === "resolveEmployeeStewardTargetWorkspaceDir" &&
        site.line === 153,
    ),
    false,
  );

  // Source posture: S25 now reads the SoT target binding; neighbours unchanged.
  assert.match(lines[152] ?? "", /resolveWorkspaceTargetBinding/);
  assert.doesNotMatch(lines[152] ?? "", /resolveEmployeeStewardTargetWorkspaceDir/);
  assert.match(lines[151] ?? "", /resolveWorkspaceLocator/);
  assert.match(lines[185] ?? "", /!resolved\.ok && sourceRoot && targetRoot \? resolved\.reason/);
  assert.match(lines[278] ?? "", /resolveEmployeeStewardSourceWorkspaceDir/);
  assert.match(lines[279] ?? "", /resolveEmployeeStewardTargetWorkspaceDir/);
  assert.doesNotMatch(source, /process\.cwd\(/);

  // Controlled target-binding capability: no ownership-model change, no prod row, no source fallback.
  assert.equal(packet.targetBindingCapability.api, "resolveWorkspaceTargetBinding");
  assert.equal(packet.targetBindingCapability.ownershipModelChanged, false);
  assert.equal(packet.targetBindingCapability.createsProductionCatalogRow, false);
  assert.equal(packet.targetBindingCapability.failClosed.fallbackToCanonicalSource, false);
  assert.equal(packet.targetBindingCapability.failClosed.mutatesCatalog, false);

  // Locks unchanged.
  assert.equal(packet.productionCatalogWrite, "none");
  assert.equal(packet.productionWrite, false);
  assert.equal(packet.schemaV2ProductionWrite, false);
  assert.equal(packet.rollbackProof, true);
  assert.equal(packet.quarantineProof, true);
  assert.equal(packet.independentRetirementReviewAccepted, true);
  assert.equal(packet.rollback.rewriteFreezeBaselineToZero, false);
  assert.equal(packet.retirementExecuted, false);
  assert.equal(packet.i3Executed, false);
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.schemaV2Write, "disabled");
  assert.equal(packet.live, "forbidden");

  // Batch 22 did not start any follow-on retirement.
  assert.equal(packet.batch23Started, false);
  assert.equal(packet.s26Started, false);
  assert.equal(packet.s27Started, false);

  // Canonical governance pointers stay blocked.
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.fullUnlock, "not-issued");
  assert.equal(unlock.retirementExecuted, false);
  assert.equal(unlock.item7RetirementUnlocked, true);
  assert.equal(decision.phase1bExecutionBlocked, true);

  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
});
