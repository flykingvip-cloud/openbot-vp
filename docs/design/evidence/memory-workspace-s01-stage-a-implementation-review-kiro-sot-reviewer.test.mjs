import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

void test("kiro-sot-reviewer Stage A implementation review pass 2", async () => {
  console.log("=== kiro-sot-reviewer Stage A implementation review pass 2 ===");

  const reviewPath = join(
    __dirname,
    "memory-workspace-s01-stage-a-implementation-review-kiro-sot-reviewer.json",
  );
  const review = JSON.parse(readFileSync(reviewPath, "utf-8"));
  const cwdSrc = readFileSync(
    join(repoRoot, "src/gateway/data-governance/s01-authorized-tool-cwd.ts"),
    "utf-8",
  );
  const identitySrc = readFileSync(
    join(repoRoot, "src/gateway/data-governance/s01-steward-workspace-identity.ts"),
    "utf-8",
  );
  const getReply = readFileSync(join(repoRoot, "src/auto-reply/reply/get-reply.ts"), "utf-8");
  const getReplyLines = getReply.split("\n");
  const scan = JSON.parse(
    readFileSync(
      join(repoRoot, "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json"),
      "utf-8",
    ),
  );

  assert.equal(review.schema, "memory-workspace-s01-stage-a-implementation-review/v1");
  assert.equal(review.reviewer, "kiro-sot-reviewer");
  assert.equal(review.decision, "accepted");
  assert.equal(review.stageAAdapterImplementation, "accepted");
  assert.equal(review.reviewPass, 2);
  assert.equal(review.targetPR, 844);
  assert.equal(review.originMain, "e5134c6ee49db6752b34dbeb699b4bf430390452");
  assert.equal(review.ia1, "closed");
  assert.equal(review.ia2, "closed");
  assert.equal(review.scope, "s01-stage-a-adapter-implementation");
  assert.equal(review.selfAccepted, false);
  assert.equal(review.signedAsKiroSotReviewer, true);
  assert.equal(review.fillsCodexArchitecture, false);

  assert.equal(review.authorizesStageAImplementation, true);
  assert.equal(review.authorizesStageAAccept, false);
  assert.equal(review.authorizesStageB, false);
  assert.equal(review.flipsImplementationGate, false);

  assert.equal(review.implementationFiles.length, 4);
  assert.ok(
    review.implementationFiles.some((f) => f.path.includes("s01-steward-workspace-identity.ts")),
  );
  assert.ok(review.implementationFiles.some((f) => f.path.includes("s01-authorized-tool-cwd.ts")));

  const checks = review.verificationChecks;
  assert.equal(checks.targetIdentityNotNull.status, "pass");
  assert.ok(checks.targetIdentityNotNull.finding.includes("IR1"));
  assert.ok(checks.targetIdentityNotNull.finding.includes("expectedBindingRole=canonical"));
  assert.ok(checks.targetIdentityNotNull.finding.includes("fencingToken"));

  assert.equal(checks.elevenUniqueHandoffErrorCodes.status, "pass");
  assert.equal(checks.elevenUniqueHandoffErrorCodes.errorCodes.length, 11);
  assert.ok(checks.elevenUniqueHandoffErrorCodes.errorCodes.includes("ERR_PRINCIPAL_REQUIRED"));
  assert.ok(checks.elevenUniqueHandoffErrorCodes.errorCodes.includes("ERR_WORKSPACE_ARCHIVED"));
  assert.ok(checks.elevenUniqueHandoffErrorCodes.errorCodes.includes("ERR_CATALOG_UNAVAILABLE"));

  assert.equal(checks.catalogOnlyNoIndependentTables.status, "pass");
  assert.ok(checks.catalogOnlyNoIndependentTables.finding.includes("WorkspaceResourceCatalog"));

  assert.equal(checks.membershipPortNotArray.status, "pass");
  assert.ok(checks.membershipPortNotArray.finding.includes("S01MembershipPort"));

  assert.equal(checks.staleFencingMapsErrWorkspaceArchived.status, "pass");
  assert.ok(checks.staleFencingMapsErrWorkspaceArchived.finding.includes("IA1 closed"));
  assert.ok(checks.staleFencingMapsErrWorkspaceArchived.finding.includes("ERR_WORKSPACE_ARCHIVED"));

  assert.equal(checks.uniqueCanonicalActiveBinding.status, "pass");
  assert.ok(checks.uniqueCanonicalActiveBinding.finding.includes("IA2 closed"));
  assert.ok(checks.uniqueCanonicalActiveBinding.finding.includes("ERR_BINDING_NOT_CANONICAL"));

  assert.equal(checks.pathEscapeAndSymlinkDenied.status, "pass");
  assert.ok(checks.pathEscapeAndSymlinkDenied.finding.includes("traversal"));
  assert.ok(checks.pathEscapeAndSymlinkDenied.finding.includes("symlink"));

  assert.equal(checks.getReplyUnwired.status, "pass");
  assert.ok(checks.getReplyUnwired.finding.includes("get-reply.ts:164"));
  assert.ok(checks.getReplyUnwired.finding.includes("zero references"));

  assert.equal(checks.scanRemaining10.status, "pass");
  assert.ok(checks.scanRemaining10.finding.includes("remaining=10"));
  assert.ok(checks.scanRemaining10.finding.includes("liveWriteWatchIndex=10"));

  assert.match(cwdSrc, /target\.governanceVersion/);
  assert.match(cwdSrc, /target\.fencingToken/);
  assert.match(identitySrc, /expectedBindingState: "active";/);
  assert.doesNotMatch(identitySrc, /expectedBindingState: "active" \| "read_only"/);
  assert.match(getReplyLines[163] ?? "", /resolveEmployeeBuiltinStewardWorkspaceDir/);
  assert.doesNotMatch(getReply, /evaluateS01AuthorizedToolCwd/);
  assert.doesNotMatch(getReply, /resolveS01StewardWorkspaceIdentity/);
  assert.equal(scan.remaining, 10);
  assert.equal(scan.liveWriteWatchIndex, 10);

  assert.equal(review.testCoverage.identityResolverTests, 11);
  assert.equal(review.testCoverage.cwdAdapterTests, 16);
  assert.equal(review.testCoverage.totalTests, 27);
  assert.equal(review.testCoverage.allTestsPassed, true);
  assert.ok(review.testCoverage.coverageAreas.length >= 16);

  assert.ok(review.findings.length >= 9);
  assert.ok(review.findings.every((f) => f.startsWith("✅")));
  assert.ok(review.findings.some((f) => f.includes("IA1 closed")));
  assert.ok(review.findings.some((f) => f.includes("IA2 closed")));
  assert.ok(review.findings.some((f) => f.includes("Stage A Adapter Implementation accepted")));

  assert.equal(review.blockers.length, 3);
  assert.ok(review.blockers.every((b) => b.severity === "critical"));
  assert.ok(
    review.blockers.some((b) => b.id === "IMPL-2" && b.category === "production-authorization"),
  );
  assert.ok(review.blockers.some((b) => b.id === "IMPL-3" && b.category === "stage-sequence"));
  assert.ok(review.blockers.some((b) => b.id === "IMPL-4" && b.category === "accept-packet"));

  const locks = review.locks;
  assert.equal(locks.implementationGate, "not-met");
  assert.equal(locks.implementationVerified, false);
  assert.equal(locks.stageAImplementation, "accepted");
  assert.equal(locks.stageB, "locked");
  assert.equal(locks.remaining, 10);
  assert.equal(locks.liveWriteWatchIndex, 10);
  assert.equal(locks.item7, "not-met");
  assert.equal(locks.s01Retirement, "blocked");
  assert.equal(locks.phase1b, "blocked");
  assert.equal(locks.deployAuthorized, false);
  assert.equal(locks.i3, "not executed");
  assert.equal(locks.liveDeployment, "forbidden");

  assert.ok(review.conclusion.includes("accepted"));
  assert.ok(review.conclusion.includes("IA1 closed"));
  assert.ok(review.conclusion.includes("IA2 closed"));
  assert.ok(!review.conclusion.includes("CHANGES REQUIRED"));

  assert.ok(review.nextSteps.length >= 4);
  assert.ok(review.nextSteps.some((s) => s.includes("codex-architecture")));
  assert.ok(review.nextSteps.some((s) => s.includes("Implementation Accept")));

  console.log("✓ Implementation review pass 2: decision=accepted");
  console.log("✓ IA1 closed: targetIdentity versions/fencing required");
  console.log("✓ IA2 closed: expectedBindingState=active only");
  console.log("✓ Stage A Adapter Implementation accepted");
  console.log("✓ Isolation: get-reply unwired, scan 10/10");
  console.log("✓ Tests: 27/27 (11 identity + 16 cwd)");
  console.log("✓ Locks: implementationVerified=false, deployAuthorized=false, Stage B=locked");
  console.log("Status: Stage A implementation accepted; Accept packet not this sidecar");
});
