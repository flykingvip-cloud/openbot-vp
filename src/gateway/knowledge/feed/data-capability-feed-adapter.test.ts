// @vitest-environment node
import { describe, expect, it } from "vitest";
import { listEnterpriseKnowledgeProjectionBindings } from "../../enterprise-data/enterprise-knowledge-projection-binding-store.js";
import { runProjectionMaterialization } from "../../enterprise-data/projection-materializer.js";
import { seedEnterpriseDataCatalog } from "../../enterprise-data/seeds.js";
import { normalizeEnterpriseDataStore } from "../../enterprise-data/store.js";
import {
  buildKnowledgeIndexCapabilityDescriptor,
  loadDataCapabilityFeed,
} from "./data-capability-feed-adapter.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";

function seededStore() {
  const store = normalizeEnterpriseDataStore(null);
  seedEnterpriseDataCatalog({ store, tenantId, nowIso });
  return store;
}

describe("data-capability catalog freshness", () => {
  it("does not invent freshness or feed items from live DataSource status", () => {
    const store = seededStore();
    for (const source of Object.values(store.dataSources)) {
      source.status = "disconnected";
    }
    const feed = loadDataCapabilityFeed({
      store,
      context: {
        tenantId,
        seatId: "seat-sales-director",
        userId: "employee-1",
        hasEnterpriseScope: true,
      },
    });
    expect(feed.feedItems).toEqual([]);
    expect(feed.objects).toEqual([]);
    expect(feed.descriptors.length).toBeGreaterThan(0);
    expect(feed.descriptors.every((item) => item.freshness === "unknown")).toBe(true);
  });

  it("copies freshness from a materialized FeedItem, not connector status", async () => {
    const store = seededStore();
    for (const source of Object.values(store.dataSources)) {
      source.status = "error";
    }
    const binding = listEnterpriseKnowledgeProjectionBindings({ store, tenantId }).find((item) => {
      const spec = store.enterpriseKnowledgeProjectionSpecs[item.projectionId];
      return spec?.projectionKey === "customer.profile";
    });
    expect(binding?.capabilityId).toBeTruthy();
    await runProjectionMaterialization({
      store,
      tenantId,
      bindingId: binding!.bindingId,
      nowIso,
    });
    const feed = loadDataCapabilityFeed({
      store,
      context: {
        tenantId,
        seatId: "seat-sales-director",
        userId: "employee-1",
        hasEnterpriseScope: true,
      },
    });
    const profile = feed.descriptors.find((item) => item.id === binding!.capabilityId);
    expect(profile?.freshness).toBe("fresh");
    expect(feed.objects).toEqual([]);
    const untouched = feed.descriptors.find((item) => item.id !== binding!.capabilityId);
    expect(untouched?.freshness).toBe("unknown");
  });

  it("marks the real knowledge-index capability as fresh", () => {
    const descriptor = buildKnowledgeIndexCapabilityDescriptor({ indexedChunkCount: 12 });
    expect(descriptor?.freshness).toBe("fresh");
    expect(descriptor?.isSample).toBe(false);
  });
});
