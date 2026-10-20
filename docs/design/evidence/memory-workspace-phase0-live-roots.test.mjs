import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRegistryStore,
  lookupAssetInEnterprise,
  inferTenantForUser,
  classifyRoot,
  describeRootResolution,
  unexplainedRootCount,
  buildCandidateResourceId,
  buildEvidenceSummary,
  buildCatalogCandidate,
} from "./memory-workspace-phase0-live-roots.mjs";

void test("parses Record<string, AgentAsset> and ignores array-only assumption", () => {
  const parsed = parseRegistryStore({
    version: 1,
    assets: {
      "asset-1": {
        agentAssetId: "asset-1",
        enterpriseId: "001",
        agentSlug: "bot-2",
        legacyAgentId: "bot-2",
        status: "active",
      },
    },
    ownerBindings: {
      "bind-1": {
        bindingId: "bind-1",
        enterpriseId: "001",
        agentAssetId: "asset-1",
        ownerType: "membership",
        ownerId: "user-1",
        isPrimary: true,
      },
    },
  });
  assert.equal(parsed.assetShape, "record");
  assert.equal(parsed.assetCount ?? parsed.assets.length, 1);
  assert.equal(parsed.assets[0].agentSlug, "bot-2");
  assert.equal(parsed.ownerBindings.length, 1);
});

void test("does not treat empty Record as zero assets when shape is record", () => {
  const parsed = parseRegistryStore({ version: 1, assets: {} });
  assert.equal(parsed.assetShape, "record");
  assert.equal(parsed.assets.length, 0);
});

void test("lookup is enterprise-scoped and does not steal another tenant slug", () => {
  const registry = parseRegistryStore({
    assets: {
      a: { agentAssetId: "a", enterpriseId: "ent-a", agentSlug: "bot-2" },
      b: { agentAssetId: "b", enterpriseId: "ent-b", agentSlug: "bot-2" },
    },
  });
  const inA = lookupAssetInEnterprise(registry, "ent-a", "bot-2");
  assert.equal(inA.reason, "enterprise-scoped-exact");
  assert.equal(inA.matches[0].agentAssetId, "a");
  const missing = lookupAssetInEnterprise(registry, "ent-c", "bot-2");
  assert.equal(missing.reason, "slug-exists-in-other-enterprise");
  assert.equal(missing.matches.length, 0);
});

void test("host roots never classify as classified via global slug", () => {
  assert.equal(
    classifyRoot({
      kind: "host_canonical",
      lookupReason: "host-root-has-no-enterprise",
      matchCount: 0,
    }),
    "conflict",
  );
  assert.equal(
    classifyRoot({
      kind: "tenant_workspace",
      lookupReason: "enterprise-scoped-exact",
      matchCount: 1,
    }),
    "classified",
  );
  assert.equal(
    classifyRoot({ kind: "tenant_workspace", lookupReason: "no-enterprise-match", matchCount: 0 }),
    "unknown",
  );
  assert.equal(
    classifyRoot({
      kind: "employee_steward",
      lookupReason: "employee-steward-missing-tenant",
      matchCount: 0,
    }),
    "unknown",
  );
  assert.equal(
    classifyRoot({
      kind: "employee_steward",
      lookupReason: "unique-user-dir",
      matchCount: 0,
      tenantId: "001",
    }),
    "unknown",
  );
  assert.deepEqual(
    describeRootResolution({
      kind: "employee_steward",
      lookupReason: "unique-user-dir",
      matchCount: 0,
      tenantId: "001",
    }),
    {
      classification: "unknown",
      resolutionStatus: "pending_authority",
      evidenceHint: "unique-user-dir",
    },
  );
  assert.equal(
    classifyRoot({
      kind: "employee_steward",
      lookupReason: "unique-user-dir",
      matchCount: 0,
      tenantId: "001",
      authority: "membership-sot",
    }),
    "classified",
  );
  assert.equal(
    classifyRoot({
      kind: "employee_steward",
      lookupReason: "ambiguous-user-tenants",
      matchCount: 0,
    }),
    "conflict",
  );
  assert.equal(
    classifyRoot({
      kind: "group_shared",
      lookupReason: "group-tenant-hint",
      tenantId: "001",
    }),
    "unknown",
  );
  assert.equal(
    classifyRoot({ kind: "group_shared", lookupReason: "group-missing-authoritative-tenant" }),
    "unknown",
  );
  assert.equal(
    classifyRoot({ kind: "group_space_mirror", lookupReason: "group-missing-tenant" }),
    "conflict",
  );
});

void test("employee resourceIds stay unique and never classify without a tenant", () => {
  assert.deepEqual(inferTenantForUser(["001"]), {
    tenantId: "001",
    reason: "unique-user-dir",
  });
  assert.equal(inferTenantForUser(["001", "002"]).reason, "ambiguous-user-tenants");
  assert.equal(inferTenantForUser([]).reason, "employee-steward-missing-tenant");

  const missingA = {
    kind: "employee_steward",
    slug: "main",
    userId: "user-a",
    classification: "unknown",
    assetLookup: { reason: "employee-steward-missing-tenant" },
    pathPattern: "{stateDir}/agents/main/employees/<user>/workspace",
  };
  const missingB = { ...missingA, userId: "user-b" };
  const pending = {
    kind: "employee_steward",
    slug: "main",
    userId: "user-c",
    tenantId: "001",
    classification: "unknown",
    resolutionStatus: "pending_authority",
    evidenceHint: "unique-user-dir",
    assetLookup: { reason: "unique-user-dir" },
    pathPattern: "{stateDir}/agents/main/employees/<user>/workspace",
  };
  const candidate = buildCatalogCandidate(
    { cluster: { rootCount: 3 }, roots: [missingA, missingB, pending] },
    "memory-workspace-phase0-20260814",
  );
  const ids = candidate.candidates.map((row) => row.resourceId);
  assert.equal(new Set(ids).size, 3);
  assert.match(ids[0], /^ws:host:user:user-[0-9a-f]{12}:unknown:employee-steward-missing-tenant$/);
  assert.match(ids[1], /^ws:host:user:user-[0-9a-f]{12}:unknown:employee-steward-missing-tenant$/);
  assert.notEqual(ids[0], ids[1]);
  assert.match(ids[2], /^ws:tenant-[0-9a-f]{12}:user:user-[0-9a-f]{12}:pending:unique-user-dir$/);
  assert.equal(candidate.candidates[0].classification, "unknown");
  assert.equal(candidate.candidates[2].classification, "unknown");
  assert.equal(candidate.candidates[2].resolutionStatus, "pending_authority");
  assert.equal(candidate.candidates[2].evidenceHint, "unique-user-dir");
  assert.equal(candidate.coverage.employee_private.classifiedWithTenant, 0);
  assert.equal(candidate.coverage.employee_private.pendingAuthority, 1);
  assert.equal(candidate.p0ExitGate.unexplainedWritableRoots, "open");
  assert.equal(candidate.p0ExitGate.notClassifiedCount, 3);
  assert.equal(candidate.coverage.employee_private.observed, 3);
  assert.equal(candidate.coverage.employee_private.uniqueResourceIds, 3);
  assert.equal(candidate.coverage.employee_private.gate, "fail");
});

void test("group_shared candidates come from inventoried roots and keep coverage fail", () => {
  const candidate = buildCatalogCandidate(
    {
      cluster: { rootCount: 2, groupRootCount: 2 },
      roots: [
        {
          kind: "group_shared",
          slug: "grp-demo",
          groupId: "grp-demo",
          pathPattern: "{stateDir}/collaboration-shared/groups/<groupId>",
          classification: "unknown",
          assetLookup: { reason: "group-missing-tenant" },
        },
        {
          kind: "group_space_mirror",
          slug: "grp-demo",
          groupId: "grp-demo",
          pathPattern: "{stateDir}/spaces/<groupId>",
          classification: "conflict",
          assetLookup: { reason: "group-root-overlap" },
        },
      ],
    },
    "memory-workspace-phase0-20260814",
  );
  assert.equal(candidate.coverage.group_shared.observed, 2);
  assert.equal(candidate.coverage.group_shared.inventoried, true);
  assert.equal(candidate.coverage.group_shared.classifiedWithTenant, 0);
  assert.equal(candidate.coverage.group_shared.gate, "fail");
  assert.equal(candidate.candidates[0].workspaceKind, "group_shared");
  assert.match(
    candidate.candidates[0].resourceId,
    /^ws:host:unknown:group-missing-tenant:slug-[0-9a-f]{12}$/,
  );
  assert.equal(
    buildCandidateResourceId(
      {
        kind: "group_shared",
        tenantId: "001",
        classification: "unknown",
        assetLookup: { reason: "group-tenant-hint" },
      },
      {
        tenantToken: "tenant-abc",
        userToken: "none",
        slugToken: "slug-1",
        groupToken: "slug-1",
        exactAssetId: "",
      },
    ),
    "ws:host:unknown:group-tenant-hint:slug-1",
  );
});

void test("evidence-summary emits slugCount/agentIndex/dualTree without unpublished fields", () => {
  const summary = buildEvidenceSummary(
    {
      probeUtc: "2026-08-14T00:00:00.000Z",
      scriptPath: "docs/design/evidence/memory-workspace-phase0-live-roots.mjs",
      scriptSha256: "abc",
      schema: "memory-workspace-phase0-live-roots/v1",
      limits: { truncated: false },
      cluster: { tenantCount: 1, userDirCount: 1, rootCount: 2, sqliteCount: 1 },
      registry: {
        available: true,
        assetShape: "record",
        assetCount: 1,
        ownerBindingCount: 1,
        enterpriseCount: 1,
      },
      agents: [{ id: "bot-2", hasOwnerId: true, hasWorkspaceConfig: true }],
      roots: [
        { kind: "host_canonical", slug: "bot-2", mdCount: 7, classification: "conflict" },
        {
          kind: "tenant_workspace",
          slug: "bot-2",
          tenantId: "001",
          mdCount: 76,
          classification: "classified",
          assetLookup: {
            reason: "enterprise-scoped-exact",
            matchCount: 1,
            agentAssetId: "asset-1",
          },
        },
      ],
      sqlite: [{ agentId: "bot-2", bytes: 10, mtimeUtc: "2026-08-14T00:00:00.000Z" }],
    },
    "memory-workspace-phase0-live-20260814",
  );
  assert.equal(summary.registry.slugCount, 1);
  assert.equal(summary.agentIndex.count, 1);
  assert.equal(summary.dualTree.length, 1);
  assert.equal(summary.sqlite[0].dualTree, true);
  assert.equal(summary.transform, "raw-controlled -> evidence-summary (no unpublished steps)");
  assert.equal(summary.p0ExitGate.registryParsingTrusted, true);
  assert.equal(summary.p0ExitGate.classificationTrusted, undefined);
  assert.equal(summary.p0ExitGate.unexplainedWritableRoots, "open");
  assert.equal(summary.p0ExitGate.notClassifiedCount, 1);
  assert.equal(
    unexplainedRootCount([{ classification: "unknown", resolutionStatus: "pending_authority" }]),
    1,
  );
});

void test("catalog-candidate emits one row per root", () => {
  const candidate = buildCatalogCandidate(
    {
      cluster: { rootCount: 2 },
      roots: [
        {
          kind: "tenant_workspace",
          slug: "bot-2",
          tenantId: "001",
          userId: "user-1",
          pathPattern: "tenants/<tid>/users/<uid>/OpenBot/workspace-bot-2",
          classification: "classified",
          assetLookup: {
            reason: "enterprise-scoped-exact",
            matchCount: 1,
            agentAssetId: "asset-1",
          },
        },
        {
          kind: "host_canonical",
          slug: "bot-2",
          pathPattern: "{stateDir}/workspace-bot-2",
          classification: "conflict",
          assetLookup: { reason: "host-root-has-no-enterprise", matchCount: 0 },
        },
      ],
      sqlite: [{ agentId: "bot-2", pathPattern: "{stateDir}/memory/bot-2.sqlite" }],
    },
    "memory-workspace-phase0-20260814",
  );
  assert.equal(candidate.candidateCount, 2);
  assert.equal(candidate.sourceRootCount, 2);
  assert.match(candidate.candidates[0].resourceId, /asset:asset-[0-9a-f]{12}$/);
  assert.equal(candidate.coverage.agent_primary.gate, "fail");
});
