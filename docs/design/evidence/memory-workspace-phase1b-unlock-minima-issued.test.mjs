import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const TIP = "0f92f5b66e62951283f35f69cd931b852de99b9a";
const MERGE = "1d89c302eac9f6105c1784bf8f9e3ab80610bd8d";
const ITEM5 = "85f55ee2fa76f88dc538180b481a5823631af649";
const OP = "phase1b-unlock-minima-issued-0f92f5b66e-20260820T011000Z";
const I4 = "openbot-data-governance-p4-later-i4-eval";

const ALLOWED = [
  "prepare Item 6 independent design package",
  "prepare Item 7 independent design package",
  "run inventory and fixture verification",
  "run read-only and shadow verification",
  "run dry-run and production-equivalent verification",
  "submit separate implementation request/handoff",
];

const FORBIDDEN = [
  "Item 6 implementation",
  "Item 7 implementation",
  "wiredToProductionResolver=true",
  "Catalog miss=deny",
  "schema v2 production write",
  "production Catalog new write",
  "deleting any productionWriteWatchIndex call-site",
  "Item 7 Retirement",
  "deployAuthorized=true",
  "LIVE cutover",
  "cross-tenant migration",
  "BYOS / tenant-cloud / cold archive",
  "deriving Item 6/7 met from minima",
  "modifying PR #538 or PR #542 frozen evidence",
];

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

function readRepo(relPath) {
  return fs.readFileSync(path.join(REPO, relPath), "utf8");
}

function sha256Disk(relPath) {
  return createHash("sha256")
    .update(fs.readFileSync(path.join(REPO, relPath)))
    .digest("hex");
}

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: REPO, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

void test("issued receipt cites PR 542 tip/merge and is minima-only", () => {
  const receipt = load("memory-workspace-phase1b-unlock-minima-issued-receipt.json");
  const full = load("memory-workspace-phase1b-unlock-decision.json");

  assert.equal(receipt.schema, "memory-workspace-phase1b-unlock-minima-issued-receipt/v1");
  assert.equal(receipt.status, "issued");
  assert.equal(receipt.effective, true);
  assert.equal(receipt.unlock, "minima-issued");
  assert.equal(receipt.fullUnlock, "not-issued");
  assert.notEqual(receipt.unlock, "issued");
  assert.equal(receipt.decision, "approved-by-independent-review");
  assert.equal(receipt.signedBy, "independent-codex-review");
  assert.equal(receipt.reviewTip, TIP);
  assert.equal(receipt.reviewMerge, MERGE);
  assert.equal(receipt.item5ReviewTip, ITEM5);
  assert.equal(receipt.reviewSurface, "https://github.com/gmood2008/openbot/pull/542");
  assert.equal(receipt.operationId, OP);
  assert.equal(full.unlock, "not-issued");
});

void test("production switches stay blocked and Item 6/7 implementation stays locked", () => {
  const receipt = load("memory-workspace-phase1b-unlock-minima-issued-receipt.json");
  assert.equal(receipt.phase1bExecutionBlocked, true);
  assert.notEqual(receipt.phase1bExecutionBlocked, false);
  assert.equal(receipt.deployAuthorized, false);
  assert.equal(receipt.wiredToProductionResolver, false);
  assert.equal(receipt.liveCutover, false);
  assert.equal(receipt.item6ImplementationUnlocked, false);
  assert.equal(receipt.item7ImplementationUnlocked, false);
  assert.equal(receipt.item6Unlocked, false);
  assert.equal(receipt.item7Unlocked, false);
  assert.equal(receipt.items["6"], "locked");
  assert.equal(receipt.items["7"], "locked");
});

void test("allowed list is preparation-only and forbidden list covers production danger", () => {
  const receipt = load("memory-workspace-phase1b-unlock-minima-issued-receipt.json");
  const allowed = receipt.allowed.join("\n");
  for (const item of ALLOWED) {
    assert.ok(receipt.allowed.includes(item), `missing allowed: ${item}`);
  }
  assert.doesNotMatch(allowed, /implementation unlocked/i);
  assert.doesNotMatch(allowed, /wiredToProductionResolver=true/);
  assert.doesNotMatch(allowed, /deployAuthorized=true/);
  assert.doesNotMatch(allowed, /Retirement/);
  assert.doesNotMatch(allowed, /LIVE cutover/);
  for (const item of FORBIDDEN) {
    assert.ok(receipt.forbidden.includes(item), `missing forbidden: ${item}`);
  }
});

void test("current pointer distinguishes full unlock from minima unlock", () => {
  const pointer = load("memory-workspace-phase1b-unlock-current.json");
  const receipt = load("memory-workspace-phase1b-unlock-minima-issued-receipt.json");
  assert.equal(pointer.fullUnlock, "not-issued");
  assert.equal(pointer.minimaUnlock, "issued");
  assert.equal(pointer.executionBlocked, true);
  assert.equal(pointer.phase1bExecutionBlocked, true);
  assert.equal(pointer.productionAuthorized, false);
  assert.equal(pointer.deployAuthorized, false);
  assert.equal(pointer.item6ImplementationUnlocked, true);
  assert.equal(pointer.item7ImplementationUnlocked, true);
  assert.equal(pointer.minimaUnlockReceipt, receipt.path);
  assert.equal(
    pointer.fullUnlockReceipt,
    "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
  );
  assert.ok(pointer.ordinaryCallerMustNotTreatMinimaAs.includes("production unlock"));
  assert.ok(pointer.ordinaryCallerMustNotTreatMinimaAs.includes("full Phase 1B unlock"));
});

void test("Item 6 and Item 7 instructions do not authorize production implementation", () => {
  const item6 = readRepo(
    ".kiro/specs/memory-workspace-platform-remediation/phase1b-item6-evidence-preparation-instruction.md",
  );
  const item7 = readRepo(
    ".kiro/specs/memory-workspace-platform-remediation/phase1b-item7-evidence-preparation-instruction.md",
  );
  for (const text of [item6, item7]) {
    const allowed = text.slice(0, text.indexOf("## Forbidden"));
    assert.match(text, /independent evidence preparation/i);
    assert.match(text, /not.*implementation unlock/i);
    assert.match(text, /I4/);
    assert.doesNotMatch(text, /authorizes production code/i);
    assert.doesNotMatch(text, /implementation unlocked/);
    assert.doesNotMatch(text, /phase1bExecutionBlocked=false/);
    assert.doesNotMatch(allowed, /deployAuthorized=true/);
    assert.doesNotMatch(allowed, /wiredToProductionResolver=true/);
    assert.match(text, /## Forbidden/);
  }
  assert.match(item6, /SQLite paths/);
  assert.match(item6, /read-only/);
  assert.match(item6, /implementation request\/handoff/);
  assert.match(item6, /Forbidden/);
  assert.match(item7, /productionWriteWatchIndex/);
  assert.match(item7, /Retirement order/);
  assert.match(item7, /do not execute Retirement/);
  assert.match(item7, /does not delete call-sites/);
});

void test("cited SHAs exist and this tree is not I4", () => {
  const receipt = load("memory-workspace-phase1b-unlock-minima-issued-receipt.json");
  const handoff = readRepo(
    ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-unlock-minima-issued.md",
  );
  const required = [
    receipt.path,
    receipt.currentPointer,
    receipt.sourceRequest,
    receipt.sourceProposedReceipt,
    receipt.canonicalFullUnlockReceipt,
    receipt.item6Instruction,
    receipt.item7Instruction,
    "docs/design/evidence/memory-workspace-phase1b-unlock-minima.test.mjs",
    ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-unlock-minima.md",
  ];
  for (const relPath of required) {
    assert.ok(fs.existsSync(path.join(REPO, relPath)), `missing ${relPath}`);
    assert.match(sha256Disk(relPath), /^[0-9a-f]{64}$/);
  }
  assert.match(handoff, new RegExp(OP));
  assert.match(handoff, new RegExp(TIP));
  assert.match(handoff, new RegExp(MERGE));
  assert.match(handoff, /Phase 1B Unlock Minima Receipt Review/);
  assert.ok(gitOk(["merge-base", "--is-ancestor", TIP, "HEAD"]));
  assert.ok(gitOk(["merge-base", "--is-ancestor", MERGE, "HEAD"]));
  assert.ok(gitOk(["merge-base", "--is-ancestor", ITEM5, "HEAD"]));
  assert.ok(!REPO.includes(I4), `repo root must not be I4 dirty tree: ${REPO}`);
  assert.ok(receipt.notReviewSurface.some((line) => line.includes("I4")));
});
