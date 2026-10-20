import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch21-s24.json",
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
const BASELINE = "3447511b071f5538523704831c8d3fb09a4b0943";

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

void test("item 7 batch 21 retires S24 and keeps remaining above zero", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  const unlock = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
  const decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
  const phase0 = JSON.parse(fs.readFileSync(phase0Path, "utf8"));
  const source = fs.readFileSync(sourcePath, "utf8");
  const lines = source.split("\n");
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.retiredThisChange, 1);
  assert.equal(packet.previousAcceptedBaseline, 14);
  assert.equal(packet.remaining, 13);
  assert.equal(packet.liveWriteWatchIndex, 13);
  assert.notEqual(packet.liveWriteWatchIndex, 0);
  assert.ok(scan.remaining <= 13);
  assert.ok(scan.sites.length <= 13);
  assert.equal(scan.liveWriteWatchIndex, scan.remaining);
  assert.equal(scan.remaining, scan.sites.length);
  assert.notEqual(scan.liveWriteWatchIndex, 0);
  assert.equal(scan.frozenWriteWatchIndex, 38);
  assert.equal(phase0.productionWriteWatchIndex, 38);
  assert.equal(scan.phase0Rewritten, false);
  assert.equal(scan.i3Executed, false);
  assert.equal(
    scan.sites.some(
      (site) =>
        site.file === "src/gateway/workspace-resolver/steward-write.ts" &&
        site.symbol === "resolveEmployeeStewardSourceWorkspaceDir" &&
        site.line === 152,
    ),
    false,
  );
  assert.match(lines[151] ?? "", /resolveWorkspaceLocator/);
  assert.doesNotMatch(lines[151] ?? "", /resolveEmployeeStewardSourceWorkspaceDir/);
  // Batch 22 extended the guard (+ targetRoot) and retired S25 (line 153).
  assert.match(lines[185] ?? "", /!resolved\.ok && sourceRoot && targetRoot \? resolved\.reason/);
  assert.match(lines[152] ?? "", /resolveWorkspaceTargetBinding/);
  assert.match(lines[278] ?? "", /resolveEmployeeStewardSourceWorkspaceDir/);
  assert.match(lines[279] ?? "", /resolveEmployeeStewardTargetWorkspaceDir/);
  assert.doesNotMatch(source, /process\.cwd\(/);
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
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.fullUnlock, "not-issued");
  assert.equal(unlock.retirementExecuted, false);
  assert.equal(unlock.item7RetirementUnlocked, true);
  assert.equal(decision.phase1bExecutionBlocked, true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
});
