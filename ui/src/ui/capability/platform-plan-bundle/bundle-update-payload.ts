/**
 * 组装 platform-plan-bundle.update 请求体（保留权益 / quota / AOR 字段）。
 */

import type { PlatformPlanBundleUpdateRequest, PlatformPlanBundleVersionRow } from "./endpoints.ts";

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))].toSorted();
}

function entitlementPayloadFromMeta(
  meta: PlatformPlanBundleVersionRow | null,
  defaultPolicyId: string,
): Pick<
  PlatformPlanBundleUpdateRequest,
  | "monthlyCredits"
  | "maxConcurrentRuns"
  | "maxWorkflows"
  | "maxKnowledgeBases"
  | "overagePolicy"
  | "allowedTiers"
  | "allowedPolicies"
  | "policyId"
  | "allowCustomPolicy"
  | "allowPrivateModels"
  | "features"
> {
  const snap = meta?.entitlementSnapshot;
  const binding = meta?.binding;
  const policyId =
    binding?.policyId?.trim() || snap?.allowedPolicies?.[0]?.trim() || defaultPolicyId;
  const allowedTiers = uniqueSorted(binding?.allowedTiers ?? snap?.allowedTiers ?? []);
  const allowedPolicies = uniqueSorted(binding?.allowedPolicies ?? snap?.allowedPolicies ?? []);
  const maxConcurrentRuns = snap?.maxConcurrentRuns;
  const maxWorkflows = snap?.maxWorkflows;
  const maxKnowledgeBases = snap?.maxKnowledgeBases;
  return {
    monthlyCredits: snap?.monthlyCredits ?? 0,
    ...(maxConcurrentRuns !== undefined ? { maxConcurrentRuns } : {}),
    ...(maxWorkflows !== undefined ? { maxWorkflows } : {}),
    ...(maxKnowledgeBases !== undefined ? { maxKnowledgeBases } : {}),
    overagePolicy: {
      type: snap?.overagePolicy?.type ?? "block",
      allowBurstConcurrency: snap?.overagePolicy?.allowBurstConcurrency ?? false,
    },
    allowedTiers,
    allowedPolicies: allowedPolicies.length > 0 ? allowedPolicies : [policyId],
    policyId,
    allowCustomPolicy: snap?.allowCustomPolicy === true,
    allowPrivateModels: snap?.allowPrivateModels === true,
    features: {
      auditLog: snap?.features?.auditLog === true,
      mfa: snap?.features?.mfa === true,
      sso: snap?.features?.sso === true,
      vpcIsolation: snap?.features?.vpcIsolation === true,
    },
  };
}

export function buildBundleUpdatePayload(
  planId: string,
  meta: PlatformPlanBundleVersionRow | null,
  allowedModelIds: string[],
  options?: { defaultPolicyId?: string },
): PlatformPlanBundleUpdateRequest {
  const binding = meta?.binding;
  const rawQuota = binding?.modelQuota;
  const filteredQuota =
    rawQuota && Object.keys(rawQuota).length > 0
      ? Object.fromEntries(
          Object.entries(rawQuota).filter(([modelId]) => allowedModelIds.includes(modelId)),
        )
      : undefined;
  const rawBudgets = binding?.modelBudgets;
  const filteredBudgets =
    rawBudgets && Object.keys(rawBudgets).length > 0
      ? Object.fromEntries(
          Object.entries(rawBudgets).filter(([modelId]) => allowedModelIds.includes(modelId)),
        )
      : undefined;
  return {
    planId,
    allowedModelIds: uniqueSorted(allowedModelIds),
    ...entitlementPayloadFromMeta(meta, options?.defaultPolicyId ?? "balanced"),
    ...(filteredQuota && Object.keys(filteredQuota).length > 0
      ? { modelQuota: filteredQuota }
      : {}),
    ...(filteredBudgets && Object.keys(filteredBudgets).length > 0
      ? { modelBudgets: filteredBudgets }
      : {}),
    ...(binding?.aorExecution ? { aorExecution: binding.aorExecution } : {}),
  };
}
