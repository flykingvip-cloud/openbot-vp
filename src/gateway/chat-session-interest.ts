/**
 * Authoritative chat-session resource bindings for live event fan-out.
 *
 * Interest (who may receive) and tenant binding (which enterprise the resource
 * belongs to) are recorded only from authorized RPC paths (chat.send / history).
 * Emit paths must not guess tenant from a bare sessionKey / space:<groupId>.
 */

import { sanitizeEmployeeStewardIdentity } from "../agents/builtin-steward/employee-isolation.js";

export type ChatSessionResourceBinding = {
  interestedUserIds: Set<string>;
  /** Tenants that authorized access to this sessionKey (may be >1 if key is shared). */
  tenantIds: Set<string>;
};

const bindingsBySessionKey = new Map<string, ChatSessionResourceBinding>();
/** Per-run tenant captured at chat.send so emit can resolve without guessing. */
const tenantByRunId = new Map<string, string>();

function normalizeSessionKey(sessionKey: string): string {
  return sessionKey.trim().toLowerCase();
}

function normalizeTenantId(tenantId: string): string {
  return tenantId.trim().toLowerCase();
}

function getOrCreateBinding(sessionKey: string): ChatSessionResourceBinding | null {
  const key = normalizeSessionKey(sessionKey);
  if (!key) {
    return null;
  }
  let binding = bindingsBySessionKey.get(key);
  if (!binding) {
    binding = { interestedUserIds: new Set(), tenantIds: new Set() };
    bindingsBySessionKey.set(key, binding);
  }
  return binding;
}

/** Record that `platformUserId` may receive live chat events for `sessionKey`. */
export function noteChatSessionInterest(
  sessionKey: string,
  platformUserId: string,
  tenantId?: string | null,
): void {
  const binding = getOrCreateBinding(sessionKey);
  const owner = sanitizeEmployeeStewardIdentity(platformUserId);
  if (!binding || !owner) {
    return;
  }
  binding.interestedUserIds.add(owner);
  const tenant = tenantId?.trim() ? normalizeTenantId(tenantId) : "";
  if (tenant) {
    binding.tenantIds.add(tenant);
  }
}

export function listChatSessionInterestedUserIds(sessionKey: string): ReadonlySet<string> {
  const key = normalizeSessionKey(sessionKey);
  if (!key) {
    return new Set();
  }
  return bindingsBySessionKey.get(key)?.interestedUserIds ?? new Set();
}

/**
 * When exactly one tenant is bound to `sessionKey`, return it.
 * Ambiguous (0 or >1) bindings return null — emit must supply tenantId explicitly.
 */
export function resolveUniqueBoundChatSessionTenantId(sessionKey: string): string | null {
  const key = normalizeSessionKey(sessionKey);
  if (!key) {
    return null;
  }
  const tenants = bindingsBySessionKey.get(key)?.tenantIds;
  if (!tenants || tenants.size !== 1) {
    return null;
  }
  return [...tenants][0] ?? null;
}

export function noteChatRunTenant(runId: string, tenantId: string | null | undefined): void {
  const id = runId.trim();
  const tenant = tenantId?.trim() ? normalizeTenantId(tenantId) : "";
  if (!id || !tenant) {
    return;
  }
  tenantByRunId.set(id, tenant);
}

/**
 * Child runIds (`${parent}:user`, `${parent}:${agentId}`) inherit the parent
 * turn's tenant. Emit must not require a second noteChatRunTenant for suffixes.
 */
export function resolveParentChatRunId(runId: string | null | undefined): string | null {
  const id = runId?.trim();
  if (!id) {
    return null;
  }
  const colon = id.lastIndexOf(":");
  if (colon <= 0) {
    return null;
  }
  const parent = id.slice(0, colon).trim();
  return parent || null;
}

export function resolveChatRunTenantId(runId: string | null | undefined): string | null {
  let id = runId?.trim() ?? "";
  while (id) {
    const bound = tenantByRunId.get(id);
    if (bound) {
      return bound;
    }
    const parent = resolveParentChatRunId(id);
    if (!parent || parent === id) {
      break;
    }
    id = parent;
  }
  return null;
}

export function clearChatRunTenant(runId: string | null | undefined): void {
  const id = runId?.trim();
  if (!id) {
    return;
  }
  tenantByRunId.delete(id);
}

/** Test helper — clears in-memory interest + tenant bindings. */
export function resetChatSessionInterestForTests(): void {
  bindingsBySessionKey.clear();
  tenantByRunId.clear();
}
