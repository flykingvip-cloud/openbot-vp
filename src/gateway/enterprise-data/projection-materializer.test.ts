// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { upsertDataConnectorCredential } from "./connector-credential-store.js";
import { saveCredentialSecret } from "./connector-credential-vault.js";
import { ensureConnectorPackage } from "./connector-packages.js";
import { upsertDataSource } from "./data-source-store.js";
import { MATERIALIZER_SEAT_ID } from "./enterprise-data-seat-context.js";
import {
  listEnterpriseKnowledgeProjectionBindings,
  upsertEnterpriseKnowledgeProjectionBinding,
} from "./enterprise-knowledge-projection-binding-store.js";
import { findKnowledgeFeedItem } from "./knowledge-feed-item-store.js";
import { listKnowledgeLineageRecords } from "./knowledge-lineage-store.js";
import { lineageRecordsVerifiedSar } from "./knowledge-publication.js";
import { runProjectionMaterialization } from "./projection-materializer.js";
import { upsertEnterpriseKnowledgeProjectionSpec } from "./projection-spec-store.js";
import { applyProjectionTemplate } from "./projection-template-engine.js";
import { upsertScopePolicy } from "./scope-policy-store.js";
import { upsertSeatActionGrant } from "./seat-action-grant-store.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeEnterpriseDataStore } from "./store.js";

const yonyouVaultDir = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-yonyou-projection-${Date.now()}`,
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: yonyouVaultDir.tmpDir,
  };
});

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";

function seededStore() {
  const store = normalizeEnterpriseDataStore(null);
  seedEnterpriseDataCatalog({ store, tenantId, nowIso });
  return store;
}

function profileBindingId(store: ReturnType<typeof seededStore>): string {
  const binding = listEnterpriseKnowledgeProjectionBindings({
    store,
    tenantId,
  }).find((item) => {
    const spec = store.enterpriseKnowledgeProjectionSpecs[item.projectionId];
    return spec?.projectionKey === "customer.profile";
  });
  if (!binding) {
    throw new Error("profile binding not found");
  }
  return binding.bindingId;
}

describe("projection materializer M4", () => {
  it("materializes active projection through gateway and writes feed + lineage", async () => {
    const store = seededStore();
    const bindingId = profileBindingId(store);
    const result = await runProjectionMaterialization({
      store,
      tenantId,
      bindingId,
      nowIso,
    });
    expect(result.feedItem.title).toContain("画像");
    expect(result.feedItem.kind).toBe("data");
    expect(result.feedItem.sourceSystems).toEqual(["crm-salesforce"]);
    expect(result.feedItem.maskedFields.length).toBeGreaterThan(0);
    expect(result.gatewayTraceIds).toHaveLength(1);
    expect(findKnowledgeFeedItem(store, tenantId, result.objectId)).not.toBeNull();
    const lineage = listKnowledgeLineageRecords({ store, tenantId, objectId: result.objectId });
    expect(lineage).toHaveLength(1);
    expect(lineage[0]?.sourceActions).toEqual(["crm.customer.read_summary@v1"]);
    expect(lineage[0]?.sourceTraceIds).toHaveLength(1);
    expect(lineage[0]?.sarVersion).toBeUndefined();
    expect(lineage[0]?.validator).toBeUndefined();
    expect(lineageRecordsVerifiedSar(lineage[0])).toBe(false);
    expect(result.feedItem.publication).toBe("complete");
  });

  it("uses binding materializationTeamLabel for gateway scope", async () => {
    const store = seededStore();
    const bindingId = profileBindingId(store);
    store.enterpriseKnowledgeProjectionBindings[bindingId].materializationTeamLabel = "华北销售";
    const north = await runProjectionMaterialization({ store, tenantId, bindingId, nowIso });
    expect(north.feedItem.title).toContain("华北客户C");

    store.enterpriseKnowledgeProjectionBindings[bindingId].materializationTeamLabel = "华东销售";
    const east = await runProjectionMaterialization({ store, tenantId, bindingId, nowIso });
    expect(east.feedItem.title).toContain("华东客户");
  });

  it("rejects draft projection lifecycle", async () => {
    const store = seededStore();
    const bindingId = profileBindingId(store);
    const binding = store.enterpriseKnowledgeProjectionBindings[bindingId];
    // The seeded churn-risk spec is active so scheduled refresh can run.
    // Draft rejection is checked by flipping this spec, not by assuming the seed.
    store.enterpriseKnowledgeProjectionSpecs[binding.projectionId].lifecycle = "draft";
    try {
      await runProjectionMaterialization({
        store,
        tenantId,
        bindingId,
        nowIso,
      });
      expect.fail("expected draft projection to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(EnterpriseDataStoreError);
      expect((error as EnterpriseDataStoreError).code).toBe("PROJECTION_NOT_ACTIVE");
    }
  });

  it("rejects disabled binding", async () => {
    const store = seededStore();
    const bindingId = profileBindingId(store);
    store.enterpriseKnowledgeProjectionBindings[bindingId].enabled = false;
    try {
      await runProjectionMaterialization({ store, tenantId, bindingId, nowIso });
      expect.fail("expected disabled binding to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(EnterpriseDataStoreError);
      expect((error as EnterpriseDataStoreError).code).toBe("PROJECTION_BINDING_DISABLED");
    }
  });

  it("rejects specs that omit sourceActions even when a capability is linked", () => {
    const store = seededStore();
    const capability = Object.values(store.dataCapabilities).find(
      (item) => item.capabilityKey === "customer.profile",
    );
    expect(capability).toBeTruthy();
    try {
      upsertEnterpriseKnowledgeProjectionSpec({
        store,
        tenantId,
        nowIso,
        spec: {
          projectionKey: "implicit.source.bad",
          displayName: "Implicit Source",
          category: "customer",
          capabilityId: capability!.capabilityId,
          sourceActions: [],
          objectKind: "data",
          templateKey: "NormalizeTemplate",
          description: "must not derive sourceActions from the capability",
          outputSchema: { type: "object" },
          lifecycle: "draft",
        },
      });
      expect.fail("expected missing sourceActions to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(EnterpriseDataStoreError);
      expect((error as EnterpriseDataStoreError).code).toBe("PROJECTION_SOURCE_ACTIONS_REQUIRED");
    }
  });

  it("rejects sourceActions that are not on the linked capability", () => {
    const store = seededStore();
    const capability = Object.values(store.dataCapabilities).find(
      (item) => item.capabilityKey === "customer.profile",
    );
    expect(capability).toBeTruthy();
    try {
      upsertEnterpriseKnowledgeProjectionSpec({
        store,
        tenantId,
        nowIso,
        spec: {
          projectionKey: "capability.mismatch",
          displayName: "Capability Mismatch",
          category: "customer",
          capabilityId: capability!.capabilityId,
          sourceActions: [
            {
              connectorId: "erp-sap",
              actionKey: "erp.order.read_status",
              version: "v1",
            },
          ],
          objectKind: "data",
          templateKey: "NormalizeTemplate",
          description: "explicit action must still align with the capability",
          outputSchema: { type: "object" },
          lifecycle: "draft",
        },
      });
      expect.fail("expected mismatched sourceAction to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(EnterpriseDataStoreError);
      expect((error as EnterpriseDataStoreError).code).toBe(
        "PROJECTION_SOURCE_ACTION_NOT_IN_CAPABILITY",
      );
    }
  });

  it("rejects multi-source projection specs", async () => {
    const store = seededStore();
    try {
      upsertEnterpriseKnowledgeProjectionSpec({
        store,
        tenantId,
        nowIso,
        spec: {
          projectionKey: "multi.source.bad",
          displayName: "Bad Multi Source",
          category: "customer",
          sourceActions: [
            {
              connectorId: "crm-salesforce",
              actionKey: "crm.customer.read_summary",
              version: "v1",
            },
            {
              connectorId: "crm-salesforce",
              actionKey: "crm.customer.read_summary",
              version: "v2",
            },
          ],
          objectKind: "data",
          templateKey: "NormalizeTemplate",
          description: "invalid multi source",
          outputSchema: { type: "object" },
          lifecycle: "active",
        },
      });
      expect.fail("expected multi-source projection to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(EnterpriseDataStoreError);
      expect((error as EnterpriseDataStoreError).code).toBe("PROJECTION_SINGLE_SOURCE_REQUIRED");
    }
  });

  it("applies RiskDetectionTemplate from gateway payload", async () => {
    const result = applyProjectionTemplate({
      templateKey: "RiskDetectionTemplate",
      spec: {
        projectionKey: "sales.churn-risk",
        displayName: "客户流失风险洞察",
        objectKind: "insight",
        category: "sales",
      },
      gatewayData: {
        customer: {
          id: "cust-002",
          name: "华东客户B",
          segment: "enterprise",
        },
      },
      gatewayResponse: { maskedFields: [], scopeApplied: "团队数据（华东销售）" },
    });
    expect(result.title).toContain("流失风险");
    expect(result.payload.riskLevel).toBe("low");
  });

  it("rejects template keys outside the five declarative templates", () => {
    expect(() =>
      applyProjectionTemplate({
        templateKey: "SqlTemplate" as never,
        spec: {
          projectionKey: "sql.bad",
          displayName: "SQL",
          objectKind: "data",
          category: "customer",
        },
        gatewayData: { sql: "select 1" },
        gatewayResponse: { maskedFields: [], scopeApplied: "all" },
      }),
    ).toThrow(/Unsupported projection template/);
  });
});

describe("yonyou projection cursor window", () => {
  const tenantId = "tenant-jingshanzi";
  const sourceId = "src-yonyou";
  const nowIso = "2026-10-22T06:00:00.000Z";

  it("sends the stored inventory cursor on materialization and keeps an explicit window", async () => {
    fs.rmSync(yonyouVaultDir.tmpDir, { recursive: true, force: true });
    fs.mkdirSync(yonyouVaultDir.tmpDir, { recursive: true });
    const store = normalizeEnterpriseDataStore({});
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    ensureConnectorPackage({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      nowIso,
    });
    const credential = upsertDataConnectorCredential({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      label: "京扇子 T+",
      kind: "oauth2",
      nowIso,
    });
    await saveCredentialSecret(credential.credentialId, {
      oauthAccessToken: "simulated-yonyou-tplus-token-abc",
    });
    upsertDataSource({
      store,
      tenantId,
      nowIso,
      source: {
        sourceId,
        sourceKey: "yonyou-tplus",
        displayName: "用友 T+",
        category: "erp",
        status: "connected",
        connectorId: "erp-yonyou-tplus",
        credentialId: credential.credentialId,
      },
    });
    upsertScopePolicy({
      store,
      tenantId,
      nowIso,
      policy: {
        scopePolicyId: "scope-all-readonly",
        displayName: "全量只读范围",
        scopeType: "ALL",
        filterDescription: "租户内全量只读",
      },
    });
    upsertSeatActionGrant({
      store,
      tenantId,
      seatId: MATERIALIZER_SEAT_ID,
      connectorId: "erp-yonyou-tplus",
      actionKey: "erp.inventory.query_page",
      version: "v1",
      scopePolicyId: "scope-all-readonly",
      nowIso,
    });
    const cursorId = `${sourceId}::inventory`;
    store.connectorSyncCursors ??= {};
    store.connectorSyncCursors[cursorId] = {
      cursorId,
      tenantId,
      sourceId,
      streamKey: "inventory",
      watermark: "2026-10-20 00:00:00",
      updatedAt: "2026-10-21T00:00:00.000Z",
    };
    const spec = upsertEnterpriseKnowledgeProjectionSpec({
      store,
      tenantId,
      nowIso,
      spec: {
        projectionKey: "erp.inventory.incremental",
        displayName: "存货增量",
        category: "inventory",
        sourceId,
        sourceActions: [
          {
            connectorId: "erp-yonyou-tplus",
            actionKey: "erp.inventory.query_page",
            version: "v1",
          },
        ],
        objectKind: "data",
        templateKey: "NormalizeTemplate",
        description: "用友存货按同步水位读取一页",
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
        materializationMode: "on_demand",
        materializationTeamLabel: "京扇子",
        enabled: true,
        generatorVersion: "yonyou-cursor-1",
      },
    });
    const result = await runProjectionMaterialization({
      store,
      tenantId,
      bindingId: binding.bindingId,
      nowIso,
    });
    expect(result.feedItem.payload.query).toEqual({
      param: {
        PageSize: "100",
        PageIndex: "1",
        SelectFields: "ID,Code,Name,Specification,InvSCost,LatestCost,AvagCost,RetailPriceNew",
        UpdateDateBegin: "2026-10-20 00:00:00",
        UpdateDateEnd: "2026-10-22 06:00:00",
      },
    });
    expect(result.feedItem.title).toBe("存货增量");

    const pinned = await runProjectionMaterialization({
      store,
      tenantId,
      bindingId: binding.bindingId,
      nowIso,
      input: {
        param: {
          UpdateDateBegin: "2026-01-01 00:00:00",
          UpdateDateEnd: "2026-01-02 00:00:00",
        },
      },
    });
    expect(pinned.feedItem.payload.query).toEqual({
      param: {
        UpdateDateBegin: "2026-01-01 00:00:00",
        UpdateDateEnd: "2026-01-02 00:00:00",
      },
    });
  });

  it("does not inject UpdateDate cursor for AggregateTemplate inventory", async () => {
    fs.rmSync(yonyouVaultDir.tmpDir, { recursive: true, force: true });
    fs.mkdirSync(yonyouVaultDir.tmpDir, { recursive: true });
    const store = normalizeEnterpriseDataStore({});
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    ensureConnectorPackage({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      nowIso,
    });
    const credential = upsertDataConnectorCredential({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      label: "京扇子 T+",
      kind: "oauth2",
      nowIso,
    });
    await saveCredentialSecret(credential.credentialId, {
      oauthAccessToken: "simulated-yonyou-tplus-token-abc",
    });
    upsertDataSource({
      store,
      tenantId,
      nowIso,
      source: {
        sourceId,
        sourceKey: "yonyou-tplus",
        displayName: "用友 T+",
        category: "erp",
        status: "connected",
        connectorId: "erp-yonyou-tplus",
        credentialId: credential.credentialId,
      },
    });
    upsertScopePolicy({
      store,
      tenantId,
      nowIso,
      policy: {
        scopePolicyId: "scope-all-readonly",
        displayName: "全量只读范围",
        scopeType: "ALL",
        filterDescription: "租户内全量只读",
      },
    });
    upsertSeatActionGrant({
      store,
      tenantId,
      seatId: MATERIALIZER_SEAT_ID,
      connectorId: "erp-yonyou-tplus",
      actionKey: "erp.inventory.query_page",
      version: "v1",
      scopePolicyId: "scope-all-readonly",
      nowIso,
    });
    const cursorId = `${sourceId}::inventory`;
    store.connectorSyncCursors ??= {};
    store.connectorSyncCursors[cursorId] = {
      cursorId,
      tenantId,
      sourceId,
      streamKey: "inventory",
      watermark: "2026-10-20 00:00:00",
      updatedAt: "2026-10-21T00:00:00.000Z",
    };
    const spec = upsertEnterpriseKnowledgeProjectionSpec({
      store,
      tenantId,
      nowIso,
      spec: {
        projectionKey: "erp.inventory.aggregate",
        displayName: "001-用友T+存货",
        category: "inventory",
        sourceId,
        sourceActions: [
          {
            connectorId: "erp-yonyou-tplus",
            actionKey: "erp.inventory.query_page",
            version: "v1",
          },
        ],
        objectKind: "data",
        templateKey: "AggregateTemplate",
        description: "用友存货汇总，不应用同步水位窗",
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
        materializationMode: "on_demand",
        materializationTeamLabel: "京扇子",
        enabled: true,
        generatorVersion: "yonyou-aggregate-1",
      },
    });
    const result = await runProjectionMaterialization({
      store,
      tenantId,
      bindingId: binding.bindingId,
      nowIso,
    });
    const query = result.feedItem.payload.query as Record<string, unknown> | undefined;
    expect(query).toBeUndefined();
    expect(result.feedItem.payload.count).toBeGreaterThanOrEqual(1);
    expect(result.feedItem.title).toContain("汇总");
  });
});
