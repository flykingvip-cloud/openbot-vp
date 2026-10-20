/**
 * 从 platform-plan-bundle.overview 本地投影模型绑定视图，替代 legacy overview RPC。
 */

import type { Plan } from "../cost-budget-billing/index.ts";
import type { PlatformModelBindingOverview } from "../platform-model-binding/types.ts";
import type {
  PlatformPlanBundleOverviewResponse,
  PlatformPlanBundleVersionRow,
} from "./endpoints.ts";

export function indexBundleVersionMeta(
  overview: PlatformPlanBundleOverviewResponse,
): Record<string, PlatformPlanBundleVersionRow> {
  return Object.fromEntries(
    overview.plans.flatMap((row) => row.versions.map((version) => [version.versionId, version])),
  );
}

export function buildModelBindingOverviewFromBundle(params: {
  plans: readonly Plan[];
  versionMetaById: Readonly<Record<string, PlatformPlanBundleVersionRow>>;
  catalog: readonly string[];
}): PlatformModelBindingOverview {
  const planRows = params.plans.map((plan) => {
    const meta = params.versionMetaById[plan.currentVersionId];
    return {
      planId: plan.id,
      name: plan.name,
      status: plan.status,
      currentVersionId: plan.currentVersionId,
      allowedModelIds: meta?.binding?.allowedModelIds ?? [],
      aorExecution: meta?.binding?.aorExecution,
      modelQuota: meta?.binding?.modelQuota,
    };
  });

  const reverseIndex: Record<string, string[]> = {};
  for (const row of planRows) {
    for (const modelId of row.allowedModelIds) {
      const bucket = reverseIndex[modelId] ?? [];
      bucket.push(row.planId);
      reverseIndex[modelId] = bucket;
    }
  }

  const catalogSet = new Set(params.catalog);
  for (const row of planRows) {
    for (const modelId of row.allowedModelIds) {
      catalogSet.add(modelId);
    }
  }

  return {
    catalog: [...catalogSet].toSorted(),
    plans: planRows,
    reverseIndex,
  };
}

export function buildModelBindingOverviewFromBundleResponse(
  overview: PlatformPlanBundleOverviewResponse,
): PlatformModelBindingOverview {
  const plans = overview.plans.map((row) => row.plan);
  return buildModelBindingOverviewFromBundle({
    plans,
    versionMetaById: indexBundleVersionMeta(overview),
    catalog: overview.catalog,
  });
}
