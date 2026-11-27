/**
 * Default-off, read-only Semantic Object catalog adapter (VB-3).
 * Unique write authority remains openbot-enterprise-semantic-objects.json;
 * this module never writes and is not registered on any Gateway route.
 */
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
