/**
 * Default-off, read-only Semantic Object catalog adapter (VB-3 / W1B-3).
 * Unique write authority remains openbot-enterprise-semantic-objects.json
 * via semantic-object-store.ts write APIs. This module only
 * calls loadSemanticObjectStore / listSemanticObjects, never writes, never
 * dual-writes, and redacts credential-bearing keys from the projection.
 * It is not registered on any Gateway route.
 */
import {
  listSemanticObjects,
  loadSemanticObjectStore,
} from "../../gateway/enterprise-data/semantic-object-store.js";
import type { SemanticObject } from "../../gateway/enterprise-data/semantic-object-types.js";

export const SEMANTIC_OBJECT_CATALOG_READ_ADAPTER_ENABLED_DEFAULT = false;
export const SEMANTIC_OBJECT_STORE_FILENAME = "openbot-enterprise-semantic-objects.json";

export type SemanticObjectCatalogRecord = {
  objectId: string;
  tenantId: string;
  objectKey: string;
  displayName: string;
  kind: string;
  lifecycle: string;
  fields: unknown[];
  sourceBindings: unknown[];
};

export type SemanticObjectCatalogReader = {
  /** Read-only projection. Implementations must not persist. */
  listByTenant(tenantId: string): Promise<readonly SemanticObjectCatalogRecord[]>;
};

export type SemanticObjectCatalogReadRequest = {
  tenant_id: string;
  policy_generation: number;
  object_key?: string;
};

export type SemanticObjectCatalogReadResult =
  | { ok: true; storeFilename: string; objects: SemanticObjectCatalogRecord[] }
  | { ok: false; reason: "ADAPTER_DISABLED" | "INVALID_REQUEST" };

export function createSemanticObjectCatalogReadAdapter(options: {
  enabled?: boolean;
  reader: SemanticObjectCatalogReader;
}) {
  const enabled = options.enabled ?? SEMANTIC_OBJECT_CATALOG_READ_ADAPTER_ENABLED_DEFAULT;
  return {
    enabled,
    async read(
      request: SemanticObjectCatalogReadRequest,
    ): Promise<SemanticObjectCatalogReadResult> {
      if (!enabled) {
        return { ok: false, reason: "ADAPTER_DISABLED" };
      }
      if (
        !request.tenant_id?.trim() ||
        !Number.isInteger(request.policy_generation) ||
        request.policy_generation < 1
      ) {
        return { ok: false, reason: "INVALID_REQUEST" };
      }
      const all = await options.reader.listByTenant(request.tenant_id);
      const objects = request.object_key
        ? all.filter((row) => row.objectKey === request.object_key)
        : [...all];
      return { ok: true, storeFilename: SEMANTIC_OBJECT_STORE_FILENAME, objects };
    },
  };
}

const FORBIDDEN_CREDENTIAL_KEYS = new Set([
  "api_key",
  "api_token",
  "password",
  "bearer_token",
  "secret",
  "credential",
  "access_token",
  "private_key",
  "dsn",
  "connection_string",
  "jdbc_url",
  "authorization",
]);

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_CREDENTIAL_KEYS.has(key) || FORBIDDEN_CREDENTIAL_KEYS.has(key.toLowerCase())) {
        continue;
      }
      out[key] = redactValue(child);
    }
    return out;
  }
  return value;
}

export function redactSemanticObjectRecord(object: SemanticObject): SemanticObjectCatalogRecord {
  const redacted = redactValue({
    objectId: object.objectId,
    tenantId: object.tenantId,
    objectKey: object.objectKey,
    displayName: object.displayName,
    kind: object.kind,
    lifecycle: object.lifecycle,
    fields: object.fields,
    sourceBindings: object.sourceBindings,
  }) as SemanticObjectCatalogRecord;
  return redacted;
}

/**
 * Read-only catalog reader over the host semantic-object-store.
 * Callers may inject loadStore in tests; production default is loadSemanticObjectStore.
 * This function must not be given a write path.
 */
export function createSemanticObjectStoreCatalogReader(options?: {
  storePath?: string;
  loadStore?: typeof loadSemanticObjectStore;
}): SemanticObjectCatalogReader {
  const loadStore = options?.loadStore ?? loadSemanticObjectStore;
  return {
    async listByTenant(tenantId: string) {
      const store = await loadStore(options?.storePath);
      return listSemanticObjects({ store, tenantId }).map(redactSemanticObjectRecord);
    },
  };
}
