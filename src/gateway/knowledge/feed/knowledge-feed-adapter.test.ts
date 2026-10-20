// @vitest-environment node
import { describe, expect, it } from "vitest";
import { listEnterpriseKnowledgeProjectionBindings } from "../../enterprise-data/enterprise-knowledge-projection-binding-store.js";
import { runProjectionMaterialization } from "../../enterprise-data/projection-materializer.js";
import { seedEnterpriseDataCatalog } from "../../enterprise-data/seeds.js";
import { normalizeEnterpriseDataStore } from "../../enterprise-data/store.js";
import { loadKnowledgeFeedBundle } from "./knowledge-feed-adapter.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";

describe("knowledge feed adapter M6", () => {
  it("does not publish projection specs that have no persisted feed item", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const bundle = loadKnowledgeFeedBundle({
      store,
      context: {
        tenantId,
        seatId: "seat-sales-director",
        userId: "employee-1",
        agentType: "employee-agent",
        hasEnterpriseScope: true,
      },
    });
    expect(bundle.feedItems.filter((item) => item.source === "enterprise")).toEqual([]);
    expect(bundle.feedItems.filter((item) => item.source === "data")).toEqual([]);
    expect(bundle.enterpriseAccessible).toEqual([]);
    expect(bundle.enterpriseRestricted).toEqual([]);
    expect(bundle.dataObjects).toEqual([]);
  });

  it("publishes materialized enterprise feed items with lineage and freshness", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const binding = listEnterpriseKnowledgeProjectionBindings({ store, tenantId }).find((item) => {
      const spec = store.enterpriseKnowledgeProjectionSpecs[item.projectionId];
      return spec?.projectionKey === "customer.profile";
    });
    expect(binding).toBeTruthy();
    await runProjectionMaterialization({
      store,
      tenantId,
      bindingId: binding!.bindingId,
      nowIso,
    });

    const bundle = loadKnowledgeFeedBundle({
      store,
      context: {
        tenantId,
        seatId: "seat-sales-director",
        userId: "employee-1",
        agentType: "employee-agent",
        hasEnterpriseScope: true,
      },
    });

    expect(bundle.feedItems.length).toBeGreaterThan(0);
    const enterpriseFeed = bundle.feedItems.find((item) => item.source === "enterprise");
    expect(enterpriseFeed?.lineageId).toBeTruthy();
    expect(enterpriseFeed?.freshnessStatus).toBe("fresh");
    expect(bundle.enterpriseAccessible.length).toBeGreaterThan(0);
    expect(bundle.dataObjects).toEqual([]);
    expect(bundle.feedItems.every((item) => item.source === "enterprise")).toBe(true);
  });
});
