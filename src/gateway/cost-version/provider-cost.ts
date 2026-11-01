/**
 * 供应商成本纯函数（framework-free）。
 */

export type TokenUsageInput = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export type ProviderCostRateInput = {
  usage: TokenUsageInput;
  inputCostPer1MCents: number;
  outputCostPer1MCents: number;
  /** undefined = 该维单价未配置（有缓存用量时不得当成已知 0）。 */
  cacheReadCostPer1MCents?: number;
  cacheWriteCostPer1MCents?: number;
};

function nonNegTokens(value: number | undefined): number {
  return Math.max(0, Math.floor(value ?? 0));
}

function nonNegRate(value: number | undefined): number {
  return Math.max(0, Math.floor(value ?? 0));
}

export function computeProviderCostCentsFloat(input: ProviderCostRateInput): number {
  const inputTokens = nonNegTokens(input.usage.inputTokens);
  const outputTokens = nonNegTokens(input.usage.outputTokens);
  const cacheReadTokens = nonNegTokens(input.usage.cacheReadTokens);
  const cacheWriteTokens = nonNegTokens(input.usage.cacheWriteTokens);
  const inputRate = nonNegRate(input.inputCostPer1MCents);
  const outputRate = nonNegRate(input.outputCostPer1MCents);
  let total = (inputTokens * inputRate) / 1_000_000 + (outputTokens * outputRate) / 1_000_000;
  if (input.cacheReadCostPer1MCents !== undefined) {
    total += (cacheReadTokens * nonNegRate(input.cacheReadCostPer1MCents)) / 1_000_000;
  }
  if (input.cacheWriteCostPer1MCents !== undefined) {
    total += (cacheWriteTokens * nonNegRate(input.cacheWriteCostPer1MCents)) / 1_000_000;
  }
  return total;
}

export function computeProviderCostCents(input: ProviderCostRateInput): number {
  return Math.round(computeProviderCostCentsFloat(input));
}

/**
 * 有缓存用量但对应单价未配置时，成本不得伪装成「已知 0」。
 * 返回 null 表示价格不完整，调用方应记 providerPriceState=missing。
 */
export function computeProviderCostCentsOrMissing(input: ProviderCostRateInput): number | null {
  const cacheReadTokens = nonNegTokens(input.usage.cacheReadTokens);
  const cacheWriteTokens = nonNegTokens(input.usage.cacheWriteTokens);
  if (cacheReadTokens > 0 && input.cacheReadCostPer1MCents === undefined) {
    return null;
  }
  if (cacheWriteTokens > 0 && input.cacheWriteCostPer1MCents === undefined) {
    return null;
  }
  return computeProviderCostCents(input);
}

export function computeTenantRevenueCents(input: {
  creditsCharged: number;
  creditPriceCents: number | null | undefined;
}): number {
  const credits = Math.max(0, Math.floor(input.creditsCharged));
  const price = input.creditPriceCents;
  if (credits <= 0 || price === null || price === undefined || price <= 0) {
    return 0;
  }
  return Math.round(credits * price);
}

export function computeMarginCents(input: {
  tenantRevenueCents: number;
  providerCostCents: number;
}): number {
  return (
    Math.max(0, Math.floor(input.tenantRevenueCents)) -
    Math.max(0, Math.floor(input.providerCostCents))
  );
}
