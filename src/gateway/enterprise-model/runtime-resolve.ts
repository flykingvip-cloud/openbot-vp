/**
 * Per-request tenant model runtime config for BYOK invocation.
 * MUST NOT mutate global loadConfig() / process-level provider state.
 */

import { getEnterpriseModelAssetByRuntimeId } from "./asset-store.js";
import { recordEnterpriseModelAuditEvent } from "./audit.js";
import { assertEnterpriseModelBudgetAllows } from "./budget-gate.js";
import { getEnterpriseModelConnection } from "./connection-store.js";
import { loadEnterpriseModelSecret } from "./credential-vault.js";
import { EnterpriseModelError } from "./errors.js";
import { isEnterpriseRuntimeModelId } from "./ids.js";

export type TenantModelRuntimeConfig = {
  tenantId: string;
  runtimeModelId: string;
  upstreamModelId: string;
  connectionId: string;
  providerType: string;
  protocol: string;
  baseUrl?: string;
  apiKey: string;
  billingOwner: "enterprise";
  source: "enterprise";
};

export async function resolveTenantModelRuntimeConfig(params: {
  tenantId: string;
  runtimeModelId: string;
  connectionStorePath?: string;
  assetStorePath?: string;
  vaultPath?: string;
  usageLedgerPath?: string;
  now?: Date;
}): Promise<TenantModelRuntimeConfig | null> {
  if (!isEnterpriseRuntimeModelId(params.runtimeModelId)) {
    return null;
  }
  const asset = await getEnterpriseModelAssetByRuntimeId(
    params.tenantId,
    params.runtimeModelId,
    params.assetStorePath,
  );
  if (!asset) {
    throw new EnterpriseModelError(
      "ENTERPRISE_MODEL_NOT_FOUND",
      "enterprise model asset not found for tenant",
    );
  }
  if (!asset.enabled) {
    throw new EnterpriseModelError(
      "ENTERPRISE_MODEL_FORBIDDEN",
      "enterprise model asset is disabled",
    );
  }
  // Fail-closed: unknown/unchecked/degraded must not run until re-verified.
  if (asset.healthStatus !== "healthy") {
    throw new EnterpriseModelError(
      "ENTERPRISE_MODEL_MODEL_UNAVAILABLE",
      `enterprise model asset is not verified (health=${asset.healthStatus})`,
    );
  }
  await assertEnterpriseModelBudgetAllows({
    tenantId: params.tenantId,
    asset,
    ...(params.now ? { now: params.now } : {}),
    ...(params.usageLedgerPath ? { usageLedgerPath: params.usageLedgerPath } : {}),
  });
  const connection = await getEnterpriseModelConnection(
    params.tenantId,
    asset.connectionId,
    params.connectionStorePath,
  );
  if (!connection || connection.status === "disabled") {
    throw new EnterpriseModelError(
      "ENTERPRISE_MODEL_FORBIDDEN",
      "enterprise model connection is unavailable",
    );
  }
  const runtimeReadyStatuses = new Set(["verified", "models_discovered", "active"]);
  if (!runtimeReadyStatuses.has(connection.status)) {
    throw new EnterpriseModelError(
      "ENTERPRISE_MODEL_FORBIDDEN",
      `enterprise model connection is not verified (status=${connection.status})`,
    );
  }
  if (connection.healthStatus !== "healthy") {
    throw new EnterpriseModelError(
      "ENTERPRISE_MODEL_FORBIDDEN",
      `enterprise model connection is not healthy (health=${connection.healthStatus})`,
    );
  }
  const secret = await loadEnterpriseModelSecret(connection.credentialRef, params.vaultPath);
  if (!secret?.apiKey?.trim()) {
    throw new EnterpriseModelError(
      "ENTERPRISE_MODEL_INVALID_CREDENTIAL",
      "enterprise model credential missing",
    );
  }
  // Audit successful BYOK resolve (ready to invoke). Never include apiKey.
  try {
    await recordEnterpriseModelAuditEvent({
      tenantId: params.tenantId,
      action: "runtime.invoked",
      targetType: "asset",
      targetId: asset.assetId,
      result: "success",
      details: {
        runtimeModelId: asset.runtimeModelId,
        connectionId: connection.connectionId,
        providerType: connection.providerType,
      },
    });
  } catch {
    // Audit must not block invoke.
  }
  return {
    tenantId: params.tenantId,
    runtimeModelId: asset.runtimeModelId,
    upstreamModelId: asset.upstreamModelId,
    connectionId: connection.connectionId,
    providerType: connection.providerType,
    protocol: connection.protocol,
    ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
    apiKey: secret.apiKey,
    billingOwner: "enterprise",
    source: "enterprise",
  };
}
