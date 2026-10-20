#!/usr/bin/env node --no-warnings
/**
 * Evidence test: S01 Stage B shadow CR2 production ports.
 *
 * Locks honest production read-only wrappers, no InMemory-as-production,
 * steward main fail-closed, helper cwd, scan 10/10, and not-accepted.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

const packet = JSON.parse(
  readFileSync(join(__dirname, "memory-workspace-s01-stage-b-shadow-cr2.json"), "utf-8"),
);
const scan = JSON.parse(
  readFileSync(
    join(repoRoot, "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json"),
    "utf-8",
  ),
);
const getReply = readFileSync(join(repoRoot, "src/auto-reply/reply/get-reply.ts"), "utf-8");
const getReplyLines = getReply.split("\n");
const portsSrc = readFileSync(
  join(repoRoot, "src/gateway/data-governance/s01-stage-b-shadow-production-ports.ts"),
  "utf-8",
);
const shadowSrc = readFileSync(
  join(repoRoot, "src/gateway/data-governance/s01-get-reply-steward-cwd-shadow.ts"),
  "utf-8",
);

console.log("=== S01 Stage B shadow CR2 production ports ===\n");

assert.equal(packet.kind, "s01-stage-b-shadow-cr2");
assert.equal(
  packet.taskId,
  "memory-workspace-platform-remediation:cursor-data-governance-s01-stage-b-shadow",
);
assert.equal(packet.cr2Status, "production-read-only-ports-landed");
assert.equal(packet.forgedProductionAdapters, false);
assert.equal(packet.usedInMemoryAsProduction, false);
assert.equal(packet.usedUniqueRowGuess, false);
assert.equal(packet.inventedMainAgentAssetId, false);
assert.equal(packet.secondCatalogStore, false);
assert.equal(packet.stageBImplementation, "landed-not-accepted");
assert.equal(packet.stageBImplementationAccepted, false);
assert.equal(packet.authorizesStageC, false);
assert.equal(packet.implementationVerified, false);
assert.equal(packet.implementationGate, "not-met");
assert.equal(packet.remaining, 10);
assert.equal(packet.liveWriteWatchIndex, 10);
assert.equal(packet.deployAuthorized, false);
assert.equal(packet.live, "forbidden");
assert.equal(packet.reviewRequested, "S01 Stage B Shadow CR2 / production-ports Review");
assert.equal(packet.flag.resolvesDepsWhenOff, false);
assert.match(packet.productionPorts.stewardMainPolicy, /catalog_miss/);

assert.match(getReplyLines[163] ?? "", /resolveEmployeeBuiltinStewardWorkspaceDir/);
assert.match(getReply, /runS01GetReplyStewardCwdShadowFromEntry/);
assert.match(getReply, /scheduleS01StewardCwdShadow/);
assert.doesNotMatch(getReply, /evaluateS01AuthorizedToolCwd/);
assert.doesNotMatch(getReply, /resolveS01StewardWorkspaceIdentity/);
assert.doesNotMatch(getReply, /InMemoryWorkspaceResourceCatalog/);
assert.doesNotMatch(getReply, /createInMemoryS01/);
assert.doesNotMatch(getReply, /getSharedDataGovernanceCatalog/);
assert.doesNotMatch(getReply, /loadExistingGovernedWorkspaceIdentity/);
assert.doesNotMatch(getReply, /issueS01TrustedPrincipal/);

assert.match(portsSrc, /class S01ReadOnlyDurableCatalogView/);
assert.match(portsSrc, /getSharedDataGovernanceCatalog/);
assert.match(portsSrc, /createProductionS01StewardRegistryPort/);
assert.match(portsSrc, /resolveLegacyAgentId/);
assert.doesNotMatch(portsSrc, /InMemoryWorkspaceResourceCatalog/);
assert.doesNotMatch(portsSrc, /createInMemoryS01StewardRegistryPort/);
assert.doesNotMatch(portsSrc, /loadExistingGovernedWorkspaceIdentity/);

assert.match(shadowSrc, /runS01GetReplyStewardCwdShadowFromEntry/);
assert.match(shadowSrc, /loadS01StageBShadowProductionDeps/);
assert.match(shadowSrc, /if \(!isS01StageBStewardCwdShadowEnabled/);

assert.equal(scan.remaining, 10);
assert.equal(scan.liveWriteWatchIndex, 10);
assert.equal(scan.sites[0].pathId, "P5");
assert.ok(packet.doesNotAuthorize.includes("Stage B Implementation Accepted"));
assert.ok(packet.doesNotAuthorize.includes("inventing steward main agentAssetId"));

console.log("✓ CR2 production read-only ports landed; helper cwd; scan 10/10\n");
console.log("Status: landed-not-accepted; implementationVerified=false; request CR2 review only");
