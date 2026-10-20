import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { measureItem7Retirement } from "./memory-workspace-phase1b-item7-retirement-scan.mjs";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const PLAN = "memory-workspace-phase1b-item7-replacement-plan.json";
const LEDGER = "memory-workspace-phase1b-item7-callsite-ledger.json";
const SCAN = "memory-workspace-phase1b-item7-retirement-scan.json";
const ITEM6 = "memory-workspace-phase1b-item6-implementation-review.json";
const ITEM7_REVIEW = "memory-workspace-phase1b-item7-implementation-review.json";
const UNLOCK = "memory-workspace-phase1b-unlock-decision.json";
const CURRENT = "memory-workspace-phase1b-unlock-current.json";
const MINIMA_TIP = "ce6cf5e1702c7f2de20b58f062fd100562b6ee01";
const ITEM5_TIP = "85f55ee2fa76f88dc538180b481a5823631af649";
const BASELINE = "5480cefe122f38fdf1064c1672b860e10060a32c";
const CITED_ITEM6_REVIEW = "7aaa532f6b5a17e39343d7ab03811801fbcf8faa";
const LEDGER_MERGE = "c925b54ed9e48848a782a66064157cd085059367";
const OP = "phase1b-item7-replacement-plan-5480cefe12-20260820T141800Z";
const I4 = "openbot-data-governance-p4-later-i4-eval";
const HANDOFF =
  ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-item7-replacement-plan.md";
const REQUIRED_FIELDS = [
  "replacementSymbol",
  "owner",
  "dependency",
  "rollback",
  "quarantine",
  "retirementPrerequisite",
  "verificationTests",
];
const REPLACEMENT_SYMBOLS = new Set([
  "resolveWorkspaceResource",
  "WorkspaceResourceCatalog.getResource",
  "resolveMemoryWorkspaceHandle",
]);

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

function readRepo(relPath) {
  return fs.readFileSync(path.join(REPO, relPath), "utf8");
}

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: REPO, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

function gitOut(args) {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
}

function evaluateItem7ReplacementPlan(input) {
  if (input.setItem6ImplementationUnlocked === true) {
    return { allow: false, reason: "item6-unlock-from-this-packet-forbidden", failClosed: true };
  }
  if (input.unlockImplementation === true) {
    return { allow: false, reason: "unlock-from-this-packet-forbidden", failClosed: true };
  }
  if (input.deleteCallSite === true) {
    return { allow: false, reason: "delete-call-site-forbidden", failClosed: true };
  }
  if (input.rewriteCountToZero === true) {
    return { allow: false, reason: "count-rewrite-forbidden", failClosed: true };
  }
  if (input.markItem7Met === true && input.liveWriteWatchIndex !== 0) {
    return { allow: false, reason: "item7-met-gate-not-satisfied", failClosed: true };
  }
  if (input.executeRetirement === true) {
    return { allow: false, reason: "retirement-forbidden", failClosed: true };
  }
  if (input.schemaV2Write === true) {
    return { allow: false, reason: "schema-v2-write-forbidden", failClosed: true };
  }
  if (input.resolverProductionWrite === true) {
    return { allow: false, reason: "resolver-write-forbidden", failClosed: true };
  }
  if (input.catalogWrite === true) {
    return { allow: false, reason: "catalog-write-forbidden", failClosed: true };
  }
  if (input.databaseMigration === true) {
    return { allow: false, reason: "database-migration-forbidden", failClosed: true };
  }
  if (input.deployAuthorized === true) {
    return { allow: false, reason: "deploy-authorized-forbidden", failClosed: true };
  }
  if (input.liveCutover === true) {
    return { allow: false, reason: "live-cutover-forbidden", failClosed: true };
  }
  return { allow: false, reason: "replacement-plan-does-not-start-work", failClosed: true };
}

void test("item 7 replacement plan is not ledger or implementation-review and stays locked", () => {
  const plan = load(PLAN);
  const ledger = load(LEDGER);
  const scan = load(SCAN);
  const item6 = load(ITEM6);
  const item7Review = load(ITEM7_REVIEW);
  const unlock = load(UNLOCK);
  const current = load(CURRENT);
  const packed = JSON.stringify(plan);

  assert.equal(plan.schema, "memory-workspace-phase1b-item7-replacement-plan/v1");
  assert.equal(plan.kind, "item7-replacement-plan");
  assert.notEqual(plan.kind, "item7-evidence-preparation");
  assert.notEqual(plan.kind, "item7-callsite-ledger");
  assert.notEqual(plan.kind, "item7-implementation-review");
  assert.equal(plan.status, "replacement-plan-submitted");
  assert.equal(plan.reviewRequest, "Item 7 Replacement Plan Review only");
  assert.equal(plan.item7, "not-met");
  assert.equal(plan.item7Met, false);
  assert.equal(plan.implementationUnlocked, false);
  assert.equal(plan.implementationStarted, false);
  assert.equal(plan.retirement, "forbidden");
  assert.equal(plan.retirementExecuted, false);
  assert.equal(plan.thisPacketUnlocksImplementation, false);
  assert.equal(plan.thisPacketMarksItem7Met, false);
  assert.equal(plan.thisPacketExecutesRetirement, false);
  assert.equal(plan.thisPacketDeletesCallSites, false);
  assert.equal(plan.thisPacketRewritesWatchIndexToZero, false);
  assert.equal(plan.phase1bUnlock, "not-issued");
  assert.equal(plan.fullUnlock, "not-issued");
  assert.equal(plan.phase1bExecutionBlocked, true);
  assert.equal(plan.deployAuthorized, false);
  assert.equal(plan.wiredToProductionResolver, false);
  assert.equal(plan.liveCutover, false);
  assert.equal(plan.live, "forbidden");
  assert.equal(plan.liveWriteWatchIndex, 37);
  assert.equal(plan.frozenWriteWatchIndex, 38);
  assert.equal(plan.retiredThisChange, 0);
  assert.equal(plan.remaining, 37);
  assert.equal(plan.sites.length, 37);
  assert.equal(scan.liveWriteWatchIndex, scan.sites.length);
  assert.ok(scan.liveWriteWatchIndex > 0);
  assert.notEqual(scan.liveWriteWatchIndex, 0);
  assert.equal(ledger.liveWriteWatchIndex, 37);
  assert.equal(plan.operationId, OP);
  assert.equal(plan.baselineSha, BASELINE);
  assert.equal(plan.baselineSha, gitOut(["rev-parse", "origin/main"]));
  assert.equal(plan.citedUserBaseline, CITED_ITEM6_REVIEW);
  assert.equal(plan.citedItem6ReviewMerge, CITED_ITEM6_REVIEW);
  assert.equal(plan.citedLedgerMerge, LEDGER_MERGE);
  assert.equal(plan.retargetFrom, CITED_ITEM6_REVIEW);
  assert.equal(gitOk(["merge-base", "--is-ancestor", CITED_ITEM6_REVIEW, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", LEDGER_MERGE, "HEAD"]), true);
  assert.equal(plan.minimaReceiptTip, MINIMA_TIP);
  assert.equal(plan.item5ReviewTip, ITEM5_TIP);
  assert.equal(plan.item6ImplementationUnlocked, false);
  assert.equal(plan.item6ImplementationReviewWaitsForIndependentReviewer, true);
  assert.equal(plan.item7ImplementationUnlocked, false);
  assert.equal(item6.implementationUnlocked, false);
  assert.equal(item6.thisPacketUnlocksImplementation, false);
  assert.equal(item7Review.implementationUnlocked, false);
  assert.equal(current.item6ImplementationUnlocked, false);
  assert.equal(current.item7ImplementationUnlocked, false);
  assert.equal(current.fullUnlock, "not-issued");
  assert.equal(unlock.unlock, "not-issued");
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.deployAuthorized, false);
  assert.equal(unlock.live, "forbidden");
  assert.equal(plan.retirementReviewRequest.requested, true);
  assert.equal(plan.retirementReviewRequest.thisPacketExecutesRetirement, false);
  assert.equal(plan.retirementReviewRequest.acceptingDoesNotMarkItem7Met, true);
  assert.ok(plan.thisPacketIsNot.includes("Item 7 call-site ledger"));
  assert.ok(plan.thisPacketIsNot.includes("Item 6 implementation-review"));
  assert.ok(plan.thisPacketIsNot.includes("stale item7-retirement-plan.json"));
  assert.ok(plan.allowedNow.includes("independent retirement review request"));
  assert.doesNotMatch(packed, /\/Users\//);
  assert.doesNotMatch(packed, /\/root\//);
  assert.doesNotMatch(packed, new RegExp(I4));
});

void test("each of 37 sites has replacement symbol, owner, dependency, rollback, quarantine, prerequisite, tests", () => {
  const plan = load(PLAN);
  const ledger = load(LEDGER);
  const scan = load(SCAN);
  const keys = new Set();
  for (const site of plan.sites) {
    for (const field of REQUIRED_FIELDS) {
      assert.ok(site[field], `${site.ledgerId} missing ${field}`);
    }
    assert.equal(typeof site.owner, "string");
    assert.equal(site.uniqueOwner, true);
    assert.equal(REPLACEMENT_SYMBOLS.has(site.replacementSymbol), true, site.replacementSymbol);
    assert.equal(site.replacementExistsInSrc, true);
    assert.equal(site.replacementImplemented, false);
    assert.equal(site.wiredToThisCallSite, false);
    assert.equal(site.deleteNow, false);
    assert.equal(site.retiredThisChange, false);
    assert.equal(site.dependency.w0Satisfied, false);
    assert.equal(site.dependency.blockedBy, "item7ImplementationUnlocked=false");
    assert.ok(Array.isArray(site.dependency.dependsOnWaves));
    assert.equal(site.rollback.restoreFromGit, true);
    assert.equal(site.rollback.rewriteFreezeBaselineToZero, false);
    assert.equal(site.quarantine.enabled, false);
    assert.equal(site.quarantine.quarantineNormalWrites, 0);
    assert.ok(
      site.verificationTests.nowAllowed.includes(
        "docs/design/evidence/memory-workspace-phase1b-item7-replacement-plan.test.mjs",
      ),
    );
    assert.match(site.verificationTests.shadowDryRun, /shadow-dry-run/);
    const key = `${site.file}|${site.line}|${site.symbol}|${site.op}`;
    assert.equal(keys.has(key), false, key);
    keys.add(key);
    const src = fs.readFileSync(path.join(REPO, site.file), "utf8").split(/\n/);
    const cited = src[site.line - 1];
    assert.ok(cited, `${key} cited line missing`);
    const stillLive = scan.sites.some(
      (row) => row.file === site.file && row.symbol === site.symbol && row.op === site.op,
    );
    if (!stillLive) {
      continue;
    }
    const wrappedForClient =
      site.symbol === "resolveAgentWorkspaceDirForClient" &&
      cited.includes("resolveTrustedAgentLocator");
    assert.equal(
      cited.includes(site.symbol) || wrappedForClient,
      true,
      `${site.ledgerId} cited line does not contain ${site.symbol}: ${cited.trim()}`,
    );
    if (wrappedForClient) {
      assert.equal(site.citedLineWraps, "resolveTrustedAgentLocator");
      assert.equal(site.wrapperStillCalls, "resolveAgentWorkspaceDirForClient");
    }
    for (const testPath of site.verificationTests.nowAllowed) {
      assert.equal(
        fs.existsSync(path.join(REPO, testPath)),
        true,
        `${site.ledgerId} missing ${testPath}`,
      );
    }
  }
  assert.equal(keys.size, 37);
  const ledgerKeys = new Set(
    ledger.sites.map((site) => `${site.file}|${site.line}|${site.symbol}|${site.op}`),
  );
  const cmp = (left, right) => left.localeCompare(right);
  assert.deepEqual([...keys].toSorted(cmp), [...ledgerKeys].toSorted(cmp));
});

void test("replacement symbols exist as read paths and are not wired by this packet", () => {
  const resolveSrc = readRepo("src/gateway/workspace-resolver/resolve.ts");
  const catalogSrc = readRepo("src/gateway/workspace-resolver/catalog.ts");
  const memorySrc = readRepo("src/gateway/workspace-resolver/memory-workspace-resolve.ts");
  const schema = readRepo("src/memory/schema-v2.ts");
  const trusted = readRepo("src/gateway/workspace/handler-bridge.ts");

  assert.match(resolveSrc, /export function resolveWorkspaceResource/);
  assert.match(catalogSrc, /getResource\(resourceId: string\): WorkspaceResourceRecord \| null/);
  assert.match(memorySrc, /export async function resolveMemoryWorkspaceHandle/);
  assert.match(schema, /export const SCHEMA_V2_ENABLED = false/);
  assert.match(trusted, /return resolveAgentWorkspaceDirForClient/);
});

void test("dry-run does not delete call-sites, rewrite Freeze, unlock Item 6, or mark item 7 met", () => {
  const plan = load(PLAN);
  const measured = measureItem7Retirement();
  const phase0 = JSON.parse(
    fs.readFileSync(path.join(DIR, "memory-workspace-phase0-20260814.call-sites.json"), "utf8"),
  );

  assert.equal(measured.item7, "not-met");
  assert.equal(measured.retiredThisChange, 0);
  assert.equal(measured.liveWriteWatchIndex, measured.sites.length);
  assert.ok(measured.liveWriteWatchIndex > 0);
  assert.notEqual(measured.liveWriteWatchIndex, 0);
  assert.equal(phase0.productionWriteWatchIndex, 38);
  assert.equal(plan.dryRun.deletesCallSites, false);
  assert.equal(plan.dryRun.modifiesProductionCode, false);
  assert.equal(plan.dryRun.rewritesPhase0Freeze, false);
  assert.equal(plan.dryRun.enablesSchemaV2, false);
  assert.equal(plan.dryRun.switchesResolverProductionWrite, false);
  assert.equal(plan.dryRun.writesProductionCatalog, false);
  assert.equal(plan.dryRun.migratesDatabase, false);
  assert.equal(plan.dryRun.liveCutover, false);
  assert.doesNotMatch(
    gitOut(["diff", "--name-only", "origin/main", "--", "src/memory/schema-v2.ts"]),
    /schema-v2/,
  );

  assert.equal(
    evaluateItem7ReplacementPlan({ setItem6ImplementationUnlocked: true }).reason,
    "item6-unlock-from-this-packet-forbidden",
  );
  assert.equal(
    evaluateItem7ReplacementPlan({ unlockImplementation: true }).reason,
    "unlock-from-this-packet-forbidden",
  );
  assert.equal(
    evaluateItem7ReplacementPlan({ deleteCallSite: true }).reason,
    "delete-call-site-forbidden",
  );
  assert.equal(
    evaluateItem7ReplacementPlan({ rewriteCountToZero: true }).reason,
    "count-rewrite-forbidden",
  );
  assert.equal(
    evaluateItem7ReplacementPlan({ markItem7Met: true, liveWriteWatchIndex: 37 }).reason,
    "item7-met-gate-not-satisfied",
  );
  assert.equal(
    evaluateItem7ReplacementPlan({ executeRetirement: true }).reason,
    "retirement-forbidden",
  );
  assert.equal(
    evaluateItem7ReplacementPlan({ schemaV2Write: true }).reason,
    "schema-v2-write-forbidden",
  );
  assert.equal(
    evaluateItem7ReplacementPlan({ resolverProductionWrite: true }).reason,
    "resolver-write-forbidden",
  );
  assert.equal(
    evaluateItem7ReplacementPlan({ catalogWrite: true }).reason,
    "catalog-write-forbidden",
  );
  assert.equal(
    evaluateItem7ReplacementPlan({ databaseMigration: true }).reason,
    "database-migration-forbidden",
  );
  assert.equal(
    evaluateItem7ReplacementPlan({ deployAuthorized: true }).reason,
    "deploy-authorized-forbidden",
  );
  assert.equal(
    evaluateItem7ReplacementPlan({ liveCutover: true }).reason,
    "live-cutover-forbidden",
  );
  const locked = evaluateItem7ReplacementPlan({});
  assert.equal(locked.allow, false);
  assert.equal(locked.reason, "replacement-plan-does-not-start-work");
});

void test("item 7 replacement-plan handoff requests Replacement Plan Review only", () => {
  const handoff = readRepo(HANDOFF);
  const md = readRepo("docs/design/evidence/memory-workspace-phase1b-item7-replacement-plan.md");
  assert.match(handoff, /Item 7 Replacement Plan Review only/);
  assert.match(handoff, /does not request Item 7 implementation unlock/);
  assert.match(handoff, /does not request Item 7 met/);
  assert.match(handoff, /does not execute Item 7 Retirement/);
  assert.match(handoff, /does not set item6ImplementationUnlocked=true/);
  assert.doesNotMatch(handoff, /Item 7 Evidence Preparation Review only/);
  assert.match(md, /resolveWorkspaceResource/);
  assert.match(md, /WorkspaceResourceCatalog.getResource/);
  assert.match(md, /resolveMemoryWorkspaceHandle/);
  assert.ok(!REPO.includes(I4), REPO);
  assert.equal(gitOk(["merge-base", "--is-ancestor", MINIMA_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", ITEM5_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", "origin/main", "HEAD"]), true);
});
