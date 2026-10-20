#!/usr/bin/env node --no-warnings
/**
 * Evidence test: S01 Stage A adapter contract remediation.
 *
 * Locks SA1/SA2/SA3. Does not authorize Stage A implementation, wire
 * get-reply, write Catalog, or accept the #833 landing.
 */

import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

const evidencePath = join(__dirname, "memory-workspace-s01-stage-a-adapter.json");
const evidence = JSON.parse(readFileSync(evidencePath, "utf-8"));
const evidenceText = readFileSync(evidencePath, "utf-8");
const handoff = readFileSync(join(repoRoot, evidence.stageAHandoffDoc), "utf-8");
const reviewRequest = readFileSync(
  join(
    repoRoot,
    ".kiro/specs/memory-workspace-platform-remediation/s01-stage-a-adapter-review-request.md",
  ),
  "utf-8",
);
const scan = JSON.parse(
  readFileSync(
    join(repoRoot, "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json"),
    "utf-8",
  ),
);
const getReply = readFileSync(join(repoRoot, "src/auto-reply/reply/get-reply.ts"), "utf-8");
const getReplyLines = getReply.split("\n");
const contract = readFileSync(
  join(repoRoot, "docs/design/contracts/s01-trusted-principal-handle-contract.ts"),
  "utf-8",
);

console.log("=== S01 Stage A adapter contract remediation ===\n");

assert.equal(evidence.status, "stage-a-contract-resubmitted");
assert.equal(evidence.implementationAuthorized, false);
assert.equal(evidence.selfAccepted, false);
assert.equal(evidence.thisPacketCreatesProductionFiles, false);
assert.equal(evidence.thisPacketWiresGetReply, false);
assert.equal(evidence.thisPacketModifiesProductionAdapters, false);
assert.equal(evidence.owner, "cursor-data-governance");
assert.equal(
  evidence.taskId,
  "memory-workspace-platform-remediation:cursor-data-governance-s01-stage-a-adapter",
);
assert.equal(evidence.previousAcceptance.decision, "changes-required");
assert.equal(evidence.unauthorizedImplementationLanding.authorized, false);
assert.equal(evidence.unauthorizedImplementationLanding.pr, 833);

assert.equal(evidence.catalogSoT.uniqueInput, "WorkspaceResourceCatalog typed view");
assert.equal(evidence.catalogSoT.port, "S01CatalogViewPort");
assert.equal(evidence.catalogSoT.forbidCatalogTableField, true);
assert.deepEqual(evidence.catalogSoT.forbidIndependentTables, [
  "workspace_handles",
  "authorized_cwds",
  "tenant_memberships",
]);
assert.equal(
  evidence.adapterContracts.resolveStewardWorkspaceIdentity.catalogInput.includes("typed view"),
  true,
);
assert.equal(
  evidence.adapterContracts.evaluateS01AuthorizedToolCwd.catalogInput.includes("typed view"),
  true,
);

function collectCatalogTables(value, found = []) {
  if (value && typeof value === "object") {
    if (Object.hasOwn(value, "catalogTable")) {
      found.push(value.catalogTable);
    }
    for (const child of Object.values(value)) {
      collectCatalogTables(child, found);
    }
  }
  return found;
}
assert.deepEqual(collectCatalogTables(evidence), [], "catalogTable must be removed from evidence");
assert.doesNotMatch(evidenceText, /"catalogTable"\s*:/);
for (const packet of [handoff, reviewRequest]) {
  assert.doesNotMatch(packet, /catalogTable\s*:/);
  assert.doesNotMatch(packet, /FROM workspace_handles/);
  assert.doesNotMatch(packet, /FROM authorized_cwds/);
  assert.doesNotMatch(packet, /查询 Catalog `workspace_handles` 表/);
  assert.doesNotMatch(packet, /查询 Catalog `authorized_cwds` 表/);
}
assert.match(handoff, /WorkspaceResourceCatalog/);
assert.match(handoff, /S01CatalogViewPort/);
assert.match(reviewRequest, /WorkspaceResourceCatalog|Catalog 唯一 SoT/);
assert.match(contract, /workspace_handles/);
assert.match(contract, /S01_INDEPENDENT_CATALOG_TABLES/);

const cwd = evidence.adapterContracts.evaluateS01AuthorizedToolCwd;
assert.ok(
  !evidence.adapterContracts.resolveAuthorizedToolCwd,
  "old resolveAuthorizedToolCwd key must be gone",
);
assert.match(
  cwd.forbidsSimplifiedSignature,
  /async function\(handle: WorkspaceHandle, toolName: string\): Promise<string>/,
);
assert.doesNotMatch(
  handoff,
  /export async function resolveAuthorizedToolCwd\(\s*handle: WorkspaceHandle,\s*toolName: string,\s*\): Promise<string>/s,
);
assert.match(handoff, /TrustedPrincipal/);
assert.match(handoff, /workspaceResourceId/);
assert.match(handoff, /S01PlatformAuthMembershipPort/);
assert.match(handoff, /expectedFencing|contentVersion/);
for (const required of [
  "principal: TrustedPrincipal",
  "catalog: S01CatalogViewPort",
  "memberships: S01PlatformAuthMembershipPort",
  "targetResourceId: workspaceResourceId",
  "expectedFencing / contentVersion",
]) {
  assert.ok(cwd.requiredInputs.includes(required), `missing input ${required}`);
}

const identity = evidence.targetIdentity;
assert.equal(identity.notNull, true);
assert.equal(identity.workspaceResourceId, true);
assert.equal(identity.agentAssetId, true);
assert.equal(evidence.adapterContracts.resolveStewardWorkspaceIdentity.returnsNullOnMiss, false);
assert.equal(
  evidence.adapterContracts.resolveStewardWorkspaceIdentity.identitySignatureIncludesCatalogPort,
  true,
);
assert.equal(
  evidence.adapterContracts.resolveStewardWorkspaceIdentity.identitySignatureIncludesRegistryPort,
  true,
);
assert.equal(
  evidence.adapterContracts.resolveStewardWorkspaceIdentity.targetIdentityCompleteVsIr1,
  true,
);
assert.match(
  evidence.adapterContracts.resolveStewardWorkspaceIdentity.signature,
  /catalog:\s*S01CatalogViewPort/,
);
assert.match(
  evidence.adapterContracts.resolveStewardWorkspaceIdentity.signature,
  /registry:\s*S01StewardRegistryPort/,
);
assert.match(
  evidence.adapterContracts.resolveStewardWorkspaceIdentity.signature,
  /expectedFencing/,
);
assert.deepEqual(evidence.adapterContracts.resolveStewardWorkspaceIdentity.requiredIdentityFields, [
  "tenantId",
  "employeeOwnerId",
  "agentAssetId",
  "workspaceResourceId",
  "expectedBindingRole",
  "expectedBindingState",
  "governanceVersion",
  "contentVersion",
  "fencingToken",
]);
assert.equal(identity.expectedBindingRole, "canonical");
assert.equal(identity.expectedBindingState, "active");
assert.equal(identity.governanceVersion, true);
assert.equal(identity.contentVersion, true);
assert.equal(identity.fencingToken, true);
assert.match(handoff, /expectedBindingRole:\s*"canonical"/);
assert.match(handoff, /expectedBindingState:\s*"active"/);
assert.match(handoff, /fencingToken:/);
assert.match(handoff, /catalog:\s*S01CatalogViewPort/);
assert.match(handoff, /registry:\s*S01StewardRegistryPort/);
assert.match(handoff, /expectedFencing\?:/);
assert.match(handoff, /\|\s*SA4\s*\|/);
assert.doesNotMatch(
  handoff,
  /function resolveStewardWorkspaceIdentity\(input: \{\s*tenantId: string;\s*userId: string; \/\/ employeeOwnerId\s*agentId: string; \/\/ slug only\s*\}\): S01StewardTargetIdentity/s,
);

for (const trigger of [
  "catalog-miss",
  "duplicate-canonical-binding",
  "tenant-mismatch",
  "membership-missing",
  "stale-fencing",
]) {
  assert.ok(cwd.failClosedTriggers.includes(trigger), `missing fail-closed ${trigger}`);
}
for (const trigger of [
  "registry-miss",
  "catalog-miss",
  "duplicate-canonical-binding",
  "stale-fencing",
]) {
  assert.ok(
    evidence.adapterContracts.resolveStewardWorkspaceIdentity.failClosedTriggers.includes(trigger),
    `identity missing fail-closed ${trigger}`,
  );
}

assert.equal(evidence.currentStatus.stageAImplementation, "blocked");
assert.equal(evidence.currentStatus.s01Retirement, "blocked");
assert.equal(evidence.currentStatus.item7, "not-met");
assert.equal(evidence.currentStatus.phase1b, "blocked");
assert.equal(evidence.currentStatus.productionCatalogWrite, "none");
assert.equal(evidence.currentStatus.deployAuthorized, false);
assert.equal(evidence.currentStatus.i3Executed, false);
assert.equal(evidence.currentStatus.liveDeployment, "forbidden");
assert.equal(evidence.currentStatus.remaining, 10);
assert.equal(evidence.currentStatus.liveWriteWatchIndex, 10);
assert.equal(scan.remaining, 10);
assert.equal(scan.liveWriteWatchIndex, 10);

assert.match(getReplyLines[163] ?? "", /resolveEmployeeBuiltinStewardWorkspaceDir/);
assert.doesNotMatch(getReply, /evaluateS01AuthorizedToolCwd/);
assert.doesNotMatch(getReply, /resolveS01StewardWorkspaceIdentity/);

const simplifiedSignature =
  /export async function resolveAuthorizedToolCwd\(\s*handle:\s*WorkspaceHandle,\s*toolName:\s*string/;
const independentTableSql =
  /CREATE\s+TABLE[\s\S]{0,80}(workspace_handles|authorized_cwds|tenant_memberships)/i;
for (const file of evidence.productionFiles) {
  const abs = join(repoRoot, file);
  if (!existsSync(abs)) {
    continue;
  }
  const source = readFileSync(abs, "utf-8");
  assert.doesNotMatch(source, /catalogTable\s*:/);
  assert.doesNotMatch(source, independentTableSql);
  assert.doesNotMatch(source, simplifiedSignature);
  assert.doesNotMatch(source, /FROM workspace_handles/);
  assert.doesNotMatch(source, /FROM authorized_cwds/);
}

assert.ok(evidence.strictlyForbidden.includes("catalogTable-workspace_handles"));
assert.ok(evidence.strictlyForbidden.includes("catalogTable-authorized_cwds"));
assert.ok(evidence.strictlyForbidden.includes("simplified-cwd-signature"));
assert.ok(evidence.strictlyForbidden.includes("start-stage-a-implementation-before-dual-review"));
assert.ok(evidence.strictlyForbidden.includes("accept-stage-a-implementation-before-dual-review"));
assert.equal(evidence.stageSequence.notCatalogSchemaDeployment, true);
assert.deepEqual(evidence.reviewRequest.reviewers, ["codex-architecture", "kiro-sot-reviewer"]);
assert.equal(evidence.reviewRequest.selfAccepted, false);

console.log(
  "✓ Stage A contract remediated; independent tables and simplified signature forbidden\n",
);
console.log("Status: stage-a-contract-resubmitted; Stage A implementation blocked; scan 10/10");
