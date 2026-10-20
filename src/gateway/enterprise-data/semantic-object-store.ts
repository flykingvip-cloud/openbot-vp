// Semantic Object Catalog — independent store (persistence + CRUD + seeds).
// Spec: .kiro/specs/semantic-object-catalog/{requirements,design,tasks}.md
//
// Mirrors the enterprise-data store conventions (store.ts / data-source-store.ts /
// projection-spec-store.ts) but persists to its OWN file so it never touches the
// shared EnterpriseDataStore (design decision D1). Metadata-First: no business data
// rows are ever stored here (design decision D2). Cross-store existence checks
// (sourceId / action) are deferred to the resolver/handler/Planner (design decision D3).

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import {
  SEMANTIC_OBJECT_STORE_VERSION,
  type SemanticObject,
  type SemanticObjectKind,
  type SemanticObjectLifecycle,
  type SemanticObjectSourceBinding,
  type SemanticObjectStore,
} from "./semantic-object-types.js";

const DEFAULT_STORE_FILENAME = "openbot-enterprise-semantic-objects.json";

/** Binding input allows omitting bindingId (filled by the store). */
export type SemanticObjectSourceBindingInput = Omit<SemanticObjectSourceBinding, "bindingId"> & {
  bindingId?: string;
};

/** Upsert contract: id/tenant/timestamps are store-managed; bindingIds are filled in. */
export type SemanticObjectUpsertInput = Omit<
  SemanticObject,
  "objectId" | "tenantId" | "createdAt" | "updatedAt" | "sourceBindings"
> & {
  objectId?: string;
  sourceBindings?: SemanticObjectSourceBindingInput[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Persistence (mirrors enterprise-data/store.ts)
// ─────────────────────────────────────────────────────────────────────────────

function normalizeSemanticObject(object: SemanticObject): SemanticObject {
  return {
    ...object,
    tenantId: canonicalizeTenantId(object.tenantId) ?? object.tenantId,
    fields: Array.isArray(object.fields) ? object.fields : [],
    sourceBindings: Array.isArray(object.sourceBindings) ? object.sourceBindings : [],
  };
}

export function normalizeSemanticObjectStore(
  parsed: Partial<SemanticObjectStore> | null | undefined,
): SemanticObjectStore {
  const objects = parsed?.semanticObjects ?? {};
  return {
    version: parsed?.version ?? SEMANTIC_OBJECT_STORE_VERSION,
    semanticObjects: Object.fromEntries(
      Object.entries(objects).map(([id, object]) => [id, normalizeSemanticObject(object)]),
    ),
  };
}

export function resolveDefaultSemanticObjectStorePath(): string {
  return path.join(CONFIG_DIR, DEFAULT_STORE_FILENAME);
}

export async function loadSemanticObjectStore(storePath?: string): Promise<SemanticObjectStore> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultSemanticObjectStorePath(),
  );
  const parsed = await readJsonFile<Partial<SemanticObjectStore>>(resolvedPath);
  return normalizeSemanticObjectStore(parsed);
}

export async function saveSemanticObjectStore(
  store: SemanticObjectStore,
  storePath?: string,
): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultSemanticObjectStorePath(),
  );
  const normalized = normalizeSemanticObjectStore({
    ...store,
    version: SEMANTIC_OBJECT_STORE_VERSION,
  });
  await writeJsonAtomic(resolvedPath, normalized);
}

const storeLock = createAsyncLock();

/**
 * Serialize a load → mutate → save cycle. Reads do not need this (use loadSemanticObjectStore).
 * Mirrors connector-oauth-session-persistence's write-lock pattern.
 */
export async function withSemanticObjectStoreWriteLock<T>(
  run: (store: SemanticObjectStore) => Promise<T> | T,
  storePath?: string,
): Promise<T> {
  return storeLock(async () => {
    const store = await loadSemanticObjectStore(storePath);
    const result = await run(store);
    await saveSemanticObjectStore(store, storePath);
    return result;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD (pure functions over an in-memory SemanticObjectStore)
// ─────────────────────────────────────────────────────────────────────────────

export function listSemanticObjects(params: {
  store: SemanticObjectStore;
  tenantId: string;
  kind?: SemanticObjectKind;
  lifecycle?: SemanticObjectLifecycle;
}): SemanticObject[] {
  return Object.values(params.store.semanticObjects)
    .filter((object) => {
      if (object.tenantId !== params.tenantId) {
        return false;
      }
      if (params.kind && object.kind !== params.kind) {
        return false;
      }
      if (params.lifecycle && object.lifecycle !== params.lifecycle) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => left.objectKey.localeCompare(right.objectKey));
}

export function findSemanticObject(
  store: SemanticObjectStore,
  tenantId: string,
  objectId: string,
): SemanticObject | null {
  const object = store.semanticObjects[objectId];
  if (!object || object.tenantId !== tenantId) {
    return null;
  }
  return object;
}

export function findSemanticObjectByKey(
  store: SemanticObjectStore,
  tenantId: string,
  objectKey: string,
): SemanticObject | null {
  return (
    Object.values(store.semanticObjects).find(
      (object) => object.tenantId === tenantId && object.objectKey === objectKey,
    ) ?? null
  );
}

/** Self-consistency validation (no cross-store checks — see design decision D3). */
function validateSemanticObjectShape(input: SemanticObjectUpsertInput): void {
  if (!input.objectKey?.trim()) {
    throw new EnterpriseDataStoreError(
      "SEMANTIC_OBJECT_KEY_REQUIRED",
      "SemanticObject requires a non-empty objectKey.",
    );
  }
  const fieldKeys = new Set<string>();
  for (const field of input.fields) {
    const key = field.fieldKey?.trim();
    if (!key) {
      throw new EnterpriseDataStoreError(
        "SEMANTIC_FIELD_KEY_REQUIRED",
        `SemanticObject ${input.objectKey} has a field with an empty fieldKey.`,
      );
    }
    if (fieldKeys.has(key)) {
      throw new EnterpriseDataStoreError(
        "SEMANTIC_FIELD_KEY_CONFLICT",
        `SemanticObject ${input.objectKey} has duplicate fieldKey ${key}.`,
      );
    }
    fieldKeys.add(key);
  }
  let primaryCount = 0;
  for (const binding of input.sourceBindings ?? []) {
    if (binding.primary) {
      primaryCount += 1;
    }
    for (const mapping of binding.fieldMappings ?? []) {
      if (!fieldKeys.has(mapping.fieldKey)) {
        throw new EnterpriseDataStoreError(
          "SEMANTIC_BINDING_FIELD_UNKNOWN",
          `Binding for ${input.objectKey} maps unknown fieldKey ${mapping.fieldKey}.`,
        );
      }
    }
  }
  if (primaryCount > 1) {
    throw new EnterpriseDataStoreError(
      "SEMANTIC_BINDING_MULTIPLE_PRIMARY",
      `SemanticObject ${input.objectKey} has more than one primary source binding.`,
    );
  }
}

export function upsertSemanticObject(params: {
  store: SemanticObjectStore;
  tenantId: string;
  object: SemanticObjectUpsertInput;
  nowIso: string;
}): SemanticObject {
  validateSemanticObjectShape(params.object);
  const existingByKey = findSemanticObjectByKey(
    params.store,
    params.tenantId,
    params.object.objectKey,
  );
  const existing =
    params.object.objectId != null
      ? findSemanticObject(params.store, params.tenantId, params.object.objectId)
      : existingByKey;
  // Reject only when a DIFFERENT object already owns the same objectKey.
  if (existingByKey && existingByKey.objectId !== (existing?.objectId ?? params.object.objectId)) {
    throw new EnterpriseDataStoreError(
      "SEMANTIC_OBJECT_KEY_CONFLICT",
      `SemanticObject key ${params.object.objectKey} already exists.`,
    );
  }
  const sourceBindings: SemanticObjectSourceBinding[] = (params.object.sourceBindings ?? []).map(
    (binding) => ({
      bindingId: binding.bindingId ?? randomUUID(),
      sourceId: binding.sourceId,
      action: { ...binding.action },
      fieldMappings: (binding.fieldMappings ?? []).map((mapping) => ({ ...mapping })),
      capabilityId: binding.capabilityId,
      primary: binding.primary,
    }),
  );
  const record: SemanticObject = {
    objectId: params.object.objectId ?? existing?.objectId ?? randomUUID(),
    tenantId: params.tenantId,
    objectKey: params.object.objectKey,
    displayName: params.object.displayName,
    kind: params.object.kind,
    description: params.object.description,
    fields: params.object.fields.map((field) => ({ ...field })),
    sourceBindings,
    lifecycle: params.object.lifecycle,
    seedOrigin: params.object.seedOrigin,
    createdAt: existing?.createdAt ?? params.nowIso,
    updatedAt: params.nowIso,
    createdBy: params.object.createdBy ?? existing?.createdBy,
  };
  params.store.semanticObjects[record.objectId] = record;
  return record;
}

export function deleteSemanticObject(params: {
  store: SemanticObjectStore;
  tenantId: string;
  objectId: string;
}): SemanticObject {
  const object = findSemanticObject(params.store, params.tenantId, params.objectId);
  if (!object) {
    throw new EnterpriseDataStoreError("SEMANTIC_OBJECT_NOT_FOUND", "SemanticObject not found.");
  }
  delete params.store.semanticObjects[params.objectId];
  return object;
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo catalog (seeds) — idempotent, catalog-only (no source bindings)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical demo objects. No source bindings (bindings need real sourceIds).
 * Demonstrates reference relationships (order→customer, inventory→product) and
 * data classification (customer.phone/email = CONFIDENTIAL).
 */
function demoSemanticObjectDefinitions(): SemanticObjectUpsertInput[] {
  return [
    {
      objectKey: "customer",
      displayName: "客户",
      kind: "customer",
      description: "企业客户主数据（规范对象）。",
      lifecycle: "active",
      fields: [
        { fieldKey: "customerId", displayName: "客户ID", type: "id", required: true },
        { fieldKey: "name", displayName: "客户名称", type: "string", classification: "INTERNAL" },
        {
          fieldKey: "phone",
          displayName: "联系电话",
          type: "string",
          classification: "CONFIDENTIAL",
        },
        { fieldKey: "email", displayName: "邮箱", type: "string", classification: "CONFIDENTIAL" },
        { fieldKey: "industry", displayName: "行业", type: "string" },
      ],
    },
    {
      objectKey: "sales-order",
      displayName: "订单",
      kind: "order",
      description: "销售订单（规范对象）。",
      lifecycle: "active",
      fields: [
        { fieldKey: "orderId", displayName: "订单ID", type: "id", required: true },
        {
          fieldKey: "customerId",
          displayName: "客户",
          type: "reference",
          referenceObjectKey: "customer",
        },
        { fieldKey: "amount", displayName: "金额", type: "money" },
        { fieldKey: "status", displayName: "状态", type: "enum" },
        { fieldKey: "orderedAt", displayName: "下单时间", type: "datetime" },
      ],
    },
    {
      objectKey: "product",
      displayName: "产品",
      kind: "product",
      description: "产品主数据（规范对象）。",
      lifecycle: "active",
      fields: [
        { fieldKey: "productId", displayName: "产品ID", type: "id", required: true },
        { fieldKey: "name", displayName: "产品名称", type: "string" },
        { fieldKey: "sku", displayName: "SKU", type: "string" },
        { fieldKey: "price", displayName: "价格", type: "money" },
        { fieldKey: "category", displayName: "品类", type: "string" },
      ],
    },
    {
      objectKey: "inventory",
      displayName: "库存",
      kind: "inventory",
      description: "库存水位（规范对象）。",
      lifecycle: "active",
      fields: [
        { fieldKey: "inventoryId", displayName: "库存ID", type: "id", required: true },
        {
          fieldKey: "productId",
          displayName: "产品",
          type: "reference",
          referenceObjectKey: "product",
        },
        { fieldKey: "quantity", displayName: "数量", type: "number" },
        { fieldKey: "warehouse", displayName: "仓库", type: "string" },
        { fieldKey: "updatedAt", displayName: "更新时间", type: "datetime" },
      ],
    },
  ];
}

/**
 * Idempotently seed the demo catalog for a tenant. Objects whose objectKey already
 * exists are skipped (never overwrites user edits).
 */
export function ensureSemanticObjectDemoCatalog(params: {
  store: SemanticObjectStore;
  tenantId: string;
  nowIso: string;
}): { created: SemanticObject[]; skipped: string[] } {
  const created: SemanticObject[] = [];
  const skipped: string[] = [];
  for (const definition of demoSemanticObjectDefinitions()) {
    if (findSemanticObjectByKey(params.store, params.tenantId, definition.objectKey)) {
      skipped.push(definition.objectKey);
      continue;
    }
    created.push(
      upsertSemanticObject({
        store: params.store,
        tenantId: params.tenantId,
        object: { ...definition, seedOrigin: "demo" },
        nowIso: params.nowIso,
      }),
    );
  }
  return { created, skipped };
}
