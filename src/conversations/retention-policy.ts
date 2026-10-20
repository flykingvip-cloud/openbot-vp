import type { OpenBotConfig } from "../config/config.js";
import type { TenantRetentionPolicy } from "../config/types.gateway.js";

export type ResolvedConversationRetentionPolicy = {
  activeDays: number;
  archiveDays: number;
  deleteAfterDays: number;
  complianceProfile: NonNullable<TenantRetentionPolicy["complianceProfile"]>;
};

const PLATFORM_DEFAULTS: ResolvedConversationRetentionPolicy = {
  activeDays: 30,
  archiveDays: 180,
  deleteAfterDays: 365,
  complianceProfile: "standard",
};

export function resolveTenantRetentionPolicy(
  cfg: OpenBotConfig | undefined,
  tenantId?: string | null,
): TenantRetentionPolicy {
  const trimmedTenant = tenantId?.trim();
  if (trimmedTenant && cfg?.gateway?.tenantPolicies?.[trimmedTenant]?.retention) {
    return cfg.gateway.tenantPolicies[trimmedTenant].retention ?? {};
  }
  return cfg?.gateway?.tenantPolicies?.default?.retention ?? {};
}

export function resolveConversationRetentionPolicy(
  cfg?: OpenBotConfig,
  tenantId?: string | null,
): ResolvedConversationRetentionPolicy {
  const raw = resolveTenantRetentionPolicy(cfg, tenantId);
  const conversation = raw.conversation ?? {};
  return {
    activeDays: conversation.activeDays ?? PLATFORM_DEFAULTS.activeDays,
    archiveDays: conversation.archiveDays ?? PLATFORM_DEFAULTS.archiveDays,
    deleteAfterDays: conversation.deleteAfterDays ?? PLATFORM_DEFAULTS.deleteAfterDays,
    complianceProfile: raw.complianceProfile ?? PLATFORM_DEFAULTS.complianceProfile,
  };
}

export function retentionDaysToMs(days: number): number {
  return Math.max(0, days) * 24 * 60 * 60 * 1000;
}
