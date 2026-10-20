/**
 * Resource Catalog doctor 体检（只读）。
 */

import type { OpenBotConfig } from "../../config/types.js";
import type { EntitlementDoctorIssue } from "../model-entitlement/doctor-checks.js";
import { listPlanVersionModelBindings } from "../model-entitlement/plan-version-model-binding-store.js";
import { listConfiguredModelIds } from "../model-entitlement/resolve-effective-model-set.js";
import { listResourceModelCatalog } from "./models-catalog-store.js";
import { compareTierProjectionWithModelIds } from "./resolve.js";

export async function checkResourceCatalogIntegrity(
  cfg: OpenBotConfig | undefined,
  opts?: {
    modelCatalogStorePath?: string;
    planBindingStorePath?: string;
  },
): Promise<EntitlementDoctorIssue[]> {
  const issues: EntitlementDoctorIssue[] = [];
  const configIds = listConfiguredModelIds(cfg);
  const catalog = await listResourceModelCatalog(opts?.modelCatalogStorePath);
  const catalogIds = new Set(catalog.map((m) => m.modelId));
  const missing = configIds.filter((id) => !catalogIds.has(id));
  if (missing.length > 0) {
    issues.push({
      code: "resource_catalog_missing",
      severity: "info",
      message: `${missing.length} configured model(s) are not in the resource catalog store. Run platform-resource-catalog.models.seed-from-config or upsert entries manually.`,
      hint: `Missing: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "…" : ""}`,
    });
  }

  const bindings = await listPlanVersionModelBindings(opts?.planBindingStorePath);
  for (const binding of bindings) {
    if (!binding.allowedTiers || binding.allowedTiers.length === 0) {
      continue;
    }
    // Phase 3：Tier 是配置真源，allowedModelIds 是派生缓存。doctor 不再校验「人工双配是否一致」，
    // 而是体检「派生结果是否健康」：(1) Tier 是否能投影出非空模型池；(2) 缓存是否相对当前目录陈旧。
    const comparison = compareTierProjectionWithModelIds({
      allowedTierIds: binding.allowedTiers,
      allowedModelIds: binding.allowedModelIds,
      catalog,
    });
    if (comparison.projectedModelIds.length === 0) {
      issues.push({
        code: "binding_tier_empty_projection",
        severity: "warning",
        planVersionId: binding.planVersionId,
        message: `Plan version "${binding.planVersionId}" allowedTiers [${binding.allowedTiers.join(", ")}] resolve to no enabled models; the derived model pool is empty.`,
        hint: "Enable models under these tiers in the resource catalog, or pick tiers that contain enabled models.",
      });
      continue;
    }
    if (!comparison.aligned) {
      issues.push({
        code: "binding_tier_mismatch",
        severity: "info",
        planVersionId: binding.planVersionId,
        message: `Plan version "${binding.planVersionId}" cached allowedModelIds is stale vs the current tier projection (added=${comparison.extraInProjection.length}, dropped=${comparison.missingFromProjection.length}).`,
        hint: "allowedModelIds is a derived cache of the tier projection; re-save the version to refresh it from the current resource catalog.",
      });
    }
  }

  return issues;
}
