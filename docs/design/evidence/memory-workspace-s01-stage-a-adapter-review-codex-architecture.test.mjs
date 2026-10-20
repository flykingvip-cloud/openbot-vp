#!/usr/bin/env node --no-warnings
/**
 * Evidence test: S01 Stage A SA1–SA3 architecture review sidecar.
 *
 * Accepts SA1–SA3 on merged #834. Does not accept SA4, Stage A
 * implementation, #833, kiro-sot-reviewer, or implementationGate.
 */

import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

const sidecar = JSON.parse(
  readFileSync(
    join(__dirname, "memory-workspace-s01-stage-a-adapter-review-codex-architecture.json"),
    "utf-8",
  ),
);
const evidence = JSON.parse(
  readFileSync(join(__dirname, "memory-workspace-s01-stage-a-adapter.json"), "utf-8"),
);
const handoff = readFileSync(join(repoRoot, evidence.stageAHandoffDoc), "utf-8");
const scan = JSON.parse(
  readFileSync(
    join(repoRoot, "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json"),
    "utf-8",
  ),
);
const getReply = readFileSync(join(repoRoot, "src/auto-reply/reply/get-reply.ts"), "utf-8");
const getReplyLines = getReply.split("\n");
const contract = readFileSync(
  join(repoRoot, "docs/design/contracts/s01-trusted-principal-handle-contract.ts"),
  "utf-8",
);

console.log("=== S01 Stage A SA1–SA3 architecture review ===\n");

assert.equal(sidecar.reviewer, "codex-architecture");
assert.equal(sidecar.signedBy, "codex-architecture");
assert.equal(sidecar.decision, "accepted");
assert.equal(sidecar.reviewPass, 2);
assert.equal(sidecar.scope, "s01-stage-a-sa1-sa3");
assert.match(sidecar.signedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
assert.equal(sidecar.fillsKiroSotReviewer, false);
assert.equal(sidecar.flipsImplementationGate, false);
assert.equal(sidecar.packetSelfAccepted, false);
assert.equal(sidecar.authorizesStageA, false);
assert.equal(sidecar.acceptsUnauthorizedLanding833, false);
assert.equal(sidecar.mergedBaseline.pr, 834);
assert.equal(sidecar.mergedBaseline.mergeCommit, "74ca45c14407dc68b7102e1a3fd2cc276aeb4e6c");
assert.deepEqual(sidecar.closedFindings, ["SA1", "SA2", "SA3"]);
assert.deepEqual(sidecar.outOfScope, ["SA4"]);
assert.equal(sidecar.verdict.SA1, "pass");
assert.equal(sidecar.verdict.SA2, "pass");
assert.equal(sidecar.verdict.SA3, "pass");
assert.ok(sidecar.doesNotAuthorize.includes("closing SA4"));

assert.equal(evidence.status, "stage-a-contract-resubmitted");
assert.equal(evidence.implementationAuthorized, false);
assert.equal(evidence.selfAccepted, false);
assert.equal(evidence.catalogSoT.uniqueInput, "WorkspaceResourceCatalog typed view");
assert.equal(evidence.catalogSoT.port, "S01CatalogViewPort");
assert.equal(evidence.catalogSoT.forbidCatalogTableField, true);
assert.doesNotMatch(JSON.stringify(evidence), /"catalogTable"\s*:/);
assert.doesNotMatch(handoff, /catalogTable\s*:/);
assert.doesNotMatch(handoff, /FROM workspace_handles/);
assert.doesNotMatch(handoff, /FROM authorized_cwds/);
assert.match(handoff, /WorkspaceResourceCatalog/);
assert.match(handoff, /S01CatalogViewPort/);
assert.match(contract, /S01_INDEPENDENT_CATALOG_TABLES/);

const cwd = evidence.adapterContracts.evaluateS01AuthorizedToolCwd;
assert.ok(!evidence.adapterContracts.resolveAuthorizedToolCwd);
assert.match(handoff, /TrustedPrincipal/);
assert.match(handoff, /workspaceResourceId/);
assert.match(handoff, /S01PlatformAuthMembershipPort/);
assert.match(handoff, /expectedFencing|contentVersion/);
for (const required of [
  "principal: TrustedPrincipal",
  "catalog: S01CatalogViewPort",
  "memberships: S01PlatformAuthMembershipPort",
  "targetResourceId: workspaceResourceId",
  "expectedFencing / contentVersion",
]) {
  assert.ok(cwd.requiredInputs.includes(required), `missing ${required}`);
}
assert.doesNotMatch(
  handoff,
  /export async function resolveAuthorizedToolCwd\(\s*handle: WorkspaceHandle,\s*toolName: string,\s*\): Promise<string>/s,
);

assert.equal(evidence.adapterContracts.resolveStewardWorkspaceIdentity.returnsNullOnMiss, false);
for (const trigger of [
  "catalog-miss",
  "duplicate-canonical-binding",
  "tenant-mismatch",
  "membership-missing",
  "stale-fencing",
]) {
  assert.ok(cwd.failClosedTriggers.includes(trigger), `missing ${trigger}`);
}
assert.match(handoff, /fail-closed|failClosed/);

assert.equal(sidecar.architectureReview.independentCatalogTablesRemoved, true);
assert.equal(sidecar.architectureReview.cwdHasTrustedPrincipal, true);
assert.equal(sidecar.architectureReview.failClosedDocumented, true);
assert.equal(sidecar.architectureReview.implementationAuthorized, false);

assert.equal(sidecar.locks.stageAImplementation, "blocked");
assert.equal(sidecar.locks.s01Retirement, "blocked");
assert.equal(sidecar.locks.item7, "not-met");
assert.equal(sidecar.locks.phase1b, "blocked");
assert.equal(sidecar.locks.i3, "not executed");
assert.equal(sidecar.locks.live, "forbidden");
assert.equal(sidecar.locks.deployAuthorized, false);
assert.equal(sidecar.locks.implementationGate, "not-met");
assert.equal(sidecar.locks.remaining, 10);
assert.equal(sidecar.locks.liveWriteWatchIndex, 10);
assert.equal(scan.remaining, 10);
assert.equal(scan.liveWriteWatchIndex, 10);

assert.match(getReplyLines[163] ?? "", /resolveEmployeeBuiltinStewardWorkspaceDir/);
assert.match(getReplyLines[164] ?? "", /resolveAgentWorkspaceDir/);
assert.doesNotMatch(getReply, /evaluateS01AuthorizedToolCwd/);
assert.equal(sidecar.productionObservation.getReplyStillUsesStewardHelper, true);
assert.equal(sidecar.productionObservation.evaluateS01AuthorizedToolCwdImportedByGetReply, false);

assert.ok(sidecar.doesNotAuthorize.includes("filling kiro-sot-reviewer slot"));
assert.ok(sidecar.doesNotAuthorize.includes("accepting #833"));
assert.ok(sidecar.explicitlyForbidden.includes("sign as kiro-sot-reviewer"));
assert.equal(
  existsSync(join(__dirname, "memory-workspace-s01-stage-a-adapter-review-kiro-sot-reviewer.json")),
  false,
);

console.log("✓ SA1–SA3 accepted; SA4 out of scope; Stage A implementation blocked\n");
console.log("Status: scan 10/10; Item 7 not-met; I3 not executed; LIVE forbidden");
