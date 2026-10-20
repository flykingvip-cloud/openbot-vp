// @vitest-environment node
import { describe, expect, it } from "vitest";
import { listEnterpriseKnowledgeProjectionBindings } from "./enterprise-knowledge-projection-binding-store.js";
import { upsertKnowledgeFeedItem } from "./knowledge-feed-item-store.js";
import { listKnowledgeSupplyAuditEvents } from "./knowledge-supply-audit-store.js";
import {
  resolveAuditLineageOverview,
  resolveKnowledgeLineageChain,
} from "./lineage-governance-store.js";
import { runProjectionMaterialization } from "./projection-materializer.js";
import { upsertEnterpriseKnowledgeProjectionSpec } from "./projection-spec-store.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeEnterpriseDataStore } from "./store.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";

describe("lineage governance M5", () => {
  it("resolves feed -> projection -> capability -> source -> action -> trace chain", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const binding = listEnterpriseKnowledgeProjectionBindings({ store, tenantId }).find((item) => {
      const spec = store.enterpriseKnowledgeProjectionSpecs[item.projectionId];
      return spec?.projectionKey === "customer.profile";
    });
    const result = await runProjectionMaterialization({
      store,
      tenantId,
      bindingId: binding!.bindingId,
      nowIso,
    });
    const resolution = resolveKnowledgeLineageChain({
      store,
      tenantId,
      objectId: result.objectId,
    });
    const layers = resolution.chain.map((node) => node.layer);
    expect(layers).toContain("feed_item");
    expect(layers).toContain("projection");
    expect(layers).toContain("capability");
    expect(layers).toContain("data_source");
    expect(layers).toContain("connector_action");
    expect(layers).toContain("invocation_trace");
    expect(layers.indexOf("feed_item")).toBeLessThan(layers.indexOf("projection"));
    expect(layers.indexOf("connector_action")).toBeLessThan(layers.indexOf("invocation_trace"));
    const reverseRoles = resolution.reverseChain.map((node) => node.role);
    expect(reverseRoles[0]).toBe("projection");
    expect(reverseRoles).not.toContain("insight");
    expect(reverseRoles).not.toContain("metric");
    expect(reverseRoles.indexOf("connector_action")).toBeLessThan(
      reverseRoles.indexOf("source_data"),
    );
    const action = resolution.reverseChain.find((node) => node.role === "connector_action");
    expect(action?.refs).toMatchObject({
      connectorId: "crm-salesforce",
      actionKey: "crm.customer.read_summary",
      version: "v1",
    });
    expect(action?.id).toBe("crm-salesforce::crm.customer.read_summary@v1");
  });

  it("answers Insight → Metric → Projection → ConnectorAction@version → Source Data", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const churnCapability = Object.values(store.dataCapabilities).find(
      (item) => item.tenantId === tenantId && item.capabilityKey === "sales.churn-risk",
    )!;
    const orderCapability = Object.values(store.dataCapabilities).find(
      (item) => item.tenantId === tenantId && item.capabilityKey === "order.status",
    )!;
    const metricProjection = upsertEnterpriseKnowledgeProjectionSpec({
      store,
      tenantId,
      nowIso,
      spec: {
        projectionKey: "sales.churn-score",
        displayName: "流失风险指标",
        category: "sales",
        capabilityId: churnCapability.capabilityId,
        sourceActions: [
          {
            connectorId: "crm-salesforce",
            actionKey: "crm.customer.read_summary",
            version: "v2",
          },
        ],
        objectKind: "metric",
        templateKey: "AggregateTemplate",
        description: "流失风险指标",
        outputSchema: { type: "object" },
        lifecycle: "active",
      },
    });
    const decoyProjection = upsertEnterpriseKnowledgeProjectionSpec({
      store,
      tenantId,
      nowIso,
      spec: {
        projectionKey: "order.backlog",
        displayName: "订单积压指标",
        category: "inventory",
        capabilityId: orderCapability.capabilityId,
        sourceActions: [
          {
            connectorId: "erp-sap",
            actionKey: "erp.order.read_status",
            version: "v1",
          },
        ],
        objectKind: "metric",
        templateKey: "AggregateTemplate",
        description: "另一能力的指标，不能串到流失洞察",
        outputSchema: { type: "object" },
        lifecycle: "active",
      },
    });
    upsertKnowledgeFeedItem({
      store,
      tenantId,
      nowIso,
      item: {
        projectionId: decoyProjection.projectionId,
        title: "订单积压",
        kind: "metric",
        category: "inventory",
        sourceSystems: ["erp-sap"],
        scopeApplied: "TEAM",
        maskedFields: [],
        generatedAt: "2026-06-05T18:00:00.000Z",
        traceRefs: [],
        payload: {},
      },
    });
    const metric = upsertKnowledgeFeedItem({
      store,
      tenantId,
      nowIso,
      item: {
        projectionId: metricProjection.projectionId,
        title: "流失评分",
        kind: "metric",
        category: "sales",
        sourceSystems: ["crm-salesforce"],
        scopeApplied: "TEAM",
        maskedFields: [],
        generatedAt: "2026-06-05T11:00:00.000Z",
        traceRefs: [],
        payload: {},
      },
    });
    const churnBinding = listEnterpriseKnowledgeProjectionBindings({ store, tenantId }).find(
      (item) => {
        const spec = store.enterpriseKnowledgeProjectionSpecs[item.projectionId];
        return spec?.projectionKey === "sales.churn-risk";
      },
    );
    const insight = await runProjectionMaterialization({
      store,
      tenantId,
      bindingId: churnBinding!.bindingId,
      nowIso,
    });
    const resolution = resolveKnowledgeLineageChain({
      store,
      tenantId,
      objectId: insight.objectId,
    });
    expect(resolution.reverseChain.map((node) => node.role)).toEqual([
      "insight",
      "metric",
      "projection",
      "connector_action",
      "source_data",
    ]);
    expect(resolution.reverseChain[1]).toMatchObject({
      role: "metric",
      id: metric.objectId,
      label: "流失评分",
    });
    expect(resolution.reverseChain[3]?.refs).toMatchObject({
      connectorId: "crm-salesforce",
      actionKey: "crm.customer.read_summary",
      version: "v2",
    });
    const source = resolution.reverseChain[4];
    expect(source?.role).toBe("source_data");
    expect(source?.refs).toMatchObject({ connectorId: "crm-salesforce" });
    const overview = resolveAuditLineageOverview({ store, tenantId });
    expect(overview.recentReverseChain.map((node) => node.role)).toEqual([
      "insight",
      "metric",
      "projection",
      "connector_action",
      "source_data",
    ]);
  });

  it("records supply audit on success and failure", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const binding = listEnterpriseKnowledgeProjectionBindings({ store, tenantId }).find((item) => {
      const spec = store.enterpriseKnowledgeProjectionSpecs[item.projectionId];
      return spec?.projectionKey === "customer.profile";
    });
    await runProjectionMaterialization({ store, tenantId, bindingId: binding!.bindingId, nowIso });
    const churnBinding = listEnterpriseKnowledgeProjectionBindings({ store, tenantId }).find(
      (item) => {
        const spec = store.enterpriseKnowledgeProjectionSpecs[item.projectionId];
        return spec?.projectionKey === "sales.churn-risk";
      },
    );
    // Force a known failure path: lifecycle gate (seeded churn is active for scheduled demos).
    const churnSpec = store.enterpriseKnowledgeProjectionSpecs[churnBinding!.projectionId];
    churnSpec.lifecycle = "draft";
    try {
      await runProjectionMaterialization({
        store,
        tenantId,
        bindingId: churnBinding!.bindingId,
        nowIso,
      });
    } catch {
      // draft projection expected to fail materialization
    }
    const events = listKnowledgeSupplyAuditEvents({ store, tenantId });
    expect(events.some((event) => event.status === "success")).toBe(true);
    expect(events.some((event) => event.status === "failure")).toBe(true);
  });
});
