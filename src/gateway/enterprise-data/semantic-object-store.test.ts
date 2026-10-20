// @vitest-environment node
import { rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import {
  deleteSemanticObject,
  ensureSemanticObjectDemoCatalog,
  findSemanticObject,
  findSemanticObjectByKey,
  listSemanticObjects,
  loadSemanticObjectStore,
  normalizeSemanticObjectStore,
  saveSemanticObjectStore,
  upsertSemanticObject,
  type SemanticObjectUpsertInput,
} from "./semantic-object-store.js";
import { SEMANTIC_OBJECT_STORE_VERSION, type SemanticObject } from "./semantic-object-types.js";

const tenantId = "tenant-acme";
const nowIso = "2026-07-12T12:00:00.000Z";

function freshStore() {
  return normalizeSemanticObjectStore(null);
}

function customerInput(overrides?: Partial<SemanticObjectUpsertInput>): SemanticObjectUpsertInput {
  return {
    objectKey: "customer",
    displayName: "客户",
    kind: "customer",
    description: "test customer",
    lifecycle: "active",
    fields: [
      { fieldKey: "customerId", displayName: "ID", type: "id" },
      { fieldKey: "name", displayName: "名称", type: "string" },
    ],
    ...overrides,
  };
}

function catchStoreError(fn: () => unknown): EnterpriseDataStoreError {
  try {
    fn();
  } catch (error) {
    if (error instanceof EnterpriseDataStoreError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected EnterpriseDataStoreError to be thrown");
}

describe("semantic-object-store CRUD", () => {
  it("upserts objects and lists them sorted by objectKey", () => {
    const store = freshStore();
    upsertSemanticObject({
      store,
      tenantId,
      object: { ...customerInput(), objectKey: "product", displayName: "产品", kind: "product" },
      nowIso,
    });
    const customer = upsertSemanticObject({ store, tenantId, object: customerInput(), nowIso });
    expect(customer.objectId).toBeTruthy();
    expect(customer.tenantId).toBe(tenantId);
    const listed = listSemanticObjects({ store, tenantId });
    expect(listed.map((object) => object.objectKey)).toEqual(["customer", "product"]);
  });

  it("finds by id and by key, respecting tenant isolation", () => {
    const store = freshStore();
    const customer = upsertSemanticObject({ store, tenantId, object: customerInput(), nowIso });
    expect(findSemanticObject(store, tenantId, customer.objectId)?.objectKey).toBe("customer");
    expect(findSemanticObjectByKey(store, tenantId, "customer")?.objectId).toBe(customer.objectId);
    expect(findSemanticObject(store, "other-tenant", customer.objectId)).toBeNull();
    expect(findSemanticObjectByKey(store, "other-tenant", "customer")).toBeNull();
  });

  it("isolates objects per tenant even with the same objectKey", () => {
    const store = freshStore();
    upsertSemanticObject({ store, tenantId, object: customerInput(), nowIso });
    upsertSemanticObject({
      store,
      tenantId: "tenant-beta",
      object: { ...customerInput(), displayName: "Beta 客户" },
      nowIso,
    });
    expect(listSemanticObjects({ store, tenantId })).toHaveLength(1);
    expect(findSemanticObjectByKey(store, "tenant-beta", "customer")?.displayName).toBe(
      "Beta 客户",
    );
  });

  it("updates in place when upserting the same objectKey (createdAt preserved)", () => {
    const store = freshStore();
    const first = upsertSemanticObject({ store, tenantId, object: customerInput(), nowIso });
    const later = "2026-07-13T09:00:00.000Z";
    const second = upsertSemanticObject({
      store,
      tenantId,
      object: customerInput({ description: "updated" }),
      nowIso: later,
    });
    expect(second.objectId).toBe(first.objectId);
    expect(second.description).toBe("updated");
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBe(later);
    expect(listSemanticObjects({ store, tenantId })).toHaveLength(1);
  });

  it("rejects a different object claiming an existing objectKey", () => {
    const store = freshStore();
    upsertSemanticObject({ store, tenantId, object: customerInput(), nowIso });
    const error = catchStoreError(() =>
      upsertSemanticObject({
        store,
        tenantId,
        object: { ...customerInput(), objectId: "different-id" },
        nowIso,
      }),
    );
    expect(error.code).toBe("SEMANTIC_OBJECT_KEY_CONFLICT");
  });

  it("rejects empty objectKey and duplicate fieldKey", () => {
    const store = freshStore();
    expect(
      catchStoreError(() =>
        upsertSemanticObject({
          store,
          tenantId,
          object: customerInput({ objectKey: "  " }),
          nowIso,
        }),
      ).code,
    ).toBe("SEMANTIC_OBJECT_KEY_REQUIRED");
    expect(
      catchStoreError(() =>
        upsertSemanticObject({
          store,
          tenantId,
          object: customerInput({
            fields: [
              { fieldKey: "dup", displayName: "A", type: "string" },
              { fieldKey: "dup", displayName: "B", type: "string" },
            ],
          }),
          nowIso,
        }),
      ).code,
    ).toBe("SEMANTIC_FIELD_KEY_CONFLICT");
  });

  it("deletes an object and reports not-found on a second delete", () => {
    const store = freshStore();
    const customer = upsertSemanticObject({ store, tenantId, object: customerInput(), nowIso });
    const deleted = deleteSemanticObject({ store, tenantId, objectId: customer.objectId });
    expect(deleted.objectId).toBe(customer.objectId);
    expect(listSemanticObjects({ store, tenantId })).toHaveLength(0);
    expect(
      catchStoreError(() => deleteSemanticObject({ store, tenantId, objectId: customer.objectId }))
        .code,
    ).toBe("SEMANTIC_OBJECT_NOT_FOUND");
  });
});

describe("semantic-object-store source bindings", () => {
  const bindingBase = {
    sourceId: "src-1",
    action: { connectorId: "crm-salesforce", actionKey: "listCustomers", version: "v1" },
    fieldMappings: [{ fieldKey: "customerId", sourceFieldPath: "records[].Id" }],
  };

  it("fills a bindingId when omitted", () => {
    const store = freshStore();
    const object = upsertSemanticObject({
      store,
      tenantId,
      object: customerInput({ sourceBindings: [{ ...bindingBase }] }),
      nowIso,
    });
    expect(object.sourceBindings).toHaveLength(1);
    expect(object.sourceBindings[0]?.bindingId).toBeTruthy();
  });

  it("rejects a binding that maps an undeclared field", () => {
    const store = freshStore();
    const error = catchStoreError(() =>
      upsertSemanticObject({
        store,
        tenantId,
        object: customerInput({
          sourceBindings: [
            { ...bindingBase, fieldMappings: [{ fieldKey: "ghost", sourceFieldPath: "x" }] },
          ],
        }),
        nowIso,
      }),
    );
    expect(error.code).toBe("SEMANTIC_BINDING_FIELD_UNKNOWN");
  });

  it("rejects more than one primary binding", () => {
    const store = freshStore();
    const error = catchStoreError(() =>
      upsertSemanticObject({
        store,
        tenantId,
        object: customerInput({
          sourceBindings: [
            { ...bindingBase, primary: true },
            { ...bindingBase, sourceId: "src-2", primary: true },
          ],
        }),
        nowIso,
      }),
    );
    expect(error.code).toBe("SEMANTIC_BINDING_MULTIPLE_PRIMARY");
  });
});

describe("semantic-object-store persistence", () => {
  it("normalizes null/empty input and defaults arrays", () => {
    expect(normalizeSemanticObjectStore(null)).toEqual({
      version: SEMANTIC_OBJECT_STORE_VERSION,
      semanticObjects: {},
    });
    const normalized = normalizeSemanticObjectStore({
      version: SEMANTIC_OBJECT_STORE_VERSION,
      semanticObjects: {
        x: {
          objectId: "x",
          tenantId,
          objectKey: "k",
          displayName: "K",
          kind: "custom",
          description: "",
          lifecycle: "active",
        } as unknown as SemanticObject,
      },
    });
    expect(normalized.semanticObjects.x?.fields).toEqual([]);
    expect(normalized.semanticObjects.x?.sourceBindings).toEqual([]);
  });

  it("round-trips a catalog through save and load", async () => {
    const storePath = `/tmp/openbot-semantic-objects-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    try {
      const store = freshStore();
      upsertSemanticObject({ store, tenantId, object: customerInput(), nowIso });
      await saveSemanticObjectStore(store, storePath);
      const reloaded = await loadSemanticObjectStore(storePath);
      expect(reloaded.version).toBe(SEMANTIC_OBJECT_STORE_VERSION);
      const listed = listSemanticObjects({ store: reloaded, tenantId });
      expect(listed).toHaveLength(1);
      expect(listed[0]?.objectKey).toBe("customer");
    } finally {
      await rm(storePath, { force: true });
    }
  });
});

describe("semantic-object-store demo catalog", () => {
  it("seeds the four canonical objects with references and classification, idempotently", () => {
    const store = freshStore();
    const first = ensureSemanticObjectDemoCatalog({ store, tenantId, nowIso });
    expect(first.created).toHaveLength(4);
    expect(first.skipped).toHaveLength(0);
    expect(listSemanticObjects({ store, tenantId }).map((object) => object.objectKey)).toEqual([
      "customer",
      "inventory",
      "product",
      "sales-order",
    ]);

    const customer = findSemanticObjectByKey(store, tenantId, "customer");
    expect(customer?.seedOrigin).toBe("demo");
    expect(customer?.fields.find((field) => field.fieldKey === "phone")?.classification).toBe(
      "CONFIDENTIAL",
    );

    const order = findSemanticObjectByKey(store, tenantId, "sales-order");
    const customerRef = order?.fields.find((field) => field.fieldKey === "customerId");
    expect(customerRef?.type).toBe("reference");
    expect(customerRef?.referenceObjectKey).toBe("customer");

    const inventory = findSemanticObjectByKey(store, tenantId, "inventory");
    const productRef = inventory?.fields.find((field) => field.fieldKey === "productId");
    expect(productRef?.referenceObjectKey).toBe("product");

    const second = ensureSemanticObjectDemoCatalog({ store, tenantId, nowIso });
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toEqual(["customer", "sales-order", "product", "inventory"]);
    expect(listSemanticObjects({ store, tenantId })).toHaveLength(4);
  });
});
