import { readConfiguredAgentOwnership } from "./collaboration-learning/shared.js";
import { buildBotOwnerUserIdMap } from "./collaboration-learning/space-store.js";
import type { EnterpriseSeatAssetsStore } from "./enterprise-seat-assets-store.js";
import type { UserOperationalIdentityAgentScope } from "./user-operational-identity-types.js";

function normalizeIdentity(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

/**
 * Personal-identity grants to `shared` agents are limited to seat-owned robots
 * (position/shared bots whose current seat occupant is the granting user).
 * Pure `owned` / `group` scopes keep their existing grant rules.
 */
export function isPersonalIdentityGrantEligibleForAgentScope(params: {
  ownerId: string;
  currentUserEmail?: string | null;
  agentId: string;
  agentScope: UserOperationalIdentityAgentScope;
  tenantId?: string | null;
  seatStore?: EnterpriseSeatAssetsStore | null;
}): boolean {
  if (params.agentScope === "owned" || params.agentScope === "group") {
    return true;
  }
  if (params.agentScope !== "shared") {
    return false;
  }

  const ownerId = normalizeIdentity(params.ownerId);
  const email = normalizeIdentity(params.currentUserEmail);
  const agentId = params.agentId.trim();
  if (!ownerId || !agentId) {
    return false;
  }

  const configured = readConfiguredAgentOwnership(agentId);
  const configuredOwnerRaw = configured?.ownerId?.trim() ?? "";
  const configuredOwner = normalizeIdentity(configuredOwnerRaw);
  if (configuredOwner && (configuredOwner === ownerId || (email && configuredOwner === email))) {
    return true;
  }

  const seatStore = params.seatStore;
  // Position-owned robots store seatId in agent.ownerId. Resolve the seat's
  // current occupant before falling back to the full seat-asset owner map.
  if (configuredOwnerRaw && seatStore?.seats?.[configuredOwnerRaw]) {
    const seatEmployee = normalizeIdentity(seatStore.seats[configuredOwnerRaw]?.currentEmployeeId);
    if (seatEmployee && seatEmployee === ownerId) {
      return true;
    }
  }

  const tenantId = params.tenantId?.trim();
  if (!tenantId || !seatStore) {
    // Fail closed for shared agents when seat authority is unavailable.
    return false;
  }

  const ownerByAgentId = buildBotOwnerUserIdMap(seatStore, tenantId);
  const seatOwnerUserId = normalizeIdentity(ownerByAgentId.get(agentId.toLowerCase()));
  return Boolean(seatOwnerUserId && seatOwnerUserId === ownerId);
}
