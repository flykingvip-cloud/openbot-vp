/**
 * 把模型成本默认价表回填到已存在的 Resource Model Catalog。
 *
 * seedResourceModelCatalog 只补缺失条目、不覆盖已存在条目，因此线上早已 seed 成
 * 0/0、tier_b 的目录无法靠重新 seed 修复。本模块对已存在条目按 model-cost-defaults
 * 解析默认单价与 tier，通过 upsert 回填（保留 displayName / capabilities 等其它字段）。
 *
 * 默认仅回填「当前未定价（输入与输出成本都为 0）」的条目；overwriteExisting=true 时
 * 连已定价条目也按默认价覆盖。tier 一并校正到默认价表给出的层级。
 */

import { resolveModelCostDefault } from "./model-cost-defaults.js";
import {
  listResourceModelCatalog,
  upsertResourceModelCatalogEntry,
} from "./models-catalog-store.js";

export type AppliedCostDefault = {
  modelId: string;
  tier: string;
  inputCostPer1MCents: number;
  outputCostPer1MCents: number;
  ruleId: string;
  previousInputCostPer1MCents: number;
  previousOutputCostPer1MCents: number;
};

export type ApplyCostDefaultsResult = {
  dryRun: boolean;
  updated: AppliedCostDefault[];
  /** 价表未覆盖的模型（需运营手动填价）。 */
  skippedNoDefault: string[];
  /** 已有非零定价且未要求覆盖。 */
  skippedAlreadyPriced: string[];
  total: number;
};

export async function applyModelCostDefaultsToCatalog(opts?: {
  storePath?: string;
  /** 连已定价条目也覆盖（默认 false：只回填未定价条目）。 */
  overwriteExisting?: boolean;
  /** 只计算不落盘（默认 false）。 */
  dryRun?: boolean;
}): Promise<ApplyCostDefaultsResult> {
  const dryRun = opts?.dryRun ?? false;
  const overwriteExisting = opts?.overwriteExisting ?? false;
  const entries = await listResourceModelCatalog(opts?.storePath);

  const updated: AppliedCostDefault[] = [];
  const skippedNoDefault: string[] = [];
  const skippedAlreadyPriced: string[] = [];

  for (const entry of entries) {
    const costDefault = resolveModelCostDefault(entry.modelId);
    if (!costDefault) {
      skippedNoDefault.push(entry.modelId);
      continue;
    }
    const alreadyPriced = entry.inputCostPer1MCents > 0 || entry.outputCostPer1MCents > 0;
    if (alreadyPriced && !overwriteExisting) {
      skippedAlreadyPriced.push(entry.modelId);
      continue;
    }
    if (!dryRun) {
      await upsertResourceModelCatalogEntry(
        {
          modelId: entry.modelId,
          tier: costDefault.tier,
          inputCostPer1MCents: costDefault.inputCostPer1MCents,
          outputCostPer1MCents: costDefault.outputCostPer1MCents,
        },
        opts?.storePath,
      );
    }
    updated.push({
      modelId: entry.modelId,
      tier: costDefault.tier,
      inputCostPer1MCents: costDefault.inputCostPer1MCents,
      outputCostPer1MCents: costDefault.outputCostPer1MCents,
      ruleId: costDefault.ruleId,
      previousInputCostPer1MCents: entry.inputCostPer1MCents,
      previousOutputCostPer1MCents: entry.outputCostPer1MCents,
    });
  }

  return {
    dryRun,
    updated,
    skippedNoDefault,
    skippedAlreadyPriced,
    total: entries.length,
  };
}
