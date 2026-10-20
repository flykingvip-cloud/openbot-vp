import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const proposalPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-stage-c-memory-index-proposal.json",
);
const scanPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
);
const unlockPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-current.json",
);
const decisionPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
);
const phase0Path = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase0-20260814.call-sites.json",
);
const interfacePath = path.join(root, "src/memory/memory-index-workspace-handle.ts");

// Baseline this slice is built on (worktree base == origin/main tip at creation).
const BASELINE = "c014b0247e64278e0c60b7d691a31b7ccbaa2f1e";

// The five Stage C op=index sites (C1..C5 = ledger S30/S31/S32/S36/S37).
const STAGE_C_SITES = [
  { file: "src/memory/backend-config.ts", line: 417 },
  { file: "src/memory/backend-config.ts", line: 444 },
  { file: "src/memory/cogniweave-manager.ts", line: 554 },
  { file: "src/memory/manager.ts", line: 152 },
  { file: "src/memory/qmd-manager.ts", line: 196 },
];

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

void test("Stage C proposal carries the mandated §8 counters and retires nothing", () => {
  const p = JSON.parse(fs.readFileSync(proposalPath, "utf8"));

  // §8 mandated counters (exact).
  assert.equal(p.observedAcceptedBaseline, 12);
  assert.equal(p.siteCount, 5);
  assert.equal(p.proposedRetiredThisSlice, 5);
  assert.equal(p.projectedRemainingIfAppliedDirectly, 7);
  assert.equal(p.canonicalLedgerUpdated, false);
  assert.equal(p.canonicalCountClaimed, false);
  assert.equal(p.stageBDependencyState, "blocked");
  assert.equal(p.item7, "not-met");
  assert.equal(p.phase1bExecutionBlocked, true);
  assert.equal(p.phase1bUnlock, "not-issued");
  assert.equal(p.deployAuthorized, false);
  assert.equal(p.live, "forbidden");
  assert.equal(p.productionCatalogWrite, "none");
  assert.equal(p.schemaV2ProductionWrite, false);
  assert.equal(p.rollbackProof, true);
  assert.equal(p.quarantineProof, true);

  // Projection is math off the observed baseline, never a new accepted baseline.
  assert.equal(p.projectedRemainingIfAppliedDirectly, p.observedAcceptedBaseline - p.siteCount);
  assert.notEqual(p.canonicalCountClaimed, true);

  // This is a review-only slice, not a batch accept, and it retires nothing in production.
  assert.equal(p.changeRequest, true);
  assert.equal(p.reviewRequest, "item-7-stage-c-technical-slice-review-only");
  assert.equal(p.reviewRequestIsBatchAccept, false);
  assert.equal(p.retiredThisChange, 0);
  assert.equal(p.productionIndexSwitch, false);
  assert.equal(p.deleteCallSites, false);
  assert.equal(p.retirementExecuted, false);
  assert.equal(p.i3Executed, false);
  assert.equal(p.independentRetirementReviewAccepted, false);
  assert.equal(p.scanModified, false);
  assert.equal(p.absorbsUnacceptedBatches, false);
  assert.equal(p.s25AcceptedStatusPreserved, true);
  assert.equal(p.frozenWriteWatchIndex, 38);
  assert.equal(p.liveWriteWatchIndex, 12);

  // Per-site audit: five sites, none honestly retirable as-is (no trusted identity).
  assert.equal(p.sitesInScope, 5);
  assert.equal(p.sitesHonestlyRetirableAsIs, 0);
  assert.equal(Array.isArray(p.siteAudit), true);
  assert.equal(p.siteAudit.length, 5);
  const labels = p.siteAudit.map((s) => s.label).toSorted();
  assert.deepEqual(labels, ["C1", "C2", "C3", "C4", "C5"]);
  const ledgerIds = p.siteAudit.map((s) => s.ledgerId).toSorted();
  assert.deepEqual(ledgerIds, ["S30", "S31", "S32", "S36", "S37"]);
  for (const s of p.siteAudit) {
    assert.equal(s.op, "index", `${s.label} must be op=index`);
    assert.equal(s.trustedIdentityAtCallSite, false, `${s.label} has no trusted identity`);
    assert.equal(s.honestlyRetirableAsIs, false, `${s.label} not honestly retirable as-is`);
    assert.equal(s.createsAsset, false, `${s.label} is not asset-creation`);
    assert.equal(s.circularDependency, false, `${s.label} is not circular (unlike S26)`);
  }

  // §6 index lifecycle invariants recorded.
  assert.equal(p.indexLifecycle.namespaceBoundToTenantAndResource, true);
  assert.equal(p.indexLifecycle.sameNamedAgentCrossTenantSharesRoot, false);
  assert.equal(p.indexLifecycle.tombstoneRevokeBlocksNewIndex, true);
  assert.equal(p.indexLifecycle.tombstoneRevokeHaltsRunningIndex, true);
  assert.equal(p.indexLifecycle.recoversFromOldHostPath, false);
  assert.equal(p.indexLifecycle.indexExistenceImpliesAccess, false);

  // Narrow interface contract: authorize-only, no dir creation, no Catalog write.
  assert.equal(p.narrowInterface.api, "resolveMemoryIndexWorkspaceHandle");
  assert.equal(p.narrowInterface.createsDirectories, false);
  assert.equal(p.narrowInterface.writesCatalog, false);
  assert.equal(p.narrowInterface.resolvesOnly, "existing canonical/active binding");

  assert.equal(p.originMainSha, BASELINE);
});

void test("Stage C proposal leaves the live retirement scan at 12 with the five sites present (op=index)", () => {
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));

  assert.equal(scan.remaining, 12);
  assert.equal(scan.sites.length, 12);
  assert.equal(scan.liveWriteWatchIndex, 12);
  assert.equal(scan.frozenWriteWatchIndex, 38);
  assert.equal(scan.phase0Rewritten, false);
  assert.equal(scan.i3Executed, false);

  for (const site of STAGE_C_SITES) {
    const found = scan.sites.find((x) => x.file === site.file && x.line === site.line);
    assert.ok(found, `Stage C site ${site.file}:${site.line} must remain in the live scan`);
    assert.equal(found.op, "index", `${site.file}:${site.line} must be op=index`);
    assert.equal(found.symbol, "resolveAgentWorkspaceDir");
  }
});

void test("Stage C proposal keeps canonical governance pointers blocked and is built on origin/main", () => {
  const phase0 = JSON.parse(fs.readFileSync(phase0Path, "utf8"));
  assert.equal(phase0.productionWriteWatchIndex, 38);

  const unlock = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.fullUnlock, "not-issued");
  assert.equal(unlock.retirementExecuted, false);

  const decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
  assert.equal(decision.phase1bExecutionBlocked, true);

  // The controlled narrow interface exists and does not statically import the gateway
  // resolver (memory-layer boundary: the canonical resolver is injected as a port).
  const src = fs.readFileSync(interfacePath, "utf8");
  assert.equal(/from\s+["'][^"']*gateway\/workspace-resolver/.test(src), false);
  assert.match(src, /export async function resolveMemoryIndexWorkspaceHandle/);
  assert.match(src, /export async function guardedMemoryIndexStart/);

  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
});
