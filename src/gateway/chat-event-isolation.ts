/**
 * Authorized live `chat` WebSocket fan-out.
 *
 * Hard rules (docs/design/daibai-conversation-isolation-conditional-approval-2026-08-12.md):
 * - Never install-wide broadcast chat payloads to employee/enterprise shells.
 * - Steward sessions: matching platformUserId AND matching resource tenantId.
 * - Group sessions: member ACL at (tenantId, groupId); tenant comes from run/binding,
 *   never guessed from a bare space:<groupId>.
 * - Other sessions: interest registry (+ tenant when bound).
 * - UI filtering is defense-in-depth, not the access boundary.
 */

import {
  extractEmployeeStewardUserIdFromSessionKey,
  isGlobalBuiltinStewardSessionKey,
  sanitizeEmployeeStewardIdentity,
} from "../agents/builtin-steward/employee-isolation.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { parseAgentSessionKey, deriveSessionChatType } from "../sessions/session-key-utils.js";
import { getCachedGroupChatAcl, scheduleGroupChatAclCacheRefresh } from "./chat-group-acl-cache.js";
import {
  listChatSessionInterestedUserIds,
  resolveChatRunTenantId,
  resolveUniqueBoundChatSessionTenantId,
} from "./chat-session-interest.js";
import type { GatewayBroadcastToConnIdsFn } from "./server-broadcast.js";
import type { GatewayWsClient } from "./server/ws-types.js";

const log = createSubsystemLogger("gateway/chat-event");

export type ChatEventClientIdentity = Pick<
  GatewayWsClient,
  "connId" | "user" | "sessionDomain" | "platformUserId" | "sessionEnterpriseId"
>;

export type BroadcastChatOpts = {
  dropIfSlow?: boolean;
  /**
   * Authoritative tenant for this chat resource/run. Required for employee-shell
   * delivery when the sessionKey alone is not tenant-unique.
   */
  tenantId?: string | null;
  /** Optional runId used to resolve tenant when opts.tenantId is omitted. */
  runId?: string | null;
};

export function resolveClientStewardOwnerId(
  client: Pick<ChatEventClientIdentity, "platformUserId" | "user">,
): string | null {
  const fromId = client.platformUserId?.trim();
  if (fromId) {
    return sanitizeEmployeeStewardIdentity(fromId) || null;
  }
  const fromUser = client.user?.trim();
  if (!fromUser) {
    return null;
  }
  return sanitizeEmployeeStewardIdentity(fromUser) || null;
}

function normalizeTenantId(tenantId: string | null | undefined): string | null {
  const trimmed = tenantId?.trim().toLowerCase() || "";
  return trimmed || null;
}

function resolveClientTenantId(
  client: Pick<ChatEventClientIdentity, "sessionEnterpriseId">,
): string | null {
  return normalizeTenantId(client.sessionEnterpriseId);
}

function isEmployeeOrEnterpriseShell(
  client: Pick<ChatEventClientIdentity, "sessionDomain">,
): boolean {
  return client.sessionDomain === "employee" || client.sessionDomain === "enterprise";
}

export function extractGroupIdFromChatSessionKey(sessionKey: string): string | null {
  const normalized = sessionKey.trim();
  if (!normalized) {
    return null;
  }
  const lower = normalized.toLowerCase();
  if (lower.startsWith("space:")) {
    return lower.slice("space:".length).trim() || null;
  }
  // Child bot keys are `agent:<bot>:main:space:<groupId>`. The space segment
  // is not the start of `rest` (`main:space:…`), so a prefix-only check
  // returned null and employee shells fail-closed (recipientCount: 0).
  const spaceIdx = lower.indexOf(":space:");
  if (spaceIdx >= 0) {
    return lower.slice(spaceIdx + ":space:".length).trim() || null;
  }
  const parsed = parseAgentSessionKey(normalized);
  if (!parsed) {
    return null;
  }
  const rest = parsed.rest.trim();
  if (deriveSessionChatType(normalized) === "group") {
    return rest.toLowerCase() || null;
  }
  return null;
}

/** Per-bot group run key (`agent:<bot>:main:space:<groupId>`), not the parent `space:<groupId>`. */
export function isCollaborationSpaceChildSessionKey(sessionKey: string): boolean {
  const lower = sessionKey.trim().toLowerCase();
  return lower.startsWith("agent:") && lower.includes(":space:");
}

/**
 * Resolve the authoritative tenant for a chat resource at emit time.
 * Prefer explicit opts, then run binding, then a unique session binding.
 */
export function resolveChatEventResourceTenantId(params: {
  sessionKey: string;
  tenantId?: string | null;
  runId?: string | null;
}): string | null {
  const explicit = normalizeTenantId(params.tenantId);
  if (explicit) {
    return explicit;
  }
  const fromRun = resolveChatRunTenantId(params.runId);
  if (fromRun) {
    return fromRun;
  }
  return resolveUniqueBoundChatSessionTenantId(params.sessionKey);
}

function clientMatchesResourceTenant(
  client: ChatEventClientIdentity,
  resourceTenantId: string | null,
): boolean {
  if (!resourceTenantId) {
    // No authoritative tenant → employee/enterprise shells fail closed.
    return !isEmployeeOrEnterpriseShell(client);
  }
  const clientTenant = resolveClientTenantId(client);
  if (!clientTenant) {
    return !isEmployeeOrEnterpriseShell(client);
  }
  return clientTenant === resourceTenantId;
}

/**
 * Whether this WS client may receive a live chat event for `sessionKey`.
 */
export function shouldDeliverChatEventToClient(
  client: ChatEventClientIdentity,
  sessionKey: string,
  resourceTenantId?: string | null,
): boolean {
  const key = sessionKey.trim();
  if (!key) {
    return false;
  }
  const tenantId =
    normalizeTenantId(resourceTenantId) ?? resolveChatEventResourceTenantId({ sessionKey: key });

  const stewardOwner = extractEmployeeStewardUserIdFromSessionKey(key);
  if (stewardOwner) {
    const clientOwner = resolveClientStewardOwnerId(client);
    if (!clientOwner || clientOwner !== stewardOwner) {
      return false;
    }
    return clientMatchesResourceTenant(client, tenantId);
  }

  if (isGlobalBuiltinStewardSessionKey(key)) {
    return !isEmployeeOrEnterpriseShell(client);
  }

  const groupId = extractGroupIdFromChatSessionKey(key);
  if (groupId) {
    if (!tenantId) {
      scheduleGroupChatAclCacheRefresh();
      return !isEmployeeOrEnterpriseShell(client);
    }
    if (!clientMatchesResourceTenant(client, tenantId)) {
      return false;
    }
    const acl = getCachedGroupChatAcl(tenantId, groupId);
    if (!acl) {
      scheduleGroupChatAclCacheRefresh();
      return !isEmployeeOrEnterpriseShell(client);
    }
    const clientOwner = resolveClientStewardOwnerId(client);
    if (!clientOwner) {
      return !isEmployeeOrEnterpriseShell(client);
    }
    return acl.memberUserIds.has(clientOwner);
  }

  // Personal / other agent sessions: interest registry + tenant match.
  const interested = listChatSessionInterestedUserIds(key);
  const clientOwner = resolveClientStewardOwnerId(client);
  if (clientOwner && interested.has(clientOwner) && clientMatchesResourceTenant(client, tenantId)) {
    return true;
  }
  if (isEmployeeOrEnterpriseShell(client)) {
    return false;
  }
  return true;
}

/**
 * Always returns an explicit recipient set — never signals install-wide broadcast.
 */
export function collectChatEventRecipientConnIds(
  clients: Iterable<ChatEventClientIdentity>,
  sessionKey: string,
  resourceTenantId?: string | null,
): Set<string> {
  const key = sessionKey.trim();
  const recipients = new Set<string>();
  if (!key) {
    return recipients;
  }
  const tenantId =
    normalizeTenantId(resourceTenantId) ?? resolveChatEventResourceTenantId({ sessionKey: key });
  const groupId = extractGroupIdFromChatSessionKey(key);
  if (groupId && tenantId && !getCachedGroupChatAcl(tenantId, groupId)) {
    scheduleGroupChatAclCacheRefresh();
  }
  for (const client of clients) {
    const connId = client.connId?.trim();
    if (!connId) {
      continue;
    }
    if (shouldDeliverChatEventToClient(client, key, tenantId)) {
      recipients.add(connId);
    }
  }
  return recipients;
}

export type BroadcastChatEventParams = {
  sessionKey: string;
  payload: unknown;
  clients: Iterable<ChatEventClientIdentity>;
  broadcastToConnIds: GatewayBroadcastToConnIdsFn;
  opts?: BroadcastChatOpts;
};

function extractChatPayloadState(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const state = (payload as { state?: unknown }).state;
  return typeof state === "string" && state.trim() ? state.trim() : null;
}

/** Fan-out `chat` only to authorized connections. Returns recipient count. */
export function broadcastChatEvent(params: BroadcastChatEventParams): number {
  const tenantId = resolveChatEventResourceTenantId({
    sessionKey: params.sessionKey,
    tenantId: params.opts?.tenantId,
    runId: params.opts?.runId,
  });
  const recipients = collectChatEventRecipientConnIds(params.clients, params.sessionKey, tenantId);
  if (recipients.size === 0) {
    const state = extractChatPayloadState(params.payload);
    // Final/error empties are the missing-bubble landmines; warn for diagnosis.
    if (state === "final" || state === "error" || state === "user_echo") {
      log.warn("chat broadcast skipped: no recipients", {
        runId: extractRunIdFromChatPayload(params.payload),
        sessionKey: params.sessionKey,
        recipientCount: 0,
        state,
      });
    }
    return 0;
  }
  params.broadcastToConnIds("chat", params.payload, recipients, {
    dropIfSlow: params.opts?.dropIfSlow,
  });
  return recipients.size;
}

function extractRunIdFromChatPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const runId = (payload as { runId?: unknown }).runId;
  return typeof runId === "string" && runId.trim() ? runId.trim() : null;
}

export function createBroadcastChatEvent(params: {
  clients: Set<GatewayWsClient>;
  broadcastToConnIds: GatewayBroadcastToConnIdsFn;
}): (sessionKey: string, payload: unknown, opts?: BroadcastChatOpts) => number {
  return (sessionKey, payload, opts) => {
    return broadcastChatEvent({
      sessionKey,
      payload,
      clients: params.clients,
      broadcastToConnIds: params.broadcastToConnIds,
      opts: {
        ...opts,
        runId: opts?.runId ?? extractRunIdFromChatPayload(payload),
      },
    });
  };
}
