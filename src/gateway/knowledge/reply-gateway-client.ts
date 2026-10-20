import type { GatewayClient } from "../server-methods/types.js";

export function buildKnowledgeReplyGatewayClient(params: {
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionEnterpriseId?: string;
  gatewayClientSessionMembershipId?: string;
}): GatewayClient | null {
  const user = params.gatewayClientUser?.trim();
  const platformUserId = params.gatewayClientPlatformUserId?.trim();
  if (!user && !platformUserId) {
    return null;
  }
  const sessionEnterpriseId = params.gatewayClientSessionEnterpriseId?.trim();
  const sessionMembershipId = params.gatewayClientSessionMembershipId?.trim();
  return {
    connect: {} as GatewayClient["connect"],
    ...(user ? { user } : {}),
    ...(platformUserId ? { platformUserId } : {}),
    ...(params.gatewayClientSessionDomain
      ? { sessionDomain: params.gatewayClientSessionDomain }
      : {}),
    ...(sessionEnterpriseId ? { sessionEnterpriseId, sessionTenantId: sessionEnterpriseId } : {}),
    ...(sessionMembershipId ? { sessionMembershipId } : {}),
  };
}
