/**
 * Tier 路由纯函数（Package V2 Phase 2）。
 *
 * legacy：套餐 binding 的 allowedModelIds 为真源。
 * tier：allowedTiers → Resource Catalog 投影为模型池。
 */

import type { ModelRef } from "../model-entitlement/types.js";
import { resolveModelsFromTiers } from "../resource-catalog/resolve.js";
import type { ResourceModelCatalogEntry } from "../resource-catalog/types.js";

export type ModelEntitlementRoutingMode = "legacy" | "tier";

export function resolveBindingAllowlist(input: {
  routingMode: ModelEntitlementRoutingMode;
  allowedTiers?: readonly string[] | null;
  allowedModelIds: readonly ModelRef[];
  catalog: readonly ResourceModelCatalogEntry[];
}): { source: "tier" | "models"; modelIds: ModelRef[] } {
  const tiers = (input.allowedTiers ?? []).map((t) => t.trim()).filter((t) => t.length > 0);
  if (input.routingMode === "tier" && tiers.length > 0) {
    const pool = resolveModelsFromTiers({ allowedTierIds: tiers, catalog: input.catalog });
    return { source: "tier", modelIds: pool.modelIds };
  }
  return {
    source: "models",
    modelIds: [...new Set(input.allowedModelIds.map((id) => id.trim()).filter(Boolean))],
  };
}
