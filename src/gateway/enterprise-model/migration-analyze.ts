/**
 * Read-only migration / doctor analysis for enterprise model governance.
 * NEVER auto-assigns global providers as a tenant's BYOK assets.
 */

import type { OpenBotConfig } from "../../config/types.js";
import { listEnterpriseModelEntitlements } from "../model-entitlement/enterprise-model-entitlement-store.js";
import { listConfiguredModelIds } from "../model-entitlement/resolve-effective-model-set.js";
import { listSeatModelGrantsForTenant } from "../model-entitlement/seat-model-grant-store.js";
import { listEnabledResourceCatalogModelIds } from "../resource-catalog/list-enabled-model-ids.js";
import { listEnterpriseModelAssets } from "./asset-store.js";
import { isEnterpriseRuntimeModelId } from "./ids.js";

export type EnterpriseModelMigrationReport = {
  globalConfiguredModelIds: string[];
  platformCatalogActiveModelIds: string[];
  configuredButNotInActiveCatalog: string[];
  danglingEntitlements: Array<{ tenantId: string; modelId: string }>;
  danglingGrants: Array<{
    tenantId: string;
    subjectType: string;
    subjectId: string;
    modelId: string;
  }>;
  tenantOwnedAssets: Array<{ tenantId: string; runtimeModelId: string; enabled: boolean }>;
  notes: string[];
};

export async function analyzeEnterpriseModelMigration(params: {
  cfg: OpenBotConfig | undefined;
  tenantIds?: string[];
  entitlementStorePath?: string;
  seatGrantStorePath?: string;
  resourceCatalogStorePath?: string;
  assetStorePath?: string;
}): Promise<EnterpriseModelMigrationReport> {
  const globalConfiguredModelIds = listConfiguredModelIds(params.cfg);
  const platform = await listEnabledResourceCatalogModelIds({
    storePath: params.resourceCatalogStorePath,
  });
  const platformCatalogActiveModelIds = platform.modelIds;
  const catalogSet = new Set(platformCatalogActiveModelIds);
  const configuredButNotInActiveCatalog = globalConfiguredModelIds.filter(
    (id) => !catalogSet.has(id),
  );

  const entitlements = await listEnterpriseModelEntitlements(params.entitlementStorePath);
  const tenantFilter = params.tenantIds?.length
    ? new Set(params.tenantIds.map((t) => t.trim()).filter(Boolean))
    : null;

  const danglingEntitlements: EnterpriseModelMigrationReport["danglingEntitlements"] = [];
  const danglingGrants: EnterpriseModelMigrationReport["danglingGrants"] = [];
  const tenantOwnedAssets: EnterpriseModelMigrationReport["tenantOwnedAssets"] = [];

  for (const ent of entitlements) {
    if (tenantFilter && !tenantFilter.has(ent.tenantId)) {
      continue;
    }
    const assets = await listEnterpriseModelAssets(ent.tenantId, {
      storePath: params.assetStorePath,
    });
    for (const asset of assets) {
      tenantOwnedAssets.push({
        tenantId: asset.tenantId,
        runtimeModelId: asset.runtimeModelId,
        enabled: asset.enabled,
      });
    }
    const ownedSet = new Set(assets.map((a) => a.runtimeModelId));
    for (const modelId of ent.allowedModelIds) {
      const ok =
        catalogSet.has(modelId) ||
        ownedSet.has(modelId) ||
        (isEnterpriseRuntimeModelId(modelId) && ownedSet.has(modelId));
      if (!ok) {
        danglingEntitlements.push({ tenantId: ent.tenantId, modelId });
      }
    }
    const grants = await listSeatModelGrantsForTenant(ent.tenantId, params.seatGrantStorePath);
    for (const grant of grants) {
      for (const modelId of grant.grantedModelIds) {
        const inCeiling =
          ent.allowedModelIds.includes(modelId) || ownedSet.has(modelId) || catalogSet.has(modelId);
        if (!inCeiling) {
          danglingGrants.push({
            tenantId: ent.tenantId,
            subjectType: grant.subjectType,
            subjectId: grant.subjectId,
            modelId,
          });
        }
      }
    }
  }

  return {
    globalConfiguredModelIds,
    platformCatalogActiveModelIds,
    configuredButNotInActiveCatalog,
    danglingEntitlements,
    danglingGrants,
    tenantOwnedAssets,
    notes: [
      "Global models.providers are NOT auto-assigned to any tenant BYOK catalog.",
      "Explicit migration confirmation or platform ownership rules are required before cutover.",
      "Empty enterprise-model stores must not break existing platform/personal model paths.",
    ],
  };
}
