/**
 * Account sandbox scope key. Existing scopes stay session | agent | shared.
 * The account key always contains tenantId and userId. The exec key also
 * contains agentId so two agents of one user do not share a workspace mount.
 * The browser key is tenant + user only: one profile, recyclable processes.
 */
import { isSharedTenantAddressingEnabled } from "../../config/data-space.js";
import type { OpenBotConfig } from "../../config/types.js";
export type AccountSandboxIdentity = {
  tenantId: string;
  userId: string;
  agentId: string;
};

/** Missing trusted identity cannot be repaired by selecting another model. */
export function isSandboxAccountIdentityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return (
    message ===
      "Managed multitenant sandbox requires a server-derived account (tenantId and userId)." ||
    message === "Account worker request does not match the server-derived account." ||
    /^Account sandbox (?:tenantId|userId|agentId) is missing or unsafe\.$/u.test(message)
  );
}

/** Platform user id for the account computer. An email is not a computer key. */
export function accountComputerObserverUserId(userId: string | undefined): string | null {
  const trimmed = userId?.trim() ?? "";
  if (!trimmed || trimmed.includes("@")) {
    return null;
  }
  return trimmed;
}

function firstPlatformUserId(...values: Array<string | undefined>): string {
  for (const value of values) {
    const accepted = accountComputerObserverUserId(value);
    if (accepted) {
      return accepted;
    }
  }
  return "";
}

function requireSegment(value: string | undefined, label: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes(":")) {
    throw new Error(`Account sandbox ${label} is missing or unsafe.`);
  }
  return trimmed;
}

export function resolveAccountExecScopeKey(account: AccountSandboxIdentity | undefined): string {
  const tenantId = requireSegment(account?.tenantId, "tenantId");
  const userId = requireSegment(account?.userId, "userId");
  const agentId = requireSegment(account?.agentId, "agentId");
  return `account:${tenantId}:${userId}:agent:${agentId}`;
}

export function resolveAccountBrowserScopeKey(
  account:
    | {
        tenantId?: string;
        userId?: string;
      }
    | undefined,
): string {
  const tenantId = requireSegment(account?.tenantId, "tenantId");
  const userId = requireSegment(account?.userId, "userId");
  return `account:${tenantId}:${userId}:browser`;
}

export function resolveEmbeddedSandboxAccount(params: {
  agentId?: string;
  gatewayClientUser?: string;
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionEnterpriseId?: string;
  executionIdentity?: {
    collaborationGroupId?: string;
    enterpriseId?: string;
    user?: string;
    platformUserId?: string;
    agentId?: string;
  };
}): AccountSandboxIdentity | undefined {
  const tenantId =
    params.gatewayClientSessionEnterpriseId?.trim() ||
    params.executionIdentity?.enterpriseId?.trim() ||
    "";
  // Platform user id is the account and computer key. Login email is ignored.
  const userId = firstPlatformUserId(
    params.gatewayClientPlatformUserId,
    params.executionIdentity?.platformUserId,
    params.gatewayClientUser,
    params.executionIdentity?.user,
  );
  const agentId = params.agentId?.trim() || params.executionIdentity?.agentId?.trim() || "main";
  if (!tenantId || !userId) {
    return undefined;
  }
  return { tenantId, userId, agentId };
}

export type EmbeddedSandboxAccountInput = {
  config?: OpenBotConfig;
  agentId?: string;
  gatewayClientUser?: string;
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionEnterpriseId?: string;
  executionIdentity?: {
    collaborationGroupId?: string;
    enterpriseId?: string;
    user?: string;
    platformUserId?: string;
    agentId?: string;
  };
};

/**
 * Account for a production sandbox caller.
 * Managed + OPENBOT_MULTITENANT requires tenantId and userId from the run's
 * trusted identity. Config `scope: "account"` is not a substitute.
 * personal_local (shared addressing off) stays unchanged.
 */
export function resolveProductionSandboxAccount(
  params: EmbeddedSandboxAccountInput,
): { tenantId: string; userId: string } | undefined {
  if (!isSharedTenantAddressingEnabled(params.config)) {
    return undefined;
  }
  const account = resolveEmbeddedSandboxAccount(params);
  if (!account) {
    throw new Error(
      "Managed multitenant sandbox requires a server-derived account (tenantId and userId).",
    );
  }
  return { tenantId: account.tenantId, userId: account.userId };
}

export function resolveEmbeddedRunSandboxParams(
  params: EmbeddedSandboxAccountInput & {
    sessionKey?: string;
    workspaceDir: string;
  },
): {
  config?: OpenBotConfig;
  sessionKey?: string;
  workspaceDir: string;
  account?: { tenantId: string; userId: string };
  agentId?: string;
} {
  const account = resolveProductionSandboxAccount(params);
  return {
    config: params.config,
    sessionKey: params.sessionKey,
    workspaceDir: params.workspaceDir,
    ...(params.agentId ? { agentId: params.agentId } : {}),
    ...(account ? { account } : {}),
  };
}
