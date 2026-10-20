/**
 * 供应商成本纯函数（framework-free）。
 */

export type TokenUsageInput = {
  inputTokens?: number;
  outputTokens?: number;
};

export function computeProviderCostCentsFloat(input: {
  usage: TokenUsageInput;
  inputCostPer1MCents: number;
  outputCostPer1MCents: number;
}): number {
  const inputTokens = Math.max(0, Math.floor(input.usage.inputTokens ?? 0));
  const outputTokens = Math.max(0, Math.floor(input.usage.outputTokens ?? 0));
  const inputRate = Math.max(0, Math.floor(input.inputCostPer1MCents));
  const outputRate = Math.max(0, Math.floor(input.outputCostPer1MCents));
  return (inputTokens * inputRate) / 1_000_000 + (outputTokens * outputRate) / 1_000_000;
}

export function computeProviderCostCents(input: {
  usage: TokenUsageInput;
  inputCostPer1MCents: number;
  outputCostPer1MCents: number;
}): number {
  return Math.round(
    computeProviderCostCentsFloat({
      usage: input.usage,
      inputCostPer1MCents: input.inputCostPer1MCents,
      outputCostPer1MCents: input.outputCostPer1MCents,
    }),
  );
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
