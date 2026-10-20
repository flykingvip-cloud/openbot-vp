#!/usr/bin/env node
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
/**
 * S01 D1-D5 kiro-sot-reviewer sidecar evidence test
 *
 * Verifies:
 * - sidecar is accepted
 * - D1-D5 all pass
 * - locks unchanged (remaining=10, liveWriteWatchIndex=10, implementationGate=not-met)
 * - does not authorize S01 retirement, production Catalog write, I3, Phase 1B, LIVE
 */
import { test } from "node:test";

const repoRoot = join(import.meta.dirname, "../../..");
const sidecarPath = join(
  repoRoot,
  "docs/design/evidence/memory-workspace-s01-d1d5-design-review-kiro-sot-reviewer.json",
);

void test("S01 D1-D5 kiro-sot-reviewer design review sidecar", () => {
  const sidecar = JSON.parse(readFileSync(sidecarPath, "utf-8"));

  console.log("=== S01 D1-D5 kiro-sot-reviewer design review sidecar ===");

  // schema and reviewer
  assert.equal(sidecar.schema, "memory-workspace-s01-d1d5-design-review/v2");
  assert.equal(sidecar.reviewer, "kiro-sot-reviewer");
  assert.equal(sidecar.signedBy, "kiro-sot-reviewer");

  // decision and scope
  assert.equal(sidecar.decision, "accepted");
  assert.equal(sidecar.scope, "d1-d5-design-only-independent-sot-governance");

  // D1-D5 verdict
  assert.equal(sidecar.verdict.D1, "pass");
  assert.equal(sidecar.verdict.D2, "pass");
  assert.equal(sidecar.verdict.D3, "pass");
  assert.equal(sidecar.verdict.D4, "pass");
  assert.equal(sidecar.verdict.D5, "pass");

  // D1-D5 detailed status
  assert.equal(sidecar.d1TrustedPrincipal.status, "pass");
  assert.equal(sidecar.d2WorkspaceHandle.status, "pass");
  assert.equal(sidecar.d3CatalogSot.status, "pass");
  assert.equal(sidecar.d4ResolverInterface.status, "pass");
  assert.equal(sidecar.d5TestsAndRegression.status, "pass");

  // D5 test coverage verification
  const d5Coverage = sidecar.d5TestsAndRegression.testCoverage;
  assert.equal(d5Coverage.forgedPrincipal, true);
  assert.equal(d5Coverage.expiredPrincipal, true);
  assert.equal(d5Coverage.unkeyedHmac, true);
  assert.equal(d5Coverage.selfComparedHmac, true);
  assert.equal(d5Coverage.wireIdentityInjection, true);
  assert.equal(d5Coverage.sourceProofHmac, true);
  assert.equal(d5Coverage.injectedMembership, true);
  assert.equal(d5Coverage.sameTenantOtherOwner, true);
  assert.equal(d5Coverage.seatGroupMembership, true);
  assert.equal(d5Coverage.retiredRevokedHandle, true);
  assert.equal(d5Coverage.staleFencing, true);
  assert.equal(d5Coverage.duplicateCanonical, true);
  assert.equal(d5Coverage.compatibilityOnlyBinding, true);
  assert.equal(d5Coverage.pathTraversal, true);
  assert.equal(d5Coverage.outsideWorkspace, true);
  assert.equal(d5Coverage.catalogUnavailable, true);
  assert.equal(d5Coverage.twoWorkspaceIntegration, true);
  assert.equal(d5Coverage.productionCallerFreeze, true);
  assert.equal(d5Coverage.p99InMemorySla, true);

  // checks run verification
  assert.equal(sidecar.checksRun.contractTest.result, "pass");
  assert.equal(sidecar.checksRun.contractTest.cases, 21);
  assert.equal(sidecar.checksRun.contractTest.allPass, true);
  assert.equal(sidecar.checksRun.gateEvidenceTest.result, "pass");
  assert.equal(sidecar.checksRun.architectureSidecarTest.result, "pass");
  assert.equal(sidecar.checksRun.r6SingleSotCheck.result, "pass");
  assert.equal(sidecar.checksRun.r6SingleSotCheck.designComplete, true);
  assert.equal(sidecar.checksRun.r6SingleSotCheck.implementationVerified, false);

  // CRITICAL: locks unchanged
  assert.equal(sidecar.locks.productionCatalogWrite, "none");
  assert.equal(sidecar.locks.s01Retirement, "blocked");
  assert.equal(sidecar.locks.item7, "not-met");
  assert.equal(sidecar.locks.phase1b, "blocked");
  assert.equal(sidecar.locks.i3, "not executed");
  assert.equal(sidecar.locks.live, "forbidden");
  assert.equal(sidecar.locks.deployAuthorized, false);
  assert.equal(sidecar.locks.implementationGate, "not-met");
  assert.equal(sidecar.locks.remaining, 10);
  assert.equal(sidecar.locks.liveWriteWatchIndex, 10);

  // production observation
  assert.equal(sidecar.productionObservation.getReplyStillUsesStewardHelper, true);
  assert.equal(sidecar.productionObservation.evaluateS01AuthorizedToolCwdImportedBySrc, false);
  assert.equal(sidecar.productionObservation.secondMemoryWorkspaceHandleProductionEntry, false);
  assert.equal(sidecar.productionObservation.srcMemoryUntouched, true);
  assert.equal(sidecar.productionObservation.currentProductionExploitability, "none-not-wired");

  // does not authorize
  assert.ok(
    sidecar.doesNotAuthorize.includes("S01 retirement"),
    "must not authorize S01 retirement",
  );
  assert.ok(
    sidecar.doesNotAuthorize.includes("implementation wiring"),
    "must not authorize implementation wiring",
  );
  assert.ok(
    sidecar.doesNotAuthorize.includes("production Catalog write"),
    "must not authorize production Catalog write",
  );
  assert.ok(
    sidecar.doesNotAuthorize.includes("Phase 1B unlock"),
    "must not authorize Phase 1B unlock",
  );
  assert.ok(sidecar.doesNotAuthorize.includes("I3"), "must not authorize I3");
  assert.ok(sidecar.doesNotAuthorize.includes("LIVE"), "must not authorize LIVE");

  // explicitly forbidden
  assert.ok(
    sidecar.explicitlyForbidden.includes("modify src/auto-reply/reply/get-reply.ts"),
    "get-reply modification forbidden",
  );
  assert.ok(
    sidecar.explicitlyForbidden.includes("modify src/memory/**"),
    "src/memory modification forbidden",
  );
  assert.ok(
    sidecar.explicitlyForbidden.includes("modify src/gateway/workspace-resolver/**"),
    "workspace-resolver modification forbidden",
  );
  assert.ok(
    sidecar.explicitlyForbidden.includes("write production Catalog"),
    "production Catalog write forbidden",
  );
  assert.ok(sidecar.explicitlyForbidden.includes("execute I3"), "I3 execution forbidden");
  assert.ok(
    sidecar.explicitlyForbidden.includes("issue Phase 1B unlock"),
    "Phase 1B unlock forbidden",
  );
  assert.ok(
    sidecar.explicitlyForbidden.includes("set deployAuthorized=true"),
    "deployAuthorized=true forbidden",
  );
  assert.ok(
    sidecar.explicitlyForbidden.includes("any LIVE or production deployment"),
    "LIVE deployment forbidden",
  );

  console.log("✓ sidecar is accepted (pass 1); D1-D5 all pass; locks unchanged");
  console.log(
    "Status: S01 retirement blocked; Item 7 not-met; Phase 1B blocked; I3 not executed; LIVE forbidden",
  );
});
