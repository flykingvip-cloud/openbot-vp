import { isBuiltinStewardAgent } from "../agents/builtin-steward/identity.js";
import { loadConfig } from "../config/config.js";
import { deriveSessionChatType, parseAgentSessionKey } from "../sessions/session-key-utils.js";
import { readConfiguredAgentOwnership } from "./collaboration-learning/shared.js";
import { listOwnershipRecords } from "./ownership-store.js";
import { listAgentsForGateway } from "./session-utils.js";
import type { UserOperationalIdentityAgentScope } from "./user-operational-identity-types.js";

export type TrustedUserOperationalIdentityAgentScopeInput = {
  currentUserId: string;
  currentUserEmail?: string | null;
  agentId: string;
  sessionKey?: string | null;
};

function normalizeIdentity(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isCollaborationSessionKey(sessionKey: string | null | undefined): boolean {
  const raw = sessionKey?.trim().toLowerCase() ?? "";
  if (!raw) {
    return false;
  }
  if (raw.startsWith("space:")) {
    return true;
  }
  const parsed = parseAgentSessionKey(raw);
  if (!parsed) {
    return false;
  }
  return deriveSessionChatType(raw) === "group" || parsed.rest.includes("group");
}

function resolveConfiguredAgentScope(agentId: string): {
  found: boolean;
  scope?: string;
  ownerId?: string;
} {
  const ownership = readConfiguredAgentOwnership(agentId);
  if (ownership) {
    return {
      found: true,
      scope: ownership.scope ?? undefined,
      ownerId: ownership.ownerId ?? undefined,
    };
  }
  const cfg = loadConfig();
  const row = listAgentsForGateway(cfg).agents.find((entry) => entry.id === agentId);
  if (!row) {
    return { found: false };
  }
  return {
    found: true,
    scope: row.scope ?? undefined,
    ownerId: row.ownerId ?? undefined,
  };
}

function actorIdentities(params: {
  currentUserId: string;
  currentUserEmail?: string | null;
}): Set<string> {
  return new Set(
    [params.currentUserId, params.currentUserEmail]
      .map((value) => normalizeIdentity(value))
      .filter(Boolean),
  );
}

function userOwnsViaOrganizationOwnership(params: {
  currentUserId: string;
  currentUserEmail?: string | null;
  agentId: string;
}): boolean {
  const identities = actorIdentities(params);
  if (identities.size === 0) {
    return false;
  }
  const agentId = params.agentId.trim().toLowerCase();
  return listOwnershipRecords().some((record) => {
    if (record.subjectKind !== "agent" || record.bindingStatus === "revoked") {
      return false;
    }
    if (record.subjectId.trim().toLowerCase() !== agentId) {
      return false;
    }
    return identities.has(normalizeIdentity(record.currentManagerUserId));
  });
}

function hasActiveOrganizationOwnership(agentId: string): boolean {
  const normalized = agentId.trim().toLowerCase();
  return listOwnershipRecords().some(
    (record) =>
      record.subjectKind === "agent" &&
      record.bindingStatus !== "revoked" &&
      record.subjectId.trim().toLowerCase() === normalized,
  );
}

function userOwnsConfiguredAgent(params: {
  currentUserId: string;
  currentUserEmail?: string | null;
  ownerId?: string;
  scope?: string;
}): boolean {
  const scope = normalizeIdentity(params.scope);
  if (scope === "shared" || scope === "team") {
    return false;
  }
  const owner = normalizeIdentity(params.ownerId);
  const userId = normalizeIdentity(params.currentUserId);
  const email = normalizeIdentity(params.currentUserEmail);
  if (owner) {
    return owner === userId || (email.length > 0 && owner === email);
  }
  return scope === "self";
}

/**
 * Derive agent scope from trusted server config + session shape.
 * Never trust client-supplied owned/shared/group agent id lists.
 */
export function resolveTrustedUserOperationalIdentityAgentScope(
  params: TrustedUserOperationalIdentityAgentScopeInput,
): UserOperationalIdentityAgentScope {
  const agentId = params.agentId.trim();
  if (!agentId) {
    return "shared";
  }
  if (isCollaborationSessionKey(params.sessionKey)) {
    return "group";
  }
  const configured = resolveConfiguredAgentScope(agentId);
  if (
    userOwnsConfiguredAgent({
      currentUserId: params.currentUserId,
      currentUserEmail: params.currentUserEmail,
      ownerId: configured.ownerId,
      scope: configured.scope,
    })
  ) {
    return "owned";
  }
  if (isBuiltinStewardAgent(agentId)) {
    return "owned";
  }
  if (
    userOwnsViaOrganizationOwnership({
      currentUserId: params.currentUserId,
      currentUserEmail: params.currentUserEmail,
      agentId,
    })
  ) {
    return "owned";
  }
  const scope = normalizeIdentity(configured.scope);
  if (scope === "shared" || scope === "team") {
    return "shared";
  }
  // Personal/local robots often have no scope/ownerId in agents.list. Treat them
  // as owned only when no other user already holds an org ownership record.
  if (configured.found && !configured.ownerId && !hasActiveOrganizationOwnership(agentId)) {
    return "owned";
  }
  // Fail closed: unknown or foreign agents require explicit grant.
  return "shared";
}

export function buildTrustedUserOperationalIdentityAgentScopeIds(params: {
  currentUserId: string;
  currentUserEmail?: string | null;
  agentId: string;
  sessionKey?: string | null;
}): {
  ownedAgentIds: string[];
  sharedAgentIds: string[];
  groupAgentIds: string[];
  agentScope: UserOperationalIdentityAgentScope;
} {
  const agentScope = resolveTrustedUserOperationalIdentityAgentScope(params);
  const agentId = params.agentId.trim();
  return {
    agentScope,
    ownedAgentIds: agentScope === "owned" ? [agentId] : [],
    sharedAgentIds: agentScope === "shared" ? [agentId] : [],
    groupAgentIds: agentScope === "group" ? [agentId] : [],
  };
}
