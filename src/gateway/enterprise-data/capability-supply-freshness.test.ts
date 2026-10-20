// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveCapabilitySupplyFreshness } from "./capability-supply-freshness.js";
import { listEnterpriseKnowledgeProjectionBindings } from "./enterprise-knowledge-projection-binding-store.js";
import { upsertKnowledgeFeedItem } from "./knowledge-feed-item-store.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeEnterpriseDataStore } from "./store.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";

describe("capability supply freshness", () => {
  it("stays unknown until supply writes a feed item", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    for (const source of Object.values(store.dataSources)) {
      source.status = "disconnected";
    }
    const binding = listEnterpriseKnowledgeProjectionBindings({
      store,
      tenantId,
      enabled: true,
    }).find((item) => item.capabilityId);
    expect(binding?.capabilityId).toBeTruthy();
    expect(
      resolveCapabilitySupplyFreshness({
        store,
        tenantId,
        capabilityId: binding!.capabilityId!,
      }),
    ).toBe("unknown");
  });

  it("reads persisted feed freshness, including expired as stale", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const binding = listEnterpriseKnowledgeProjectionBindings({
      store,
      tenantId,
      enabled: true,
    }).find((item) => item.capabilityId);
    expect(binding).toBeTruthy();
    upsertKnowledgeFeedItem({
      store,
      tenantId,
      nowIso,
      freshnessSlaMinutes: 30,
      item: {
        projectionId: binding!.projectionId,
        title: "Aged profile",
        kind: "data",
        category: "customer",
        sourceSystems: ["CRM"],
        scopeApplied: "team",
        maskedFields: [],
        generatedAt: "2026-06-05T08:00:00.000Z",
        traceRefs: [],
        payload: { summary: "aged" },
      },
    });
    expect(
      resolveCapabilitySupplyFreshness({
        store,
        tenantId,
        capabilityId: binding!.capabilityId!,
      }),
    ).toBe("stale");
  });
});
