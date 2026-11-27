import { describe, expect, it } from "vitest";
import {
  SEMANTIC_OBJECT_CATALOG_READ_ADAPTER_ENABLED_DEFAULT,
  SEMANTIC_OBJECT_STORE_FILENAME,
  createSemanticObjectCatalogReadAdapter,
  type SemanticObjectCatalogRecord,
} from "./semantic-object-catalog-read-adapter.js";

const sample: SemanticObjectCatalogRecord = {
  objectId: "obj-1",
  tenantId: "tenant-a",
  objectKey: "customer",
  displayName: "Customer",
  kind: "customer",
  lifecycle: "active",
  fields: [],
  sourceBindings: [],
};

describe("SemanticObjectCatalogReadAdapter", () => {
  it("is default-off and does not call the reader", async () => {
    expect(SEMANTIC_OBJECT_CATALOG_READ_ADAPTER_ENABLED_DEFAULT).toBe(false);
    let called = 0;
    const adapter = createSemanticObjectCatalogReadAdapter({
      reader: {
        listByTenant: async () => {
          called += 1;
          return [sample];
        },
      },
    });
    const result = await adapter.read({ tenant_id: "tenant-a", policy_generation: 1 });
    expect(result).toEqual({ ok: false, reason: "ADAPTER_DISABLED" });
    expect(called).toBe(0);
    expect(adapter.enabled).toBe(false);
  });

  it("when explicitly enabled, reads only and filters by object_key", async () => {
    const adapter = createSemanticObjectCatalogReadAdapter({
      enabled: true,
      reader: { listByTenant: async () => [sample] },
    });
    const all = await adapter.read({ tenant_id: "tenant-a", policy_generation: 1 });
    expect(all).toEqual({
      ok: true,
      storeFilename: SEMANTIC_OBJECT_STORE_FILENAME,
      objects: [sample],
    });
    const missing = await adapter.read({
      tenant_id: "tenant-a",
      policy_generation: 1,
      object_key: "order",
    });
    expect(missing.ok).toBe(true);
    if (missing.ok) {
      expect(missing.objects).toEqual([]);
    }
  });

  it("rejects invalid requests even when enabled", async () => {
    const adapter = createSemanticObjectCatalogReadAdapter({
      enabled: true,
      reader: { listByTenant: async () => [sample] },
    });
    const result = await adapter.read({ tenant_id: " ", policy_generation: 0 });
    expect(result).toEqual({ ok: false, reason: "INVALID_REQUEST" });
  });
});
