// @vitest-environment node
import { describe, expect, it } from "vitest";
import { upsertConnectorAction } from "./connector-action-store.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import {
  assertWebsiteBindingAssignable,
  buildDataAssetLinkage,
  recordGovernedReadSuccess,
  recordMaterializedConnectorAction,
  recordSourceConnectionCheck,
  registerCallerAccountBinding,
  resolveOwnedAssetLinks,
  resolveWebsiteAccessChoice,
  summarizeDataAssetLinkage,
} from "./data-asset-linkage.js";
import { upsertDataSource } from "./data-source-store.js";
import { registerRuntimeHandler } from "./runtime-registry.js";
import { probeDataSourceConnection } from "./source-connection-probe.js";
import { normalizeEnterpriseDataStore } from "./store.js";
import type { EnterpriseDataStore, EnterpriseSarExecutionBridge } from "./types.js";

const tenantId = "tenant-acme";
const otherTenant = "tenant-other";
const nowIso = "2026-10-17T08:00:00.000Z";
const ownerId = "user-owner";
const adminId = "user-admin";

function bridge(
  overrides: Partial<EnterpriseSarExecutionBridge> = {},
): EnterpriseSarExecutionBridge {
  return {
    bridgeId: "bridge-1",
    tenantId,
    sourceId: "src-site",
    actionRef: { connectorId: "site-session", actionKey: "read", version: "1" },
    capabilityId: "sar.cap.read",
    version: "2026.10.17",
    artifactDigest: "digest-1",
    skillId: "skill-site",
    bindingId: "bind-owner",
    userId: ownerId,
    verification: "failed",
    effect: "read",
    supportedScopeTypes: ["SELF"],
    enforcedFilterFields: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function siteSource(store: EnterpriseDataStore, status: "connected" | "error" = "connected") {
  return upsertDataSource({
    store,
    tenantId,
    nowIso: "2026-10-16T00:00:00.000Z",
    source: {
      sourceId: "src-site",
      sourceKey: "site-a",
      displayName: "网站 A",
      category: "external",
      status,
      connectorId: "site-session",
      bindingId: "bind-owner",
    },
  });
}

describe("E2 data asset linkage", () => {
  it("keeps a healthy account and a failed capability at the same time", () => {
    const store = normalizeEnterpriseDataStore(null);
    siteSource(store, "connected");
    registerCallerAccountBinding({
      store,
      caller: { tenantId, userId: ownerId },
      bindingId: "bind-owner",
    });
    store.sarExecutionBridges = { "bridge-1": bridge({ verification: "failed" }) };
    store.dataSources["src-site"].materializationCount = 2;
    const [item] = buildDataAssetLinkage({
      store,
      tenantId,
      callerUserId: ownerId,
      nowIso,
    });
    expect(item?.connection.health).toBe("healthy");
    expect(item?.connection.status).toBe("connected");
    expect(item?.verification.status).toBe("failed");
    expect(item?.verification.healthy).toBe(false);
    expect(item?.verification.productionVerificationCount).toBe(0);
    expect(item?.accessMethod).toBe("website_session");
    expect(item?.scope).toEqual({ supportedScopeTypes: ["SELF"], known: true });
    expect(item?.links.capabilityCenter).toEqual({
      capabilityId: "sar.cap.read",
      version: "2026.10.17",
      skillId: "skill-site",
    });
    expect(item?.links.dataCenter).toEqual({ sourceId: "src-site" });
    expect(item?.freshness.claimsSynced).toBe(false);
    expect(item?.freshness.claimsIngested).toBe(false);
    expect(item?.freshness.status).toBe("unknown");
    const stats = summarizeDataAssetLinkage([item]);
    expect(stats.connection.healthy).toBe(1);
    expect(stats.verification.failed).toBe(1);
    expect(stats.verification.passed).toBe(0);
    expect(stats.freshness.unknown).toBe(1);
    expect(stats.freshness.fresh).toBe(0);
  });

  it("does not count unknown connection, verification, or freshness as healthy", () => {
    const store = normalizeEnterpriseDataStore(null);
    const source = siteSource(store);
    source.status = "connected";
    delete (source as { status: string }).status;
    (source as { status: string }).status = "mystery";
    const [item] = buildDataAssetLinkage({
      store,
      tenantId,
      callerUserId: null,
      nowIso,
    });
    expect(item?.connection.health).toBe("unknown");
    expect(item?.connection.health === "healthy").toBe(false);
    expect(item?.verification.status).toBe("unknown");
    expect(item?.verification.healthy).toBe(false);
    expect(item?.freshness.healthy).toBe(false);
    const stats = summarizeDataAssetLinkage([item]);
    expect(stats.connection.unknown).toBe(1);
    expect(stats.connection.healthy).toBe(0);
    expect(stats.verification.unknown).toBe(1);
  });

  it("labels a live read as not synced and not ingested", () => {
    const store = normalizeEnterpriseDataStore(null);
    siteSource(store);
    store.dataSources["src-site"].updatedAt = nowIso;
    recordGovernedReadSuccess({
      store,
      tenantId,
      sourceId: "src-site",
      nowIso,
    });
    const [item] = buildDataAssetLinkage({
      store,
      tenantId,
      callerUserId: ownerId,
      nowIso,
    });
    expect(item?.freshness.status).toBe("live_query");
    expect(item?.freshness.lastSucceededAt).toBe(nowIso);
    expect(item?.freshness.lastMaterializedAt).toBeUndefined();
    expect(item?.freshness.claimsSynced).toBe(false);
    expect(item?.freshness.claimsIngested).toBe(false);
    expect(item?.freshness.healthy).toBe(false);
    expect(store.dataSources["src-site"]?.updatedAt).toBe(nowIso);
    expect(store.dataSources["src-site"]?.materializationCount ?? 0).toBe(0);
  });

  it("does not let a connection probe increase production verification or materialization", async () => {
    const store = normalizeEnterpriseDataStore(null);
    const source = siteSource(store);
    source.materializationCount = 3;
    source.lastSucceededAt = "2026-10-10T00:00:00.000Z";
    source.lastMaterializedAt = "2026-10-10T00:00:00.000Z";
    source.updatedAt = "2026-10-11T00:00:00.000Z";
    const saved = bridge({ verification: "failed" });
    store.sarExecutionBridges = { "bridge-1": saved };
    upsertConnectorAction({
      store,
      tenantId,
      nowIso,
      action: {
        connectorId: "site-session",
        actionKey: "read",
        version: "1",
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
      connectorId: "site-session",
      actionKey: "read",
      version: "1",
      handlerRef: "enterprise-data/sar-bridge/read",
    });
    const before = JSON.stringify({
      verification: saved.verification,
      updatedAt: saved.updatedAt,
      materializationCount: source.materializationCount,
      lastSucceededAt: source.lastSucceededAt,
      lastMaterializedAt: source.lastMaterializedAt,
      sourceUpdatedAt: source.updatedAt,
    });
    const probe = await probeDataSourceConnection({
      store,
      tenantId,
      connectorId: "site-session",
    });
    recordSourceConnectionCheck({
      store,
      tenantId,
      sourceId: source.sourceId,
      nowIso,
    });
    expect(probe.mode).toBe("website_session_not_verified");
    expect(probe.ok).toBe(false);
    expect(source.lastCheckedAt).toBe(nowIso);
    expect(
      JSON.stringify({
        verification: saved.verification,
        updatedAt: saved.updatedAt,
        materializationCount: source.materializationCount,
        lastSucceededAt: source.lastSucceededAt,
        lastMaterializedAt: source.lastMaterializedAt,
        sourceUpdatedAt: source.updatedAt,
      }),
    ).toBe(before);
    const [item] = buildDataAssetLinkage({
      store,
      tenantId,
      callerUserId: ownerId,
      nowIso,
    });
    expect(item?.verification.productionVerificationCount).toBe(0);
    expect(item?.freshness.materializationCount).toBe(3);
    expect(item?.connection.lastCheckedAt).toBe(nowIso);
  });

  it("keeps demo connectors labeled and outside production verification", async () => {
    const store = normalizeEnterpriseDataStore(null);
    store.dataSources["src-demo"] = {
      sourceId: "src-demo",
      tenantId,
      sourceKey: "crm-salesforce",
      displayName: "演示 CRM",
      category: "crm",
      status: "connected",
      connectorId: "crm-salesforce",
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const probe = await probeDataSourceConnection({
      store,
      tenantId,
      connectorId: "crm-salesforce",
    });
    recordSourceConnectionCheck({
      store,
      tenantId,
      sourceId: "src-demo",
      nowIso,
    });
    recordGovernedReadSuccess({
      store,
      tenantId,
      sourceId: "src-demo",
      nowIso,
    });
    const [item] = buildDataAssetLinkage({
      store,
      tenantId,
      callerUserId: null,
      nowIso,
    });
    expect(item?.demo).toBe(true);
    expect(probe.mode === "mock_smoke_ok" || !probe.ok).toBe(true);
    expect(item?.verification.healthy).toBe(false);
    expect(item?.verification.productionVerificationCount).toBe(0);
    expect(store.dataSources["src-demo"]?.lastSucceededAt).toBeUndefined();
    expect(store.dataSources["src-demo"]?.lastMaterializedAt).toBeUndefined();
    expect(store.dataSources["src-demo"]?.lastCheckedAt).toBe(nowIso);
    expect(
      recordMaterializedConnectorAction({
        store,
        tenantId,
        actionRef: { connectorId: "crm-salesforce", actionKey: "read", version: "1" },
        nowIso,
      }),
    ).toEqual([]);
    expect(store.dataSources["src-demo"]?.lastMaterializedAt).toBeUndefined();
    expect(store.dataSources["src-demo"]?.materializationCount ?? 0).toBe(0);
  });

  it("lets the account owner select a binding and refuses a private binding to an admin", () => {
    const store = normalizeEnterpriseDataStore(null);
    registerCallerAccountBinding({
      store,
      caller: { tenantId, userId: ownerId },
      bindingId: "bind-owner",
    });
    expect(
      resolveWebsiteAccessChoice({ store, caller: { tenantId, userId: ownerId } }).outcome,
    ).toBe("select_existing");
    expect(resolveWebsiteAccessChoice({ store, caller: { tenantId, userId: adminId } })).toEqual({
      outcome: "owner_must_authorize",
      selectable: [],
    });
    expect(resolveWebsiteAccessChoice({ store, caller: null })).toEqual({
      outcome: "owner_must_authorize",
      selectable: [],
    });
    expect(() =>
      registerCallerAccountBinding({
        store,
        caller: { tenantId, userId: adminId },
        bindingId: "bind-owner",
      }),
    ).toThrow(EnterpriseDataStoreError);
    expect(() =>
      assertWebsiteBindingAssignable({
        store,
        tenantId,
        callerUserId: adminId,
        bindingId: "bind-owner",
      }),
    ).toThrow(/不因企业管理员身份共享/);
    expect(() =>
      assertWebsiteBindingAssignable({
        store,
        tenantId,
        callerUserId: ownerId,
        bindingId: "bind-owner",
      }),
    ).not.toThrow();
  });

  it("resolves bidirectional links only inside the tenant", () => {
    const store = normalizeEnterpriseDataStore(null);
    siteSource(store);
    store.sarExecutionBridges = {
      "bridge-1": bridge(),
      "bridge-foreign": bridge({
        bridgeId: "bridge-foreign",
        tenantId: otherTenant,
        sourceId: "src-foreign",
        capabilityId: "sar.cap.read",
        skillId: "skill-site",
      }),
    };
    store.dataSources["src-foreign"] = {
      sourceId: "src-foreign",
      tenantId: otherTenant,
      sourceKey: "foreign",
      displayName: "别人的站",
      category: "external",
      status: "connected",
      connectorId: "site-session",
      bindingId: "bind-foreign",
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const owned = resolveOwnedAssetLinks({
      store,
      tenantId,
      capabilityId: "skill-site",
    });
    expect(owned.map((link) => link.sourceId)).toEqual(["src-site"]);
    expect(
      resolveOwnedAssetLinks({ store, tenantId: otherTenant, capabilityId: "skill-site" }).map(
        (link) => link.sourceId,
      ),
    ).toEqual(["src-foreign"]);
    const foreignView = buildDataAssetLinkage({
      store,
      tenantId: otherTenant,
      callerUserId: adminId,
      nowIso,
    });
    expect(foreignView.map((item) => item.sourceId)).toEqual(["src-foreign"]);
    expect(
      buildDataAssetLinkage({ store, tenantId, callerUserId: ownerId, nowIso }).some(
        (item) => item.sourceId === "src-foreign",
      ),
    ).toBe(false);
  });

  it("counts a materialization separately from a record edit", () => {
    const store = normalizeEnterpriseDataStore(null);
    const source = siteSource(store);
    const editedAt = source.updatedAt;
    const stamped = recordMaterializedConnectorAction({
      store,
      tenantId,
      actionRef: { connectorId: "site-session", actionKey: "read", version: "1" },
      nowIso,
    });
    expect(stamped).toEqual(["src-site"]);
    expect(source.lastMaterializedAt).toBe(nowIso);
    expect(source.materializationCount).toBe(1);
    expect(source.updatedAt).toBe(editedAt);
    const [item] = buildDataAssetLinkage({
      store,
      tenantId,
      callerUserId: null,
      nowIso,
    });
    expect(item?.freshness.status).toBe("fresh");
    expect(item?.freshness.claimsIngested).toBe(true);
    expect(item?.freshness.healthy).toBe(true);
  });
});
