import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-provision-steward-cutover-workspace.json",
);
const scanPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
);
const modulePath = path.join(root, "src/gateway/workspace-resolver/provision-steward-cutover.ts");
const stewardWritePath = path.join(root, "src/gateway/workspace-resolver/steward-write.ts");
// Baseline this change is built on (origin/main tip a327d71819, #677 merge).
const BASELINE = "a327d71819b16d0d33e94376cad45ef1d45ec158";

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

void test("provision command packet: implementation only, retires nothing, baseline stays 12", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));

  assert.equal(packet.changeKind, "implementation");
  assert.equal(packet.command, "provisionEmployeeStewardCutoverWorkspace");
  assert.equal(
    packet.reviewRequest,
    "provision-command-implementation-independent-acceptance-review-only",
  );
  assert.equal(packet.reviewRequestIsRetirementOrAccept, false);

  // 10-point contract recorded.
  assert.equal(Array.isArray(packet.contract), true);
  assert.equal(packet.contract.length, 10);
  assert.equal(packet.contractPoints, 10);

  // Scope boundaries: add command + tests only; no wiring, no retirement, no scan change.
  assert.equal(packet.scopeBoundaries.addsCommandAndTestsOnly, true);
  assert.equal(packet.scopeBoundaries.wiresPilotToCommand, false);
  assert.equal(packet.scopeBoundaries.modifiesS26S27CallSites, false);
  assert.equal(packet.scopeBoundaries.retiresAnySite, false);
  assert.equal(packet.scopeBoundaries.modifiesRetirementScan, false);
  assert.equal(packet.scopeBoundaries.persistsToProductionCatalog, false);
  assert.equal(packet.scopeBoundaries.callsFrozenHostPathResolvers, false);

  // Invariants (incl. freeze-safe placement-as-input).
  assert.equal(packet.invariants.catalogBeforeFilesystem, true);
  assert.equal(packet.invariants.noHostFallback, true);
  assert.equal(packet.invariants.noProductionCatalogWrite, true);
  assert.equal(packet.invariants.singleWritableCanonicalSource, true);
  assert.equal(packet.invariants.singleCompatibilityReadOnlyTarget, true);
  assert.equal(packet.invariants.placementIsTrustedInput, true);
  assert.equal(packet.invariants.addsNoFrozenPhase0CallSites, true);
  assert.equal(packet.failClosedReasons.includes("missing_placement"), true);

  // No retirement / baseline preserved / locks.
  assert.equal(packet.retiredThisChange, 0);
  assert.equal(packet.previousAcceptedBaseline, 12);
  assert.equal(packet.remaining, 12);
  assert.equal(packet.liveWriteWatchIndex, 12);
  assert.equal(packet.proposedRemaining, 12);
  assert.equal(packet.S26Retired, false);
  assert.equal(packet.S27Retired, false);
  assert.equal(packet.scanModified, false);
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.phase1bUnlock, "not-issued");
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.live, "forbidden");
  assert.equal(packet.productionCatalogWrite, "none");
  assert.equal(packet.schemaV2ProductionWrite, false);
  assert.equal(packet.absorbsUnacceptedBatches, false);
  assert.equal(packet.stageCStarted, false);
  assert.equal(packet.stageDStarted, false);
  assert.equal(packet.originMainSha, BASELINE);
});

void test("the command module exists and exports the provisioning function (static imports only)", () => {
  const src = fs.readFileSync(modulePath, "utf8");
  assert.match(src, /export function provisionEmployeeStewardCutoverWorkspace\(/);
  // Catalog-first, fail-closed guardrails present in source.
  assert.match(src, /recovery: "recovery_required"/);
  assert.match(src, /assertSingleWritableCanonicalBinding/);
  // No dynamic import() — avoids [INEFFECTIVE_DYNAMIC_IMPORT] and the dynamic-import guardrail.
  assert.doesNotMatch(src, /\bimport\(/);
  // Freeze-safe: placement is a trusted input; the command never calls the frozen host-path resolvers.
  assert.match(src, /sourceRoot: string/);
  assert.match(src, /targetRoot: string/);
  assert.doesNotMatch(src, /resolveEmployeeStewardSourceWorkspaceDir\(/);
  assert.doesNotMatch(src, /resolveEmployeeStewardTargetWorkspaceDir\(/);
});

void test("S26/S27 pilot call sites are unchanged and remain in the live scan", () => {
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  assert.equal(scan.remaining, 12);
  assert.equal(scan.sites.length, 12);
  assert.equal(scan.liveWriteWatchIndex, 12);
  assert.equal(scan.frozenWriteWatchIndex, 38);
  assert.equal(
    scan.sites.some(
      (s) =>
        s.file === "src/gateway/workspace-resolver/steward-write.ts" &&
        s.line === 279 &&
        s.symbol === "resolveEmployeeStewardSourceWorkspaceDir",
    ),
    true,
    "S26 must remain in the live scan",
  );
  assert.equal(
    scan.sites.some(
      (s) =>
        s.file === "src/gateway/workspace-resolver/steward-write.ts" &&
        s.line === 280 &&
        s.symbol === "resolveEmployeeStewardTargetWorkspaceDir",
    ),
    true,
    "S27 must remain in the live scan",
  );

  // The pilot source still calls the host-root resolvers at 279/280 (not retired by this change).
  const lines = fs.readFileSync(stewardWritePath, "utf8").split("\n");
  assert.match(
    lines[278] ?? "",
    /resolveEmployeeStewardSourceWorkspaceDir\(userId, params\.stateDir\)/,
  );
  assert.match(lines[279] ?? "", /resolveEmployeeStewardTargetWorkspaceDir\(\{/);

  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
});
