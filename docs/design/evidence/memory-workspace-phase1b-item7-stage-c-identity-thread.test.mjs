import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const evidencePath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-stage-c-identity-thread.json",
);
const scanPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
);
const accessCtxPath = path.join(root, "src/memory/memory-index-access-context.ts");

// Baseline this slice is built on (worktree base == origin/main tip at creation).
const BASELINE = "a54bf8e145d2e5794b97f1720ee5093ccd36a181";

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

void test("Stage C identity-thread evidence carries the mandated fields", () => {
  const e = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  // This slice retires nothing, so its reported counts must equal the CURRENT
  // canonical retirement scan (Batch 24 advanced it to 10) rather than a frozen
  // literal — keeps the evidence truthful as origin/main advances.
  const scanForCounts = JSON.parse(fs.readFileSync(scanPath, "utf8"));

  assert.equal(e.status, "stage-c-identity-thread-managed-wiring");
  assert.equal(e.runtimeBehaviorChanged, true);
  assert.equal(e.managedEnterpriseFailClosed, true);
  assert.equal(e.personalLocalLegacyPreserved, true);
  assert.equal(e.productionRetirement, false);
  assert.equal(e.retiredThisChange, 0);
  assert.equal(e.remaining, scanForCounts.remaining);
  assert.equal(e.liveWriteWatchIndex, scanForCounts.liveWriteWatchIndex);
  assert.equal(e.canonicalLedgerUpdated, false);
  assert.equal(e.stageCAccepted, false);
  assert.equal(e.item7, "not-met");
  assert.equal(e.phase1bExecutionBlocked, true);
  assert.equal(e.phase1bUnlock, "not-issued");
  assert.equal(e.deployAuthorized, false);
  assert.equal(e.live, "forbidden");
  assert.equal(e.productionCatalogWrite, "none");
  assert.equal(e.schemaV2ProductionWrite, false);
  assert.equal(e.rollbackProof, true);
  assert.equal(e.quarantineProof, true);

  // Review-only slice, not a batch accept, retires nothing, does not touch the scan.
  assert.equal(e.reviewRequestIsBatchAccept, false);
  assert.equal(e.scanModified, false);
  assert.equal(e.frozenWriteWatchIndex, scanForCounts.frozenWriteWatchIndex);
  assert.equal(e.legacyCallsDeleted, 0);

  // Five op=index sites, each keeps its legacy locator call.
  assert.equal(Array.isArray(e.sites), true);
  assert.equal(e.sites.length, 5);
  const ledgerIds = e.sites.map((s) => s.ledgerId).toSorted();
  assert.deepEqual(ledgerIds, ["S30", "S31", "S32", "S36", "S37"]);
  for (const s of e.sites) {
    assert.equal(s.op, "index", `${s.label} op=index`);
    assert.equal(s.legacyCallRetained, true, `${s.label} legacy call retained`);
  }

  // Reject path has zero side effects.
  const z = e.rejectPathZeroSideEffects;
  assert.equal(z.scan, 0);
  assert.equal(z.fileRead, 0);
  assert.equal(z.indexWrite, 0);
  assert.equal(z.rebuild, 0);
  assert.equal(z.fallback, 0);
  assert.equal(z.directoryCreated, 0);
  assert.equal(z.catalogWrite, 0);

  // Cache isolation invariants.
  assert.equal(e.cacheIsolation.crossTenantSameAgentDistinctInstance, true);
  assert.equal(e.cacheIsolation.personalVsManagedNeverShared, true);
  assert.equal(e.cacheIsolation.identityLessRequestCannotHitTenantCache, true);

  assert.equal(e.originMainSha, BASELINE);
});

void test("Stage C identity-thread keeps its five sites live in the retirement scan (op=index) without altering it", () => {
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  // The canonical live count is whatever origin/main currently records (Batch 24
  // advanced it to 10); this slice must not change it. Assert internal
  // consistency + that the five Stage C sites are still live, rather than a frozen
  // literal that a later retirement would break.
  assert.equal(scan.sites.length, scan.remaining);
  assert.equal(scan.liveWriteWatchIndex, scan.remaining);
  assert.equal(scan.phase0Rewritten, false);
  for (const site of STAGE_C_SITES) {
    const found = scan.sites.find((x) => x.file === site.file && x.line === site.line);
    assert.ok(found, `Stage C site ${site.file}:${site.line} must remain in the live scan`);
    assert.equal(found.op, "index", `${site.file}:${site.line} op=index`);
    assert.equal(found.symbol, "resolveAgentWorkspaceDir");
  }
});

void test("access-context module keeps the memory-layer boundary and is built on origin/main", () => {
  const src = fs.readFileSync(accessCtxPath, "utf8");
  // The memory layer must not statically import the gateway resolver; the canonical
  // resolver is injected as a port (CanonicalMemoryWorkspaceResolver).
  assert.equal(/from\s+["'][^"']*gateway\/workspace-resolver/.test(src), false);
  assert.match(src, /export function personalLocalAccessContext/);
  assert.match(src, /export function managedAccessContext/);
  assert.match(src, /export async function resolveMemoryIndexAccess/);

  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
});
