import { describe, expect, it } from "vitest";
import { seedEnterpriseDataCatalog } from "../enterprise-data/seeds.js";
import { normalizeEnterpriseDataStore } from "../enterprise-data/store.js";
import { buildKnowledgeIndexCapabilityDescriptor } from "./feed/data-capability-feed-adapter.js";
import { buildRelationshipGraphFromObjects } from "./graph-builder.js";
import { buildDefaultKnowledgeObjects } from "./mock-graph.js";
import { loadKnowledgeSourceBundle } from "./source-bundle.js";
import { loadDataCapabilityCatalog } from "./sources/capability-catalog.js";
import { loadEnterpriseKnowledgeObjects } from "./sources/enterprise-source.js";

describe("knowledge source bundle", () => {
  it("does not fall back to demo mock objects in production path", async () => {
    const bundle = await loadKnowledgeSourceBundle(null);
    const demoIds = new Set(buildDefaultKnowledgeObjects().map((item) => item.id));
    expect(bundle.objects.every((item) => !demoIds.has(item.id))).toBe(true);
  });

  it("still serves explicit mock bundle when preferMock is set", async () => {
    const bundle = await loadKnowledgeSourceBundle(null, { preferMock: true });
    expect(bundle.objects.some((item) => item.id === "obj:project-a")).toBe(true);
  });

  it("projects enterprise and data capabilities from seeded catalog", () => {
    const store = normalizeEnterpriseDataStore({});
    seedEnterpriseDataCatalog({
      store,
      tenantId: "tenant-acme",
      nowIso: new Date().toISOString(),
    });
    const context = {
      tenantId: "tenant-acme",
      seatId: "seat-sales-director",
      userId: "employee-1",
      hasEnterpriseScope: true,
    };
    const enterpriseObjects = loadEnterpriseKnowledgeObjects({ store, context });
    const dataCatalog = loadDataCapabilityCatalog({ store, context });
    const graph = buildRelationshipGraphFromObjects({
      objects: [...enterpriseObjects, ...dataCatalog.objects],
      dataCapabilities: dataCatalog.descriptors,
    });

    expect(enterpriseObjects.length).toBeGreaterThan(0);
    expect(dataCatalog.descriptors.length).toBeGreaterThan(0);
    expect(dataCatalog.descriptors[0]?.scenarios.length).toBeGreaterThan(0);
    expect(dataCatalog.summary.grantedCount + dataCatalog.summary.requestableCount).toBeGreaterThan(
      0,
    );
    expect(graph.edges.some((edge) => edge.relationType === "recommended-for")).toBe(true);
  });

  it("flags seeded demo capabilities as samples", () => {
    const store = normalizeEnterpriseDataStore({});
    seedEnterpriseDataCatalog({
      store,
      tenantId: "tenant-acme",
      nowIso: new Date().toISOString(),
    });
    const dataCatalog = loadDataCapabilityCatalog({
      store,
      context: {
        tenantId: "tenant-acme",
        seatId: "seat-sales-director",
        userId: "employee-1",
        hasEnterpriseScope: true,
      },
    });
    expect(dataCatalog.descriptors.length).toBeGreaterThan(0);
    // Every auto-seeded demo capability must be flagged so the UI shows a sample badge.
    expect(dataCatalog.descriptors.every((descriptor) => descriptor.isSample === true)).toBe(true);
  });

  it("builds a real (non-sample) knowledge-index capability only when chunks exist", () => {
    expect(buildKnowledgeIndexCapabilityDescriptor({ indexedChunkCount: 0 })).toBeNull();
    const real = buildKnowledgeIndexCapabilityDescriptor({ indexedChunkCount: 42 });
    expect(real).not.toBeNull();
    expect(real?.isSample).toBe(false);
    expect(real?.accessState).toBe("granted");
    expect(real?.summary).toContain("42");
  });
});
