/**
 * Resource Catalog 纯函数解析（framework-free）。
 */

import type {
  ModelRef,
  ResourceModelCatalogEntry,
  ResourceTierId,
  TierModelPoolResult,
} from "./types.js";

/**
 * 由 allowed tier 列表解析可用模型池（仅 enabled 条目）。
 * tier 顺序保留；同 tier 内按 modelId 字典序。
 */
export function resolveModelsFromTiers(input: {
  allowedTierIds: readonly ResourceTierId[];
  catalog: readonly ResourceModelCatalogEntry[];
}): TierModelPoolResult {
  const tierSet = new Set(input.allowedTierIds.map((t) => t.trim()).filter((t) => t.length > 0));
  const tierIds = [...tierSet];
  const byTier: Record<string, ModelRef[]> = {};
  const modelSet = new Set<ModelRef>();

  for (const tierId of tierIds) {
    byTier[tierId] = [];
  }

  const enabled = input.catalog
    .filter((entry) => entry.enabled && tierSet.has(entry.tier))
    .toSorted((a, b) => a.modelId.localeCompare(b.modelId));

  for (const entry of enabled) {
    if (!byTier[entry.tier]) {
      byTier[entry.tier] = [];
    }
    byTier[entry.tier].push(entry.modelId);
    modelSet.add(entry.modelId);
  }

  const modelIds = [...modelSet].toSorted((a, b) => a.localeCompare(b));
  return { tierIds, modelIds, byTier };
}

/** binding 的 tier 投影与 allowedModelIds 是否一致（双轨校验）。 */
export function compareTierProjectionWithModelIds(input: {
  allowedTierIds: readonly ResourceTierId[];
  allowedModelIds: readonly ModelRef[];
  catalog: readonly ResourceModelCatalogEntry[];
}): {
  projectedModelIds: ModelRef[];
  missingFromProjection: ModelRef[];
  extraInProjection: ModelRef[];
  aligned: boolean;
} {
  const projected = resolveModelsFromTiers({
    allowedTierIds: input.allowedTierIds,
    catalog: input.catalog,
  });
  const projectedSet = new Set(projected.modelIds);
  const allowedSet = new Set(input.allowedModelIds.map((id) => id.trim()).filter(Boolean));
  const missingFromProjection = [...allowedSet].filter((id) => !projectedSet.has(id)).toSorted();
  const extraInProjection = [...projectedSet].filter((id) => !allowedSet.has(id)).toSorted();
  return {
    projectedModelIds: projected.modelIds,
    missingFromProjection,
    extraInProjection,
    aligned: missingFromProjection.length === 0 && extraInProjection.length === 0,
  };
}
