/**
 * Trusted knowledge identity for non-employee runtimes (cron, bots, group turns).
 *
 * Fail-closed: returns null unless identity comes from a server-stamped source
 * (websocket email, platform user id, cron job owner, group owner, or bot seat binding).
 * Never accepts raw user ids from tool arguments.
 */
import { loadConfig } from "../../config/config.js";
import { resolveAgentRunEntitlementScope } from "../model-entitlement/resolve-agent-run-scope.js";
import {
  findUserByEmail,
  findUserById,
  loadPlatformAuthStore,
  resolvePlatformAuthConfig,
} from "../platform-auth.js";
import type { GatewayClient } from "../server-methods/types.js";
import { buildKnowledgeReplyGatewayClient } from "./reply-gateway-client.js";

export type KnowledgeAgentRunGatewayClient = {
  user: string;
  platformUserId?: string;
  sessionDomain?: GatewayClient["sessionDomain"];
  client: GatewayClient;
};

export type ResolveKnowledgeGatewayClientForAgentRunParams = {
  gatewayClientUser?: string | null;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientPlatformUserId?: string | null;
  gatewayClientSessionEnterpriseId?: string | null;
  gatewayClientSessionMembershipId?: string | null;
  agentId?: string | null;
  ownerUserId?: string | null;
  tenantId?: string | null;
};

type PlatformUserIdentity = {
  id: string;
  email: string;
};

async function loadEnabledPlatformStore() {
  const cfg = loadConfig();
  const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
  if (!authConfig?.enabled) {
    return null;
  }
  return loadPlatformAuthStore(authConfig);
}

async function lookupPlatformUserById(userId: string): Promise<PlatformUserIdentity | null> {
  const id = userId.trim();
  if (!id) {
    return null;
  }
  const store = await loadEnabledPlatformStore();
  if (!store) {
    return null;
  }
  const user = findUserById(store, id);
  const email = user?.email?.trim();
  if (!user || !email) {
    return null;
  }
  return { id: user.id, email };
}

async function lookupPlatformUserByEmail(email: string): Promise<PlatformUserIdentity | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const store = await loadEnabledPlatformStore();
  if (!store) {
    return null;
  }
  const user = findUserByEmail(store, normalized);
  const resolvedEmail = user?.email?.trim();
  if (!user || !resolvedEmail) {
    return null;
  }
  return { id: user.id, email: resolvedEmail };
}

function toResult(params: {
  email: string;
  platformUserId?: string;
  sessionDomain?: GatewayClient["sessionDomain"];
  sessionEnterpriseId?: string;
  sessionMembershipId?: string;
}): KnowledgeAgentRunGatewayClient | null {
  const client = buildKnowledgeReplyGatewayClient({
    gatewayClientUser: params.email,
    gatewayClientPlatformUserId: params.platformUserId,
    gatewayClientSessionDomain: params.sessionDomain,
    gatewayClientSessionEnterpriseId: params.sessionEnterpriseId,
    gatewayClientSessionMembershipId: params.sessionMembershipId,
  });
  if (!client) {
    return null;
  }
  return {
    user: params.email,
    ...(params.platformUserId ? { platformUserId: params.platformUserId } : {}),
    ...(params.sessionDomain ? { sessionDomain: params.sessionDomain } : {}),
    client,
  };
}

/**
 * Resolve a knowledge-capable gateway client for cron / bot / group runs.
 * Precedence: explicit email → explicit platform user → cron/group owner → bot seat employee.
 */
export async function resolveKnowledgeGatewayClientForAgentRun(
  params: ResolveKnowledgeGatewayClientForAgentRunParams,
): Promise<KnowledgeAgentRunGatewayClient | null> {
  const explicitEmail = params.gatewayClientUser?.trim();
  const explicitPlatformId = params.gatewayClientPlatformUserId?.trim();
  const sessionDomain = params.gatewayClientSessionDomain;
  const sessionEnterpriseId =
    params.gatewayClientSessionEnterpriseId?.trim() || params.tenantId?.trim() || undefined;
  const sessionMembershipId = params.gatewayClientSessionMembershipId?.trim() || undefined;

  if (explicitEmail) {
    const user = await lookupPlatformUserByEmail(explicitEmail);
    return toResult({
      email: explicitEmail,
      platformUserId: user?.id ?? explicitPlatformId,
      sessionDomain,
      sessionEnterpriseId,
      sessionMembershipId,
    });
  }

  if (explicitPlatformId) {
    const user = await lookupPlatformUserById(explicitPlatformId);
    if (user) {
      return toResult({
        email: user.email,
        platformUserId: user.id,
        sessionDomain: sessionDomain ?? "employee",
        sessionEnterpriseId,
        sessionMembershipId,
      });
    }
  }

  const ownerUserId = params.ownerUserId?.trim();
  if (ownerUserId) {
    const user = await lookupPlatformUserById(ownerUserId);
    if (user) {
      return toResult({
        email: user.email,
        platformUserId: user.id,
        sessionDomain: "employee",
      });
    }
  }

  const scope = await resolveAgentRunEntitlementScope({
    agentId: params.agentId?.trim() || undefined,
    tenantId: params.tenantId?.trim() || undefined,
  }).catch(() => null);
  const employeeId = scope?.employeeId?.trim();
  if (employeeId) {
    const user = await lookupPlatformUserById(employeeId);
    if (user) {
      return toResult({
        email: user.email,
        platformUserId: user.id,
        sessionDomain: "employee",
      });
    }
  }

  return null;
}

/**
 * Tool-facing client: use an already-stamped email/platform id immediately,
 * otherwise fall back to the fail-closed agent-run resolver (owner / bot seat).
 */
export async function resolveKnowledgeToolGatewayClient(
  params: ResolveKnowledgeGatewayClientForAgentRunParams,
): Promise<GatewayClient | null> {
  const immediate = buildKnowledgeReplyGatewayClient({
    gatewayClientUser: params.gatewayClientUser ?? undefined,
    gatewayClientSessionDomain: params.gatewayClientSessionDomain,
    gatewayClientPlatformUserId: params.gatewayClientPlatformUserId ?? undefined,
    gatewayClientSessionEnterpriseId: params.gatewayClientSessionEnterpriseId ?? undefined,
    gatewayClientSessionMembershipId: params.gatewayClientSessionMembershipId ?? undefined,
  });
  if (immediate) {
    return immediate;
  }
  return (await resolveKnowledgeGatewayClientForAgentRun(params))?.client ?? null;
}
