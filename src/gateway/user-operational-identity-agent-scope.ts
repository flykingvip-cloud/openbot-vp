import type { UserOperationalIdentityAgentScope } from "./user-operational-identity-types.js";

export type UserOperationalIdentityAgentClassification = {
  agentId: string;
  agentScope: UserOperationalIdentityAgentScope;
  ownerUserId?: string | null;
};

export function classifyUserOperationalIdentityAgentScope(params: {
  agentId: string;
  currentUserId: string;
  ownedAgentIds: string[];
  sharedAgentIds: string[];
  groupAgentIds: string[];
}): UserOperationalIdentityAgentClassification {
  const agentId = params.agentId.trim();
  if (params.ownedAgentIds.includes(agentId)) {
    return { agentId, agentScope: "owned", ownerUserId: params.currentUserId };
  }
  if (params.groupAgentIds.includes(agentId)) {
    return { agentId, agentScope: "group" };
  }
  if (params.sharedAgentIds.includes(agentId)) {
    return { agentId, agentScope: "shared" };
  }
  return { agentId, agentScope: "shared" };
}

export function defaultGrantModeForAgentScope(
  agentScope: UserOperationalIdentityAgentScope,
): "auto" | "explicit" {
  return agentScope === "owned" ? "auto" : "explicit";
}

export function isAgentScopeAllowedByDefault(
  agentScope: UserOperationalIdentityAgentScope,
): boolean {
  return agentScope === "owned";
}
