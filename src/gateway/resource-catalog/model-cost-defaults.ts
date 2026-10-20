/**
 * 模型供应商成本默认价表（平台级兜底，framework-free 纯函数）。
 *
 * 背景：Resource Model Catalog 的 seed 默认把 inputCostPer1MCents/outputCostPer1MCents
 * 写成 0，且 tier 一律 tier_b，导致 provider 成本恒为 0、ledger 无法核算真实成本
 * （resolveModelCostRates → catalog 0/0 → computeProviderCostCents = 0）。
 * 本表提供按模型族的市场参考单价与 tier 分类，作为 seed / 回填的默认值。
 *
 * 货币口径：返回「人民币分 / 每百万 token」，与套餐 basePriceCents（¥分）同币种，
 * 保证 providerCostCents 与 tenantRevenueCents 可直接相减得到 margin。
 *
 * 价格来源：2026 年各厂商公开 API 单价（USD / 1M token），按 FX 常量换算为人民币分。
 * 均为**可调默认值**：真实定价应由运营在成本版本（CostVersion）或目录中确认覆盖。
 * tier 语义：tier_a 经济 / tier_b 标准 / tier_c 旗舰。
 */

import type { ResourceTierId } from "./types.js";

/** USD→RMB 换算（可调默认；运营确认后应以成本版本覆盖）。 */
export const MODEL_COST_FX_USD_TO_RMB = 7.2;

export type ModelCostDefault = {
  tier: ResourceTierId;
  /** 输入成本：人民币分 / 1M token。 */
  inputCostPer1MCents: number;
  /** 输出成本：人民币分 / 1M token。 */
  outputCostPer1MCents: number;
  /** 命中的规则 id（审计 / 可解释）。 */
  ruleId: string;
};

type CostRule = {
  id: string;
  test: RegExp;
  tier: ResourceTierId;
  inputUsdPer1M: number;
  outputUsdPer1M: number;
};

/** USD/1M → 人民币分/1M（向最近整数取整，非负）。 */
export function usdPer1MToRmbCents(usdPer1M: number): number {
  return Math.max(0, Math.round(usdPer1M * MODEL_COST_FX_USD_TO_RMB * 100));
}

/**
 * 成本规则，按「具体 → 泛化」排序，首个命中生效。
 * 轻量型（mini / nano / haiku / flash）必须排在对应标准族之前。
 */
const COST_RULES: readonly CostRule[] = [
  // —— 旗舰 tier_c ——
  { id: "claude-opus", test: /opus/i, tier: "tier_c", inputUsdPer1M: 5, outputUsdPer1M: 25 },

  // —— 经济 tier_a：轻量型（先于标准族匹配）——
  { id: "claude-haiku", test: /haiku/i, tier: "tier_a", inputUsdPer1M: 1, outputUsdPer1M: 5 },
  {
    id: "gpt-nano",
    test: /gpt-?5[-_\s]?nano|nano/i,
    tier: "tier_a",
    inputUsdPer1M: 0.05,
    outputUsdPer1M: 0.4,
  },
  {
    id: "gpt-4o-mini",
    test: /gpt-4o[-_\s]?mini/i,
    tier: "tier_a",
    inputUsdPer1M: 0.15,
    outputUsdPer1M: 0.6,
  },
  {
    id: "gpt-4-1-mini",
    test: /gpt-4\.1[-_\s]?mini/i,
    tier: "tier_a",
    inputUsdPer1M: 0.4,
    outputUsdPer1M: 1.6,
  },
  {
    id: "gpt-5-mini",
    test: /gpt-?5[-_\s]?mini|o[34][-_\s]?mini/i,
    tier: "tier_a",
    inputUsdPer1M: 0.25,
    outputUsdPer1M: 2,
  },
  {
    id: "gemini-flash",
    test: /gemini.*flash|flash/i,
    tier: "tier_a",
    inputUsdPer1M: 0.3,
    outputUsdPer1M: 2.5,
  },
  { id: "deepseek", test: /deepseek/i, tier: "tier_a", inputUsdPer1M: 0.3, outputUsdPer1M: 1.1 },
  { id: "qwen", test: /qwen|tongyi/i, tier: "tier_a", inputUsdPer1M: 0.4, outputUsdPer1M: 1.2 },
  {
    id: "zhipu-glm",
    test: /\bglm\b|zhipu|chatglm/i,
    tier: "tier_a",
    inputUsdPer1M: 0.6,
    outputUsdPer1M: 2.2,
  },

  // —— 标准 tier_b ——
  { id: "claude-sonnet", test: /sonnet/i, tier: "tier_b", inputUsdPer1M: 3, outputUsdPer1M: 15 },
  { id: "gpt-4o", test: /gpt-4o/i, tier: "tier_b", inputUsdPer1M: 2.5, outputUsdPer1M: 10 },
  { id: "gpt-4-1", test: /gpt-4\.1/i, tier: "tier_b", inputUsdPer1M: 2, outputUsdPer1M: 8 },
  { id: "gpt-5", test: /gpt-?5/i, tier: "tier_b", inputUsdPer1M: 1.25, outputUsdPer1M: 10 },
  { id: "gemini", test: /gemini/i, tier: "tier_b", inputUsdPer1M: 1.25, outputUsdPer1M: 10 },
  {
    id: "mistral-large",
    test: /mistral.*large|mistral-large|magistral/i,
    tier: "tier_b",
    inputUsdPer1M: 2,
    outputUsdPer1M: 6,
  },
  {
    id: "kimi-moonshot",
    test: /kimi|moonshot/i,
    tier: "tier_b",
    inputUsdPer1M: 1.5,
    outputUsdPer1M: 9,
  },
];

/**
 * 解析模型族默认成本与 tier。匹配整个 modelId（含 provider 前缀，如 `anthropic/claude-3-7-sonnet`）。
 * 未命中返回 null（不臆测，留给运营在 CostVersion/目录中显式填写）。
 */
export function resolveModelCostDefault(modelId: string): ModelCostDefault | null {
  const id = modelId.trim();
  if (!id) {
    return null;
  }
  for (const rule of COST_RULES) {
    if (rule.test.test(id)) {
      return {
        tier: rule.tier,
        inputCostPer1MCents: usdPer1MToRmbCents(rule.inputUsdPer1M),
        outputCostPer1MCents: usdPer1MToRmbCents(rule.outputUsdPer1M),
        ruleId: rule.id,
      };
    }
  }
  return null;
}
