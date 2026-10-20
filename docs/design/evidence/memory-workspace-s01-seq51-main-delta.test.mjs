#!/usr/bin/env node --no-warnings
/**
 * Evidence test: S01 seq51..main observation delta (not deploy auth).
 *
 * Locks forward-only 112, LIVE vs main, scanner/fixture inventory,
 * log-only collector gap, and the required false/forbidden flags.
 * Does not deploy, flip flags, write Catalog, or authorize LIVE.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

const packet = JSON.parse(
  readFileSync(join(__dirname, "memory-workspace-s01-seq51-main-delta.json"), "utf-8"),
);
const handoff = readFileSync(
  join(
    repoRoot,
    ".kiro/specs/memory-workspace-platform-remediation/handoff-s01-seq51-main-delta.md",
  ),
  "utf-8",
);
const evidenceMd = readFileSync(
  join(__dirname, "memory-workspace-s01-seq51-main-delta.md"),
  "utf-8",
);
const inventory = JSON.parse(
  readFileSync(join(__dirname, "memory-workspace-s01-production-object-inventory.json"), "utf-8"),
);
const dryRun = JSON.parse(
  readFileSync(join(__dirname, "memory-workspace-legacy-migration-dry-run.json"), "utf-8"),
);
const stageCPrep = JSON.parse(
  readFileSync(join(__dirname, "memory-workspace-s01-stage-c-prep.json"), "utf-8"),
);
const shadowSrc = readFileSync(
  join(repoRoot, "src/gateway/data-governance/s01-get-reply-steward-cwd-shadow.ts"),
  "utf-8",
);

console.log("=== S01 seq51..main observation delta ===\n");

assert.equal(packet.schema, "memory-workspace-s01-seq51-main-delta/v1");
assert.equal(packet.kind, "s01-seq51-main-observation-delta");
assert.equal(packet.owner, "kiro-data-governance");
assert.equal(
  packet.taskId,
  "memory-workspace-platform-remediation:kiro-data-governance-seq51-main-observation-delta",
);
assert.equal(packet.originMain, "56a17e7f83338900e6f19fa2bd2d510b37696fe6");
assert.equal(packet.liveSha, "59be50660d8ebacf867211a206c92b4300bec418");
assert.equal(packet.liveSeq, 51);
assert.equal(packet.forwardOnly, true);
assert.equal(packet.commitCount, 112);
assert.equal(packet.selfAccepted, false);
assert.equal(packet.implementationVerified, false);
assert.equal(packet.deployAuthorized, false);
assert.equal(packet.live, "forbidden");
assert.equal(packet.LIVE, "forbidden");
assert.equal(packet.remaining, 10);
assert.equal(packet.liveWriteWatchIndex, 10);
assert.equal(packet.productionReceiptsObserved, 0);
assert.equal(packet.observationBucketsObserved, 0);
assert.equal(packet.acceptanceMet, false);
assert.equal(packet.authorizesStageC, false);
assert.equal(packet.authorizesStageD, false);
assert.equal(packet.authorizesStageCAccept, false);
assert.equal(packet.thisPacketBuildsGhcr, false);
assert.equal(packet.thisPacketPushesGhcr, false);
assert.equal(packet.candidateForFutureObservationDeploy, "freshly-fetched origin/main");
assert.equal(packet.candidateMustNotBeS01OnlyBranch, true);

assert.equal(packet.locks.implementationVerified, false);
assert.equal(packet.locks.deployAuthorized, false);
assert.equal(packet.locks.live, "forbidden");
assert.equal(packet.locks.remaining, 10);
assert.equal(packet.locks.productionReceiptsObserved, 0);
assert.equal(packet.locks.authorizesStageC, false);
assert.equal(packet.locks.authorizesStageD, false);
assert.equal(packet.locks.executedAgainstProductionRoots, false);
assert.equal(packet.locks.collectorMissing, true);

assert.equal(packet.liveVsMain.cloudLiveIncludesStageA, false);
assert.equal(packet.liveVsMain.cloudLiveIncludesStageB, false);
assert.equal(packet.liveVsMain.cloudLiveIncludesCr3, false);
assert.equal(packet.liveVsMain.cloudLiveIncludesObservationGates, false);
assert.equal(packet.classifiedDelta.s01.commitCount, 91);
assert.equal(packet.classifiedDelta.s01.stageA.commitCount, 42);
assert.equal(packet.classifiedDelta.s01.stageB.commitCount, 12);
assert.equal(packet.classifiedDelta.s01.stageC.commitCount, 3);
assert.equal(packet.classifiedDelta.s01.pr871.commitCount, 1);
assert.equal(packet.classifiedDelta.s01.incrementalReview.commitCount, 1);
assert.equal(
  packet.classifiedDelta.s01.incrementalReview.sha,
  "3a0ddedbc59efe8f4063f068090158b4090e85da",
);
assert.equal(packet.classifiedDelta.s01.incrementalReview.inLive, false);
assert.equal(packet.classifiedDelta.s01.pr876.commitCount, 1);
assert.equal(packet.classifiedDelta.s01.pr876.sha, "56a17e7f83338900e6f19fa2bd2d510b37696fe6");
assert.equal(packet.classifiedDelta.s01.pr876.inLive, false);
assert.equal(packet.classifiedDelta.s01.pr876.landedOnMain, true);
assert.equal(packet.classifiedDelta.s01.d1d5AndImplementationReadiness.commitCount, 31);
assert.equal(packet.classifiedDelta.dataGovernance.commitCount, 6);
assert.equal(packet.classifiedDelta.deployLedger.commitCount, 3);
assert.equal(packet.classifiedDelta.unrelated.commitCount, 12);
assert.equal(packet.classifiedDelta.unrelated.wechat.commitCount, 0);
assert.equal(
  packet.classifiedDelta.s01.stageA.commitCount +
    packet.classifiedDelta.s01.stageB.commitCount +
    packet.classifiedDelta.s01.stageC.commitCount +
    packet.classifiedDelta.s01.pr871.commitCount +
    packet.classifiedDelta.s01.incrementalReview.commitCount +
    packet.classifiedDelta.s01.pr876.commitCount +
    packet.classifiedDelta.s01.d1d5AndImplementationReadiness.commitCount +
    packet.classifiedDelta.dataGovernance.commitCount +
    packet.classifiedDelta.deployLedger.commitCount +
    packet.classifiedDelta.unrelated.commitCount,
  112,
);

assert.equal(packet.cPrepInventory.scannerFixtureOnly, true);
assert.equal(packet.cPrepInventory.inventedLiveInventory, false);
assert.equal(packet.cPrepInventory.executedAgainstProductionRoots, false);
assert.equal(packet.cPrepInventory.cannotReachProductionRoots, true);
assert.equal(packet.cPrepInventory.productionWrite, false);
assert.equal(packet.cPrepInventory.legacyMigrationDryRun.recordCount, 185);
assert.equal(packet.cPrepInventory.legacyMigrationDryRun.migrate, 0);
assert.equal(packet.cPrepInventory.legacyMigrationDryRun.quarantine, 171);
assert.equal(inventory.productionScanExecuted, false);
assert.equal(inventory.productionWrite, false);
assert.equal(dryRun.recordCount, 185);
assert.equal(dryRun.decisionCounts.quarantine, 171);
assert.equal(dryRun.productionWrite, false);
assert.equal(dryRun.migrationExecuted, false);

assert.equal(packet.receiptCollectorGap.persistence, "log-only");
assert.equal(packet.receiptCollectorGap.durableCollector, false);
assert.equal(packet.receiptCollectorGap.collectorMissing, true);
assert.equal(packet.receiptCollectorGap.thisPacketImplementsCollector, false);
assert.equal(packet.receiptCollectorGap.thisPacketEditsGetReply, false);
assert.equal(packet.receiptCollectorGap.stageCGate.productionReceiptsObserved, 0);
assert.equal(packet.receiptCollectorGap.stageCGate.observationBucketsObserved, 0);
assert.equal(packet.receiptCollectorGap.stageCGate.acceptanceMet, false);
assert.equal(stageCPrep.receiptAcceptance.productionReceiptsObserved, 0);
assert.equal(stageCPrep.receiptAcceptance.observationBucketsObserved, 0);
assert.equal(stageCPrep.receiptAcceptance.acceptanceMet, false);
assert.equal(shadowSrc.includes('log.info?.("s01_stage_b_steward_cwd_shadow"'), true);
assert.equal(shadowSrc.includes("writeFile"), false);
assert.equal(shadowSrc.includes("appendFile"), false);
assert.equal(shadowSrc.includes(".jsonl"), false);

for (const doc of [handoff, evidenceMd]) {
  assert.match(doc, /forward-only/i);
  assert.match(doc, /112/);
  assert.match(doc, /deployAuthorized/);
  assert.match(doc, /collectorMissing/);
  assert.match(doc, /executedAgainstProductionRoots/);
}

console.log(
  "locks held: forward-only 112, LIVE missing Stage A/B/CR3/gates, collector log-only, inventory not executed against production roots, deployAuthorized=false",
);
