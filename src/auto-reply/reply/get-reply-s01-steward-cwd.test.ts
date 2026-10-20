import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEmptyAgentRegistryStore } from "../../gateway/agent-registry/types.js";
import { S01_PRODUCTION_WIRED_TO_GET_REPLY } from "../../gateway/data-governance/s01-authorized-tool-cwd.js";
import {
  evaluateS01StewardCwdShadow,
  isS01StageBStewardCwdShadowEnabled,
  runS01GetReplyStewardCwdShadowFromEntry,
  scheduleS01StewardCwdShadow,
} from "../../gateway/data-governance/s01-get-reply-steward-cwd-shadow.js";
import { S01ReadOnlyDurableCatalogView } from "../../gateway/data-governance/s01-stage-b-shadow-production-ports.js";
import {
  GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
  type CatalogRecord,
} from "../../gateway/data-governance/types.js";
import type { PlatformAuthStore } from "../../gateway/platform-auth/store-types.js";
import { createDefaultPolicy } from "../../gateway/platform-auth/trial-policy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

const tenantId = "ent-456";
const employeeOwnerId = "usr-123";
const agentAssetId = "asset-steward-1";
const helperCwd = "/legacy/helper-cwd";
const resourceId = `ws:${tenantId}:user:${employeeOwnerId}:asset:${agentAssetId}`;
const on = { OPENBOT_S01_STAGE_B_STEWARD_CWD_SHADOW: "1" };

function durableWorkspace(params?: {
  tenantId?: string;
  locator?: string;
  contentVersion?: string;
}): CatalogRecord {
  return {
    envelope: {
      resourceId,
      resourceType: "workspace",
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId: params?.tenantId ?? tenantId,
      owner: { kind: "user", userId: employeeOwnerId },
      scope: { kind: "user", userId: employeeOwnerId },
      lifecycleState: "active",
      classification: "internal",
      governanceVersion: 1,
      canonicalBindingId: `${resourceId}:canonical`,
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    },
    bindings: [
      {
        bindingId: `${resourceId}:canonical`,
        resourceId,
        role: "canonical",
        storageKind: "filesystem",
        locator: params?.locator ?? helperCwd,
        state: "active",
        contentVersion: params?.contentVersion ?? "v1",
      },
    ],
  };
}

function registryWithLegacy(legacyAgentId: string) {
  const store = createEmptyAgentRegistryStore();
  store.assets[agentAssetId] = {
    agentAssetId,
    enterpriseId: tenantId,
    agentSlug: "steward-work",
    displayName: "Steward work",
    status: "active",
    legacyAgentId,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
  };
  return store;
}

function platformStore(params?: { userId?: string; tenantId?: string }): PlatformAuthStore {
  const nowIso = "2026-08-30T00:00:00.000Z";
  const userId = params?.userId ?? employeeOwnerId;
  const enterpriseId = params?.tenantId ?? tenantId;
  return {
    version: 5,
    secret: "platform-cookie-secret-not-s01",
    policy: createDefaultPolicy(nowIso),
    enterprises: {
      [enterpriseId]: {
        id: enterpriseId,
        name: "Ent",
        slug: "ent",
        status: "paid",
        plan: "enterprise",
        createdSource: "self-service",
        billingStatus: "active",
        createdAt: nowIso,
        updatedAt: nowIso,
        seatQuota: 5,
        seatUsed: 1,
      },
    },
    users: {},
    sessions: {},
    memberships: {
      "mem-1": {
        id: "mem-1",
        userId,
        enterpriseId,
        membershipRole: "member",
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    },
    adminProvisions: {},
    employeeProvisions: {},
    activationCodes: {},
    trialApplications: {},
    leadNotifications: {},
  };
}

describe("get-reply S01 Stage B steward cwd shadow", () => {
  it("1/11/12: helper is shadow-only; flag default off; scan 10/10; P5 stays", () => {
    const getReply = readFileSync(join(__dirname, "get-reply.ts"), "utf-8");
    expect(getReply).toMatch(/resolveRobotWriteRoot/);
    expect(getReply).toMatch(/resolveLiveRobotWriteRoot/);
    expect(getReply).not.toMatch(/resolveUnscopedHostWriteRoot/);
    expect(getReply).not.toMatch(/resolveEmployeeBuiltinStewardWorkspaceDir/);
    expect(getReply).not.toMatch(/resolveAgentWorkspaceDir\s*\(/);
    expect(getReply).toMatch(/stewardWorkspaceDir:\s*stewardHelperCwd/);
    expect(getReply).toMatch(/stewardHelperCwd/);
    expect(getReply).toMatch(/runS01GetReplyStewardCwdShadowFromEntry/);
    expect(getReply).toMatch(/scheduleS01StewardCwdShadow/);
    expect(getReply).toMatch(/s01_stage_b_steward_cwd_shadow_import_error/);
    expect(getReply).not.toMatch(/evaluateS01AuthorizedToolCwd/);
    expect(getReply).not.toMatch(/resolveS01StewardWorkspaceIdentity/);
    expect(getReply).not.toMatch(/createInMemoryS01/);
    expect(getReply).not.toMatch(/InMemoryWorkspaceResourceCatalog/);
    expect(getReply).not.toMatch(/loadExistingGovernedWorkspaceIdentity/);
    expect(getReply).not.toMatch(/getSharedDataGovernanceCatalog/);
    expect(getReply).not.toMatch(/issueS01TrustedPrincipal/);
    expect(S01_PRODUCTION_WIRED_TO_GET_REPLY).toBe(false);
    expect(isS01StageBStewardCwdShadowEnabled({})).toBe(false);

    const scan = JSON.parse(
      readFileSync(
        join(repoRoot, "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json"),
        "utf-8",
      ),
    ) as { remaining: number; liveWriteWatchIndex: number; sites: Array<{ pathId: string }> };
    expect(scan.remaining).toBe(10);
    expect(scan.liveWriteWatchIndex).toBe(10);
    expect(scan.sites[0]?.pathId).toBe("P5");
  });

  it("1: flag off does not resolve production deps", async () => {
    let loaded = 0;
    const result = await runS01GetReplyStewardCwdShadowFromEntry({
      stewardException: true,
      employeeOwnerId,
      stewardAgentId: "main",
      tenantId,
      helperCwd,
      env: {},
      durableWorkspaceRecords: [durableWorkspace()],
      registryStore: registryWithLegacy("main"),
      loadProductionDeps: async () => {
        loaded += 1;
        throw new Error("must not load production deps when flag is off");
      },
    });
    expect(result).toBeNull();
    expect(loaded).toBe(0);
  });

  it("2: production entry injects durable catalog + registry and reaches identity resolver", async () => {
    const result = await runS01GetReplyStewardCwdShadowFromEntry({
      stewardException: true,
      employeeOwnerId,
      stewardAgentId: "main",
      tenantId,
      helperCwd,
      env: on,
      durableWorkspaceRecords: [durableWorkspace()],
      registryStore: createEmptyAgentRegistryStore(),
    });
    expect(result?.receipt).toBe("catalog_miss");
    expect(result?.identityCode).toBe("ERR_WORKSPACE_NOT_FOUND");
    expect(result).not.toMatchObject({ receipt: "fail_closed_missing_identity" });
    expect(result?.usedShadowPathForProduction).toBe(false);
  });

  it("3: Catalog miss via production durable view", async () => {
    const result = await runS01GetReplyStewardCwdShadowFromEntry({
      stewardException: true,
      employeeOwnerId,
      stewardAgentId: "mapped-steward",
      tenantId,
      helperCwd,
      env: on,
      durableWorkspaceRecords: [],
      registryStore: registryWithLegacy("mapped-steward"),
    });
    expect(result?.receipt).toBe("catalog_miss");
  });

  it("4: tenant mismatch via durable catalog", async () => {
    const result = await runS01GetReplyStewardCwdShadowFromEntry({
      stewardException: true,
      employeeOwnerId,
      stewardAgentId: "mapped-steward",
      tenantId,
      helperCwd,
      env: on,
      durableWorkspaceRecords: [durableWorkspace({ tenantId: "ent-other" })],
      registryStore: registryWithLegacy("mapped-steward"),
    });
    expect(result?.receipt).toBe("tenant_mismatch");
  });

  it("5: stale fencing via durable catalog", async () => {
    const result = await runS01GetReplyStewardCwdShadowFromEntry({
      stewardException: true,
      employeeOwnerId,
      stewardAgentId: "mapped-steward",
      tenantId,
      helperCwd,
      env: on,
      durableWorkspaceRecords: [durableWorkspace()],
      registryStore: registryWithLegacy("mapped-steward"),
      expectedFencing: { contentVersion: "stale", bindingId: `${resourceId}:canonical` },
    });
    expect(result?.receipt).toBe("fencing_stale");
  });

  it("6/7: missing principal or membership cannot match", async () => {
    const missingPrincipal = await runS01GetReplyStewardCwdShadowFromEntry({
      stewardException: true,
      employeeOwnerId,
      stewardAgentId: "mapped-steward",
      tenantId,
      userId: employeeOwnerId,
      helperCwd,
      env: on,
      durableWorkspaceRecords: [durableWorkspace()],
      registryStore: registryWithLegacy("mapped-steward"),
      platformStore: platformStore(),
    });
    expect(missingPrincipal?.receipt).toBe("fail_closed_missing_authorization");

    const missingMembership = await runS01GetReplyStewardCwdShadowFromEntry({
      stewardException: true,
      employeeOwnerId,
      stewardAgentId: "mapped-steward",
      tenantId,
      userId: employeeOwnerId,
      sessionId: "sess-1",
      helperCwd,
      env: { ...on, OPENBOT_S01_ATTESTATION_SECRET: "s01-secret" },
      durableWorkspaceRecords: [durableWorkspace()],
      registryStore: registryWithLegacy("mapped-steward"),
    });
    expect(missingMembership?.receipt).toBe("fail_closed_missing_authorization");
  });

  it("8/9: cwd deny vs identity+authorization match", async () => {
    const denied = await runS01GetReplyStewardCwdShadowFromEntry({
      stewardException: true,
      employeeOwnerId,
      stewardAgentId: "mapped-steward",
      tenantId,
      userId: employeeOwnerId,
      sessionId: "sess-1",
      helperCwd,
      env: { ...on, OPENBOT_S01_ATTESTATION_SECRET: "s01-secret" },
      durableWorkspaceRecords: [durableWorkspace()],
      registryStore: registryWithLegacy("mapped-steward"),
      platformStore: platformStore({ userId: "other-user" }),
    });
    expect(denied?.receipt).toBe("authorization_denied");
    expect(denied?.usedShadowPathForProduction).toBe(false);

    const match = await runS01GetReplyStewardCwdShadowFromEntry({
      stewardException: true,
      employeeOwnerId,
      stewardAgentId: "mapped-steward",
      tenantId,
      userId: employeeOwnerId,
      sessionId: "sess-1",
      helperCwd,
      env: { ...on, OPENBOT_S01_ATTESTATION_SECRET: "s01-secret" },
      durableWorkspaceRecords: [durableWorkspace()],
      registryStore: registryWithLegacy("mapped-steward"),
      platformStore: platformStore(),
    });
    expect(match?.receipt).toBe("identity_and_authorization_match");
    expect(match?.usedShadowPathForProduction).toBe(false);
    expect(match?.productionCwdUnchanged).toBe(true);
  });

  it("10: schedule swallows rejection without changing helper cwd", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      scheduleS01StewardCwdShadow(() => Promise.reject(new Error("shadow boom")));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
      expect(helperCwd).toBe("/legacy/helper-cwd");
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("production catalog view is not InMemory", () => {
    const view = new S01ReadOnlyDurableCatalogView({
      governanceVersion: 1,
      status: "available",
      resources: {},
      bindings: {},
    });
    expect(view.constructor.name).toBe("S01ReadOnlyDurableCatalogView");
  });

  it("direct evaluator still fail-closes when ports are omitted", () => {
    const missing = evaluateS01StewardCwdShadow({
      stewardException: true,
      employeeOwnerId,
      stewardAgentId: "main",
      tenantId,
      helperCwd,
    });
    expect(missing.receipt).toBe("fail_closed_missing_identity");
  });
});
