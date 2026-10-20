import type { OpenBotConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import { applyMergePatch } from "../config/merge-patch.js";
import type { TenantRetentionPolicy } from "../config/types.gateway.js";
import {
  loadTenantConfigStore,
  resolveConfigForTenant,
  saveTenantConfigStore,
  setTenantConfigOverride,
  type TenantConfigOverride,
} from "../gateway/tenant-config.js";
import { resolveConversationRetentionPolicy } from "./retention-policy.js";

export type TenantRetentionConfigView = {
  tenantId: string;
  policy: TenantRetentionPolicy;
  resolved: ReturnType<typeof resolveConversationRetentionPolicy>;
  source: "tenant-override" | "platform-default";
};

function readRetentionFromConfig(cfg: OpenBotConfig, tenantId: string): TenantRetentionPolicy {
  return cfg.gateway?.tenantPolicies?.[tenantId]?.retention ?? {};
}

export async function loadTenantRetentionConfigView(
  tenantId: string,
): Promise<TenantRetentionConfigView> {
  const canonical = tenantId.trim();
  const platformDefault = loadConfig();
  const store = await loadTenantConfigStore();
  const override = store.tenants[canonical]?.override ?? null;
  const effective = resolveConfigForTenant({ platformDefault, override });
  const policy = readRetentionFromConfig(effective, canonical);
  const hasOverride = Boolean(policy && Object.keys(policy).length > 0);
  return {
    tenantId: canonical,
    policy,
    resolved: resolveConversationRetentionPolicy(effective, canonical),
    source: hasOverride ? "tenant-override" : "platform-default",
  };
}

export async function updateTenantRetentionPolicy(params: {
  tenantId: string;
  patch: TenantRetentionPolicy;
}): Promise<TenantRetentionConfigView> {
  const tenantId = params.tenantId.trim();
  const store = await loadTenantConfigStore();
  const currentOverride = store.tenants[tenantId]?.override ?? {};
  const mergedOverride = applyMergePatch(currentOverride, {
    gateway: {
      tenantPolicies: {
        [tenantId]: {
          retention: params.patch,
        },
      },
    },
  }) as TenantConfigOverride;
  const nextStore = setTenantConfigOverride(store, tenantId, mergedOverride);
  await saveTenantConfigStore(nextStore);
  return loadTenantRetentionConfigView(tenantId);
}
