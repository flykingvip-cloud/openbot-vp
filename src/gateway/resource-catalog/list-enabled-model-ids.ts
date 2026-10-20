/**
 * Platform resource catalog → enabled model id upper bound for EffectiveModelSet.
 */

import { listResourceModelCatalog } from "./models-catalog-store.js";
import type { ModelRef } from "./types.js";

export type ListEnabledCatalogModelIdsResult = {
  modelIds: ModelRef[];
  /** True when the catalog store has zero entries (empty / unmigrated). */
  catalogEmpty: boolean;
};

/**
 * Returns modelIds with enabled=true from the platform resource catalog.
 * Empty array + catalogEmpty=true means store is unmigrated or empty.
 * Empty array + catalogEmpty=false means all models disabled.
 */
export async function listEnabledResourceCatalogModelIds(params?: {
  storePath?: string;
}): Promise<ListEnabledCatalogModelIdsResult> {
  const all = await listResourceModelCatalog(params?.storePath);
  if (all.length === 0) {
    return { modelIds: [], catalogEmpty: true };
  }
  const modelIds = all
    .filter((entry) => entry.enabled)
    .map((entry) => entry.modelId.trim())
    .filter(Boolean);
  return { modelIds: [...new Set(modelIds)], catalogEmpty: false };
}
