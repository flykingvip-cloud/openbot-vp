/**
 * Persist a Feishu 企业通道 connection check onto the tenant config override.
 * Does not write secrets and does not start the global channel runtime.
 */
import type { OpenBotConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import {
  applyFeishuEnterpriseObservation,
  type FeishuEnterpriseProbeObservation,
} from "./enterprise-im-channel-contract.js";
import { writeTenantConfigView } from "./tenant-config-service.js";
import {
  getTenantConfigOverride,
  loadTenantConfigStore,
  resolveConfigForTenant,
} from "./tenant-config.js";

export function readFeishuProbeObservation(
  probe: unknown,
): FeishuEnterpriseProbeObservation | null {
  if (!probe || typeof probe !== "object") {
    return null;
  }
  const record = probe as {
    ok?: unknown;
    tenantKey?: unknown;
    grantedScopeNames?: unknown;
  };
  if (record.ok !== true && record.ok !== false) {
    return null;
  }
  const tenantKey =
    typeof record.tenantKey === "string" && record.tenantKey.trim()
      ? record.tenantKey.trim()
      : null;
  const grantedScopeNames = Array.isArray(record.grantedScopeNames)
    ? record.grantedScopeNames.filter((name): name is string => typeof name === "string")
    : null;
  return { ok: record.ok, tenantKey, grantedScopeNames };
}

export async function persistFeishuEnterpriseProbe(params: {
  tenantId: string;
  accountId: string;
  observation: FeishuEnterpriseProbeObservation;
  now?: Date;
  storePath?: string;
  platformDefault?: OpenBotConfig;
}): Promise<ReturnType<typeof applyFeishuEnterpriseObservation> | null> {
  const platformDefault = params.platformDefault ?? loadConfig();
  const store = await loadTenantConfigStore(params.storePath);
  const view = resolveConfigForTenant({
    platformDefault,
    override: getTenantConfigOverride(store, params.tenantId),
  });
  const config = structuredClone(view) as Record<string, unknown>;
  const recorded = applyFeishuEnterpriseObservation({
    config,
    accountId: params.accountId,
    observation: params.observation,
    nowIso: (params.now ?? new Date()).toISOString(),
  });
  const write = await writeTenantConfigView({
    tenantId: params.tenantId,
    config: config as OpenBotConfig,
    platformDefault,
    storePath: params.storePath,
    now: () => params.now ?? new Date(),
  });
  if (!write.ok) {
    return null;
  }
  return recorded;
}
