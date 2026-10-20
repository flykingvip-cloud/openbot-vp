#!/usr/bin/env node --no-warnings
/**
 * Evidence test: S01 implementation-readiness V1.8 / IR1-IR4.
 *
 * Locks the resubmitted plan. Does not start production wiring.
 * Does not retire S01. Does not flip implementationGate.
 * Prevents an implementation lander from rewriting scan counters here.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

const packet = JSON.parse(
  readFileSync(join(__dirname, "memory-workspace-s01-implementation-readiness.json"), "utf-8"),
);
const gate = JSON.parse(
  readFileSync(join(__dirname, "memory-workspace-s01-trusted-principal-handle-gate.json"), "utf-8"),
);
const scan = JSON.parse(
  readFileSync(
    join(repoRoot, "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json"),
    "utf-8",
  ),
);
const getReply = readFileSync(join(repoRoot, "src/auto-reply/reply/get-reply.ts"), "utf-8");
const getReplyLines = getReply.split("\n");
const uniqueHandoff = readFileSync(join(repoRoot, packet.canonicalHandoffDoc), "utf-8");
const readinessHandoff = readFileSync(join(repoRoot, packet.readinessHandoffDoc), "utf-8");
const registry = readFileSync(join(repoRoot, ".loom/registry.yaml"), "utf-8");

console.log("=== S01 implementation-readiness V1.8 IR1-IR4 evidence ===\n");

assert.equal(packet.status, "implementation-readiness-resubmitted");
assert.equal(packet.planVersion, "V1.8");
assert.equal(packet.selfAccepted, false);
assert.equal(packet.previousAcceptance.decision, "changes-required");
assert.equal(packet.thisPacketStartsProductionImplementation, false);
assert.equal(packet.thisPacketHasNoProductionWiring, true);
assert.equal(packet.notASecondS01Spec, true);
assert.equal(packet.readinessOwner, "codex-architecture");
assert.equal(packet.uniqueProductionOwner, "cursor-data-governance");
assert.equal(packet.loom.productionState, "blocked");
assert.equal(packet.loom.doesNotClaimGetReplyYet, true);
assert.equal(packet.loom.doesNotClaimProductionAdapterPaths, true);
assert.equal(packet.implementationGate.status, "not-met");
assert.equal(gate.implementationGate.status, "not-met");
assert.equal(packet.reviewRequest.selfAccepted, false);
assert.equal(packet.reviewRequest.rereview, true);

const identity = packet.targetIdentity;
assert.ok(identity && identity.notNull === true, "targetIdentity must not be null");
assert.equal(identity.workspaceResourceId, true);
assert.equal(identity.agentAssetId, true);
assert.equal(identity.tenantId, true);
assert.equal(identity.employeeOwnerId, true);
assert.equal(identity.expectedBindingRole, "canonical");
assert.equal(identity.expectedBindingState, "active");
assert.equal(identity.governanceVersion, true);
assert.equal(identity.contentVersion, true);
assert.equal(identity.fencingToken, true);
assert.equal(identity.forbidPathBasedIdentityInference, true);
assert.equal(identity.forbidPrincipalAnyUniqueWorkspace, true);
assert.equal(identity.forbidCatalogCreateOnMiss, true);
assert.equal(identity.forbidHostCwdHelperFallback, true);
assert.equal(identity.forbidMemoryAssetResourceIdAsWorkspaceResourceId, true);
assert.equal(identity.agentIdIsTenantSlugOnly, true);
assert.equal(identity.agentIdIsNotResourceId, true);
assert.equal(packet.getReplyBoundary.forbidPathBasedIdentityInference, true);
assert.match(readinessHandoff, /targetIdentity/);
assert.match(readinessHandoff, /workspaceResourceId/);
assert.match(readinessHandoff, /agentAssetId/);
assert.doesNotMatch(
  readinessHandoff,
  /从 Catalog Handle 查询该 principal 的唯一 canonical locator/,
);

assert.equal(packet.shadowVersusCutover.distinctPhases, true);
assert.equal(packet.shadowVersusCutover.shadowProductionCwdSource, "legacy-helper");
assert.equal(packet.shadowVersusCutover.shadowKeepsP5InScan, true);
assert.equal(packet.shadowVersusCutover.shadowScanRemaining, 10);
assert.equal(packet.shadowVersusCutover.shadowScanLiveWriteWatchIndex, 10);
assert.equal(packet.shadowVersusCutover.cutoverHasNoRuntimeHelperFallback, true);
assert.equal(packet.failClosed.shadowFlagOffKeepsLegacyAndP5InScan, true);
assert.equal(packet.failClosed.cutoverHasNoRuntimeHelperFallback, true);
assert.equal(packet.failClosed.rollbackRequiresRevertAndScanRestoration, true);
assert.equal(packet.failClosed.flagOffRestoresHelperWithoutScanRewrite, false);
assert.equal(packet.rollback.rollbackRequiresRevertAndScanRestoration, true);
assert.match(readinessHandoff, /shadowFlagOffKeepsLegacyAndP5InScan=true/);
assert.match(readinessHandoff, /cutoverHasNoRuntimeHelperFallback=true/);
assert.match(readinessHandoff, /rollbackRequiresRevertAndScanRestoration=true/);
assert.doesNotMatch(readinessHandoff, /flagOffRestoresHelperWithoutScanRewrite=true/);
assert.doesNotMatch(readinessHandoff, /暗接线：flag on 走 S01/);

const stageIds = Object.keys(packet.stages);
assert.deepEqual(stageIds, ["A", "B", "C", "D", "E"]);
for (const id of stageIds) {
  const stage = packet.stages[id];
  assert.equal(typeof stage.loomTask, "string", `${id} loomTask`);
  assert.equal(stage.owner, "cursor-data-governance", `${id} owner`);
  assert.ok(Array.isArray(stage.paths) && stage.paths.length > 0, `${id} paths`);
  assert.equal(stage.independentPr, true, `${id} independentPr`);
  assert.equal(stage.independentEvidence, true, `${id} independentEvidence`);
  assert.equal(stage.independentReviewerDecision, true, `${id} independentReviewerDecision`);
  assert.equal(typeof stage.entryGate, "string", `${id} entryGate`);
  assert.equal(typeof stage.exitGate, "string", `${id} exitGate`);
}
assert.equal(packet.stages.A.modifiesGetReply, false);
assert.equal(packet.stages.B.productionCwdSource, "legacy-helper");
assert.equal(packet.stages.B.keepsP5InScan, true);
assert.equal(packet.stages.D.modifiesGetReplyLine, 164);
assert.equal(packet.stages.D.forbidsLine165P1Change, true);
assert.equal(packet.stages.D.runtimeHelperFallback, "forbidden");
assert.equal(packet.stages.E.remainingAfterAccept, 9);
assert.equal(packet.stages.E.liveWriteWatchIndexAfterAccept, "write-watch-owner-signed-only");
assert.equal(packet.stages.E.item7AfterS01Retirement, "not-met");
assert.match(readinessHandoff, /Stage A/);
assert.match(readinessHandoff, /Stage B/);
assert.match(readinessHandoff, /Stage C/);
assert.match(readinessHandoff, /Stage D/);
assert.match(readinessHandoff, /Stage E/);

assert.equal(packet.scanExpectation.implementationLanderMustNotModifyRemaining, true);
assert.equal(packet.scanExpectation.implementationLanderMustNotModifyLiveWriteWatchIndex, true);
assert.equal(packet.scanExpectation.currentRepoHasIndependentWriteWatchSiteSet, false);
assert.equal(packet.scanExpectation.forbidPlanningNineOverTenWithoutIndependentDefinition, true);
assert.equal(packet.scanExpectation.shadowKeepsP5AndScanTenTen, true);
assert.equal(packet.scanExpectation.currentRemaining, 10);
assert.equal(packet.scanExpectation.currentLiveWriteWatchIndex, 10);
assert.equal(packet.scanExpectation.afterIndependentScanAcceptRemaining, 9);
assert.equal(
  packet.scanExpectation.afterIndependentScanAcceptLiveWriteWatchIndex,
  "write-watch-owner-signed-only",
);
assert.equal(packet.currentStatus.remaining, 10);
assert.equal(packet.currentStatus.liveWriteWatchIndex, 10);
assert.equal(scan.remaining, 10);
assert.equal(scan.liveWriteWatchIndex, 10);
assert.equal(scan.remaining, packet.currentStatus.remaining);
assert.equal(scan.liveWriteWatchIndex, packet.currentStatus.liveWriteWatchIndex);
assert.ok(
  !(
    packet.scanExpectation.afterIndependentScanAcceptRemaining === 9 &&
    packet.scanExpectation.afterIndependentScanAcceptLiveWriteWatchIndex === 10
  ),
  "must not plan remaining=9 with liveWriteWatchIndex=10",
);
assert.ok(!Object.hasOwn(packet.scanExpectation, "afterFormalRetirementBothCounters"));
assert.ok(!Object.hasOwn(packet.scanExpectation, "afterFormalRetirementLiveWriteWatchIndex"));

assert.equal(packet.thisPacketHasNoProductionWiring, true);
assert.match(getReplyLines[163] ?? "", /resolveEmployeeBuiltinStewardWorkspaceDir/);
assert.match(getReplyLines[164] ?? "", /resolveAgentWorkspaceDir/);
assert.doesNotMatch(getReply, /evaluateS01AuthorizedToolCwd/);
assert.match(getReply, /catalogResourceId:\s*null/);
assert.ok(
  (scan.sites ?? []).some(
    (site) =>
      site.file === "src/auto-reply/reply/get-reply.ts" &&
      site.line === 164 &&
      site.symbol === "resolveEmployeeBuiltinStewardWorkspaceDir",
  ),
);
assert.ok(
  (scan.sites ?? []).some(
    (site) =>
      site.file === "src/auto-reply/reply/get-reply.ts" &&
      site.line === 165 &&
      site.symbol === "resolveAgentWorkspaceDir",
  ),
);

assert.match(uniqueHandoff, /implementationVerified: false/);
assert.deepEqual(packet.reviewRequest.reviewers, ["kiro-sot-reviewer", "codex-architecture"]);
assert.equal(packet.currentStatus.item7, "not-met");
assert.equal(packet.currentStatus.phase1b, "blocked");
assert.equal(packet.currentStatus.s01Retirement, "blocked");
assert.equal(packet.currentStatus.deployAuthorized, false);
assert.equal(packet.currentStatus.i3Executed, false);
assert.equal(packet.currentStatus.liveDeployment, "forbidden");

for (const forbidden of [
  "modify-src/auto-reply/reply/get-reply.ts",
  "start-production-implementation-before-readiness-accept",
  "path-based-identity-inference",
  "plan-remaining-9-liveWriteWatchIndex-10",
  "implementation-lander-modify-scan-counters",
  "flagOffRestoresHelperWithoutScanRewrite",
]) {
  assert.ok(packet.explicitlyForbiddenNow.includes(forbidden), `missing ${forbidden}`);
}

assert.match(registry, /codex-architecture-s01-implementation-readiness/);
assert.match(registry, /cursor-data-governance-s01-production-wiring/);

console.log("✓ V1.8 closes IR1-IR4; production frozen; dual rereview requested; scan 10/10\n");
console.log(
  "Status: implementation-readiness-resubmitted; Item 7 not-met; Phase 1B blocked; I3 not executed; LIVE forbidden",
);
