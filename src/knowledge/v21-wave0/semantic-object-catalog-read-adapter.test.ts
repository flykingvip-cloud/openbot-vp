import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadSemanticObjectStore,
  saveSemanticObjectStore,
} from "../../gateway/enterprise-data/semantic-object-store.js";
import {
  SEMANTIC_OBJECT_STORE_VERSION,
  type SemanticObject,
} from "../../gateway/enterprise-data/semantic-object-types.js";
import {
  SEMANTIC_OBJECT_CATALOG_READ_ADAPTER_ENABLED_DEFAULT,
  SEMANTIC_OBJECT_STORE_FILENAME,
  createSemanticObjectCatalogReadAdapter,
  createSemanticObjectStoreCatalogReader,
  redactSemanticObjectRecord,
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

function objectWithSecret(tenantId: string): SemanticObject {
  return {
    objectId: "obj-secret",
    tenantId,
    objectKey: "customer",
    displayName: "Customer",
    kind: "customer",
    description: "catalog entry",
    fields: [],
    sourceBindings: [
      {
        bindingId: "bind-1",
        sourceId: "src-1",
        action: {
          connectorId: "conn-1",
          actionId: "list-customers",
          api_key: "sk-should-never-leak",
        } as SemanticObject["sourceBindings"][number]["action"],
        fieldMappings: [],
      },
    ],
    lifecycle: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("SemanticObjectCatalogReadAdapter onto semantic-object-store.ts", () => {
  it("redacts credential keys and never writes the unique store file", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-semantic-catalog-read-"));
    const storePath = path.join(tmpDir, "openbot-enterprise-semantic-objects.json");
    const seeded = objectWithSecret("tenant-a");
    await saveSemanticObjectStore(
      {
        version: SEMANTIC_OBJECT_STORE_VERSION,
        semanticObjects: { [seeded.objectId]: seeded },
      },
      storePath,
    );
    const before = createHash("sha256").update(fs.readFileSync(storePath)).digest("hex");

    const loadCalls = { count: 0 };
    const reader = createSemanticObjectStoreCatalogReader({
      storePath,
      loadStore: async (candidate) => {
        loadCalls.count += 1;
        return loadSemanticObjectStore(candidate);
      },
    });
    const disabled = createSemanticObjectCatalogReadAdapter({ reader });
    const disabledResult = await disabled.read({ tenant_id: "tenant-a", policy_generation: 1 });
    expect(disabledResult).toEqual({ ok: false, reason: "ADAPTER_DISABLED" });
    expect(loadCalls.count).toBe(0);

    const adapter = createSemanticObjectCatalogReadAdapter({ enabled: true, reader });
    const result = await adapter.read({ tenant_id: "tenant-a", policy_generation: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.storeFilename).toBe(SEMANTIC_OBJECT_STORE_FILENAME);
      expect(result.objects).toHaveLength(1);
      expect(JSON.stringify(result.objects)).not.toContain("sk-should-never-leak");
      expect(JSON.stringify(result.objects)).not.toContain("api_key");
      expect(result.objects[0]?.objectKey).toBe("customer");
    }

    const after = createHash("sha256").update(fs.readFileSync(storePath)).digest("hex");
    expect(after).toBe(before);
    expect(loadCalls.count).toBe(1);

    const source = fs.readFileSync(
      new URL("./semantic-object-catalog-read-adapter.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("saveSemanticObjectStore");
    expect(source).not.toContain("withSemanticObjectStoreWriteLock");
    expect(source).not.toContain("upsertSemanticObject");
    expect(source).not.toContain("deleteSemanticObject");

    const leaked = redactSemanticObjectRecord(seeded);
    expect(JSON.stringify(leaked)).not.toContain("sk-should-never-leak");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
