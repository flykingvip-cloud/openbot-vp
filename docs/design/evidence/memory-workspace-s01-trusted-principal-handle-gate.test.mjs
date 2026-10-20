#!/usr/bin/env node --no-warnings
/**
 * Evidence test: S01 trusted principal / Workspace Handle unique-handoff unify
 *
 * Design-only. Does not retire S01. Does not write production Catalog.
 */

import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

const evidencePath = join(__dirname, "memory-workspace-s01-trusted-principal-handle-gate.json");
const evidence = JSON.parse(readFileSync(evidencePath, "utf-8"));
const uniqueHandoffPath = join(repoRoot, evidence.canonicalHandoffDoc);
const uniqueHandoff = readFileSync(uniqueHandoffPath, "utf-8");
const stubPath = join(repoRoot, evidence.duplicateDocsDesignHandoff.path);
const stub = readFileSync(stubPath, "utf-8");
const scanPath = join(
  repoRoot,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
);
const scan = JSON.parse(readFileSync(scanPath, "utf-8"));
const getReply = readFileSync(join(repoRoot, "src/auto-reply/reply/get-reply.ts"), "utf-8");

console.log("=== S01 unique handoff Catalog SoT evidence test ===\n");

console.log("Test 1: unique handoff identity");
assert.strictEqual(evidence.uniqueHandoff, true);
assert.strictEqual(evidence.designOnly, true);
assert.strictEqual(evidence.thisPrIsNotS01RetirementAccepted, true);
assert.strictEqual(evidence.thisPrIsNotProductionDeploy, true);
assert.strictEqual(
  evidence.canonicalHandoffDoc,
  ".kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md",
);
assert.match(uniqueHandoff, /唯一 handoff/);
assert.match(uniqueHandoff, /Data Governance Catalog 是唯一 SoT/);
assert.match(uniqueHandoff, /design-delivered-nonprod-contract/);
assert.doesNotMatch(uniqueHandoff, /Catalog 表结构已在 Aliyun RDS 建表/);
console.log("✓ unique handoff is the only spec\n");

console.log("Test 2: duplicate docs/design is deprecated stub");
assert.strictEqual(evidence.duplicateDocsDesignHandoff.status, "deprecated-stub");
assert.strictEqual(evidence.duplicateDocsDesignHandoff.mustNotBeSecondSpec, true);
assert.match(stub, /DEPRECATED/);
assert.match(
  stub,
  /\.kiro\/specs\/memory-workspace-platform-remediation\/handoff-s01-trusted-principal-handle-gate\.md/,
);
assert.doesNotMatch(stub, /workspace_handles \/ authorized_cwds \/ tenant_memberships 表/);
assert.ok(stub.length < uniqueHandoff.length, "stub must not remain a second full spec");
console.log("✓ docs/design copy is a stub\n");

console.log("Test 3: Catalog SoT and typed views");
assert.strictEqual(evidence.catalogSot.uniqueSourceOfTruth, "data-governance-catalog");
assert.strictEqual(evidence.catalogSot.catalogType, "WorkspaceResourceCatalog");
assert.strictEqual(evidence.catalogSot.handle, "typed-view-of-WorkspaceResourceRecord");
assert.strictEqual(
  evidence.catalogSot.membership,
  "constrained-extension-or-readonly-PlatformAuthMembership",
);
assert.strictEqual(
  evidence.catalogSot.authorizedCwd,
  "typed-view-of-WorkspaceBindingRecord.locator",
);
assert.strictEqual(evidence.catalogSot.forbidIndependentCatalogTables, true);
assert.deepStrictEqual(evidence.catalogSot.forbiddenIndependentTables, [
  "workspace_handles",
  "authorized_cwds",
  "tenant_memberships",
]);
assert.deepStrictEqual(evidence.designDeliverables.catalogSchema.tables, []);
assert.match(uniqueHandoff, /typed view/);
assert.match(uniqueHandoff, /禁止独立创建三张 Catalog 表/);
console.log("✓ Handle/membership/CWD are Catalog views; independent tables forbidden\n");

console.log("Test 4: approved non-production adapter; no Aliyun RDS");
assert.strictEqual(evidence.testPolicy.approvedNonProductionAdapterOnly, true);
assert.strictEqual(evidence.testPolicy.defaultAdapter, "InMemoryWorkspaceResourceCatalog");
assert.strictEqual(evidence.testPolicy.forbidDirectAliyunRds, true);
assert.strictEqual(evidence.testPolicy.aliyunRdsDdlIsNotADesignGatePrecondition, true);
assert.match(uniqueHandoff, /禁止直接操作 Aliyun RDS/);
assert.match(uniqueHandoff, /经数据治理 owner 批准的非生产 Catalog adapter/);
assert.ok(
  evidence.productionGuardrails.strictlyForbidden.includes("direct-aliyun-rds-access"),
  "direct Aliyun RDS must be forbidden",
);
assert.ok(
  evidence.productionGuardrails.strictlyForbidden.includes(
    "create-independent-workspace_handles-authorized_cwds-tenant_memberships-tables",
  ),
);
console.log("✓ tests use approved adapter only; Aliyun RDS forbidden\n");

console.log("Test 5: D1-D5 completed; implementation gate still not-met");
for (const [name, deliverable] of Object.entries(evidence.designDeliverables)) {
  assert.strictEqual(deliverable.status, "completed", `Deliverable '${name}' must be completed`);
}
assert.strictEqual(evidence.implementationGate.status, "not-met");
assert.strictEqual(evidence.status, "design-delivered-nonprod-contract");
assert.strictEqual(evidence.reviewRequest.requested, true);
assert.deepStrictEqual(evidence.reviewRequest.reviewers, [
  "kiro-sot-reviewer",
  "codex-architecture",
]);
assert.strictEqual(evidence.reviewRequest.notS01Retirement, true);
assert.strictEqual(evidence.reviewRequest.notLive, true);
const contractPath = join(repoRoot, evidence.references.contractModule);
const contractTestPath = join(repoRoot, evidence.references.contractTest);
const contract = readFileSync(contractPath, "utf-8");
assert.match(contract, /evaluateS01AuthorizedToolCwd/);
assert.match(contract, /S01CatalogViewPort/);
assert.match(contract, /S01ServerSourceContext/);
assert.match(contract, /S01PlatformAuthMembershipPort/);
assert.match(contract, /ERR_WORKSPACE_OWNER_DENIED/);
assert.match(contract, /createHmac/);
assert.match(uniqueHandoff, /S01ServerSourceContext/);
assert.match(uniqueHandoff, /ERR_WORKSPACE_OWNER_DENIED/);
assert.doesNotMatch(contract, /createMemoryWorkspaceHandle/);
assert.doesNotMatch(contract, /from ["']\.\/memory-workspace-handle/);
assert.doesNotMatch(contract, /CREATE TABLE workspace_handles/);
assert.doesNotMatch(contract, /Aliyun RDS/);
assert.match(readFileSync(contractTestPath, "utf-8"), /createEmptyWorkspaceCatalog/);
assert.match(readFileSync(contractTestPath, "utf-8"), /InMemoryWorkspaceResourceCatalog/);
assert.ok(
  evidence.references.contractModule.startsWith("docs/design/contracts/"),
  "contract must live in the non-production contracts directory",
);
assert.equal(
  existsSync(
    join(repoRoot, "src/gateway/data-governance/s01-trusted-principal-handle-contract.ts"),
  ),
  false,
  "production src contract module must be removed",
);
assert.equal(
  existsSync(
    join(repoRoot, "src/gateway/data-governance/s01-trusted-principal-handle-contract.test.ts"),
  ),
  false,
  "production src contract test must be removed",
);
console.log("✓ D1-D5 completed in non-production contract directory; not wired\n");

console.log("Test 6: production guardrails and fail-closed");
const forbidden = evidence.productionGuardrails.strictlyForbidden;
for (const guardrail of [
  "modify-src/auto-reply/reply/get-reply.ts",
  "modify-src/memory/**",
  "add-second-MemoryWorkspaceHandle-production-entry",
  "create-production-catalog-data",
  "modify-scan-remaining-liveWriteWatchIndex",
  "execute-i3-unlock-phase1b",
  "any-live-production-deployment",
]) {
  assert.ok(forbidden.includes(guardrail), `missing guardrail ${guardrail}`);
}
assert.strictEqual(evidence.failClosedBehavior.response.failClosed, true);
assert.strictEqual(evidence.failClosedBehavior.response.retryable, false);
console.log("✓ production guardrails and fail-closed hold\n");

console.log("Test 7: locks unchanged; S01 code and scan untouched");
assert.strictEqual(evidence.currentStatus.s01Retirement, "blocked");
assert.strictEqual(evidence.currentStatus.item7, "not-met");
assert.strictEqual(evidence.currentStatus.phase1b, "blocked");
assert.strictEqual(evidence.currentStatus.remaining, 10);
assert.strictEqual(evidence.currentStatus.liveWriteWatchIndex, 10);
assert.strictEqual(evidence.currentStatus.retiredThisChange, 0);
assert.strictEqual(evidence.currentStatus.productionCatalogWrite, "none");
assert.strictEqual(evidence.currentStatus.deployAuthorized, false);
assert.strictEqual(evidence.currentStatus.i3Executed, false);
assert.strictEqual(evidence.currentStatus.liveDeployment, "forbidden");
assert.equal(scan.remaining, 10);
assert.equal(scan.liveWriteWatchIndex, 10);
assert.ok(
  (scan.sites ?? []).some(
    (site) =>
      site.file === "src/auto-reply/reply/get-reply.ts" &&
      site.line === 164 &&
      site.symbol === "resolveEmployeeBuiltinStewardWorkspaceDir",
  ),
  "S01 get-reply.ts:164 must remain in retirement scan",
);
assert.match(getReply, /resolveEmployeeBuiltinStewardWorkspaceDir/);
console.log("✓ scan stays 10; get-reply still has S01 helper\n");

console.log("Test 8: this task did not modify src/memory/** and did not add a second Handle entry");
assert.strictEqual(evidence.srcMemory.didNotModifySrcMemory, true);
assert.deepStrictEqual(evidence.srcMemory.filesTouched, []);
assert.strictEqual(
  evidence.srcMemory.thisSliceAddsSecondMemoryWorkspaceHandleProductionEntry,
  false,
);
assert.strictEqual(
  evidence.srcMemory.soleProductionMemoryWorkspaceHandle,
  "src/memory/memory-workspace-handle.ts",
);
assert.strictEqual(evidence.nonProductionContract.notAProductionSrcEntry, true);
assert.strictEqual(evidence.nonProductionContract.notImportedBySrc, true);
const productionHandle = readFileSync(
  join(repoRoot, evidence.srcMemory.soleProductionMemoryWorkspaceHandle),
  "utf-8",
);
assert.match(productionHandle, /export function createMemoryWorkspaceHandle/);
const memoryS01Files = readdirSync(join(repoRoot, "src/memory")).filter(
  (name) => name.includes("s01-trusted-principal") || name.includes("s01-d1-d5"),
);
assert.deepStrictEqual(memoryS01Files, []);
assert.match(uniqueHandoff, /不得修改 `src\/memory\/\*\*`/);
assert.match(uniqueHandoff, /不得新增第二套 `MemoryWorkspaceHandle`\s*生产入口/);
console.log("✓ src/memory untouched; no second MemoryWorkspaceHandle production entry\n");

console.log("=== All tests passed ===");
console.log(
  "Status: D1-D5 design retained in non-production contracts dir; src/memory untouched; not S01 retirement; not production deploy",
);
