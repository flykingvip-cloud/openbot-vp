// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveAssetLandscapeGraph } from "./asset-landscape-store.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeEnterpriseDataStore } from "./store.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";

describe("asset landscape graph", () => {
  it("builds a four-layer graph with source/capability/knowledge/target nodes and three edge kinds", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });

    const graph = resolveAssetLandscapeGraph({ store, tenantId });

    const kinds = new Set(graph.nodes.map((node) => node.kind));
    expect(kinds.has("source")).toBe(true);
    expect(kinds.has("capability")).toBe(true);
    expect(kinds.has("knowledge")).toBe(true);
    // seeded policies include seat/department/role targets
    expect(kinds.has("seat") || kinds.has("department") || kinds.has("role")).toBe(true);

    const relations = new Set(graph.edges.map((edge) => edge.relation));
    expect(relations.has("source")).toBe(true);
    expect(relations.has("generate")).toBe(true);
    expect(relations.has("open")).toBe(true);
  });

  it("keeps every edge endpoint present in nodes (referential integrity)", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });

    const graph = resolveAssetLandscapeGraph({ store, tenantId });
    const ids = new Set(graph.nodes.map((node) => node.id));
    for (const edge of graph.edges) {
      expect(ids.has(edge.from)).toBe(true);
      expect(ids.has(edge.to)).toBe(true);
    }
  });

  it("marks truncated when capability limit is exceeded", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });

    const full = resolveAssetLandscapeGraph({ store, tenantId });
    const capabilityNodeCount = full.nodes.filter((node) => node.kind === "capability").length;
    expect(capabilityNodeCount).toBeGreaterThan(0);

    const limited = resolveAssetLandscapeGraph({ store, tenantId, limit: 1 });
    expect(limited.nodes.filter((node) => node.kind === "capability").length).toBe(1);
    if (capabilityNodeCount > 1) {
      expect(limited.truncated).toBe(true);
    }
  });

  it("uses the supplied targetLabelResolver for department nodes", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });

    const graph = resolveAssetLandscapeGraph({
      store,
      tenantId,
      targetLabelResolver: (kind, targetId) =>
        kind === "department" && targetId === "sales-mgr:华东销售" ? "华东销售" : targetId,
    });

    const departmentNode = graph.nodes.find((node) => node.kind === "department");
    expect(departmentNode?.label).toBe("华东销售");
  });
});
