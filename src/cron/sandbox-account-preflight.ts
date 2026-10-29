import type { OpenBotConfig } from "../config/config.js";
/**
 * Fail-closed / inject account binding before isolated cron runs that need a
 * managed multitenant sandbox (server-derived tenantId + userId).
 *
 * Stops consecutive ~200ms "Managed multitenant sandbox requires a
 * server-derived account" loops when ownership is incomplete.
 */
import { isSharedTenantAddressingEnabled } from "../config/data-space.js";

export const CRON_ACCOUNT_MISSING_PREFIX = "cron_account:missing";

export type CronOwnershipLike = {
  tenantId?: string;
  ownerId?: string;
};

export type CronSandboxAccountBinding = {
  tenantId: string;
  /** Platform user id suitable for sandbox account keys (no email / unsafe chars). */
  userId: string;
};

/** Strip addressing prefixes so sandbox requireSegment accepts the id. */
export function normalizeCronOwnerUserId(ownerId: string | undefined): string {
  const raw = ownerId?.trim() ?? "";
  if (!raw) {
    return "";
  }
  const stripped = raw.replace(/^(?:platform-user:|subject:|user:)/i, "").trim();
  return stripped || raw;
}

export function resolveCronSandboxAccountBinding(
  ownership: CronOwnershipLike | undefined,
): CronSandboxAccountBinding | null {
  const tenantId = ownership?.tenantId?.trim() ?? "";
  const userId = normalizeCronOwnerUserId(ownership?.ownerId);
  if (!tenantId || !userId) {
    return null;
  }
  if (userId.includes("/") || userId.includes("\\") || userId.includes(":")) {
    return null;
  }
  if (tenantId.includes("/") || tenantId.includes("\\") || tenantId.includes(":")) {
    return null;
  }
  return { tenantId, userId };
}

export function cronNeedsManagedSandboxAccount(
  cfg: OpenBotConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isSharedTenantAddressingEnabled(cfg, env);
}

export type CronSandboxAccountPreflight =
  | {
      ok: true;
      binding: CronSandboxAccountBinding | null;
      /** Inject into runEmbeddedPiAgent when binding present. */
      gatewayClientSessionEnterpriseId?: string;
      gatewayClientPlatformUserId?: string;
    }
  | {
      ok: false;
      error: string;
    };

/**
 * When managed multitenant addressing is on, require ownership tenantId+ownerId
 * (or fail-closed). When off, no injection is required.
 */
export function preflightCronManagedSandboxAccount(params: {
  cfg: OpenBotConfig;
  ownership?: CronOwnershipLike;
  env?: NodeJS.ProcessEnv;
}): CronSandboxAccountPreflight {
  const needs = cronNeedsManagedSandboxAccount(params.cfg, params.env);
  const binding = resolveCronSandboxAccountBinding(params.ownership);
  if (!needs) {
    return {
      ok: true,
      binding,
      ...(binding
        ? {
            gatewayClientSessionEnterpriseId: binding.tenantId,
            gatewayClientPlatformUserId: binding.userId,
          }
        : {}),
    };
  }
  if (!binding) {
    return {
      ok: false,
      error: `${CRON_ACCOUNT_MISSING_PREFIX} Managed multitenant sandbox requires job.ownership.tenantId and ownerId (server-derived). Job disabled until ownership is bound.`,
    };
  }
  return {
    ok: true,
    binding,
    gatewayClientSessionEnterpriseId: binding.tenantId,
    gatewayClientPlatformUserId: binding.userId,
  };
}

export function isCronAccountMissingError(error?: string): boolean {
  return (error?.trim() ?? "").startsWith(CRON_ACCOUNT_MISSING_PREFIX);
}
