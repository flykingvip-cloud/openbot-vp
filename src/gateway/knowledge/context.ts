import { loadConfig } from "../../config/config.js";
import { resolveTrustedEnterpriseDataExecutionContext } from "../enterprise-data/enterprise-data-seat-context.js";
import type { KnowledgeAgentType } from "../enterprise-data/types.js";
import {
  findUserById,
  loadPlatformAuthStore,
  resolvePlatformAuthConfig,
} from "../platform-auth.js";
import { resolveAuthoritativeEnterpriseScopeForClient } from "../platform-auth/active-membership-scope.js";
import type { GatewayClient } from "../server-methods/types.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import type { KnowledgeSourceContext } from "./sources/types.js";

const EMPTY_CONTEXT: KnowledgeSourceContext = {
  tenantId: null,
  seatId: null,
  userId: null,
  hasEnterpriseScope: false,
};

async function resolveKnowledgePlatformFallbackContext(
  client: GatewayClient,
  options?: { agentType?: KnowledgeAgentType | null },
): Promise<KnowledgeSourceContext> {
  const email = client.user?.trim().toLowerCase();
  if (!email) {
    return EMPTY_CONTEXT;
  }
  const cfg = loadConfig();
  const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
  if (!authConfig?.enabled) {
    return EMPTY_CONTEXT;
  }
  const platformStore = await loadPlatformAuthStore(authConfig);
  const scope = resolveAuthoritativeEnterpriseScopeForClient({
    store: platformStore,
    client,
    canonicalize: canonicalizeTenantId,
  });
  if (scope.kind === "deny" || scope.kind === "no-platform-identity") {
    // Suspended, ambiguous, or unrecognized identities get no tenant context.
    return EMPTY_CONTEXT;
  }
  // Remaining kinds both carry the recognized platform user.
  const user = scope.user;
  const tenantId =
    scope.kind === "authoritative" ? scope.enterpriseId : (client.sessionTenantId?.trim() ?? null);
  return {
    tenantId,
    seatId: null,
    userId: user.id,
    teamLabel: null,
    roleCode: null,
    departmentId: null,
    agentType: options?.agentType ?? "employee-agent",
    hasEnterpriseScope: false,
  };
}

async function hydrateKnowledgeGatewayClient(client: GatewayClient): Promise<GatewayClient | null> {
  if (client.user?.trim()) {
    return client;
  }
  const platformUserId = client.platformUserId?.trim();
  if (!platformUserId) {
    return null;
  }
  const cfg = loadConfig();
  const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
  if (!authConfig?.enabled) {
    return null;
  }
  const store = await loadPlatformAuthStore(authConfig);
  const email = findUserById(store, platformUserId)?.email?.trim();
  if (!email) {
    return null;
  }
  return { ...client, user: email };
}

export async function resolveKnowledgeSourceContext(
  client: GatewayClient | null,
  options?: { agentType?: KnowledgeAgentType | null },
): Promise<KnowledgeSourceContext> {
  if (!client) {
    return EMPTY_CONTEXT;
  }
  const hydrated = await hydrateKnowledgeGatewayClient(client);
  if (!hydrated?.user?.trim()) {
    return EMPTY_CONTEXT;
  }
  try {
    const execution = await resolveTrustedEnterpriseDataExecutionContext(hydrated);
    return {
      tenantId: execution.tenantId,
      seatId: execution.seatId,
      userId: execution.userId,
      teamLabel: execution.teamLabel ?? null,
      roleCode: execution.roleCode ?? null,
      departmentId: execution.departmentId ?? null,
      agentType: options?.agentType ?? "employee-agent",
      hasEnterpriseScope: true,
    };
  } catch {
    return resolveKnowledgePlatformFallbackContext(hydrated, options);
  }
}
