/**
 * Tokens, estimated USD, provider procurement cost, and credits stay in
 * separate columns. Missing data is unknown, not zero. Nothing here converts
 * one column into another.
 */
import { createHash } from "node:crypto";
import type { ModelCostConfig } from "../utils/usage-format.js";
import type { ModelCallUsage } from "./model-call-evidence.js";

export const PRICING_FINGERPRINT_SCHEMA_VERSION = 1 as const;

export type CostColumns = {
  schemaVersion: 1;
  tokens: ModelCallUsage & { completeness: "complete" | "partial" | "absent" };
  estimatedUsd: {
    amount: number | null;
    status: "known" | "unknown" | "partial";
    basis: "config_estimate" | "provider_settlement" | "unknown";
    pricingFingerprint: string | null;
    pricingSchemaVersion: number | null;
  };
  providerProcurementCost: {
    amount: number | null;
    currency: "USD" | null;
    status: "known" | "unknown";
  };
  credits: { amount: number | null; status: "known" | "unknown" };
  /** Estimated USD only. Never a silent sum of credits and procurement. */
  total: { amount: number | null; status: "known" | "unknown" | "partial" };
  billingCorrelation: { businessTaskId: string; runId: string };
  rollup: { role: "own" | "child" | "parent"; includeInFamilyTotal: boolean };
};

function tokenCompleteness(usage: ModelCallUsage): "complete" | "partial" | "absent" {
  const values = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite];
  if (values.every((value) => value == null)) {
    return "absent";
  }
  if (values.some((value) => value == null)) {
    return "partial";
  }
  return "complete";
}

export function pricingFingerprint(params: {
  provider: string;
  model: string;
  cost: ModelCostConfig;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: PRICING_FINGERPRINT_SCHEMA_VERSION,
        provider: params.provider,
        model: params.model,
        cost: params.cost,
      }),
    )
    .digest("hex");
}

function estimateCompleteUsage(usage: ModelCallUsage, cost: ModelCostConfig): number | null {
  if (
    usage.input == null ||
    usage.output == null ||
    usage.cacheRead == null ||
    usage.cacheWrite == null
  ) {
    return null;
  }
  const total =
    usage.input * cost.input +
    usage.output * cost.output +
    usage.cacheRead * cost.cacheRead +
    usage.cacheWrite * cost.cacheWrite;
  if (!Number.isFinite(total)) {
    return null;
  }
  return total / 1_000_000;
}

export function buildCostColumns(params: {
  usage: ModelCallUsage;
  provider?: string;
  model?: string;
  /** Config rates actually used. Null means the price is unknown. */
  cost?: ModelCostConfig | null;
  basis?: "config_estimate" | "provider_settlement";
  providerProcurementUsd?: number | null;
  providerProcurementKnown?: boolean;
  credits?: number | null;
  creditsKnown?: boolean;
  businessTaskId: string;
  runId: string;
  rollupRole?: "own" | "child" | "parent";
}): CostColumns {
  const completeness = tokenCompleteness(params.usage);
  const basis = params.basis ?? (params.cost ? "config_estimate" : "unknown");
  const estimated =
    completeness === "complete" && params.cost && params.provider && params.model
      ? estimateCompleteUsage(params.usage, params.cost)
      : null;
  const estimatedStatus =
    completeness === "absent"
      ? "unknown"
      : completeness === "partial" || !params.cost
        ? completeness === "partial"
          ? "partial"
          : "unknown"
        : estimated == null
          ? "unknown"
          : "known";
  const procurementKnown =
    params.providerProcurementKnown === true &&
    typeof params.providerProcurementUsd === "number" &&
    Number.isFinite(params.providerProcurementUsd);
  const creditsKnown =
    params.creditsKnown === true &&
    typeof params.credits === "number" &&
    Number.isFinite(params.credits);
  const role = params.rollupRole ?? "own";
  return {
    schemaVersion: 1,
    tokens: { ...params.usage, completeness },
    estimatedUsd: {
      amount: estimatedStatus === "known" ? estimated : null,
      status: estimatedStatus,
      basis: estimatedStatus === "known" ? basis : "unknown",
      pricingFingerprint:
        estimatedStatus === "known" && params.cost && params.provider && params.model
          ? pricingFingerprint({
              provider: params.provider,
              model: params.model,
              cost: params.cost,
            })
          : null,
      pricingSchemaVersion: estimatedStatus === "known" ? PRICING_FINGERPRINT_SCHEMA_VERSION : null,
    },
    providerProcurementCost: {
      amount: procurementKnown ? (params.providerProcurementUsd ?? null) : null,
      currency: procurementKnown ? "USD" : null,
      status: procurementKnown ? "known" : "unknown",
    },
    credits: {
      amount: creditsKnown ? (params.credits ?? null) : null,
      status: creditsKnown ? "known" : "unknown",
    },
    total: {
      amount: estimatedStatus === "known" ? estimated : null,
      status: estimatedStatus,
    },
    billingCorrelation: { businessTaskId: params.businessTaskId, runId: params.runId },
    rollup: { role, includeInFamilyTotal: role !== "child" },
  };
}

/**
 * A parent that already stores childAttributedCostUsd must not also sum the
 * children's own amounts. The unsafe sum is reported as unknown.
 */
export function familyRollup(params: {
  parentOwnUsd: number | null;
  parentChildAttributedUsd: number | null;
  childOwnUsd: Array<number | null>;
}): { amount: number | null; status: "known" | "unknown"; doubleCountRisk: boolean } {
  const childrenKnown = params.childOwnUsd.every((value) => typeof value === "number");
  const attributed = params.parentChildAttributedUsd;
  if (attributed != null && params.childOwnUsd.length > 0) {
    return { amount: null, status: "unknown", doubleCountRisk: true };
  }
  if (params.parentOwnUsd == null || !childrenKnown) {
    return { amount: null, status: "unknown", doubleCountRisk: false };
  }
  const childSum = params.childOwnUsd.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return { amount: params.parentOwnUsd + childSum, status: "known", doubleCountRisk: false };
}
