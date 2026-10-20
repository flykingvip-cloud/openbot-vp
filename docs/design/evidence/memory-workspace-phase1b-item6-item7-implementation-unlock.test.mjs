import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const REQUEST = "memory-workspace-phase1b-item6-item7-implementation-unlock-request.json";
const PROPOSED = "memory-workspace-phase1b-item6-item7-implementation-unlock-proposed-receipt.json";
const ITEM6_REVIEW = "memory-workspace-phase1b-item6-implementation-review.json";
const ITEM7_REVIEW = "memory-workspace-phase1b-item7-implementation-review.json";
const CANONICAL = "memory-workspace-phase1b-unlock-decision.json";
const MINIMA_ISSUED = "memory-workspace-phase1b-unlock-minima-issued-receipt.json";
const REPLACEMENT = "memory-workspace-phase1b-item7-replacement-plan.json";
const MINIMA_TIP = "ce6cf5e1702c7f2de20b58f062fd100562b6ee01";
const ITEM5_TIP = "85f55ee2fa76f88dc538180b481a5823631af649";
const BASELINE = "e0d5c3750166692bbcdd324854ee65e4a358a9f1";
const ITEM6_REVIEW_TIP = "d650a3fafa59192bef7823357d74eeca648e6ecf";
const ITEM7_REVIEW_TIP = "daa00a3d7006f2b7023f2540f276bc831f538317";
const ITEM6_REVIEW_MERGE = "7aaa532f6b5a17e39343d7ab03811801fbcf8faa";
const ITEM7_REVIEW_MERGE = "daaadd34cc44cce12a832e6f7c3bc355beb5aca6";
const ITEM6_OP = "phase1b-item6-implementation-unlock-decision-e0d5c37501-20260821T164500Z";
const ITEM7_OP = "phase1b-item7-implementation-unlock-decision-e0d5c37501-20260821T164501Z";
const I4 = "openbot-data-governance-p4-later-i4-eval";
const ITEM6_PLAN =
  ".kiro/specs/memory-workspace-platform-remediation/phase1b-item6-implementation-execution-plan.md";
const ITEM7_PLAN =
  ".kiro/specs/memory-workspace-platform-remediation/phase1b-item7-implementation-execution-plan.md";
const HANDOFF =
  ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-item6-item7-implementation-unlock.md";

const FORBIDDEN_SURFACE = [
  "wiredToProductionResolver=true",
  "Catalog miss=deny",
  "schema v2 production write",
  "production Catalog new write",
  "production SQLite write",
  "productionWriteWatchIndex",
  "Item 7 Retirement execute",
  "LIVE cutover",
  "deployAuthorized=true",
  "cross-tenant migration",
  "BYOS / tenant-cloud / cold archive",
  "Item 6/7 met",
  "PR #538",
  "canonical full unlock receipt",
];

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

void test("combined Item 6/7 implementation-unlock request stays not-issued", () => {
  const request = load(REQUEST);
  const proposed = load(PROPOSED);
  const item6Review = load(ITEM6_REVIEW);
  const item7Review = load(ITEM7_REVIEW);
  const canonical = load(CANONICAL);
  const minima = load(MINIMA_ISSUED);
  const packed = JSON.stringify(request);

  assert.equal(
    request.schema,
    "memory-workspace-phase1b-item6-item7-implementation-unlock-request/v1",
  );
  assert.equal(request.kind, "item6-item7-implementation-unlock-decision-package");
  assert.equal(request.decision, "submitted-for-independent-review");
  assert.equal(request.reviewRequest, "Item 6/7 Implementation Unlock Decision Review only");
  assert.equal(request.requestedScope, "item6-item7-implementation-only");
  assert.equal(request.fullPhase1bUnlock, "not-issued");
  assert.equal(request.implementationUnlock, "not-issued");
  assert.equal(request.unlock, "not-issued");
  assert.equal(request.phase1bExecutionBlocked, true);
  assert.equal(request.deployAuthorized, false);
  assert.equal(request.wiredToProductionResolver, false);
  assert.equal(request.liveCutover, false);
  assert.equal(request.item6Met, false);
  assert.equal(request.item7Met, false);
  assert.equal(request.item6, "not-met");
  assert.equal(request.item7, "not-met");
  assert.equal(request.implementationStarted, false);
  assert.equal(request.item7Retirement, "forbidden");
  assert.equal(request.retirement, "forbidden");
  assert.equal(request.thisPacketIssuesUnlock, false);
  assert.equal(request.thisPacketStartsImplementation, false);
  assert.equal(request.thisPacketDeletesCallSites, false);
  assert.equal(request.thisPacketWritesProductionSqlite, false);
  assert.equal(request.productionSqliteWrite, false);
  assert.equal(request.catalogMissDeny, false);
  assert.equal(request.liveWriteWatchIndex, 37);
  assert.equal(request.frozenWriteWatchIndex, 38);
  assert.equal(request.retiredThisChange, 0);
  assert.equal(request.item6OperationId, ITEM6_OP);
  assert.equal(request.item7OperationId, ITEM7_OP);
  assert.notEqual(request.item6OperationId, request.item7OperationId);
  assert.equal(request.baselineSha, BASELINE);
  assert.equal(request.originMainSha, BASELINE);
  assert.equal(request.minimaReceiptTip, MINIMA_TIP);
  assert.equal(request.item5ReviewTip, ITEM5_TIP);
  assert.equal(request.item5FinalCloseoutBinding, ITEM5_TIP);
  assert.equal(request.item6ImplementationReviewPackageTip, ITEM6_REVIEW_TIP);
  assert.equal(request.item7ImplementationReviewPackageTip, ITEM7_REVIEW_TIP);
  assert.equal(request.cited.minimaReceiptTip, MINIMA_TIP);
  assert.equal(request.cited.item5FinalCloseoutBinding, ITEM5_TIP);
  assert.equal(request.cited.baselineSha, BASELINE);
  assert.equal(request.i4DirtyTreeUsed, false);
  assert.doesNotMatch(packed, new RegExp(I4));
  assert.ok(!REPO.includes(I4), REPO);

  assert.equal(
    item6Review.path,
    "docs/design/evidence/memory-workspace-phase1b-item6-implementation-review.json",
  );
  assert.equal(
    item7Review.path,
    "docs/design/evidence/memory-workspace-phase1b-item7-implementation-review.json",
  );
  assert.equal(item6Review.item6Met, false);
  assert.equal(item7Review.item7Met, false);
  assert.equal(minima.fullUnlock, "not-issued");
  assert.equal(canonical.unlock, "not-issued");

  assert.equal(proposed.status, "proposed");
  assert.equal(proposed.effective, false);
  assert.equal(proposed.signedBy, null);
  assert.equal(proposed.issuedAt, null);
  assert.equal(proposed.implementationUnlock, "not-issued");
  assert.notEqual(proposed.status, "issued");
  assert.notEqual(proposed.implementationUnlock, "issued");
  assert.notEqual(proposed.phase1bExecutionBlocked, false);
  assert.notEqual(proposed.deployAuthorized, true);

  for (const needle of FORBIDDEN_SURFACE) {
    assert.ok(
      request.stillForbiddenAfterApproval.some(
        (row) => row.includes(needle) || needle.includes(row),
      ),
      `request missing forbidden surface: ${needle}`,
    );
  }
});

void test("prerequisite tips exist in ancestry and paths resolve", () => {
  const request = load(REQUEST);
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", "origin/main", "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", MINIMA_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", ITEM5_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", ITEM6_REVIEW_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", ITEM7_REVIEW_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", ITEM6_REVIEW_MERGE, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", ITEM7_REVIEW_MERGE, "HEAD"]), true);
  assert.equal(gitOk(["cat-file", "-t", MINIMA_TIP]), true);
  assert.equal(gitOk(["cat-file", "-t", ITEM5_TIP]), true);
  assert.equal(gitOk(["cat-file", "-t", ITEM6_REVIEW_TIP]), true);
  assert.equal(gitOk(["cat-file", "-t", ITEM7_REVIEW_TIP]), true);

  const paths = [
    request.path,
    request.proposedReceipt,
    request.handoff,
    request.item6ExecutionPlan,
    request.item7ExecutionPlan,
    request.cited.minimaReceipt,
    request.cited.item6ImplementationReview,
    request.cited.item6ImplementationReviewHandoff,
    request.cited.item7ImplementationReview,
    request.cited.item7ImplementationReviewHandoff,
    request.canonicalUnlockReceipt,
    ITEM6_PLAN,
    ITEM7_PLAN,
    HANDOFF,
  ];
  for (const relPath of paths) {
    assert.equal(fs.existsSync(path.join(REPO, relPath)), true, relPath);
  }
});

void test("this packet does not change production code, sqlite, catalog, or call-sites", () => {
  const request = load(REQUEST);
  const schema = readRepo("src/memory/schema-v2.ts");
  assert.match(schema, /export const SCHEMA_V2_ENABLED = false/);
  assert.doesNotMatch(
    gitOut(["diff", "--name-only", "origin/main", "--", "src/memory/schema-v2.ts"]),
    /schema-v2/,
  );
  assert.equal(
    gitOut([
      "diff",
      "--name-only",
      "origin/main",
      "--",
      "src/memory",
      "src/gateway/workspace-resolver",
    ]),
    "",
  );
  assert.equal(request.thisPacketDeletesCallSites, false);
  assert.equal(request.retiredThisChange, 0);
  assert.equal(request.liveWriteWatchIndex, 37);
  const changed = gitOut(["diff", "--name-only", "origin/main"]).split("\n").filter(Boolean);
  assert.equal(
    changed.some((row) => row.startsWith("src/")),
    false,
    changed.join("\n"),
  );
  assert.equal(
    changed.includes("docs/design/evidence/memory-workspace-phase1b-unlock-decision.json"),
    false,
  );
  assert.equal(
    changed.includes(
      "docs/design/evidence/memory-workspace-phase1b-item6-implementation-review.json",
    ),
    false,
  );
  assert.equal(
    changed.includes(
      "docs/design/evidence/memory-workspace-phase1b-item7-implementation-review.json",
    ),
    false,
  );
});

void test("execution plans cover required Item 6/7 surfaces and the same forbidden set", () => {
  const item6Plan = readRepo(ITEM6_PLAN);
  const item7Plan = readRepo(ITEM7_PLAN);
  const replacement = load(REPLACEMENT);

  assert.match(item6Plan, /schema\s*\/\s*SQLite change list/i);
  assert.match(item6Plan, /Migration order/);
  assert.match(item6Plan, /Backup \/ fencing \/ single-writer/);
  assert.match(item6Plan, /Shadow \/ read \/ write \/ cutover/);
  assert.match(item6Plan, /Tenant isolation/);
  assert.match(item6Plan, /Checksum and data integrity/);
  assert.match(item6Plan, /recovery_required \/ quarantine \/ tombstone/);
  assert.match(item6Plan, /Rollback and stop conditions/);
  assert.match(item6Plan, /Production rollout pre-gates/);

  assert.match(item7Plan, /37 live call-sites/);
  assert.match(item7Plan, /38 frozen ledger rows vs live=37/);
  assert.match(item7Plan, /W0–W5 order/);
  assert.match(item7Plan, /Tombstone \/ quarantine/);
  assert.match(item7Plan, /Dual-write prohibition/);
  assert.match(item7Plan, /Per-wave delete preconditions/);
  assert.match(item7Plan, /Rollback \/ revoke/);
  assert.match(item7Plan, /Post-delete machine-checkable gate/);
  assert.match(item7Plan, /productionWriteWatchIndex=0/);
  assert.match(item7Plan, /tool-cwd\.ts:51/);
  assert.match(item7Plan, /createEmptyWorkspaceCatalog/);

  for (const site of replacement.sites) {
    assert.match(item7Plan, new RegExp(`\\b${site.ledgerId}\\b`));
    assert.match(item7Plan, new RegExp(site.file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal(replacement.sites.length, 37);

  for (const needle of FORBIDDEN_SURFACE) {
    assert.match(item6Plan, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(item7Plan, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(item6Plan, new RegExp(I4));
  assert.doesNotMatch(item7Plan, new RegExp(I4));
});

void test("handoff requests Item 6/7 Implementation Unlock Decision Review only", () => {
  const handoff = readRepo(HANDOFF);
  assert.match(handoff, /Item 6\/7 Implementation Unlock Decision Review only/);
  assert.match(handoff, /does not start implementation/i);
  assert.match(handoff, /does not request Item 6\/7 met/i);
  assert.match(handoff, /does not execute production writes/i);
  assert.match(handoff, /does not execute Retirement/i);
  assert.match(handoff, /does not execute LIVE cutover/i);
  assert.match(handoff, /does not modify the resolver/i);
  assert.match(handoff, /does not issue full Phase 1B unlock/i);
  assert.doesNotMatch(handoff, /phase1bExecutionBlocked=false/);
  assert.doesNotMatch(handoff, /(?<!not-)implementationUnlock=issued/);
  assert.doesNotMatch(handoff, new RegExp(I4));
  assert.match(handoff, /ce6cf5e1702c7f2de20b58f062fd100562b6ee01/);
  assert.match(handoff, /85f55ee2fa76f88dc538180b481a5823631af649/);
  assert.match(handoff, /d650a3fafa59192bef7823357d74eeca648e6ecf/);
  assert.match(handoff, /daa00a3d7006f2b7023f2540f276bc831f538317/);
  assert.match(handoff, /e0d5c3750166692bbcdd324854ee65e4a358a9f1/);
});
