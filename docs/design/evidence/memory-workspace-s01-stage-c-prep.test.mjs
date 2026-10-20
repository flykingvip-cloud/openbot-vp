#!/usr/bin/env node --no-warnings
/**
 * Evidence test: S01 Stage C cutover PREP (awaiting independent accept).
 *
 * Locks helper-decided cwd, default-off flag, scan 10/10, P5 present,
 * prepared-awaiting-independent-accept. Requests Stage C Prep Accept.
 * Does not flip implementationVerified or authorize Stage C Accept.
 * Records independent #878 Stage B Implementation Accept.
 * Does not edit get-reply or the shadow source.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

const packet = JSON.parse(
  readFileSync(join(__dirname, "memory-workspace-s01-stage-c-prep.json"), "utf-8"),
);
const scan = JSON.parse(
  readFileSync(
    join(repoRoot, "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json"),
    "utf-8",
  ),
);
const getReply = readFileSync(join(repoRoot, "src/auto-reply/reply/get-reply.ts"), "utf-8");
const getReplyLines = getReply.split("\n");
const cwdSrc = readFileSync(
  join(repoRoot, "src/gateway/data-governance/s01-authorized-tool-cwd.ts"),
  "utf-8",
);
const identitySrc = readFileSync(
  join(repoRoot, "src/gateway/data-governance/s01-steward-workspace-identity.ts"),
  "utf-8",
);
const shadowSrc = readFileSync(
  join(repoRoot, "src/gateway/data-governance/s01-get-reply-steward-cwd-shadow.ts"),
  "utf-8",
);
const buildersSrc = readFileSync(
  join(repoRoot, "src/gateway/workspace-resolver/builders.ts"),
  "utf-8",
);
const handoff = readFileSync(
  join(repoRoot, ".kiro/specs/memory-workspace-platform-remediation/handoff-s01-stage-c-prep.md"),
  "utf-8",
);
const preflight = readFileSync(
  join(repoRoot, ".kiro/specs/memory-workspace-platform-remediation/s01-stage-c-preflight.md"),
  "utf-8",
);
const mappingDoc = readFileSync(
  join(
    repoRoot,
    ".kiro/specs/memory-workspace-platform-remediation/s01-stage-c-identity-mapping.md",
  ),
  "utf-8",
);

console.log("=== S01 Stage C cutover PREP ===\n");

assert.equal(packet.kind, "s01-stage-c-prep");
assert.equal(packet.owner, "kiro-data-governance");
assert.equal(
  packet.taskId,
  "memory-workspace-platform-remediation:kiro-data-governance-s01-stage-c-prep",
);
assert.equal(packet.originMain, "8be667b41e60987c7b886e4a6327b168130b8717");
assert.equal(packet.selfAccepted, false);
assert.equal(packet.stageBImplementationAccepted, true);
assert.equal(packet.authorizesStageBImplementationAccepted, false);
assert.equal(packet.stageBImplementation, "accepted-via-independent-review-pr-878");
assert.equal(packet.stageBImplementationAcceptPr, 878);
assert.equal(packet.stageBImplementationAcceptMergeSha, "feb282af713021e5eaaac692e01c3cb3af0cc510");
assert.equal(packet.stageBImplementationAcceptMergedAt, "2026-08-31T19:03:52Z");
assert.equal(packet.stageBImplementationAcceptReviewer, "flykingvip-cloud");
assert.equal(packet.isolatedReplicaReceiptsObserved, 103);
assert.equal(packet.productionLiveReceiptsObserved, 0);
assert.equal(packet.isolatedReplicaAcceptanceMet, true);
assert.equal(packet.signedAsKiroSotReviewer, false);
assert.equal(packet.pr878Merged, true);

assert.equal(packet.stageC, "prepared-awaiting-independent-accept");
assert.equal(packet.stageCAccepted, false);
assert.equal(packet.authorizesStageCAccept, false);
assert.equal(packet.requestsStageCAccept, true);
assert.equal(packet.cutoverFlag, "off");
assert.equal(packet.implementationVerified, false);
assert.equal(packet.implementationGate, "not-met");
assert.equal(packet.remaining, 10);
assert.equal(packet.liveWriteWatchIndex, 10);
assert.equal(packet.deployAuthorized, false);
assert.equal(packet.live, "forbidden");
assert.equal(packet.flag.default, "off");
assert.equal(packet.thisPacketWiresProductionCwd, false);
assert.equal(packet.thisPacketModifiesGetReply, false);
assert.equal(packet.thisPacketModifiesShadowEvaluator, false);
assert.equal(packet.thisPacketRewritesScan, false);
assert.equal(packet.forgedProductionAdapters, false);
assert.equal(packet.usedInMemoryAsProduction, false);
assert.equal(packet.rollbackDrillsExecuted, false);
assert.equal(packet.notItem7C1C5, true);

assert.equal(packet.locks.stageC, "prepared-awaiting-independent-accept");
assert.equal(packet.locks.cutoverFlag, "off");
assert.equal(packet.locks.implementationVerified, false);
assert.equal(packet.locks.remaining, 10);
assert.equal(packet.locks.liveWriteWatchIndex, 10);
assert.equal(packet.locks.p5Present, true);
assert.equal(packet.locks.live, "forbidden");
assert.equal(packet.locks.authorizesStageCAccept, false);
assert.equal(packet.locks.item7, "not-met");
assert.equal(packet.locks.deployAuthorized, false);

assert.match(getReplyLines[163] ?? "", /resolveEmployeeBuiltinStewardWorkspaceDir/);
assert.match(getReplyLines[164] ?? "", /resolveAgentWorkspaceDir/);
assert.match(getReply, /runS01GetReplyStewardCwdShadowFromEntry/);
assert.doesNotMatch(getReply, /runS01StewardCwdShadowIfEnabled/);
assert.doesNotMatch(getReply, /InMemoryWorkspaceResourceCatalog/);
assert.doesNotMatch(getReply, /getSharedDataGovernanceCatalog/);
assert.doesNotMatch(getReply, /evaluateS01AuthorizedToolCwd/);
assert.doesNotMatch(getReply, /resolveS01StewardWorkspaceIdentity/);
assert.match(cwdSrc, /S01_PRODUCTION_WIRED_TO_GET_REPLY = false/);
assert.match(shadowSrc, /OPENBOT_S01_STAGE_B_STEWARD_CWD_SHADOW/);
assert.match(shadowSrc, /return false;/);
assert.match(shadowSrc, /usedShadowPathForProduction: false/);
assert.match(shadowSrc, /"identity_and_authorization_match"/);
assert.match(shadowSrc, /fail_closed_missing_authorization/);
assert.match(shadowSrc, /authorization_denied/);
assert.doesNotMatch(shadowSrc, /"identity_match"/);

const fromEntry = "runS01GetReplyStewardCwdShadowFromEntry({";
const shadowStart = getReply.indexOf(fromEntry);
assert.ok(shadowStart >= 0);
const shadowEnd = getReply.indexOf("}),", shadowStart);
assert.ok(shadowEnd > shadowStart);
const shadowCall = getReply.slice(shadowStart, shadowEnd + 3);
assert.match(shadowCall, /helperCwd: stewardHelperCwd \?\? workspaceDirRaw/);
assert.doesNotMatch(shadowCall, /catalog:/);
assert.doesNotMatch(shadowCall, /registry:/);
assert.doesNotMatch(shadowCall, /principal:/);
assert.doesNotMatch(shadowCall, /memberships:/);
assert.doesNotMatch(shadowCall, /attestationSecret:/);

assert.equal(scan.remaining, 10);
assert.equal(scan.liveWriteWatchIndex, 10);
assert.equal(scan.sites[0].pathId, "P5");
assert.equal(scan.sites[0].symbol, "resolveEmployeeBuiltinStewardWorkspaceDir");
assert.equal(scan.sites[0].file, "src/auto-reply/reply/get-reply.ts");
assert.equal(scan.sites.length, 10);

assert.equal(packet.mapping.stewardSlugValue, "main");
assert.match(identitySrc, /export const S01_STEWARD_SLUG = "main"/);
assert.match(identitySrc, /createInMemoryS01StewardRegistryPort/);
assert.match(identitySrc, /resolveUniqueAgentAssetId/);
assert.match(
  buildersSrc,
  /ws:\$\{params.tenantId\}:user:\$\{params.scope.userId\}:asset:\$\{params.scope.agentAssetId\}/,
);
assert.equal(packet.mapping.productionCatalogAdapter, "S01ReadOnlyDurableCatalogView");
assert.equal(packet.mapping.productionRegistryAdapter, "createProductionS01StewardRegistryPort");
assert.equal(
  packet.mapping.productionMembershipAdapter,
  "loadPlatformAuthStore + findUniqueMembershipByUserId",
);
assert.equal(packet.mapping.productionPrincipalIssuer, "issueS01TrustedPrincipal");
assert.notEqual(packet.mapping.productionMembershipAdapter, "missing");
assert.notEqual(packet.mapping.productionPrincipalIssuer, "missing");
assert.equal(packet.mapping.cr3Landed, true);
assert.equal(packet.mapping.inMemoryIsTestOnly, true);
assert.equal(packet.productionObservation.getReplyPassesSessionId, true);
assert.equal(packet.productionObservation.productionReceiptsObserved, 0);
assert.equal(packet.productionObservation.cr3Landed, true);
assert.equal(
  packet.mapping.testOnlyWorkedExample.workspaceResourceId,
  "ws:ent-456:user:usr-123:asset:asset-steward-1",
);
assert.match(packet.mapping.testOnlyWorkedExample.label, /NOT production/);

assert.equal(packet.receiptAcceptance.cr1Receipts[0], "identity_and_authorization_match");
assert.ok(packet.receiptAcceptance.cr1Receipts.includes("catalog_miss"));
assert.ok(packet.receiptAcceptance.cr1Receipts.includes("tenant_mismatch"));
assert.ok(packet.receiptAcceptance.cr1Receipts.includes("fencing_stale"));
assert.ok(packet.receiptAcceptance.cr1Receipts.includes("fail_closed_missing_authorization"));
assert.ok(packet.receiptAcceptance.cr1Receipts.includes("authorization_denied"));
assert.equal(packet.receiptAcceptance.mainReceipts[0], "identity_and_authorization_match");
assert.equal(packet.receiptAcceptance.deltaVsCr1.mainHasIdentityMatch, false);
assert.equal(packet.receiptAcceptance.deltaVsCr1.cr1LandedOnMain, true);
assert.equal(packet.receiptAcceptance.deltaVsCr1.shadowSourceEditedInThisPacket, false);
assert.equal(packet.receiptAcceptance.minSampleSize, 100);
assert.equal(packet.receiptAcceptance.minDistinctTenants, 2);
assert.equal(packet.receiptAcceptance.minDistinctEmployeesPerTenant, 2);
assert.equal(packet.receiptAcceptance.observationWindowMinHours, 2);
assert.equal(packet.receiptAcceptance.observationWindowHours, undefined);
assert.equal(packet.receiptAcceptance.minObservationBuckets, 4);
assert.equal(packet.receiptAcceptance.bucketDurationMinutes, 30);
assert.equal(packet.receiptAcceptance.consecutiveBucketsRequired, true);
assert.equal(packet.receiptAcceptance.realShadowReceiptsOnly, true);
assert.equal(packet.receiptAcceptance.syntheticOrTestReceiptsDoNotCount, true);
assert.equal(packet.receiptAcceptance.canaryRealOnly, true);
assert.equal(packet.receiptAcceptance.flagOffAndFlagOnEvidenceRequired, true);
assert.equal(packet.receiptAcceptance.flagOffEvidenceObserved, true);
assert.equal(packet.receiptAcceptance.flagOnEvidenceObserved, true);
assert.equal(packet.receiptAcceptance.shadowMustNotChangeUserVisibleCwd, true);
assert.equal(packet.receiptAcceptance.shadowMustNotChangeResponse, true);
assert.equal(packet.receiptAcceptance.shadowMustNotChangeAuthz, true);
assert.equal(packet.receiptAcceptance.shadowMustNotChangeProductionWrites, true);
assert.equal(packet.receiptAcceptance.observationBucketsObserved, 4);
assert.equal(packet.receiptAcceptance.zeroCrossTenantTolerance, 0);
assert.equal(packet.receiptAcceptance.maxUnexpectedErrorRate, 0.001);
assert.equal(packet.receiptAcceptance.productionReceiptsObserved, 0);
assert.equal(packet.receiptAcceptance.acceptanceMet, true);
assert.equal(packet.receiptAcceptance.productionReceiptsAcceptanceMet, false);
assert.equal(packet.stageCPrepAccepted, false);
assert.equal(packet.productionReceiptsAcceptanceMet, false);
assert.equal(packet.receiptAcceptance.isolatedReplicaReceiptsObserved, 103);
assert.equal(packet.receiptAcceptance.isolatedReplicaAcceptanceMet, true);
assert.equal(packet.blockers.stageBNotAccepted.status, "accepted-via-independent-review-pr-878");
assert.equal(packet.blockers.stageBNotAccepted.pr878, 878);
assert.equal(packet.blockers.isolatedReplicaCompositeObservationGateMet, true);
assert.equal(packet.blockers.liveProductionCompositeObservationGateMet, false);
assert.equal(packet.preflight.productionReceiptsObserved, 0);
assert.equal(packet.preflight.cutoverFlagOff, true);
assert.equal(packet.preflight.stageCAccept, false);
assert.equal(packet.stageBImplementationAcceptGate.thisPacketDoesNotAcceptStageB, true);
assert.equal(packet.productionCutoverGate.thisPacketDoesNotAuthorizeCutover, true);
assert.ok(!packet.notDone.includes("Stage B Implementation Accepted"));
assert.ok(packet.notDone.includes("Stage C Accept"));
assert.ok(packet.notDone.includes("Stage D cutover"));
assert.ok(packet.notDone.includes("real production LIVE shadow receipts"));
assert.ok(packet.doesNotAuthorize.includes("Stage B Implementation Accepted (self-grant)"));
assert.ok(packet.doesNotAuthorize.includes("deleting P5"));
assert.ok(packet.doesNotAuthorize.includes("nginx / LIVE cutover"));
assert.equal(packet.stageBImplementationAcceptGate.observationWindowMinHours, 2);
assert.equal(packet.stageBImplementationAcceptGate.minSampleSize, 100);
assert.equal(packet.stageBImplementationAcceptGate.minObservationBuckets, 4);
assert.equal(packet.stageBImplementationAcceptGate.bucketDurationMinutes, 30);
assert.equal(packet.stageBImplementationAcceptGate.acceptanceMet, true);
assert.equal(packet.productionCutoverGate.postCutoverShadowTelemetryHours, 24);
assert.equal(packet.productionCutoverGate.authorized, false);
assert.equal(packet.productionCutoverGate.authorizesStageD, false);
assert.equal(packet.productionCutoverGate.autoRollbackMonitoring, true);
assert.equal(packet.productionCutoverGate.receiptsMustPersistAndBeAuditable, true);
assert.equal(packet.stageCEnterExit.exitMet, false);
assert.equal(packet.authorizesStageD, false);
assert.equal(packet.authorizesStageE, false);

assert.equal(packet.blockers.cr1A.id, "CR1-A");
assert.equal(packet.blockers.cr1A.pr, 851);
assert.equal(packet.blockers.cr1A.status, "landed-via-857-honest-ports");
assert.equal(packet.blockers.noRealProductionShadowReceipts, true);
assert.equal(packet.blockers.compositeObservationGateNotMet, false);
assert.equal(packet.blockers.stageBNotAccepted.pr, 850);
assert.equal(packet.blockers.cr3.id, "CR3");
assert.equal(packet.blockers.cr3.pr, 860);
assert.equal(packet.blockers.cr3.reviewPr, 865);
assert.equal(packet.blockers.cr3.status, "landed-reviewed");
assert.equal(packet.blockers.cr3.productionReceiptsObserved, 0);
assert.equal(packet.preflight.compositeObservationGateMet, true);

assert.equal(packet.preflight.cutoverFlagOff, true);
assert.equal(packet.preflight.helperDecidesCwd, true);
assert.equal(packet.preflight.scanRemaining, 10);
assert.equal(packet.preflight.p5Present, true);
assert.equal(packet.preflight.stageCAccept, false);
assert.equal(packet.preflight.readyForStageCAccept, true);

assert.equal(packet.rollbackDrills.executed, false);
assert.match(packet.rollbackDrills.gitRevertThisPrepPr, /git revert/);
assert.match(packet.rollbackDrills.configRestore, /OPENBOT_S01_STAGE_B_STEWARD_CWD_SHADOW/);
assert.match(packet.rollbackDrills.scanRestore, /does not rewrite the canonical scan/);

assert.ok(packet.doesNotAuthorize.includes("Stage C Accept"));
assert.ok(packet.doesNotAuthorize.includes("LIVE authorized"));
assert.ok(packet.doesNotAuthorize.includes("forging production Catalog or Registry adapters"));

assert.match(handoff, /prepared-awaiting-independent-accept/);
assert.match(handoff, /authorizesStageCAccept: false/);
assert.match(handoff, /requestsStageCAccept/);
assert.match(handoff, /observationWindowMinHours/);
assert.match(handoff, /minObservationBuckets/);
assert.doesNotMatch(handoff, /observationWindowHours=24/);
assert.match(handoff, /8be667b41e60987c7b886e4a6327b168130b8717/);
assert.match(shadowCall, /sessionId/);
assert.ok(packet.receiptAcceptance.allMustHold.length >= 10);
assert.ok(packet.receiptAcceptance.requiredCoverage.includes("identity_and_authorization_match"));
assert.ok(packet.doesNotAuthorize.includes("Stage D cutover"));
assert.match(preflight, /OPENBOT_S01_STAGE_B_STEWARD_CWD_SHADOW/);
assert.match(preflight, /scan 10\/10/);
assert.match(preflight, /no Stage C Accept/);
assert.match(mappingDoc, /tenantId/);
assert.match(mappingDoc, /workspaceResourceId/);
assert.match(mappingDoc, /InMemory is test-only/);
assert.match(mappingDoc, /CR1-A/);

assert.equal(packet.schema, "memory-workspace-s01-stage-c-prep/v1.2-window2-bound");
assert.equal(packet.packetRevision, 3);
assert.equal(packet.policyRevisionId, "propose-minSampleSize-60-keep-active-100");
assert.match(packet.evidenceShaPendingMerge, /^pending:/);
assert.equal(packet.previousEvidenceFileSha, "2b3b652f9172e305cda22f1e6efaa8473a4f30cd");
assert.equal(packet.previousSchema, "memory-workspace-s01-stage-c-prep/v1");
assert.equal(packet.policyRevisionBaseMain, "56a17e7f83338900e6f19fa2bd2d510b37696fe6");
assert.equal(packet.policyRevisionSourcePr, 866);
assert.equal(packet.requiredReviewer, "flykingvip-cloud");
assert.equal(packet.signedAsCodexArchitecture, false);
assert.equal(packet.thisPacketEditsStageBSidecar, false);
assert.equal(packet.thisPacketActivatesProposedPolicy, false);
assert.match(
  packet.verdict,
  /Isolated-replica window2 n=103 over 2h08m46s met the active 100-receipt gate/,
);
assert.match(packet.verdict, /This packet REQUESTS Stage C Cutover Prep Accept only/);
assert.match(packet.verdict, /authorizesStageCAccept=false; selfAccepted=false/);
assert.match(packet.verdict, /flykingvip-cloud merged Stage B Implementation Accept request #878/);
assert.match(packet.verdict, /productionLiveReceiptsObserved=0/);
assert.match(packet.verdict, /proposedPolicy.minSampleSize=60 remains inactive/);
assert.match(packet.verdict, /remaining=10/);
assert.match(packet.verdict, /implementationVerified=false/);
assert.match(packet.verdict, /LIVE forbidden/);
assert.match(packet.verdict, /Does not authorize Stage D, deleting P5, or production cwd cutover/);

assert.equal(packet.originalThreshold.minSampleSize, 100);
assert.equal(packet.originalThreshold.sourcePr, 866);
assert.equal(packet.proposedThreshold.minSampleSize, 60);
assert.equal(packet.proposedThreshold.minReceiptsPerBucket, 15);
assert.equal(packet.activePolicy.minSampleSize, 100);
assert.equal(packet.activePolicy.observationWindowMinHours, 2);
assert.equal(packet.activePolicy.minObservationBuckets, 4);
assert.equal(packet.activePolicy.bucketDurationMinutes, 30);
assert.equal(packet.activePolicy.consecutiveBucketsRequired, true);
assert.equal(packet.activePolicy.zeroCrossTenantTolerance, 0);
assert.equal(packet.activePolicy.maxUnexpectedErrorRate, 0.001);
assert.equal(packet.activePolicy.flagOffAndFlagOnEvidenceRequired, true);
assert.equal(packet.proposedPolicy.minSampleSize, 60);
assert.equal(packet.proposedPolicy.minReceiptsPerBucket, 15);
assert.equal(packet.proposedPolicy.minReceiptsPerBucketHard, true);
assert.equal(packet.proposedPolicy.cannotPassOnCumulativeFromOneFatBucket, true);
assert.equal(packet.proposedPolicy.status, "proposed-not-active");
assert.equal(packet.proposedPolicy.notRetroactive, true);
assert.equal(packet.proposedPolicy.appliesToCurrentWindow, false);
assert.equal(packet.proposedPolicy.observationWindowMinHours, 2);
assert.equal(packet.proposedPolicy.minObservationBuckets, 4);
assert.equal(packet.proposedPolicy.bucketDurationMinutes, 30);
assert.equal(packet.proposedPolicy.consecutiveBucketsRequired, true);
assert.equal(packet.proposedPolicy.zeroCrossTenantTolerance, 0);
assert.equal(packet.proposedPolicy.maxUnexpectedErrorRate, 0.001);
assert.equal(packet.proposedPolicy.flagOffAndFlagOnEvidenceRequired, true);
assert.equal(packet.proposedPolicy.mandatoryCoverageMinCounts.fail_closed_missing_authorization, 1);
assert.equal(packet.proposedPolicy.mandatoryCoverageMinCounts.authorization_denied, 1);
assert.equal(packet.proposedPolicy.eachTenantMustHaveSuccessAndDeny, true);
assert.equal(packet.proposedPolicy.eachEmployeeMustHaveSuccessAndDeny, true);
assert.equal(packet.proposedPolicy.managedAndPersonalLocalBothRequired, true);
assert.deepEqual(packet.proposedPolicy.workspaceKindsRequired, ["managed", "personal_local"]);
assert.match(packet.rationale.speedVsBurstRisk, /burst-risk/);
assert.match(packet.rationale.withoutStatisticalOpsJustification, /100 remains more conservative/);
assert.match(packet.rationale.glen, /if no clear reason keep 100/);
assert.match(packet.riskAnalysis.risk, /lower n increases chance/);
assert.ok(packet.riskAnalysis.mitigations.some((m) => /minReceiptsPerBucket=15/.test(m)));
assert.ok(packet.riskAnalysis.mitigations.some((m) => /new window only/.test(m)));
assert.equal(packet.proposedAcceptanceFormula.inactiveUntilApproved, true);
assert.ok(packet.proposedAcceptanceFormula.allMustHold.length >= 16);
assert.ok(
  packet.proposedAcceptanceFormula.allMustHold.some((s) => /minReceiptsPerBucket \(15\)/.test(s)),
);
assert.equal(packet.independentReview.required, true);
assert.equal(packet.independentReview.selfAccepted, false);
assert.equal(packet.independentReview.signedAsCodexArchitecture, false);
assert.equal(packet.independentReview.requiredReviewer, "flykingvip-cloud");
assert.equal(packet.independentReview.thisPacketDoesNotActivateProposedPolicy, true);

assert.equal(packet.currentWindow.environment, "isolated-replica");
assert.equal(packet.currentWindow.flag, "on");
assert.equal(packet.currentWindow.notLive, true);
assert.equal(packet.currentWindow.live, "forbidden");
assert.equal(packet.currentWindow.window, "window2");
assert.equal(packet.currentWindow.n, 103);
assert.equal(packet.currentWindow.nShadow, 103);
assert.equal(packet.currentWindow.elapsed, "2h08m46s");
assert.equal(packet.currentWindow.elapsedSec, 7726.528);
assert.equal(packet.currentWindow.elapsedGe2h, true);
assert.equal(packet.currentWindow.acceptanceMet, true);
assert.equal(packet.currentWindow.acceptanceMetUnderActive100, true);
assert.equal(packet.currentWindow.requiredCoveragePresent, true);
assert.deepEqual(packet.currentWindow.coverageKindsMissing, []);
assert.equal(packet.currentWindow.distinctTenantCount, 2);
assert.equal(packet.currentWindow.identityAndAuthorizationMatchCrossTenant, 0);
assert.equal(packet.currentWindow.unexpectedErrorRate, 0);
assert.equal(packet.excludedWindow.n, 42);
assert.equal(packet.excludedWindow.counted, false);
assert.equal(packet.excludedWindow.failsActive100, true);
assert.equal(packet.excludedWindow.notRetroactiveUnderProposed60, true);
assert.ok(packet.excludedWindow.missingCoverage.includes("fail_closed_missing_authorization"));
assert.ok(packet.excludedWindow.missingCoverage.includes("authorization_denied"));
assert.equal(packet.excludedWindow.historicalN39FromPr877.n, 39);

assert.equal(packet.receiptAcceptance.activePolicyMinSampleSize, 100);
assert.equal(packet.receiptAcceptance.proposedPolicyMinSampleSize, 60);
assert.equal(packet.receiptAcceptance.proposedPolicyInactive, true);
assert.equal(packet.stageBImplementationAcceptGate.activeMinSampleSize, 100);
assert.equal(packet.stageBImplementationAcceptGate.proposedMinSampleSize, 60);
assert.equal(packet.stageBImplementationAcceptGate.proposedInactive, true);
assert.ok(packet.doesNotAuthorize.includes("marking isolated-replica n=39 as pass"));
assert.ok(
  packet.doesNotAuthorize.includes("applying proposed minSampleSize=60 to the current window"),
);
assert.ok(
  packet.doesNotAuthorize.includes("activating proposed policy without independent approval"),
);

assert.match(handoff, /activePolicy.minSampleSize/);
assert.match(handoff, /proposedPolicy.minSampleSize/);
assert.match(handoff, /minReceiptsPerBucket/);
assert.match(handoff, /flykingvip-cloud/);
assert.match(handoff, /This packet REQUESTS Stage C Cutover Prep Accept only/);
assert.match(handoff, /not retroactive/);
assert.match(handoff, /fail_closed_missing_authorization=0/);
assert.match(handoff, /authorization_denied=0/);
assert.match(handoff, /n=39/);
assert.match(handoff, /n=103/);
assert.match(handoff, /n=42/);
assert.match(handoff, /if no clear reason keep 100/);
assert.match(handoff, /\*\*isolatedReplicaAcceptanceMet\*\*: `true`/);
assert.match(handoff, /productionReceiptsAcceptanceMet=false/);
assert.match(handoff, /isolatedReplicaAcceptanceMet=true/);
assert.match(handoff, /\*\*implementationVerified\*\*: `false`/);
assert.doesNotMatch(handoff, /\*\*stageCAccepted\*\*: `true`/);
assert.doesNotMatch(handoff, /\*\*authorizesStageCAccept\*\*: `true`/);
assert.doesNotMatch(handoff, /\*\*implementationVerified\*\*: `true`/);
assert.match(handoff, /不创建 s01-stage-c-prep\.md/);
assert.match(packet.note, /Stage C Cutover Prep Accept REQUEST only/);
assert.equal(packet.locks.remaining, 10);
assert.equal(packet.locks.liveWriteWatchIndex, 10);

console.log(
  "✓ Stage C PREP locked; helper cwd; scan 10/10; window2 n=103; #878 recorded; Stage C Accept requested not granted\n",
);
console.log(
  "Status: prepared-awaiting-independent-accept; requestsStageCAccept=true; authorizesStageCAccept=false; LIVE forbidden",
);
