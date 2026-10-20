/**
 * EnterpriseModelCeiling = SubscriptionModelSet ∪ ActiveTenantOwnedModelSet
 */

import { getEnterpriseModelEntitlement } from "../model-entitlement/enterprise-model-entitlement-store.js";
import {
  listActiveTenantOwnedModelIds,
  promoteEnabledEnterpriseModelAssets,
} from "./asset-store.js";
import {
  isEnterpriseModelConnectionCatalogReady,
  listEnterpriseModelConnections,
} from "./connection-store.js";

export type EnterpriseModelCeilingResult = {
  tenantId: string;
  subscriptionModelIds: string[];
  tenantOwnedModelIds: string[];
  ceilingModelIds: string[];
};

export async function resolveEnterpriseModelCeiling(params: {
  tenantId: string;
  entitlementStorePath?: string;
  assetStorePath?: string;
}): Promise<EnterpriseModelCeilingResult> {
  const entitlement = await getEnterpriseModelEntitlement(
    params.tenantId,
    params.entitlementStorePath,
  );
  const subscriptionModelIds = [
    ...new Set((entitlement?.allowedModelIds ?? []).map((id) => id.trim()).filter(Boolean)),
  ];
  const tenantOwnedModelIds = await listActiveTenantOwnedModelIds(
    params.tenantId,
    params.assetStorePath,
  );
  const ceilingModelIds = [...new Set([...subscriptionModelIds, ...tenantOwnedModelIds])];
  return {
    tenantId: params.tenantId,
    subscriptionModelIds,
    tenantOwnedModelIds,
    ceilingModelIds,
  };
}

export function isModelInCeiling(ceiling: EnterpriseModelCeilingResult, modelId: string): boolean {
  return ceiling.ceilingModelIds.includes(modelId.trim());
}

/**
 * Heal BYOK assets that were saved as `unknown` after a successful connection
 * probe. The model library lists every registered asset; the seat checklist
 * only lists the ceiling, which requires `healthStatus === "healthy"`.
 *
 * Admin grant list/write calls this before resolving the ceiling. Runtime
 * resolution stays read-only and does not write asset health.
 * An unverified or unhealthy connection does not promote its assets.
 */
export async function reconcileVerifiedEnterpriseModelAssets(params: {
  tenantId: string;
  assetStorePath?: string;
  connectionStorePath?: string;
}): Promise<number> {
  const connections = await listEnterpriseModelConnections(
    params.tenantId,
    params.connectionStorePath,
  );
  let changed = 0;
  for (const connection of connections) {
    if (
      connection.healthStatus !== "healthy" ||
      !isEnterpriseModelConnectionCatalogReady(connection.status)
    ) {
      continue;
    }
    changed += await promoteEnabledEnterpriseModelAssets(
      params.tenantId,
      connection.connectionId,
      params.assetStorePath ? { storePath: params.assetStorePath } : undefined,
    );
  }
  return changed;
}
