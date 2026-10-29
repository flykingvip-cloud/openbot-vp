/**
 * Fail-closed / inject account binding before isolated cron runs that need a
 * managed multitenant sandbox (server-derived tenantId + userId).
 *
 * Stops consecutive ~200ms "Managed multitenant sandbox requires a
 * server-derived account" loops when ownership is incomplete.
 *
 * Platform user ids must match sandbox rules (email is not a computer key).
 * Email-shaped ownership.ownerId is rejected from the sandbox binding so
 * injection never passes an address that resolveProductionSandboxAccount would
 * drop, then throw. Email owners still pass ownership-field preflight and rely
 * on knowledge email→uuid resolve plus executionIdentity inheritance.
 *
 * Cron also freezes an `executionIdentity` object (not only gatewayClient*
 * scalars) so nested reconstruct / sessions_spawn hops that prefer the
 * canonical object keep tenantId+userId on every sandbox create.
 */
import { accountComputerObserverUserId } from "../agents/sandbox/account-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import { isSharedTenantAddressingEnabled } from "../config/data-space.js";
import {
  createExecutionIdentityContext,
  type ExecutionIdentityContext,
} from "../gateway/execution-identity-context.js";

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

/** True when ownership carries tenant + owner fields (email owner still counts). */
export function hasCronOwnershipAccountFields(ownership: CronOwnershipLike | undefined): boolean {
  const tenantId = ownership?.tenantId?.trim() ?? "";
  const ownerId = normalizeCronOwnerUserId(ownership?.ownerId);
  if (!tenantId || !ownerId) {
    return false;
  }
  if (tenantId.includes("/") || tenantId.includes("\\") || tenantId.includes(":")) {
    return false;
  }
  // Owner may be email (resolved later) or platform id; reject path separators / leftover prefixes.
  if (ownerId.includes("/") || ownerId.includes("\\") || ownerId.includes(":")) {
    return false;
  }
  return true;
}

/**
 * Sandbox-safe binding only. Email-shaped ownerId returns null so we never inject
 * an address that resolveProductionSandboxAccount would drop.
 */
export function resolveCronSandboxAccountBinding(
  ownership: CronOwnershipLike | undefined,
): CronSandboxAccountBinding | null {
  if (!hasCronOwnershipAccountFields(ownership)) {
    return null;
  }
  const tenantId = ownership!.tenantId!.trim();
  const normalizedOwner = normalizeCronOwnerUserId(ownership?.ownerId);
  const userId = accountComputerObserverUserId(normalizedOwner);
  if (!userId) {
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
 * Trusted run fields for isolated cron → runEmbeddedPiAgent.
 * Ownership platform user + tenant win over knowledge for the sandbox account
 * key; knowledge may still supply email / sessionDomain.
 */
export type CronSandboxRunIdentityInject = {
  executionIdentity?: ExecutionIdentityContext;
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: "platform" | "enterprise" | "employee";
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionEnterpriseId?: string;
};

export function buildCronSandboxRunIdentityInject(params: {
  preflight: Extract<CronSandboxAccountPreflight, { ok: true }>;
  knowledge?: {
    user?: string;
    platformUserId?: string;
    sessionDomain?: "platform" | "enterprise" | "employee";
  } | null;
  agentId?: string | null;
  sessionKey?: string | null;
}): CronSandboxRunIdentityInject {
  const enterpriseId =
    params.preflight.gatewayClientSessionEnterpriseId?.trim() ||
    params.preflight.binding?.tenantId?.trim() ||
    "";
  // Ownership / preflight platform id is authoritative for sandbox account keys.
  const platformUserId =
    params.preflight.gatewayClientPlatformUserId?.trim() ||
    params.preflight.binding?.userId?.trim() ||
    params.knowledge?.platformUserId?.trim() ||
    "";
  const user = params.knowledge?.user?.trim() || "";
  const sessionDomain = params.knowledge?.sessionDomain;
  if (!enterpriseId && !platformUserId && !user) {
    return {};
  }
  const executionIdentity = createExecutionIdentityContext({
    ...(user ? { user } : {}),
    ...(platformUserId ? { platformUserId } : {}),
    ...(sessionDomain ? { sessionDomain } : {}),
    ...(enterpriseId ? { enterpriseId } : {}),
    ...(params.agentId ? { agentId: params.agentId } : {}),
    ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
  });
  return {
    executionIdentity,
    ...(user ? { gatewayClientUser: user } : {}),
    ...(sessionDomain ? { gatewayClientSessionDomain: sessionDomain } : {}),
    ...(platformUserId ? { gatewayClientPlatformUserId: platformUserId } : {}),
    ...(enterpriseId ? { gatewayClientSessionEnterpriseId: enterpriseId } : {}),
  };
}

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
  const hasFields = hasCronOwnershipAccountFields(params.ownership);
  const binding = resolveCronSandboxAccountBinding(params.ownership);
  const tenantId = params.ownership?.tenantId?.trim() || undefined;
  // Inject enterprise whenever tenant is present; platform user only when sandbox-safe
  // (non-email). Email owners rely on knowledge/email→uuid resolve before runEmbedded.
  const injectEnterprise = binding?.tenantId || (hasFields ? tenantId : undefined);
  const injectUser = binding?.userId;
  if (!needs) {
    return {
      ok: true,
      binding,
      ...(injectEnterprise ? { gatewayClientSessionEnterpriseId: injectEnterprise } : {}),
      ...(injectUser ? { gatewayClientPlatformUserId: injectUser } : {}),
    };
  }
  if (!hasFields) {
    return {
      ok: false,
      error: `${CRON_ACCOUNT_MISSING_PREFIX} Managed multitenant sandbox requires job.ownership.tenantId and ownerId (server-derived). Job disabled until ownership is bound.`,
    };
  }
  return {
    ok: true,
    binding,
    ...(injectEnterprise ? { gatewayClientSessionEnterpriseId: injectEnterprise } : {}),
    ...(injectUser ? { gatewayClientPlatformUserId: injectUser } : {}),
  };
}

export function isCronAccountMissingError(error?: string): boolean {
  const text = error?.trim() ?? "";
  if (!text) {
    return false;
  }
  if (text.startsWith(CRON_ACCOUNT_MISSING_PREFIX)) {
    return true;
  }
  // Raw sandbox throw (preflight gap / nested inherit drop) — soft-disable + alert.
  return /requires a server-derived account/i.test(text);
}
