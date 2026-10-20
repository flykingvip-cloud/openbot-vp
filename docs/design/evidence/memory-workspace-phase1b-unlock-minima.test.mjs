import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const TIP = "85f55ee2fa76f88dc538180b481a5823631af649";
const OP = "phase1b-unlock-minima-85f55ee2fa-20260820T001800Z";
const I4 = "openbot-data-governance-p4-later-i4-eval";
const RUNTIME_HANDOFF =
  ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-item5-runtime-alignment-20260819.md";

const PRODUCTION_DANGER = [
  "wiredToProductionResolver=true",
  "Catalog miss=deny",
  "schema v2 production write",
  "delete any productionWriteWatchIndex call-site",
  "Item 7 Retirement",
  "production Catalog new write",
  "LIVE cutover",
  "deployAuthorized=true",
  "cross-tenant migration",
  "BYOS / tenant-cloud / cold archive",
  "derive Item 6 met or Item 7 met from this minima",
  "Item 6/7 implementation unlocked",
];

function loadEvidence(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
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

void test("minima request and proposed receipt are not issued", () => {
  const request = loadEvidence("memory-workspace-phase1b-unlock-minima-request.json");
  const proposed = loadEvidence("memory-workspace-phase1b-unlock-minima-proposed-receipt.json");
  const receipt = loadEvidence("memory-workspace-phase1b-unlock-decision.json");

  assert.equal(request.schema, "memory-workspace-phase1b-unlock-minima-request/v1");
  assert.equal(request.decision, "submitted-for-independent-review");
  assert.equal(request.requestedUnlock, "minima");
  assert.equal(request.unlock, "not-issued");
  assert.equal(request.stamped, false);
  assert.equal(request.signedBy, null);
  assert.equal(request.issuedAt, null);
  assert.equal(request.phase1bExecutionBlocked, true);
  assert.equal(request.deployAuthorized, false);
  assert.equal(request.wiredToProductionResolver, false);
  assert.equal(request.liveCutover, false);
  assert.notEqual(request.unlock, "issued");

  assert.equal(proposed.status, "proposed");
  assert.equal(proposed.effective, false);
  assert.equal(proposed.signedBy, null);
  assert.equal(proposed.issuedAt, null);
  assert.equal(proposed.unlock, "not-issued");
  assert.equal(proposed.phase1bExecutionBlocked, true);
  assert.equal(proposed.deployAuthorized, false);
  assert.equal(proposed.wiredToProductionResolver, false);
  assert.equal(proposed.liveCutover, false);
  assert.notEqual(proposed.unlock, "issued");
  assert.notEqual(proposed.phase1bExecutionBlocked, false);
  assert.notEqual(proposed.deployAuthorized, true);

  assert.equal(receipt.unlock, "not-issued");
  assert.equal(receipt.phase1bExecutionBlocked, true);
});

void test("Item 5 cites PR 538 tip and not the old runtime handoff", () => {
  const request = loadEvidence("memory-workspace-phase1b-unlock-minima-request.json");
  const scorecard = loadEvidence("memory-workspace-phase1b-unlock-minima-scorecard.json");
  const met = loadEvidence("memory-workspace-phase1b-item5-met-decision.json");
  const binding = loadEvidence("memory-workspace-phase1b-item5-final-closeout-binding.json");

  assert.equal(request.item5.status, "met");
  assert.equal(request.item5.pr, "https://github.com/gmood2008/openbot/pull/538");
  assert.equal(request.item5.reviewTip, TIP);
  assert.equal(request.reviewTip, TIP);
  assert.equal(
    request.item5.binding,
    "docs/design/evidence/memory-workspace-phase1b-item5-final-closeout-binding.json",
  );
  assert.ok(request.item5.notFinalItem5Proof.includes(RUNTIME_HANDOFF));
  assert.ok(request.item5.notFinalItem5Proof.some((line) => line.includes("I4")));
  assert.equal(scorecard.items["5"], "met");
  assert.equal(scorecard.itemSources["5"].reviewTip, TIP);
  assert.equal(met.reviewTip, TIP);
  assert.equal(met.item5, "met");
  assert.equal(binding.item5Met, false);
  assert.equal(
    request.item5.metDecision,
    "docs/design/evidence/memory-workspace-phase1b-item5-met-decision.json",
  );
  assert.equal(
    request.item5.closeoutHandoff,
    ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-item5-final-closeout.md",
  );
  assert.notEqual(request.item5.closeoutHandoff, RUNTIME_HANDOFF);
});

void test("Item 6 and Item 7 stay locked and production switches stay false", () => {
  const request = loadEvidence("memory-workspace-phase1b-unlock-minima-request.json");
  const scorecard = loadEvidence("memory-workspace-phase1b-unlock-minima-scorecard.json");
  const proposed = loadEvidence("memory-workspace-phase1b-unlock-minima-proposed-receipt.json");

  assert.equal(request.items["6"], "locked");
  assert.equal(request.items["7"], "locked");
  assert.equal(request.item6Unlocked, false);
  assert.equal(request.item7Unlocked, false);
  assert.equal(request.item6ImplementationUnlocked, false);
  assert.equal(request.item7ImplementationUnlocked, false);
  assert.equal(scorecard.items["6"], "locked");
  assert.equal(scorecard.items["7"], "locked");
  assert.equal(proposed.item6ImplementationUnlocked, false);
  assert.equal(proposed.item7ImplementationUnlocked, false);
  assert.equal(request.wiredToProductionResolver, false);
  assert.equal(request.deployAuthorized, false);
  assert.equal(request.liveCutover, false);
  assert.equal(
    request.ifApprovedMeans,
    "allow Item 6/7 independent preparation and constrained verification",
  );
  assert.equal(request.ifApprovedDoesNotMean, "Item 6/7 implementation unlocked");
});

void test("minima allowed list excludes production writes and forbidden list covers them", () => {
  const request = loadEvidence("memory-workspace-phase1b-unlock-minima-request.json");
  const allowed = request.allowedAfterApproval.join("\n");
  assert.ok(allowed.includes("design, inventory, shadow, and fixture"));
  assert.ok(allowed.includes("read-only, shadow, dry-run"));
  assert.ok(allowed.includes("implementation request/handoff"));
  assert.doesNotMatch(allowed, /implementation unlocked/i);
  assert.doesNotMatch(allowed, /wiredToProductionResolver=true/);
  assert.doesNotMatch(allowed, /deployAuthorized=true/);
  assert.doesNotMatch(allowed, /LIVE cutover/);
  assert.doesNotMatch(allowed, /Retirement/);
  assert.doesNotMatch(allowed, /schema v2 production write/);
  assert.doesNotMatch(allowed, /miss=deny/);

  for (const item of PRODUCTION_DANGER) {
    assert.ok(request.stillForbiddenAfterApproval.includes(item), `missing forbidden: ${item}`);
  }
});

void test("cited SHAs exist and handoff shares operationId/baselineSha", () => {
  const request = loadEvidence("memory-workspace-phase1b-unlock-minima-request.json");
  const scorecard = loadEvidence("memory-workspace-phase1b-unlock-minima-scorecard.json");
  const proposed = loadEvidence("memory-workspace-phase1b-unlock-minima-proposed-receipt.json");
  const handoff = fs.readFileSync(path.join(REPO, request.handoff), "utf8");

  assert.equal(request.operationId, OP);
  assert.equal(scorecard.operationId, OP);
  assert.equal(proposed.operationId, OP);
  assert.equal(request.baselineSha, request.originMainSha);
  assert.equal(scorecard.baselineSha, request.baselineSha);
  assert.equal(proposed.baselineSha, request.baselineSha);
  assert.match(handoff, new RegExp(OP));
  assert.match(handoff, new RegExp(request.baselineSha));
  assert.match(handoff, /Phase 1B Unlock Decision Review: minima/);
  assert.match(handoff, /does not issue unlock/i);
  assert.match(handoff, /does not start Item 6 or Item 7/i);
  assert.match(handoff, /does not change production resolver/i);
  assert.match(handoff, /does not authorize production writes/i);
  assert.match(handoff, /does not perform LIVE cutover/i);
  assert.doesNotMatch(handoff, /unlock["']?\s*[:=]\s*issued/);
  assert.match(handoff, /does \*\*not\*\* mean `Item 6\/7 implementation unlocked`/);
  assert.ok(request.stillForbiddenAfterApproval.includes("Item 6/7 implementation unlocked"));

  for (const [relPath, expected] of Object.entries(request.references)) {
    assert.ok(fs.existsSync(path.join(REPO, relPath)), `missing ${relPath}`);
    assert.equal(sha256Disk(relPath), expected, `sha256 mismatch ${relPath}`);
  }
});

void test("current branch contains Item 5 review tip and is not the I4 dirty tree", () => {
  const request = loadEvidence("memory-workspace-phase1b-unlock-minima-request.json");
  assert.ok(gitOk(["merge-base", "--is-ancestor", TIP, "HEAD"]));
  assert.ok(gitOk(["merge-base", "--is-ancestor", request.baselineSha, "HEAD"]));
  assert.ok(!REPO.includes(I4), `repo root must not be I4 dirty tree: ${REPO}`);
  assert.ok(request.notReviewSurface.some((line) => line.includes("I4")));
  assert.ok(request.notReviewSurface.includes(RUNTIME_HANDOFF));
});
