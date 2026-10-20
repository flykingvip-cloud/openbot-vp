#!/usr/bin/env node --no-warnings
/**
 * Evidence test: S01 Stage B shadow CR1 blocker.
 *
 * Locks CR1-A blocked, no forged production adapters, helper cwd,
 * scan 10/10, and not-accepted implementation.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

const packet = JSON.parse(
  readFileSync(join(__dirname, "memory-workspace-s01-stage-b-shadow-cr1.json"), "utf-8"),
);
const scan = JSON.parse(
  readFileSync(
    join(repoRoot, "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json"),
    "utf-8",
  ),
);
const getReply = readFileSync(join(repoRoot, "src/auto-reply/reply/get-reply.ts"), "utf-8");
const getReplyLines = getReply.split("\n");
const shadowSrc = readFileSync(
  join(repoRoot, "src/gateway/data-governance/s01-get-reply-steward-cwd-shadow.ts"),
  "utf-8",
);

console.log("=== S01 Stage B shadow CR1 blocker ===\n");

assert.equal(packet.kind, "s01-stage-b-shadow-cr1");
assert.equal(
  packet.taskId,
  "memory-workspace-platform-remediation:cursor-data-governance-s01-stage-b-shadow",
);
assert.equal(packet.cr1Status, "blocked-missing-production-adapters");
assert.equal(packet.cr1A, "blocked");
assert.equal(packet.forgedProductionAdapters, false);
assert.equal(packet.usedInMemoryAsProduction, false);
assert.equal(packet.stageBImplementation, "landed-not-accepted");
assert.equal(packet.stageBImplementationAccepted, false);
assert.equal(packet.authorizesStageC, false);
assert.equal(packet.implementationVerified, false);
assert.equal(packet.implementationGate, "not-met");
assert.equal(packet.remaining, 10);
assert.equal(packet.liveWriteWatchIndex, 10);
assert.equal(packet.deployAuthorized, false);
assert.equal(packet.live, "forbidden");
assert.equal(packet.reviewRequested, "S01 Stage B Shadow CR1 Review");

assert.match(getReplyLines[163] ?? "", /resolveEmployeeBuiltinStewardWorkspaceDir/);
assert.match(getReply, /scheduleS01StewardCwdShadow/);
assert.match(getReply, /s01_stage_b_steward_cwd_shadow_import_error/);
assert.doesNotMatch(getReply, /createInMemoryS01/);
assert.doesNotMatch(getReply, /InMemoryWorkspaceResourceCatalog/);
assert.doesNotMatch(getReply, /getSharedDataGovernanceCatalog/);
assert.doesNotMatch(getReply, /evaluateS01AuthorizedToolCwd/);
assert.match(shadowSrc, /fail_closed_missing_authorization/);
assert.match(shadowSrc, /identity_and_authorization_match/);
assert.match(shadowSrc, /authorization_denied/);
assert.doesNotMatch(shadowSrc, /"identity_match"/);

assert.equal(scan.remaining, 10);
assert.equal(scan.liveWriteWatchIndex, 10);
assert.equal(scan.sites[0].pathId, "P5");
assert.ok(packet.doesNotAuthorize.includes("Stage B Implementation Accepted"));
assert.ok(packet.doesNotAuthorize.includes("forging production Catalog or Registry adapters"));

console.log("✓ CR1-A blocked; receipts/import isolation landed; helper cwd; scan 10/10\n");
console.log("Status: blocked-missing-production-adapters; implementationVerified=false");
