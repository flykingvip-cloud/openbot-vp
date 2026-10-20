#!/usr/bin/env node --no-warnings
/**
 * Evidence test: S01 Stage B Implementation Accept request
 * (isolated replica window2). Requests independent review; does not self-grant.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

const packet = JSON.parse(
  readFileSync(join(__dirname, "memory-workspace-s01-stage-b-implementation-accept.json"), "utf-8"),
);
const scan = JSON.parse(
  readFileSync(
    join(repoRoot, "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json"),
    "utf-8",
  ),
);
const getReply = readFileSync(join(repoRoot, "src/auto-reply/reply/get-reply.ts"), "utf-8");
const getReplyLines = getReply.split("\n");
const decisionDoc = readFileSync(
  join(
    repoRoot,
    ".kiro/specs/memory-workspace-platform-remediation/s01-stage-b-implementation-accept.md",
  ),
  "utf-8",
);

console.log("=== S01 Stage B Implementation Accept request ===\n");

assert.equal(packet.kind, "s01-stage-b-implementation-accept");
assert.equal(packet.owner, "cursor-data-governance");
assert.equal(
  packet.taskId,
  "memory-workspace-platform-remediation:cursor-data-governance-s01-stage-b-implementation-accept",
);
assert.equal(packet.originMain, "a54f5860dd58557b62914d5895ca207fe95681d6");
assert.equal(packet.reviewRequested, "S01 Stage B Implementation Accept");
assert.equal(packet.appliesFor, "S01 Stage B Implementation Accept");
assert.notEqual(packet.appliesFor, "S01 Stage C Accept");
assert.notEqual(packet.appliesFor, "Stage D cutover");
assert.equal(packet.selfAccepted, false);
assert.equal(packet.packetSelfAccepted, false);
assert.equal(packet.signedAsCodexArchitecture, false);
assert.equal(packet.signedAsKiroSotReviewer, false);
assert.equal(packet.requiredReviewer, "flykingvip-cloud");
assert.equal(packet.requestsStageBImplementationAccept, true);
assert.equal(packet.authorizesStageBImplementationAccepted, false);
assert.equal(packet.stageBImplementationAccepted, false);
assert.equal(packet.isolatedReplicaReceiptsObserved, 103);
assert.equal(packet.isolatedReplicaAcceptanceMet, true);
assert.equal(packet.productionLiveReceiptsObserved, 0);
assert.equal(packet.productionReceiptsObserved, 0);
assert.equal(packet.authorizesStageC, false);
assert.equal(packet.authorizesStageCAccept, false);
assert.equal(packet.authorizesStageD, false);
assert.equal(packet.authorizesStageE, false);
assert.equal(packet.authorizesProductionCutover, false);
assert.equal(packet.implementationVerified, false);
assert.equal(packet.deployAuthorized, false);
assert.equal(packet.live, "forbidden");
assert.equal(packet.remaining, 10);
assert.equal(packet.liveWriteWatchIndex, 10);
assert.equal(packet.thisPacketEditsStageBSidecar, false);
assert.equal(packet.thisPacketActivatesProposedPolicy, false);
assert.equal(packet.thisPacketWiresProductionCwd, false);
assert.equal(packet.thisPacketRewritesScan, false);
assert.equal(packet.getReplyStillUsesStewardHelper, true);
assert.equal(packet.p5StillPresent, true);
assert.equal(packet.flag.default, "off");
assert.equal(packet.activePolicy.minSampleSize, 100);
assert.equal(packet.activePolicy.observationWindowMinHours, 2);
assert.equal(packet.activePolicy.minObservationBuckets, 4);
assert.equal(packet.activePolicy.bucketDurationMinutes, 30);
assert.equal(packet.proposedPolicy.minSampleSize, 60);
assert.equal(packet.proposedPolicy.active, false);
assert.equal(packet.proposedPolicy.thisPacketActivatesProposedPolicy, false);
assert.equal(packet.proposedPolicy.status, "proposed-not-active");

const w = packet.isolatedReplicaWindow;
assert.equal(w.environment, "isolated-replica");
assert.equal(w.notLive, true);
assert.equal(w.doNotCallTheseLiveOrganicProductionReceipts, true);
assert.equal(w.nShadow, 103);
assert.equal(w.nSends, 104);
assert.equal(w.isolatedReplicaReceiptsObserved, 103);
assert.notEqual(w.nShadow, 42);
assert.equal(w.elapsed, "2h08m46s");
assert.equal(w.elapsedSec, 7726.528);
assert.equal(w.elapsedGe2h, true);
assert.deepEqual(w.fourConsecutive30minBuckets, ["22:00", "22:30", "23:00", "23:30"]);
assert.equal(w.byKind.catalog_miss, 44);
assert.equal(w.byKind.fencing_stale, 18);
assert.equal(w.byKind.tenant_mismatch, 18);
assert.equal(w.byKind.authorization_denied, 10);
assert.equal(w.byKind.fail_closed_missing_identity, 6);
assert.equal(w.byKind.identity_and_authorization_match, 4);
assert.equal(w.byKind.fail_closed_missing_authorization, 3);
assert.equal(w.identityAndAuthorizationMatchCrossTenant, 0);
assert.equal(w.unexpectedErrorRate, 0);
assert.equal(w.shadowError, 0);
assert.equal(w.importError, 0);
assert.equal(w.helperCwdPresent, "103/103");
assert.equal(w.productionCwdUnchanged, "103/103");
assert.equal(w.catalogLocatorAsCwdTrue, 0);
assert.equal(w.acceptanceMetUnderActive100, true);
assert.equal(w.distinctTenantCount, 2);
assert.equal(w.employeesPerTenantCount["001"], 6);
assert.equal(w.employeesPerTenantCount["workspace-8-7d722e88"], 2);
assert.ok(w.firstCst.includes("2026-08-31T22:00:02.192"));
assert.ok(w.lastCst.includes("2026-09-01T00:08:48.720"));

assert.equal(packet.liveStillOldImage.productionLiveReceiptsObserved, 0);
assert.equal(packet.liveStillOldImage.catalogRevision, 77);
assert.match(packet.liveStillOldImage.id, /4aa1e738/);

assert.equal(packet.flagOffEvidence.label, "post-871-flag-off-probe");
assert.match(packet.flagOffEvidence.path, /s01-post871-flagoff-probe\.mjs/);
assert.equal(packet.flagOffEvidence.getReply, "4/4");
assert.equal(packet.flagOffEvidence.shadowEvents, 0);
assert.equal(packet.flagOffEvidence.notTheN42FailWindow, true);
assert.equal(packet.flagOffEvidence.notMixedIntoN103, true);

assert.equal(packet.excludedWindow.n, 42);
assert.equal(packet.excludedWindow.counted, false);
assert.equal(packet.excludedWindow.failsActive100, true);
assert.equal(packet.excludedWindow.thisPacketActivatesProposedPolicy, false);
assert.equal(packet.excludedWindow.activeMinSampleSizeStill, 100);
assert.notEqual(packet.isolatedReplicaReceiptsObserved, packet.excludedWindow.n);

assert.equal(packet.independentReview.required, true);
assert.equal(packet.independentReview.selfAccepted, false);
assert.equal(packet.independentReview.packetSelfAccepted, false);
assert.equal(packet.independentReview.signedAsCodexArchitecture, false);
assert.equal(packet.independentReview.requiredReviewer, "flykingvip-cloud");
assert.equal(packet.independentReview.authorCannotSelfMerge, true);

assert.equal(packet.locks.remaining, 10);
assert.equal(packet.locks.liveWriteWatchIndex, 10);
assert.equal(packet.locks.p5Present, true);
assert.equal(packet.locks.helperStillCwd, true);
assert.equal(packet.locks.flagDefault, "off");
assert.equal(packet.locks.implementationVerified, false);
assert.equal(packet.locks.deployAuthorized, false);
assert.equal(packet.locks.live, "forbidden");
assert.equal(packet.locks.proposed60Applied, false);
assert.equal(packet.locks.authorizesStageBImplementationAccepted, false);
assert.equal(packet.locks.requestsStageBImplementationAccept, true);
assert.equal(packet.locks.isolatedReplicaReceiptsObserved, 103);

assert.ok(packet.doesNotAuthorize.includes("Stage C Accept"));
assert.ok(packet.doesNotAuthorize.includes("Stage D cutover"));
assert.ok(packet.doesNotAuthorize.includes("LIVE"));
assert.ok(packet.doesNotAuthorize.includes("deleting P5"));
assert.ok(packet.doesNotAuthorize.includes("scan index change"));
assert.ok(packet.doesNotAuthorize.includes("implementationVerified=true"));
assert.ok(packet.doesNotAuthorize.includes("counting n=42"));
assert.ok(packet.doesNotAuthorize.includes("applying proposed minSampleSize=60"));
assert.ok(packet.doesNotAuthorize.includes("self-merge"));
assert.ok(packet.doesNotAuthorize.includes("self-sign"));

assert.equal(scan.remaining, 10);
assert.equal(scan.liveWriteWatchIndex, 10);
assert.equal(scan.sites[0].pathId, "P5");
assert.equal(scan.sites[0].symbol, "resolveEmployeeBuiltinStewardWorkspaceDir");
assert.equal(scan.sites[0].file, "src/auto-reply/reply/get-reply.ts");
assert.match(getReplyLines[163] ?? "", /resolveEmployeeBuiltinStewardWorkspaceDir/);
assert.match(getReply, /runS01GetReplyStewardCwdShadowFromEntry/);
assert.doesNotMatch(getReply, /evaluateS01AuthorizedToolCwd/);
assert.doesNotMatch(getReply, /resolveS01StewardWorkspaceIdentity/);

assert.match(decisionDoc, /S01 Stage B Implementation Accept/);
assert.match(decisionDoc, /selfAccepted/);
assert.match(decisionDoc, /isolated replica/);
assert.match(decisionDoc, /n=103/);
assert.match(decisionDoc, /n=42/);
assert.doesNotMatch(decisionDoc, /authorizesStageBImplementationAccepted: true/);
assert.match(decisionDoc, /authorizesStageBImplementationAccepted: false/);
assert.match(decisionDoc, /flykingvip-cloud/);
assert.match(decisionDoc, /LIVE/);

assert.ok(packet.activePolicy.requiredCoverage.includes("identity_and_authorization_match"));
assert.ok(packet.activePolicy.requiredCoverage.includes("catalog_miss"));
assert.ok(packet.activePolicy.requiredCoverage.includes("tenant_mismatch"));
assert.ok(packet.activePolicy.requiredCoverage.includes("fencing_stale"));
assert.ok(packet.activePolicy.requiredCoverage.includes("fail_closed_missing_authorization"));
assert.ok(packet.activePolicy.requiredCoverage.includes("authorization_denied"));

console.log("✓ Stage B Implementation Accept request locked; n=103; not 42; not self-signed\n");
console.log(
  "Status: requests accept; authorizesStageBImplementationAccepted=false; LIVE forbidden",
);
