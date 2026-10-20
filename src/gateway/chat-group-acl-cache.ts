/**
 * Sync-readable cache of collaboration group membership for chat event fan-out.
 *
 * Emit path must stay synchronous (agent event hot path). Cache is keyed by
 * `(tenantId, groupId)` so identical groupIds in different tenants never collide.
 * Cache miss / missing tenant fail-closes for employee/enterprise shells.
 */

import { sanitizeEmployeeStewardIdentity } from "../agents/builtin-steward/employee-isolation.js";
import { listGatewayCollaborationSpaces } from "./collaboration-learning.js";

export type CachedGroupChatAcl = {
  groupId: string;
  tenantId: string;
  memberUserIds: Set<string>;
};

const cacheByTenantGroup = new Map<string, CachedGroupChatAcl>();
let refreshInFlight: Promise<void> | null = null;
let lastRefreshAtMs = 0;

const MIN_REFRESH_INTERVAL_MS = 2_000;

function normalizeGroupId(groupId: string): string {
  return groupId
    .trim()
    .toLowerCase()
    .replace(/^space:/, "");
}

function normalizeTenantId(tenantId: string): string {
  return tenantId.trim().toLowerCase();
}

export function groupChatAclCacheKey(tenantId: string, groupId: string): string {
  return `${normalizeTenantId(tenantId)}\0${normalizeGroupId(groupId)}`;
}

function collectMemberUserIds(space: {
  ownerUserId?: string | null;
  members?: { humans?: Array<{ userId?: string; status?: string }> };
}): Set<string> {
  const members = new Set<string>();
  const owner = sanitizeEmployeeStewardIdentity(space.ownerUserId ?? "");
  if (owner) {
    members.add(owner);
  }
  for (const human of space.members?.humans ?? []) {
    const status = human.status?.trim().toLowerCase();
    if (status && status !== "active" && status !== "paused") {
      continue;
    }
    const id = sanitizeEmployeeStewardIdentity(human.userId ?? "");
    if (id) {
      members.add(id);
    }
  }
  return members;
}

export function getCachedGroupChatAcl(
  tenantId: string,
  groupId: string,
): CachedGroupChatAcl | null {
  const tenant = normalizeTenantId(tenantId);
  const group = normalizeGroupId(groupId);
  if (!tenant || !group) {
    return null;
  }
  return cacheByTenantGroup.get(groupChatAclCacheKey(tenant, group)) ?? null;
}

export async function refreshGroupChatAclCache(params?: {
  listSpaces?: typeof listGatewayCollaborationSpaces;
  force?: boolean;
}): Promise<void> {
  const now = Date.now();
  if (
    !params?.force &&
    now - lastRefreshAtMs < MIN_REFRESH_INTERVAL_MS &&
    cacheByTenantGroup.size > 0
  ) {
    return;
  }
  if (refreshInFlight) {
    await refreshInFlight;
    return;
  }
  const listSpaces = params?.listSpaces ?? listGatewayCollaborationSpaces;
  refreshInFlight = (async () => {
    try {
      const listed = await listSpaces();
      const next = new Map<string, CachedGroupChatAcl>();
      for (const space of listed.spaces ?? []) {
        const groupId = normalizeGroupId(space.groupId || space.id || "");
        const tenantId =
          typeof space.tenantId === "string" ? normalizeTenantId(space.tenantId) : "";
        // Spaces without an authoritative tenantId cannot be cached for fan-out —
        // emit path must fail closed rather than guess.
        if (!groupId || !tenantId) {
          continue;
        }
        const key = groupChatAclCacheKey(tenantId, groupId);
        next.set(key, {
          groupId,
          tenantId,
          memberUserIds: collectMemberUserIds(space),
        });
      }
      // listSpaces often omits tenantId. A clear-replace would wipe the
      // chat.send seed that just authorized this turn (including seeds
      // upserted while this refresh awaited). Union current cache into next.
      for (const [key, existing] of cacheByTenantGroup) {
        const incoming = next.get(key);
        if (incoming) {
          for (const memberUserId of existing.memberUserIds) {
            incoming.memberUserIds.add(memberUserId);
          }
          continue;
        }
        next.set(key, existing);
      }
      cacheByTenantGroup.clear();
      for (const [id, acl] of next) {
        cacheByTenantGroup.set(id, acl);
      }
      lastRefreshAtMs = Date.now();
    } finally {
      refreshInFlight = null;
    }
  })();
  await refreshInFlight;
}

/** Kick a background refresh without awaiting (emit-path safe). */
export function scheduleGroupChatAclCacheRefresh(): void {
  void refreshGroupChatAclCache().catch(() => {
    // Best-effort; emit path fail-closes on miss.
  });
}

/**
 * Seed the authorized sender into `(tenantId, groupId)` at chat.send time.
 * Emit stays synchronous; waiting for a later listSpaces refresh is not a
 * substitute for the write-ACL that just passed.
 */
export function upsertAuthorizedGroupChatAclMember(params: {
  tenantId: string;
  groupId: string;
  memberUserId: string;
}): void {
  const tenantId = normalizeTenantId(params.tenantId);
  const groupId = normalizeGroupId(params.groupId);
  const memberUserId = sanitizeEmployeeStewardIdentity(params.memberUserId);
  if (!tenantId || !groupId || !memberUserId) {
    return;
  }
  const key = groupChatAclCacheKey(tenantId, groupId);
  const existing = cacheByTenantGroup.get(key);
  const memberUserIds = new Set(existing?.memberUserIds ?? []);
  memberUserIds.add(memberUserId);
  cacheByTenantGroup.set(key, {
    groupId,
    tenantId,
    memberUserIds,
  });
}

/** Test helper. */
export function resetGroupChatAclCacheForTests(): void {
  cacheByTenantGroup.clear();
  refreshInFlight = null;
  lastRefreshAtMs = 0;
}

/** Test helper — seed one tenant-qualified group ACL. */
export function seedGroupChatAclForTests(acl: CachedGroupChatAcl): void {
  const tenantId = normalizeTenantId(acl.tenantId);
  const groupId = normalizeGroupId(acl.groupId);
  if (!tenantId || !groupId) {
    throw new Error("seedGroupChatAclForTests requires tenantId and groupId");
  }
  cacheByTenantGroup.set(groupChatAclCacheKey(tenantId, groupId), {
    groupId,
    tenantId,
    memberUserIds: new Set(
      [...acl.memberUserIds].map((id) => sanitizeEmployeeStewardIdentity(id)).filter(Boolean),
    ),
  });
}
