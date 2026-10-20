#!/usr/bin/env node
/**
 * V1.8 implementation-readiness kiro-sot-reviewer sidecar test
 *
 * Verifies kiro-sot-reviewer's independent review decision and lock preservation.
 */

/* eslint-disable @typescript-eslint/no-floating-promises */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sidecar = JSON.parse(
  readFileSync(
    "docs/design/evidence/memory-workspace-s01-implementation-readiness-review-kiro-sot-reviewer.json",
    "utf8",
  ),
);

const mainEvidence = JSON.parse(
  readFileSync("docs/design/evidence/memory-workspace-s01-implementation-readiness.json", "utf8"),
);

const scan = JSON.parse(
  readFileSync("docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json", "utf8"),
);

test("kiro-sot-reviewer V1.8 sidecar structure", () => {
  assert.equal(sidecar.schema, "memory-workspace-s01-implementation-readiness-review/v1");
  assert.equal(sidecar.kind, "s01-implementation-readiness-independent-review");
  assert.equal(sidecar.reviewer, "kiro-sot-reviewer");
  assert.equal(sidecar.signedBy, "kiro-sot-reviewer");
  assert.equal(sidecar.scope, "v1.8-ir1-ir4-implementation-readiness-plan");
});

test("kiro-sot-reviewer decision is accepted", () => {
  assert.equal(sidecar.decision, "accepted");
});

test("IR1-IR4 all pass", () => {
  assert.equal(sidecar.verdict.IR1, "pass");
  assert.equal(sidecar.verdict.IR2, "pass");
  assert.equal(sidecar.verdict.IR3, "pass");
  assert.equal(sidecar.verdict.IR4, "pass");
});

test("IR1: targetIdentity complete", () => {
  assert.ok(
    sidecar.ir1TargetIdentity.findings.includes(
      "targetIdentity required and notNull (no path-based identity inference)",
    ),
  );
  assert.ok(
    sidecar.ir1TargetIdentity.findings.includes(
      "complete fields: tenantId, employeeOwnerId, agentAssetId, workspaceResourceId",
    ),
  );
  assert.equal(sidecar.ir1TargetIdentity.mappingChain.length, 6);
  assert.ok(sidecar.ir1TargetIdentity.prohibitions.includes("no path-based identity inference"));
});

test("IR2: Shadow vs Cutover separation", () => {
  assert.equal(sidecar.ir2ShadowVersusCutover.shadowPhase.productionCwdSource, "legacy-helper");
  assert.equal(sidecar.ir2ShadowVersusCutover.shadowPhase.keepsP5InScan, true);
  assert.equal(sidecar.ir2ShadowVersusCutover.shadowPhase.scanRemaining, 10);
  assert.equal(sidecar.ir2ShadowVersusCutover.shadowPhase.scanLiveWriteWatchIndex, 10);
  assert.equal(sidecar.ir2ShadowVersusCutover.cutoverPhase.runtimeHelperFallback, "forbidden");
  assert.equal(sidecar.ir2ShadowVersusCutover.cutoverPhase.flagOffDoesNotRestoreHelper, true);
});

test("IR3: dual counter independent definition", () => {
  assert.equal(
    sidecar.ir3ScanCounterModel.counters.remaining.definition,
    "unretired call-site count in the canonical retirement scan",
  );
  assert.equal(
    sidecar.ir3ScanCounterModel.counters.liveWriteWatchIndex.definition,
    "write-watch owner frozen production write-path risk index",
  );
  assert.equal(sidecar.ir3ScanCounterModel.counters.remaining.currentValue, 10);
  assert.equal(sidecar.ir3ScanCounterModel.counters.liveWriteWatchIndex.currentValue, 10);
  assert.equal(sidecar.ir3ScanCounterModel.counters.remaining.landerMayModify, false);
  assert.equal(sidecar.ir3ScanCounterModel.counters.liveWriteWatchIndex.landerMayModify, false);
  assert.ok(
    sidecar.ir3ScanCounterModel.prohibitions.includes(
      "no planning 9/10 without independent write-watch definition",
    ),
  );
});

test("IR4: Stage A-E independent gates", () => {
  assert.equal(sidecar.ir4StagedGates.stages.length, 5);
  for (const stage of sidecar.ir4StagedGates.stages) {
    assert.equal(stage.independentPr, true);
    assert.equal(stage.independentEvidence, true);
    assert.equal(stage.independentReviewerDecision, true);
    assert.ok(stage.entryGate);
    assert.ok(stage.exitGate);
  }
});

test("baseline frozen: implementationGate not-met", () => {
  assert.equal(sidecar.currentStatus.implementationGate, "not-met");
  assert.equal(mainEvidence.implementationGate.status, "not-met");
});

test("baseline frozen: scan 10/10", () => {
  assert.equal(sidecar.currentStatus.remaining, 10);
  assert.equal(sidecar.currentStatus.liveWriteWatchIndex, 10);
  assert.equal(scan.remaining, 10);
  assert.equal(scan.liveWriteWatchIndex, 10);
});

test("baseline frozen: Item 7 not-met", () => {
  assert.equal(sidecar.currentStatus.item7, "not-met");
  assert.equal(scan.item7, "not-met");
});

test("baseline frozen: S01 retirement blocked", () => {
  assert.equal(sidecar.currentStatus.s01Retirement, "blocked");
});

test("baseline frozen: Phase 1B blocked", () => {
  assert.equal(sidecar.currentStatus.phase1b, "blocked");
});

test("baseline frozen: production Catalog write none", () => {
  assert.equal(sidecar.currentStatus.productionCatalogWrite, "none");
});

test("baseline frozen: deployAuthorized false", () => {
  assert.equal(sidecar.currentStatus.deployAuthorized, false);
});

test("baseline frozen: I3 not executed", () => {
  assert.equal(sidecar.currentStatus.i3Executed, false);
});

test("baseline frozen: LIVE deployment forbidden", () => {
  assert.equal(sidecar.currentStatus.liveDeployment, "forbidden");
});

test("does not authorize S01 retirement", () => {
  assert.ok(
    sidecar.doesNotAuthorize.some((item) => item.includes("claim S01 retired during shadow phase")),
  );
});

test("does not authorize production wiring now", () => {
  assert.ok(
    sidecar.doesNotAuthorize.some((item) =>
      item.includes("modify src/auto-reply/reply/get-reply.ts now"),
    ),
  );
  assert.ok(sidecar.doesNotAuthorize.some((item) => item.includes("modify src/memory")));
});

test("does not authorize production Catalog write", () => {
  assert.ok(sidecar.doesNotAuthorize.some((item) => item.includes("write production Catalog")));
});

test("does not authorize I3 execution", () => {
  assert.ok(sidecar.doesNotAuthorize.some((item) => item.includes("execute I3")));
});

test("does not authorize Phase 1B unlock", () => {
  assert.ok(sidecar.doesNotAuthorize.some((item) => item.includes("issue Phase 1B unlock")));
});

test("does not authorize LIVE deployment", () => {
  assert.ok(
    sidecar.doesNotAuthorize.some((item) => item.includes("any LIVE production deployment")),
  );
});

test("does not authorize lander to modify scan counters", () => {
  assert.ok(
    sidecar.doesNotAuthorize.some((item) =>
      item.includes("implementation lander modify scan counters"),
    ),
  );
});

test("approved: V1.8 plan closes IR1-IR4", () => {
  assert.ok(
    sidecar.explicitlyApproved.includes("V1.8 implementation-readiness plan closes IR1-IR4"),
  );
});

test("approved: targetIdentity complete", () => {
  assert.ok(
    sidecar.explicitlyApproved.includes(
      "targetIdentity complete with workspaceResourceId + agentAssetId",
    ),
  );
});

test("approved: Shadow vs Cutover separated", () => {
  assert.ok(sidecar.explicitlyApproved.includes("Shadow vs Cutover clearly separated"));
});

test("approved: dual counters independent", () => {
  assert.ok(
    sidecar.explicitlyApproved.includes(
      "remaining and liveWriteWatchIndex have independent definitions",
    ),
  );
});

test("approved: Stage A-E independent gates", () => {
  assert.ok(sidecar.explicitlyApproved.includes("Stage A-E have independent gates"));
});

test("constraints: Stage A entry requires dual review", () => {
  assert.ok(
    sidecar.residualConstraints.includes(
      "Stage A entry requires: V1.8 dual review accepted + kiro-loom registered",
    ),
  );
});

test("constraints: Shadow keeps P5 and 10/10", () => {
  assert.ok(sidecar.residualConstraints.includes("Shadow phase must keep P5 and 10/10"));
});

test("constraints: Cutover no fallback", () => {
  assert.ok(sidecar.residualConstraints.includes("Cutover must not have runtime helper fallback"));
});

test("constraints: Stage E remaining=9 requires scan acceptance", () => {
  assert.ok(
    sidecar.residualConstraints.includes(
      "Stage E remaining=9 only after independent scan acceptance",
    ),
  );
});

test("selfAccepted false (dual review required)", () => {
  assert.equal(sidecar.currentStatus.selfAccepted, false);
  assert.equal(mainEvidence.selfAccepted, false);
});

test("this packet does not start production implementation", () => {
  assert.equal(sidecar.currentStatus.thisPacketStartsProductionImplementation, false);
  assert.equal(sidecar.currentStatus.thisPacketHasNoProductionWiring, true);
});
