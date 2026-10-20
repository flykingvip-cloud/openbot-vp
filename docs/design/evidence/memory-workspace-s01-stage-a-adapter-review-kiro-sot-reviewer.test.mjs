import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

void test("kiro-sot-reviewer SA1-SA3 contract remediation review", async () => {
  console.log("=== kiro-sot-reviewer independent review ===");

  const reviewPath = join(
    __dirname,
    "memory-workspace-s01-stage-a-adapter-review-kiro-sot-reviewer.json",
  );
  const review = JSON.parse(readFileSync(reviewPath, "utf-8"));

  // Review metadata
  assert.equal(review.schema, "memory-workspace-s01-stage-a-adapter-review/v1");
  assert.equal(review.reviewer, "kiro-sot-reviewer");
  assert.equal(review.decision, "accepted");
  assert.equal(review.prNumber, 834);

  // SA1/SA2/SA3 findings
  assert.equal(review.acceptanceFinding.SA1, "pass");
  assert.equal(review.acceptanceFinding.SA2, "pass");
  assert.equal(review.acceptanceFinding.SA3, "pass");
  assert.equal(review.acceptanceFinding.catalogSoT, "pass");
  assert.equal(review.acceptanceFinding.failClosed, "pass");
  assert.equal(review.acceptanceFinding.unauthorizedLanding, "pass");

  // Catalog SoT verification
  const catalogSoT = review.catalogSoTVerification;
  assert.equal(catalogSoT.status, "verified");
  assert.equal(catalogSoT.uniqueInput, "WorkspaceResourceCatalog typed view");
  assert.equal(catalogSoT.port, "S01CatalogViewPort");
  assert.equal(catalogSoT.forbidIndependentTables, true);
  assert.deepEqual(catalogSoT.independentTablesDeleted, [
    "workspace_handles",
    "authorized_cwds",
    "tenant_memberships",
  ]);
  assert.equal(catalogSoT.forbidCatalogTableField, true);
  assert.equal(catalogSoT.forbidCreateOnMiss, true);
  assert.equal(catalogSoT.lockTestPresent, true);
  assert.equal(catalogSoT.r6ScriptPassed, true);
  assert.equal(catalogSoT.violationCount, 0);

  // Fail-closed verification
  const failClosed = review.failClosedVerification;
  assert.equal(failClosed.status, "verified");
  assert.equal(failClosed.identityResolverTriggers.length, 5);
  assert.ok(failClosed.identityResolverTriggers.includes("catalog-miss"));
  assert.ok(failClosed.identityResolverTriggers.includes("tenant-mismatch"));
  assert.equal(failClosed.cwdAdapterTriggers.length, 10);
  assert.ok(failClosed.cwdAdapterTriggers.includes("duplicate-canonical-binding"));
  assert.ok(failClosed.cwdAdapterTriggers.includes("membership-missing"));
  assert.ok(failClosed.cwdAdapterTriggers.includes("stale-fencing"));
  assert.equal(failClosed.returnsNullOnMiss, false);
  assert.equal(failClosed.hasFallbackBehavior, false);
  assert.equal(failClosed.contractTestsPassed, true);
  assert.equal(failClosed.contractTestCount, 30);

  // Unauthorized landing verification
  const pr833 = review.unauthorizedLandingVerification.pr833;
  assert.equal(review.unauthorizedLandingVerification.status, "verified");
  assert.equal(pr833.authorized, false);
  assert.equal(pr833.mergeSha, "7cad685fba613fd36b2d5f295ef2472d42f98d58");
  assert.ok(pr833.reason.includes("before Stage A contract dual-review"));
  assert.equal(pr833.recordedInEvidence, true);
  assert.equal(pr833.testAssertion, true);
  assert.equal(pr833.handoffDeclaration, true);
  assert.equal(pr833.multiLayerProtection, true);

  // Production code isolation
  const isolation = review.productionCodeIsolation;
  assert.equal(isolation.status, "verified");
  assert.equal(isolation.noSrcModifications, true);
  assert.equal(isolation.noGetReplyModifications, true);
  assert.equal(isolation.noMemoryModifications, true);
  assert.equal(isolation.noResolverModifications, true);
  assert.equal(isolation.onlyContractEvidenceTestChanges, true);

  // Test verification
  const tests = review.testVerification;
  assert.equal(tests.evidenceTest.status, "passed");
  assert.ok(tests.evidenceTest.verifies.includes("independent-tables-deleted"));
  assert.ok(tests.evidenceTest.verifies.includes("unauthorized-landing-recorded"));
  assert.equal(tests.contractTest.status, "passed");
  assert.equal(tests.contractTest.testCount, 30);
  assert.equal(tests.r6SingleSoT.status, "passed");
  assert.equal(tests.r6SingleSoT.violationCount, 0);

  // State verification - CRITICAL GATES
  const state = review.stateVerification;
  assert.equal(state.implementationAuthorized, false);
  assert.equal(state.stageAImplementation, "blocked");
  assert.equal(state.scan.remaining, 10);
  assert.equal(state.scan.liveWriteWatchIndex, 10);
  assert.equal(state.scan.unchanged, true);
  assert.equal(state.item7, "not-met");
  assert.equal(state.phase1b, "blocked");
  assert.equal(state.productionCatalogWrite, "none");
  assert.equal(state.deployAuthorized, false);
  assert.equal(state.i3Executed, false);
  assert.equal(state.liveDeployment, "forbidden");

  // Unique SoT reference
  const sot = review.uniqueSoTReference;
  assert.equal(sot.status, "verified");
  assert.equal(
    sot.canonicalHandoffDoc,
    ".kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md",
  );
  assert.equal(sot.thisIsNotSecondSpec, true);

  // Findings and conclusion
  assert.ok(review.findings.length >= 9);
  assert.ok(review.findings.some((f) => f.includes("SA1")));
  assert.ok(review.findings.some((f) => f.includes("SA2")));
  assert.ok(review.findings.some((f) => f.includes("SA3")));
  assert.ok(review.findings.some((f) => f.includes("Catalog SoT")));
  assert.ok(review.findings.some((f) => f.includes("Fail-closed")));
  assert.ok(review.findings.some((f) => f.includes("#833")));
  assert.ok(review.conclusion.includes("ACCEPTED"));
  assert.equal(review.blockers.length, 0);

  // Next steps verification
  assert.ok(review.nextSteps.length >= 4);
  assert.ok(review.nextSteps.some((s) => s.includes("codex-architecture")));
  assert.ok(review.nextSteps.some((s) => s.includes("dual-review acceptance")));

  console.log("✓ kiro-sot-reviewer review: SA1/SA2/SA3 pass");
  console.log("✓ Catalog SoT: WorkspaceResourceCatalog typed view only");
  console.log("✓ Fail-closed: 15 triggers, no null/fallback");
  console.log("✓ #833 unauthorized: authorized=false, multi-layer protection");
  console.log("✓ Production isolation: no src/ modifications");
  console.log("✓ State gates: implementationAuthorized=false, scan=10/10");
  console.log("✓ All tests passed (Evidence 1/1, Contract 30/30, R6 0 violations)");
  console.log(
    "Status: kiro-sot-reviewer ACCEPTED; waiting for codex-architecture independent review",
  );
});
