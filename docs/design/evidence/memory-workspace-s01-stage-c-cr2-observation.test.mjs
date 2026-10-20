#!/usr/bin/env node --no-warnings
/**
 * Evidence test: S01 Stage C CR2 observation (not accepted).
 *
 * Observes #857 honest production read-only ports on origin/main.
 * Does not flip Stage C Accept, LIVE, implementationVerified, or cwd.
 * Does not edit get-reply, shadow evaluator, production ports, or scan.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

const packet = JSON.parse(
  readFileSync(join(__dirname, "memory-workspace-s01-stage-c-cr2-observation.json"), "utf-8"),
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
const shadowSrc = readFileSync(
  join(repoRoot, "src/gateway/data-governance/s01-get-reply-steward-cwd-shadow.ts"),
  "utf-8",
);
const portsSrc = readFileSync(
  join(repoRoot, "src/gateway/data-governance/s01-stage-b-shadow-production-ports.ts"),
  "utf-8",
);
const handoff = readFileSync(
  join(
    repoRoot,
    ".kiro/specs/memory-workspace-platform-remediation/handoff-s01-stage-c-cr2-observation.md",
  ),
  "utf-8",
);

console.log("=== S01 Stage C CR2 observation ===\n");

assert.equal(packet.kind, "s01-stage-c-cr2-observation");
assert.equal(packet.owner, "kiro-data-governance");
assert.equal(
  packet.taskId,
  "memory-workspace-platform-remediation:kiro-data-governance-s01-stage-c-cr2-observation",
);
assert.equal(packet.originMain, "1955a570d3892cdec28ca0334cb83aa37d6a1fa7");
assert.equal(packet.cr2Landed, true);
assert.equal(packet.cr2Pr, 857);
assert.equal(packet.cr2Sha, "1955a570d3892cdec28ca0334cb83aa37d6a1fa7");
assert.equal(packet.stageC, "prepared-not-accepted");
assert.equal(packet.authorizesStageCAccept, false);
assert.equal(packet.requestsStageCAccept, false);
assert.equal(packet.cutoverFlag, "off");
assert.equal(packet.implementationVerified, false);
assert.equal(packet.deployAuthorized, false);
assert.equal(packet.live, "forbidden");
assert.equal(packet.remaining, 10);
assert.equal(packet.liveWriteWatchIndex, 10);
assert.equal(packet.thisPacketModifiesGetReply, false);
assert.equal(packet.forgedProductionAdapters, false);
assert.equal(packet.usedInMemoryAsProduction, false);
assert.equal(packet.flag.default, "off");

assert.equal(packet.locks.stageC, "prepared-not-accepted");
assert.equal(packet.locks.authorizesStageCAccept, false);
assert.equal(packet.locks.requestsStageCAccept, false);
assert.equal(packet.locks.cutoverFlag, "off");
assert.equal(packet.locks.implementationVerified, false);
assert.equal(packet.locks.remaining, 10);
assert.equal(packet.locks.liveWriteWatchIndex, 10);
assert.equal(packet.locks.deployAuthorized, false);
assert.equal(packet.locks.live, "forbidden");
assert.equal(packet.locks.productionReceiptsObserved, 0);
assert.equal(packet.locks.acceptanceMet, false);

assert.equal(packet.adapters.productionCatalogAdapter, "S01ReadOnlyDurableCatalogView");
assert.equal(packet.adapters.productionRegistryAdapter, "createProductionS01StewardRegistryPort");
assert.equal(packet.adapters.honest, true);
assert.equal(packet.adapters.notInMemory, true);
assert.equal(packet.adapters.notForged, true);
assert.equal(packet.adapters.stewardMainPolicy, "catalog_miss");

assert.equal(packet.receiptAcceptance.productionReceiptsObserved, 0);
assert.equal(packet.receiptAcceptance.acceptanceMet, false);

assert.match(getReplyLines[163] ?? "", /resolveEmployeeBuiltinStewardWorkspaceDir/);
assert.match(getReplyLines[164] ?? "", /resolveAgentWorkspaceDir/);
assert.match(getReply, /runS01GetReplyStewardCwdShadowFromEntry/);
assert.doesNotMatch(getReply, /runS01StewardCwdShadowIfEnabled/);
assert.doesNotMatch(getReply, /evaluateS01AuthorizedToolCwd/);
assert.doesNotMatch(getReply, /resolveS01StewardWorkspaceIdentity/);
assert.doesNotMatch(getReply, /InMemoryWorkspaceResourceCatalog/);
assert.doesNotMatch(getReply, /createInMemoryS01/);
assert.doesNotMatch(getReply, /getSharedDataGovernanceCatalog/);
assert.match(cwdSrc, /S01_PRODUCTION_WIRED_TO_GET_REPLY = false/);

const fromEntry = "runS01GetReplyStewardCwdShadowFromEntry({";
const start = getReply.indexOf(fromEntry);
assert.ok(start >= 0, "get-reply must call runS01GetReplyStewardCwdShadowFromEntry");
const end = getReply.indexOf("}),", start);
assert.ok(end > start, "shadow call must close");
const shadowCall = getReply.slice(start, end + 3);
assert.match(shadowCall, /helperCwd: workspaceDirRaw/);
assert.doesNotMatch(shadowCall, /catalog:/);
assert.doesNotMatch(shadowCall, /registry:/);
assert.doesNotMatch(shadowCall, /principal:/);
assert.doesNotMatch(shadowCall, /memberships:/);
assert.doesNotMatch(shadowCall, /attestationSecret:/);

assert.match(shadowSrc, /export async function runS01GetReplyStewardCwdShadowFromEntry/);
assert.match(portsSrc, /class S01ReadOnlyDurableCatalogView/);
assert.match(portsSrc, /export function createProductionS01StewardRegistryPort/);
assert.doesNotMatch(portsSrc, /InMemoryWorkspaceResourceCatalog/);
assert.doesNotMatch(portsSrc, /createInMemoryS01StewardRegistryPort/);

assert.equal(scan.remaining, 10);
assert.equal(scan.liveWriteWatchIndex, 10);
assert.equal(scan.sites[0].pathId, "P5");
assert.equal(scan.sites[0].symbol, "resolveEmployeeBuiltinStewardWorkspaceDir");
assert.equal(scan.sites[0].file, "src/auto-reply/reply/get-reply.ts");
assert.equal(scan.sites.length, 10);

assert.ok(packet.doesNotAuthorize.includes("Stage C Accept"));
assert.ok(packet.doesNotAuthorize.includes("LIVE authorized"));
assert.ok(packet.doesNotAuthorize.includes("editing get-reply.ts"));

assert.match(handoff, /prepared-not-accepted/);
assert.match(handoff, /authorizesStageCAccept: false/);
assert.match(handoff, /productionReceiptsObserved=0/);
assert.doesNotMatch(handoff, /requests Stage C Accept/);
assert.match(handoff, /#857/);

console.log("✓ CR2 observation locked; helper cwd; scan 10/10; no Stage C Accept\n");
console.log(
  "Status: prepared-not-accepted; cr2Landed=true; productionReceiptsObserved=0; LIVE forbidden",
);
