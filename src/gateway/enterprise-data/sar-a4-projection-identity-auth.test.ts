// @vitest-environment node
/**
 * A4: projection execution identity + continuous authorization.
 * Bridge owner ≠ continuous execution delegation.
 * Does not claim R5 / E overall / A5 / enterprise external-site sessions.
 */
import { describe, expect, it } from "vitest";
import type { SiteRunResult } from "../../site-capability/result.js";
import { loadEnterpriseKnowledgeFeed } from "../knowledge/feed/enterprise-feed-adapter.js";
import { EnterpriseDataStoreError, upsertConnectorAction } from "./connector-action-store.js";
import { registerCallerAccountBinding } from "./data-asset-linkage.js";
import { upsertDataCapability } from "./data-capability-store.js";
import { upsertDataSource } from "./data-source-store.js";
import { MATERIALIZER_SEAT_ID } from "./enterprise-data-seat-context.js";
import { upsertEnterpriseKnowledgeProjectionBinding } from "./enterprise-knowledge-projection-binding-store.js";
import {
  resolveProjectionExecutionIdentity,
} from "./knowledge-publication.js";
import { upsertKnowledgeVisibilityPolicy } from "./knowledge-visibility-policy-store.js";
import { listKnowledgeFeedItems } from "./knowledge-feed-item-store.js";
import { runProjectionMaterialization } from "./projection-materializer.js";
import { upsertEnterpriseKnowledgeProjectionSpec } from "./projection-spec-store.js";
import { registerRuntimeHandler } from "./runtime-registry.js";
import { upsertSarExecutionBridge, type SarGovernanceProvider } from "./sar-governance-bridge.js";
import { runScheduledProjectionsForStore } from "./scheduled-projection-materializer.js";
import {
  findSeatActionGrant,
  revokeSeatActionGrant,
  upsertSeatActionGrant,
} from "./seat-action-grant-store.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeEnterpriseDataStore } from "./store.js";
import type { EnterpriseDataStore } from "./types.js";

const tenantId = "tenant-acme";
const nowIso = "2026-10-18T10:30:00.000Z";
const laterIso = "2026-10-18T11:00:00.000Z";
const ownerA = "owner-a";
const adminId = "emp-admin";
const actionRef = {
  connectorId: "site-session",
  actionKey: "site.session.read",
  version: "v1",
};
const sarCapabilityId = "fixture.site.session.read";
const sarVersion = "2026.10.18";
const artifactDigest = "digest-a4-1";

type SeenCall = { bindingId: string; userId: string };

function readResult(overrides: Partial<SiteRunResult> = {}): SiteRunResult {
  return {
    runId: "run-a4-1",
    capabilityId: sarCapabilityId,
    version: sarVersion,
    status: "succeeded",
    verification: "passed",
    completeness: "complete",
    data: { customer: { id: "cust-a4", name: "masked-name" } },
    evidenceRef: "evidence-a4-1",
    durationMs: 2,
    repair: "none",
    ...overrides,
  };
}

function providerFor(calls: SeenCall[]): SarGovernanceProvider {
  return {
    async execute(input) {
      calls.push({ bindingId: input.bindingId, userId: input.userId });
      return { result: readResult(), scopeEnforcedBeforeRead: true };
    },
  };
}

function installRead(store: EnterpriseDataStore, withMaterializerGrant: boolean) {
  upsertConnectorAction({
    store,
    tenantId,
    nowIso,
    action: {
      connectorId: actionRef.connectorId,
      actionKey: actionRef.actionKey,
      version: actionRef.version,
      displayName: "网站会话读取",
      category: "external",
      riskLevel: "LOW",
      requiresApproval: false,
      readOnly: true,
      outputSchema: { type: "object" },
      lifecycle: "active",
    },
  });
  registerRuntimeHandler({
    store,
    tenantId,
    nowIso,
    connectorId: actionRef.connectorId,
    actionKey: actionRef.actionKey,
    version: actionRef.version,
    handlerRef: "enterprise-data/sar-bridge/read",
    readOnly: true,
  });
  if (withMaterializerGrant) {
    upsertSeatActionGrant({
      store,
      tenantId,
      seatId: MATERIALIZER_SEAT_ID,
      connectorId: actionRef.connectorId,
      actionKey: actionRef.actionKey,
      version: actionRef.version,
      scopePolicyId: "scope-team-default",
      approvalPolicyId: "policy-none-default",
      nowIso,
    });
  }
}

function addWebsiteSource(store: EnterpriseDataStore, sourceId: string, bindingId: string) {
  return upsertDataSource({
    store,
    tenantId,
    nowIso,
    source: {
      sourceId,
      sourceKey: sourceId,
      displayName: sourceId,
      category: "external",
      status: "connected",
      connectorId: "site-session",
      bindingId,
    },
  });
}

function addOwnerAuthAndBridge(
  store: EnterpriseDataStore,
  sourceId: string,
  bindingId: string,
  userId: string,
) {
  registerCallerAccountBinding({
    store,
    caller: { tenantId, userId },
    bindingId,
  });
  return upsertSarExecutionBridge({
    store,
    tenantId,
    nowIso,
    bridge: {
      sourceId,
      actionRef,
      capabilityId: sarCapabilityId,
      version: sarVersion,
      artifactDigest,
      bindingId,
      userId,
      verification: "passed",
      validator: "reviewer-a4",
      effect: "read",
      supportedScopeTypes: ["TEAM"],
      enforcedFilterFields: ["customer.owner_team"],
    },
  });
}

function websiteFixture(opts?: { withMaterializerGrant?: boolean }) {
  const store = normalizeEnterpriseDataStore(null);
  seedEnterpriseDataCatalog({ store, tenantId, nowIso });
  installRead(store, opts?.withMaterializerGrant !== false);
  addWebsiteSource(store, "src-a", "bind-a");
  addOwnerAuthAndBridge(store, "src-a", "bind-a", ownerA);
  const capability = upsertDataCapability({
    store,
    tenantId,
    nowIso,
    capability: {
      capabilityKey: "site.session.query.a4",
      displayName: "A4 网站查询",
      description: "A4 continuous auth fixture",
      sourceIds: ["src-a"],
      actionRefs: [actionRef],
      enabled: true,
    },
  });
  const spec = upsertEnterpriseKnowledgeProjectionSpec({
    store,
    tenantId,
    nowIso,
    spec: {
      projectionKey: "site.session.query.a4",
      displayName: "A4 网站投影",
      category: "customer",
      capabilityId: capability.capabilityId,
      sourceId: "src-a",
      sourceActions: [actionRef],
      objectKind: "data",
      templateKey: "NormalizeTemplate",
      description: "a4 identity auth",
      outputSchema: { type: "object" },
      lifecycle: "active",
    },
  });
  const binding = upsertEnterpriseKnowledgeProjectionBinding({
    store,
    tenantId,
    nowIso,
    binding: {
      projectionId: spec.projectionId,
      capabilityId: capability.capabilityId,
      materializationMode: "scheduled",
      materializationTeamLabel: "华北销售",
      enabled: true,
      generatorVersion: "a4-test",
    },
  });
  return { store, capability, spec, binding };
}

describe("A4 projection identity + continuous authorization", () => {
  it("1) rejects when bridge has owner but no valid execution delegation", () => {
    const { store, spec } = websiteFixture({ withMaterializerGrant: false });
    expect(store.sarExecutionBridges).toBeTruthy();
    const bridge = Object.values(store.sarExecutionBridges ?? {}).find(
      (item) => item.sourceId === "src-a",
    );
    expect(bridge?.userId).toBe(ownerA);
    expect(
      findSeatActionGrant(store, tenantId, MATERIALIZER_SEAT_ID, actionRef),
    ).toBeNull();

    expect(() =>
      resolveProjectionExecutionIdentity({
        store,
        tenantId,
        spec,
        sourceRef: actionRef,
      }),
    ).toThrow(EnterpriseDataStoreError);
    try {
      resolveProjectionExecutionIdentity({
        store,
        tenantId,
        spec,
        sourceRef: actionRef,
      });
    } catch (error) {
      expect((error as EnterpriseDataStoreError).code).toBe(
        "PROJECTION_EXECUTION_DELEGATION_MISSING",
      );
    }
  });

  it("1b) materialization path also rejects without delegation (provider never called)", async () => {
    const { store, binding } = websiteFixture({ withMaterializerGrant: false });
    const calls: SeenCall[] = [];
    await expect(
      runProjectionMaterialization({
        store,
        tenantId,
        bindingId: binding.bindingId,
        sarProvider: providerFor(calls),
        nowIso,
      }),
    ).rejects.toMatchObject({ code: "PROJECTION_EXECUTION_DELEGATION_MISSING" });
    expect(calls).toHaveLength(0);
  });

  it("2) after revoke, scheduled materialization stops reading", async () => {
    const { store, binding, spec } = websiteFixture();
    // Isolate: only this website binding may run on the scheduled tick.
    for (const item of Object.values(store.enterpriseKnowledgeProjectionBindings)) {
      if (item.bindingId !== binding.bindingId) {
        item.enabled = false;
      }
    }
    const calls: SeenCall[] = [];
    const provider = providerFor(calls);

    // Baseline: with delegation + account auth, identity resolves and a run succeeds.
    const identity = resolveProjectionExecutionIdentity({
      store,
      tenantId,
      spec,
      sourceRef: actionRef,
    });
    expect(identity).toEqual({ sourceId: "src-a", userId: ownerA, employeeId: ownerA });
    await runProjectionMaterialization({
      store,
      tenantId,
      bindingId: binding.bindingId,
      sarProvider: provider,
      nowIso,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ bindingId: "bind-a", userId: ownerA });

    // Revoke continuous execution delegation (materializer seat grant).
    const grant = findSeatActionGrant(store, tenantId, MATERIALIZER_SEAT_ID, actionRef);
    expect(grant).not.toBeNull();
    revokeSeatActionGrant({
      store,
      tenantId,
      grantId: grant!.grantId,
      nowIso: laterIso,
    });

    await expect(
      runProjectionMaterialization({
        store,
        tenantId,
        bindingId: binding.bindingId,
        sarProvider: provider,
        nowIso: laterIso,
      }),
    ).rejects.toMatchObject({ code: "PROJECTION_EXECUTION_DELEGATION_MISSING" });
    expect(calls).toHaveLength(1);

    const scheduled = await runScheduledProjectionsForStore({
      store,
      tenantId,
      nowIso: laterIso,
      cursor: {
        lastRunByBindingId: {},
        lastFailureByBindingId: {},
        failureCountByBindingId: {},
      },
      intervalMs: 0,
    });
    expect(scheduled.failed).toBeGreaterThanOrEqual(1);
    expect(scheduled.succeeded).toBe(0);
    // Scheduled path never reached a provider read for this private account.
    expect(calls).toHaveLength(1);

    // Account-auth revoke path: restore grant, remove AccountBinding, schedule again.
    upsertSeatActionGrant({
      store,
      tenantId,
      seatId: MATERIALIZER_SEAT_ID,
      connectorId: actionRef.connectorId,
      actionKey: actionRef.actionKey,
      version: actionRef.version,
      scopePolicyId: "scope-team-default",
      approvalPolicyId: "policy-none-default",
      nowIso: laterIso,
    });
    delete store.accountBindings!["bind-a"];
    expect(() =>
      resolveProjectionExecutionIdentity({
        store,
        tenantId,
        spec,
        sourceRef: actionRef,
      }),
    ).toThrow(expect.objectContaining({ code: "PROJECTION_ACCOUNT_AUTH_REVOKED" }));

    await expect(
      runProjectionMaterialization({
        store,
        tenantId,
        bindingId: binding.bindingId,
        sarProvider: provider,
        nowIso: "2026-10-18T12:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "PROJECTION_ACCOUNT_AUTH_REVOKED" });
    expect(calls).toHaveLength(1);

    const afterAccountRevoke = await runScheduledProjectionsForStore({
      store,
      tenantId,
      nowIso: "2026-10-18T12:00:00.000Z",
      cursor: {
        lastRunByBindingId: {},
        lastFailureByBindingId: {},
        failureCountByBindingId: {},
      },
      intervalMs: 0,
    });
    expect(afterAccountRevoke.failed).toBeGreaterThanOrEqual(1);
    expect(afterAccountRevoke.succeeded).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("3) admin cannot obtain private account access merely by creating a projection", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    // Owner authorizes the private account; materializer has no grant yet.
    installRead(store, false);
    addWebsiteSource(store, "src-private", "bind-private");
    addOwnerAuthAndBridge(store, "src-private", "bind-private", ownerA);
    const capability = upsertDataCapability({
      store,
      tenantId,
      nowIso,
      capability: {
        capabilityKey: "site.private.a4",
        displayName: "私人账户能力",
        description: "private",
        sourceIds: ["src-private"],
        actionRefs: [actionRef],
        enabled: true,
      },
    });

    // Admin creates a projection (governance) without receiving account access.
    const spec = upsertEnterpriseKnowledgeProjectionSpec({
      store,
      tenantId,
      nowIso,
      spec: {
        projectionKey: "site.private.admin-created",
        displayName: "管理员创建的投影",
        category: "customer",
        capabilityId: capability.capabilityId,
        sourceId: "src-private",
        sourceActions: [actionRef],
        objectKind: "data",
        templateKey: "NormalizeTemplate",
        description: "admin-created",
        outputSchema: { type: "object" },
        lifecycle: "active",
      },
    });
    const binding = upsertEnterpriseKnowledgeProjectionBinding({
      store,
      tenantId,
      nowIso,
      binding: {
        projectionId: spec.projectionId,
        capabilityId: capability.capabilityId,
        materializationMode: "on_demand",
        materializationTeamLabel: "华北销售",
        enabled: true,
        generatorVersion: "a4-admin",
      },
    });

    // Creating the projection did not invent a materializer delegation.
    expect(
      findSeatActionGrant(store, tenantId, MATERIALIZER_SEAT_ID, actionRef),
    ).toBeNull();
    // Admin is not the AccountBinding owner.
    expect(store.accountBindings?.["bind-private"]?.userId).toBe(ownerA);
    expect(store.accountBindings?.["bind-private"]?.userId).not.toBe(adminId);

    const calls: SeenCall[] = [];
    await expect(
      runProjectionMaterialization({
        store,
        tenantId,
        bindingId: binding.bindingId,
        sarProvider: providerFor(calls),
        nowIso,
      }),
    ).rejects.toMatchObject({ code: "PROJECTION_EXECUTION_DELEGATION_MISSING" });
    expect(calls).toHaveLength(0);

    // Even with delegation restored, identity is the owner — never the admin.
    upsertSeatActionGrant({
      store,
      tenantId,
      seatId: MATERIALIZER_SEAT_ID,
      connectorId: actionRef.connectorId,
      actionKey: actionRef.actionKey,
      version: actionRef.version,
      scopePolicyId: "scope-team-default",
      approvalPolicyId: "policy-none-default",
      nowIso,
    });
    const identity = resolveProjectionExecutionIdentity({
      store,
      tenantId,
      spec,
      sourceRef: actionRef,
    });
    expect(identity.userId).toBe(ownerA);
    expect(identity.userId).not.toBe(adminId);
    expect(identity.userId).not.toBe(MATERIALIZER_SEAT_ID);

    await runProjectionMaterialization({
      store,
      tenantId,
      bindingId: binding.bindingId,
      sarProvider: providerFor(calls),
      nowIso,
    });
    expect(calls).toEqual([{ bindingId: "bind-private", userId: ownerA }]);
    expect(calls[0]?.userId).not.toBe(adminId);
  });

  it("4) execution account authority is separate from downstream knowledge visibility", async () => {
    const { store, binding, spec } = websiteFixture();
    const calls: SeenCall[] = [];

    // Attach an explicit visibility policy that excludes the downstream seat.
    // (No policyId means default-visible in the feed adapter — not a visibility grant.)
    const denyPolicy = upsertKnowledgeVisibilityPolicy({
      store,
      tenantId,
      nowIso,
      policy: {
        projectionId: spec.projectionId,
        visibleSeats: ["seat-other-only"],
        visibleTeams: [],
        visibleDepartments: [],
        visibleRoles: [],
        visibleAgentTypes: [],
      },
    });
    store.enterpriseKnowledgeProjectionBindings[binding.bindingId].visibilityPolicyId =
      denyPolicy.policyId;

    // Execution path: materializer grant + account auth → can materialize as owner
    // even while downstream visibility is denied.
    const identity = resolveProjectionExecutionIdentity({
      store,
      tenantId,
      spec,
      sourceRef: actionRef,
    });
    expect(identity.userId).toBe(ownerA);
    await runProjectionMaterialization({
      store,
      tenantId,
      bindingId: binding.bindingId,
      sarProvider: providerFor(calls),
      nowIso,
    });
    expect(calls).toHaveLength(1);
    expect(
      listKnowledgeFeedItems({ store, tenantId, projectionId: spec.projectionId }).length,
    ).toBeGreaterThan(0);

    const denied = loadEnterpriseKnowledgeFeed({
      store,
      context: {
        tenantId,
        seatId: "seat-downstream",
        userId: "downstream-user",
        hasEnterpriseScope: true,
        agentType: "employee-agent",
      },
    });
    expect(denied.accessible.some((item) => item.projectionId === spec.projectionId)).toBe(false);
    expect(denied.restricted.some((item) => item.projectionId === spec.projectionId)).toBe(true);

    // Granting visibility does not grant execution on the private account.
    upsertKnowledgeVisibilityPolicy({
      store,
      tenantId,
      nowIso,
      policy: {
        policyId: denyPolicy.policyId,
        projectionId: spec.projectionId,
        visibleSeats: ["seat-downstream"],
        visibleTeams: [],
        visibleDepartments: [],
        visibleRoles: [],
        visibleAgentTypes: [],
      },
    });

    const withVisibility = loadEnterpriseKnowledgeFeed({
      store,
      context: {
        tenantId,
        seatId: "seat-downstream",
        userId: "downstream-user",
        hasEnterpriseScope: true,
        agentType: "employee-agent",
      },
    });
    expect(
      withVisibility.accessible.some((item) => item.projectionId === spec.projectionId),
    ).toBe(true);

    // Downstream seat still has no seat-action grant for the website action.
    expect(findSeatActionGrant(store, tenantId, "seat-downstream", actionRef)).toBeNull();
    // Execution identity remains owner-only; visibility did not change it.
    expect(
      resolveProjectionExecutionIdentity({
        store,
        tenantId,
        spec,
        sourceRef: actionRef,
      }).userId,
    ).toBe(ownerA);
  });
});
