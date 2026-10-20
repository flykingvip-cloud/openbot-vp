#!/usr/bin/env node --no-warnings
/**
 * Evidence test: S01 #871 incremental security review (kiro-data-governance).
 *
 * Locks conditions-not-met. Does not authorize observation deploy,
 * Stage C Accept, implementationVerified, LIVE, or Stage D/E.
 * CR3 Accept does not cover this change.
 */

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

const sidecarPath = "docs/design/evidence/memory-workspace-s01-871-incremental-review.json";
const cr3Path =
  "docs/design/evidence/memory-workspace-s01-stage-b-shadow-cr3-review-codex-architecture.json";
const getReplyPath = "src/auto-reply/reply/get-reply.ts";
const scanPath = "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json";

const sidecar = JSON.parse(readFileSync(join(repoRoot, sidecarPath), "utf-8"));
const cr3 = JSON.parse(readFileSync(join(repoRoot, cr3Path), "utf-8"));
const scan = JSON.parse(readFileSync(join(repoRoot, scanPath), "utf-8"));

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function headBlob(path) {
  return git(["rev-parse", `HEAD:${path}`]);
}

const originMain = git(["rev-parse", "origin/main"]);
const currentGetReplyBlob = git(["rev-parse", `origin/main:${getReplyPath}`]);
const cr3GetReplyBlob = cr3.mergedBaseline.reviewedBlobs[getReplyPath];

console.log("=== S01 #871 incremental security review (kiro-data-governance) ===\n");

assert.equal(sidecar.kind, "s01-871-incremental-review");
assert.equal(sidecar.reviewer, "kiro-data-governance");
assert.equal(sidecar.reviewedTip, originMain, "sidecar pins current origin/main SHA");
assert.equal(sidecar.pr871.pr, 871);
assert.equal(sidecar.pr871.mergeSha, "aa44194ac07261763314be345ed9352ee7f05399");
assert.equal(sidecar.cr3ReviewDoesNotCoverThisChange, true);

assert.equal(sidecar.cr3ReviewedGetReplyBlob, "1b5d0fe96fc4ccf877af4086fe4f6f635aad5a45");
assert.equal(sidecar.cr3ReviewedGetReplyBlob, cr3GetReplyBlob);
assert.equal(sidecar.currentGetReplyBlob, currentGetReplyBlob);
assert.notEqual(
  sidecar.cr3ReviewedGetReplyBlob,
  sidecar.currentGetReplyBlob,
  "CR3 blob != current get-reply blob",
);
assert.equal(sidecar.cr3ReviewedGetReplyBlobDiffersFromCurrent, true);

assert.equal(sidecar.deployAuthorized, false);
assert.equal(sidecar.implementationVerified, false);
assert.equal(sidecar.live, "forbidden");
assert.equal(sidecar.authorizesProductionObservationDeploy, false);
assert.equal(sidecar.authorizesStageBImplementationAccepted, false);
assert.equal(sidecar.authorizesStageC, false);
assert.equal(sidecar.authorizesStageD, false);
assert.equal(sidecar.authorizesStageE, false);
assert.equal(sidecar.remaining, 10);
assert.equal(sidecar.liveWriteWatchIndex, 10);
assert.equal(scan.remaining, 10);

const redLineFields = [
  "1_managedPathDecidedByControlledHandle",
  "2_legacyHelperShadowOnlyNotAuthorizationBasis",
  "3_missingTenantContextFailClosed",
  "4_noManagedToPersonalLocalHelperFallback",
];
for (const key of redLineFields) {
  assert.ok(sidecar.redLines[key], `missing red-line field ${key}`);
  assert.ok(typeof sidecar.redLines[key].pass === "boolean", `${key}.pass`);
  assert.ok(typeof sidecar.redLines[key].verdict === "string", `${key}.verdict`);
  assert.ok(Array.isArray(sidecar.redLines[key].evidence), `${key}.evidence`);
}

assert.equal(sidecar.checks.managedPathDecidedByControlledHandle, "fail");
assert.equal(sidecar.checks.legacyHelperShadowOnlyNotAuthorizationBasis, "fail");
assert.equal(sidecar.checks.missingTenantContextFailClosed, "pass");
assert.equal(sidecar.checks.noManagedToPersonalLocalHelperFallback, "fail");

assert.ok(
  ["conditions-not-met", "accepted-observation-only", "accepted"].includes(sidecar.decision),
);
if (sidecar.decision === "conditions-not-met") {
  assert.ok(Array.isArray(sidecar.openFindings));
  assert.ok(sidecar.openFindings.length >= 1, "conditions-not-met requires openFindings.length>=1");
}

assert.equal(sidecar.redLines["1_managedPathDecidedByControlledHandle"].pass, false);
assert.equal(sidecar.redLines["2_legacyHelperShadowOnlyNotAuthorizationBasis"].pass, false);
assert.equal(sidecar.redLines["3_missingTenantContextFailClosed"].pass, true);
assert.equal(sidecar.redLines["4_noManagedToPersonalLocalHelperFallback"].pass, false);

assert.equal(sidecar.reviewedBlobs[getReplyPath], currentGetReplyBlob);
assert.equal(
  sidecar.reviewedBlobs["src/gateway/workspace/handler-bridge.ts"],
  git(["rev-parse", "origin/main:src/gateway/workspace/handler-bridge.ts"]),
);

assert.ok(sidecar.doesNotAuthorize.includes("production observation deploy"));
assert.ok(sidecar.doesNotAuthorize.includes("Stage C"));
assert.ok(sidecar.doesNotAuthorize.includes("LIVE authorized"));
assert.ok(sidecar.doesNotAuthorize.includes("implementationVerified=true"));
assert.ok(sidecar.doesNotAuthorize.includes("deployAuthorized=true"));

assert.equal(sidecar.productionReceiptsObserved, 0);
assert.equal(headBlob(cr3Path), sidecar.reviewedBlobs[cr3Path]);

console.log(
  "✓ #871 incremental review conditions-not-met; CR3 blob differs; deploy unauthorized\n",
);
console.log(`origin/main=${originMain}`);
console.log(`decision=${sidecar.decision}`);
console.log("Status: conditions-not-met; observation deploy NOT authorized; LIVE forbidden");
