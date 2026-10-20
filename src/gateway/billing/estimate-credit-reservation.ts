/**
 * Preflight credit reservation estimate — never a hard-coded fake charge for final settlement.
 *
 * Uses platform credit weights + model catalog when available; falls back to
 * plan meter minimum unit (1) only when credits mode is active and no weight exists.
 */

import type { EntitlementSnapshot } from "../package-entitlement/types.js";
import { listCreditWeights } from "../resource-catalog/credit-weights-store.js";
import { getResourceModelCatalogEntry } from "../resource-catalog/models-catalog-store.js";
import type { CreditUsageStorePaths } from "./record-credit-usage.js";

export type EstimateCreditReservationInput = {
  enterpriseId: string;
  billingMode: "credits" | "enterprise_budget";
  entitlement: Pick<EntitlementSnapshot, "monthlyCredits" | "overagePolicy">;
  /** Preferred model id (provider/model) when known at gate time. */
  modelId?: string;
  storePaths?: Pick<CreditUsageStorePaths, "creditWeights" | "modelCatalog">;
};

export type EstimateCreditReservationResult = {
  /** Credits to hold before model egress; 0 means no credit hold required. */
  reservedCredits: number;
  source: "credit_weight" | "meter_min_unit" | "none";
  modelId?: string;
  tier?: string;
};

/**
 * Minimum reservation for starting an agent run under credits commercial control.
 * enterprise_budget without credit metering → 0 (budget gate handles money).
 * credits mode with quota or block/credits_only overage → at least meter min unit.
 */
export async function estimateCreditReservation(
  input: EstimateCreditReservationInput,
): Promise<EstimateCreditReservationResult> {
  if (input.billingMode !== "credits") {
    return { reservedCredits: 0, source: "none" };
  }

  const overageType = input.entitlement.overagePolicy?.type ?? "block";
  const hasCreditQuota = (input.entitlement.monthlyCredits ?? 0) > 0;
  const needsHold =
    hasCreditQuota ||
    overageType === "block" ||
    overageType === "credits_only" ||
    overageType === "pay_as_you_go";
  if (!needsHold) {
    return { reservedCredits: 0, source: "none" };
  }

  const modelId = input.modelId?.trim();
  if (modelId) {
    const entry = await getResourceModelCatalogEntry(modelId, input.storePaths?.modelCatalog);
    if (entry?.enabled) {
      const weights = await listCreditWeights(input.storePaths?.creditWeights);
      const weight = weights.find((w) => w.tier === entry.tier);
      if (weight && weight.creditCost > 0) {
        return {
          reservedCredits: Math.max(1, Math.floor(weight.creditCost)),
          source: "credit_weight",
          modelId,
          tier: entry.tier,
        };
      }
    }
  }

  // Minimum commercial unit when no catalog weight is available.
  return {
    reservedCredits: 1,
    source: "meter_min_unit",
    ...(modelId ? { modelId } : {}),
  };
}

/**
 * PAYG preflight: overage path requires meter.allowOverage and a positive extra price
 * on the plan pricing (checked by caller with plan version pricing when available).
 */
export function paygOveragePreflightAllowed(params: {
  overagePolicyType: "block" | "credits_only" | "pay_as_you_go" | undefined;
  meterAllowOverage: boolean | undefined;
  extraUnitPriceCents: number | null | undefined;
}): { allowed: boolean; reason?: string } {
  if ((params.overagePolicyType ?? "block") !== "pay_as_you_go") {
    return { allowed: true };
  }
  if (params.meterAllowOverage !== true) {
    return {
      allowed: false,
      reason: "PAYG 超额未在 meter 上允许（allowOverage=false 或未配置）。",
    };
  }
  if (params.extraUnitPriceCents == null || params.extraUnitPriceCents <= 0) {
    return {
      allowed: false,
      reason: "PAYG 超额缺少有效 extra/ai_credits 单价，禁止零价格超额出网。",
    };
  }
  return { allowed: true };
}
