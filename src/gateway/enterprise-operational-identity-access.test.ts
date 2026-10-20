import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EnterpriseDataStoreError } from "./enterprise-data/connector-action-store.js";
import { assertNoClientExecutionIdentity } from "./enterprise-data/enterprise-data-seat-context.js";
import {
  ENTERPRISE_DATA_STORE_VERSION,
  type EnterpriseDataStore,
} from "./enterprise-data/types.js";
import {
  listOperationalIdentityAccessForSeat,
  listOperationalIdentityAccessForSeatAgent,
  recordOperationalIdentityUsage,
  recordOperationalIdentityUsageDenied,
  resolveOperationalIdentityAccess,
} from "./enterprise-operational-identity-access.js";
import {
  createDataSourceIdentityBinding,
  registerEnterpriseIdentity,
  upsertIdentityUsagePolicy,
} from "./enterprise-operational-identity-store.js";
import { normalizeEnterpriseSeatAssetsStore } from "./enterprise-seat-assets-backend.js";
import {
  registerConnectorCredentialBinding,
  type EnterpriseSeatAssetsStore,
} from "./enterprise-seat-assets-store.js";

function createTestStore(): EnterpriseSeatAssetsStore {
  return normalizeEnterpriseSeatAssetsStore(null, 4);
}

function createTestDataStore(params: {
  tenantId: string;
  sourceId: string;
  nowIso: string;
}): EnterpriseDataStore {
  return {
    version: ENTERPRISE_DATA_STORE_VERSION,
    connectorActions: {},
    connectorRuntimeRegistry: {},
    dataConnectorCredentials: {},
    seatActionGrants: {},
    scopePolicies: {},
    fieldClassifications: {},
    maskingPolicies: {},
    classificationRuntimeConfigs: {},
    approvalPolicies: {},
    approvalRequests: {},
    invocationAuditEvents: {},
    dataAuditEvents: {},
    dataSources: {
      [params.sourceId]: {
        sourceId: params.sourceId,
        tenantId: params.tenantId,
        sourceKey: params.sourceId,
        displayName: params.sourceId,
        category: "crm",
        status: "connected",
        connectorId: "crm",
        createdAt: params.nowIso,
        updatedAt: params.nowIso,
      },
    },
    dataCapabilities: {},
    dataAccessPolicies: {},
    enterpriseKnowledgeProjectionSpecs: {},
    enterpriseKnowledgeProjectionBindings: {},
    knowledgeVisibilityPolicies: {},
    knowledgeFeedItems: {},
    knowledgeLineageRecords: {},
    knowledgeSupplyAuditEvents: {},
    governanceApprovalRequests: {},
  };
}

describe("enterprise operational identity access", () => {
  it("allows seat + agent + action when policy matches", () => {
    const store = createTestStore();
    const nowIso = "2026-06-06T12:00:00.000Z";
    store.seats["seat-1"] = {
      seatId: "seat-1",
      tenantId: "acme",
      title: "Ops",
      status: "occupied",
      defaultSpaceIds: [],
      defaultAgentAssetIds: ["agent-1"],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const credential = registerConnectorCredentialBinding({
      store,
      tenantId: "acme",
      connectorId: "wechat-official",
      ownerType: "seat",
      ownerId: "seat-1",
      nowIso,
    });
    const identity = registerEnterpriseIdentity({
      store,
      tenantId: "acme",
      displayName: "Mail Bot",
      credentialBindingId: credential.credentialBindingId,
      nowIso,
    });
    expect(identity.ok).toBe(true);
    if (!identity.ok) {
      return;
    }
    upsertIdentityUsagePolicy({
      store,
      tenantId: "acme",
      identityId: identity.identity.identityId,
      seatIds: ["seat-1"],
      allowedAgentIds: ["agent-1"],
      allowedActions: ["publish_article"],
      nowIso,
    });

    const allowed = resolveOperationalIdentityAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      identityId: identity.identity.identityId,
      action: "publish_article",
      nowIso,
    });
    expect(allowed.allowed).toBe(true);

    const denied = resolveOperationalIdentityAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      identityId: identity.identity.identityId,
      action: "upload_thumb",
      nowIso,
    });
    expect(denied.allowed).toBe(false);
  });

  it("denies when agent seat is not covered by policy seatIds", () => {
    const store = createTestStore();
    const nowIso = "2026-06-06T12:00:00.000Z";
    store.seats["seat-1"] = {
      seatId: "seat-1",
      tenantId: "acme",
      title: "Ops",
      status: "occupied",
      defaultSpaceIds: [],
      defaultAgentAssetIds: ["agent-1"],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    store.seats["seat-2"] = {
      seatId: "seat-2",
      tenantId: "acme",
      title: "Other",
      status: "occupied",
      defaultSpaceIds: [],
      defaultAgentAssetIds: ["agent-2"],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const credential = registerConnectorCredentialBinding({
      store,
      tenantId: "acme",
      connectorId: "wechat-official",
      ownerType: "seat",
      ownerId: "seat-1",
      nowIso,
    });
    const identity = registerEnterpriseIdentity({
      store,
      tenantId: "acme",
      displayName: "WeChat Official",
      credentialBindingId: credential.credentialBindingId,
      nowIso,
    });
    expect(identity.ok).toBe(true);
    if (!identity.ok) {
      return;
    }
    upsertIdentityUsagePolicy({
      store,
      tenantId: "acme",
      identityId: identity.identity.identityId,
      seatIds: ["seat-1"],
      allowedAgentIds: ["agent-2"],
      allowedActions: ["publish_article"],
      nowIso,
    });

    const result = resolveOperationalIdentityAccess({
      store,
      tenantId: "acme",
      seatId: "seat-2",
      agentId: "agent-2",
      identityId: identity.identity.identityId,
      action: "publish_article",
      nowIso,
    });
    expect(result.allowed).toBe(false);
  });

  it("lists agent operational identity access without data grants", () => {
    const store = createTestStore();
    const nowIso = "2026-06-06T12:00:00.000Z";
    store.seats["seat-1"] = {
      seatId: "seat-1",
      tenantId: "acme",
      title: "Ops",
      status: "occupied",
      defaultSpaceIds: [],
      defaultAgentAssetIds: ["agent-1"],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const credential = registerConnectorCredentialBinding({
      store,
      tenantId: "acme",
      connectorId: "weibo",
      ownerType: "seat",
      ownerId: "seat-1",
      nowIso,
    });
    const identity = registerEnterpriseIdentity({
      store,
      tenantId: "acme",
      displayName: "Weibo",
      credentialBindingId: credential.credentialBindingId,
      nowIso,
    });
    expect(identity.ok).toBe(true);
    if (!identity.ok) {
      return;
    }
    upsertIdentityUsagePolicy({
      store,
      tenantId: "acme",
      identityId: identity.identity.identityId,
      seatIds: ["seat-1"],
      allowedAgentIds: [],
      allowedActions: ["post_status"],
      nowIso,
    });

    const entries = listOperationalIdentityAccessForSeatAgent({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      nowIso,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.allowedActions).toEqual(["post_status"]);
  });

  it("lists seat catalog and agent access without allowedAgentIds gating", () => {
    const store = createTestStore();
    const nowIso = "2026-06-06T12:00:00.000Z";
    store.seats["seat-1"] = {
      seatId: "seat-1",
      tenantId: "acme",
      title: "Ops",
      status: "occupied",
      defaultSpaceIds: [],
      defaultAgentAssetIds: ["agent-1", "agent-2"],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const credential = registerConnectorCredentialBinding({
      store,
      tenantId: "acme",
      connectorId: "weibo",
      ownerType: "seat",
      ownerId: "seat-1",
      nowIso,
    });
    const identity = registerEnterpriseIdentity({
      store,
      tenantId: "acme",
      displayName: "Weibo",
      credentialBindingId: credential.credentialBindingId,
      nowIso,
    });
    expect(identity.ok).toBe(true);
    if (!identity.ok) {
      return;
    }
    upsertIdentityUsagePolicy({
      store,
      tenantId: "acme",
      identityId: identity.identity.identityId,
      seatIds: ["seat-1"],
      allowedAgentIds: ["agent-1"],
      allowedActions: ["post_status"],
      nowIso,
    });

    const seatCatalog = listOperationalIdentityAccessForSeat({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      nowIso,
    });
    expect(seatCatalog).toHaveLength(1);

    const agentTwoAccess = listOperationalIdentityAccessForSeatAgent({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-2",
      nowIso,
    });
    expect(agentTwoAccess).toHaveLength(1);
    expect(agentTwoAccess[0]?.identityId).toBe(identity.identity.identityId);
  });

  it("records identity.usage_denied audit events", () => {
    const store = createTestStore();
    const nowIso = "2026-06-06T12:00:00.000Z";
    recordOperationalIdentityUsageDenied({
      store,
      tenantId: "acme",
      identityId: "missing",
      seatId: "seat-1",
      agentId: "agent-1",
      action: "send_email",
      code: "IDENTITY_ACTION_DENIED",
      message: "denied",
      nowIso,
    });
    expect(
      Object.values(store.auditEvents).some((event) => event.eventType === "identity.usage_denied"),
    ).toBe(true);
  });

  it("closes PDP accessDecision.meta into usage and usage_denied audit metadata", () => {
    const store = createTestStore();
    const nowIso = "2026-09-25T02:00:00.000Z";
    const meta = {
      policyVersion: "2",
      policyVersionAtGrant: "1",
      grantMode: "explicit_owner_grant",
      grantStatus: "active",
      tenantGrantMode: "explicit_owner_grant",
      enrollmentId: "enroll-1",
      risk: "high",
    };
    recordOperationalIdentityUsageDenied({
      store,
      tenantId: "acme",
      identityId: "id-1",
      seatId: "seat-1",
      agentId: "agent-1",
      action: "publish_article",
      code: "OWNER_GRANT_POLICY_VERSION_MISMATCH",
      message: "version mismatch",
      nowIso,
      meta,
    });
    recordOperationalIdentityUsage({
      store,
      tenantId: "acme",
      identityId: "id-1",
      seatId: "seat-1",
      agentId: "agent-1",
      action: "publish_draft",
      nowIso,
      meta: { ...meta, risk: "low" },
    });
    const denied = Object.values(store.auditEvents).find(
      (event) => event.eventType === "identity.usage_denied",
    );
    const used = Object.values(store.auditEvents).find(
      (event) => event.eventType === "identity.used",
    );
    for (const key of [
      "policyVersion",
      "policyVersionAtGrant",
      "grantMode",
      "grantStatus",
      "tenantGrantMode",
      "enrollmentId",
      "risk",
    ] as const) {
      expect(denied?.metadata?.[key]).toBe(meta[key]);
    }
    expect(used?.metadata?.policyVersion).toBe("2");
    expect(used?.metadata?.policyVersionAtGrant).toBe("1");
    expect(used?.metadata?.grantMode).toBe("explicit_owner_grant");
    expect(used?.metadata?.tenantGrantMode).toBe("explicit_owner_grant");
    expect(used?.metadata?.enrollmentId).toBe("enroll-1");
    expect(used?.metadata?.risk).toBe("low");
  });

  it("rejects operational identity fields on enterprise-data invoke params", () => {
    expect(() =>
      assertNoClientExecutionIdentity({
        connectorId: "crm",
        identityId: randomUUID(),
      }),
    ).toThrow(EnterpriseDataStoreError);
  });
});

describe("data source identity binding linkage", () => {
  it("creates binding without seat action grants", () => {
    const store = createTestStore();
    const nowIso = "2026-06-06T12:00:00.000Z";
    store.seats["seat-1"] = {
      seatId: "seat-1",
      tenantId: "acme",
      title: "Ops",
      status: "occupied",
      defaultSpaceIds: [],
      defaultAgentAssetIds: ["agent-1"],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const credential = registerConnectorCredentialBinding({
      store,
      tenantId: "acme",
      connectorId: "wechat-official",
      ownerType: "seat",
      ownerId: "seat-1",
      nowIso,
    });
    const identity = registerEnterpriseIdentity({
      store,
      tenantId: "acme",
      displayName: "Mailbox",
      credentialBindingId: credential.credentialBindingId,
      nowIso,
    });
    expect(identity.ok).toBe(true);
    if (!identity.ok) {
      return;
    }
    const binding = createDataSourceIdentityBinding({
      store,
      tenantId: "acme",
      identityId: identity.identity.identityId,
      dataSourceId: "source-crm-1",
      purpose: "source_authentication",
      dataSourceStore: createTestDataStore({
        tenantId: "acme",
        sourceId: "source-crm-1",
        nowIso,
      }),
      nowIso,
    });
    expect(binding.ok).toBe(true);
    expect(Object.keys(store.accessPolicies)).toHaveLength(0);
  });

  it("rejects data source identity binding when dataSourceId does not exist", () => {
    const store = createTestStore();
    const nowIso = "2026-06-06T00:00:00.000Z";
    const dataSourceStore = createTestDataStore({
      tenantId: "acme",
      sourceId: "source-crm-1",
      nowIso,
    });
    store.seats["seat-1"] = {
      seatId: "seat-1",
      tenantId: "acme",
      title: "Ops",
      status: "occupied",
      defaultSpaceIds: [],
      defaultAgentAssetIds: ["agent-1"],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const credential = registerConnectorCredentialBinding({
      store,
      tenantId: "acme",
      connectorId: "wechat-official",
      ownerType: "seat",
      ownerId: "seat-1",
      nowIso,
    });
    const identity = registerEnterpriseIdentity({
      store,
      tenantId: "acme",
      displayName: "Mailbox",
      credentialBindingId: credential.credentialBindingId,
      nowIso,
    });
    expect(identity.ok).toBe(true);
    if (!identity.ok) {
      return;
    }
    const binding = createDataSourceIdentityBinding({
      store,
      tenantId: "acme",
      identityId: identity.identity.identityId,
      dataSourceId: "missing-source",
      purpose: "source_sync",
      dataSourceStore,
      nowIso,
    });
    expect(binding.ok).toBe(false);
    if (binding.ok) {
      return;
    }
    expect(binding.code).toBe("ENTERPRISE_IDENTITY_DATASOURCE_NOT_FOUND");
  });
});
