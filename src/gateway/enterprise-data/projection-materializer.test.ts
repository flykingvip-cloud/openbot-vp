// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { listEnterpriseKnowledgeProjectionBindings } from "./enterprise-knowledge-projection-binding-store.js";
import { findKnowledgeFeedItem } from "./knowledge-feed-item-store.js";
import { listKnowledgeLineageRecords } from "./knowledge-lineage-store.js";
import { lineageRecordsVerifiedSar } from "./knowledge-publication.js";
import { runProjectionMaterialization } from "./projection-materializer.js";
import { upsertEnterpriseKnowledgeProjectionSpec } from "./projection-spec-store.js";
import { applyProjectionTemplate } from "./projection-template-engine.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeEnterpriseDataStore } from "./store.js";

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
