/**
 * 从网关配置枚举模型，写入 Resource Model Catalog（种子数据）。
 */

import type { OpenBotConfig } from "../../config/types.js";
import { listConfiguredModelIds } from "../model-entitlement/resolve-effective-model-set.js";
import { ensureDefaultCreditWeights } from "./credit-weights-store.js";
import { resolveModelCostDefault } from "./model-cost-defaults.js";
import { seedResourceModelCatalog, type SeedModelCatalogEntry } from "./models-catalog-store.js";
import { ensureDefaultResourceTiers } from "./tiers-store.js";

function displayNameFromModelId(modelId: string): string {
  const slash = modelId.indexOf("/");
  return slash > 0 ? modelId.slice(slash + 1) : modelId;
}

export function buildSeedEntriesFromConfig(
  cfg: OpenBotConfig | undefined,
): SeedModelCatalogEntry[] {
  const modelIds = listConfiguredModelIds(cfg);
  return modelIds.map((modelId) => {
    const slash = modelId.indexOf("/");
    const provider = slash > 0 ? modelId.slice(0, slash) : modelId;
    // 命中价表则带入真实单价与 tier；未命中保持 tier_b / 0（运营后续补全）。
    const costDefault = resolveModelCostDefault(modelId);
    return {
      modelId,
      provider,
      displayName: displayNameFromModelId(modelId),
      defaultTier: costDefault?.tier ?? "tier_b",
      ...(costDefault
        ? {
            inputCostPer1MCents: costDefault.inputCostPer1MCents,
            outputCostPer1MCents: costDefault.outputCostPer1MCents,
          }
        : {}),
    };
  });
}

export async function bootstrapResourceCatalogFromConfig(
  cfg: OpenBotConfig | undefined,
  opts?: { storePaths?: { tiers?: string; models?: string; weights?: string } },
): Promise<{
  tiers: number;
  weights: number;
  seed: { created: number; skipped: number; total: number };
}> {
  const tiers = await ensureDefaultResourceTiers(opts?.storePaths?.tiers);
  const weights = await ensureDefaultCreditWeights(opts?.storePaths?.weights);
  const seed = await seedResourceModelCatalog(buildSeedEntriesFromConfig(cfg), {
    defaultTier: "tier_b",
    storePath: opts?.storePaths?.models,
  });
  return { tiers: tiers.length, weights: weights.length, seed };
}
