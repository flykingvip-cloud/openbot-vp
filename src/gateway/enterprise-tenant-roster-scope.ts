/**
 * Enterprise Control UI (sessionDomain=enterprise) needs a tenant-wide roster for
 * mesh governance — not the personal-workbench self-scope used by employee sessions.
 *
 * Agents / spaces are the union of:
 * - active ownership records for the tenant
 * - seat defaultAssetIds + active asset bindings
 * - runtime agents with tenantCoverage
 * - collaboration spaces owned by / containing active tenant members
 */

import {
  isBuiltinStewardAgent,
  withEmployeeUniversalStewardAgentIds,
} from "../agents/builtin-steward/identity.js";
import { loadConfig } from "../config/config.js";
import { listTenantMeshGrowthAgents } from "./agent-growth/mesh-growth-tenant-scope.js";
import { listOwnershipRecords } from "./ownership-store.js";
import { resolvePlatformAuthConfig } from "./platform-auth/config.js";
import { loadSeatAssetsStoreForTenantId } from "./platform-auth/seat-store-loader.js";
import { loadStore } from "./platform-auth/store.js";
import { resolveQueryScope } from "./scope-attribution.js";
import type { GatewayClient } from "./server-methods/types.js";
import type { GatewayAgentRow } from "./session-utils.js";

type TenantSpaceLike = {
  id?: string | null;
  groupId?: string | null;
  ownerUserId?: string | null;
  members?: {
    humans?: Array<{
      userId?: string | null;
      email?: string | null;
      status?: string | null;
    }> | null;
  } | null;
};

function normalizeIdentity(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export async function resolveEnterpriseTenantIdForClient(
  client: GatewayClient | null | undefined,
): Promise<string | null> {
  if (client?.sessionDomain !== "enterprise") {
    return null;
  }
  const scope = await resolveQueryScope(client);
  if (scope.kind !== "tenant") {
    return null;
  }
  const tenantId = scope.tenantId?.trim();
  if (!tenantId || tenantId === "__unresolved__") {
    return null;
  }
  return tenantId;
}

/** Filter install-wide agent roster to the enterprise tenant's mesh assets. */
export async function filterAgentsForEnterpriseTenantClient(
  client: GatewayClient | null | undefined,
  agents: GatewayAgentRow[],
): Promise<GatewayAgentRow[] | null> {
  const tenantId = await resolveEnterpriseTenantIdForClient(client);
  if (!tenantId) {
    return null;
  }
  const tenantAgents = await listTenantMeshGrowthAgents({
    tenantId,
    cfg: loadConfig(),
  });
  const allowed = new Set(
    withEmployeeUniversalStewardAgentIds(tenantAgents.map((entry) => entry.agentId)).map((id) =>
      normalizeIdentity(id),
    ),
  );
  return agents.filter(
    (agent) => allowed.has(normalizeIdentity(agent.id)) || isBuiltinStewardAgent(agent.id),
  );
}

export async function collectTenantVisibleSpaceIds(params: {
  tenantId: string;
  spaces: TenantSpaceLike[];
}): Promise<Set<string>> {
  const tenantId = params.tenantId.trim();
  const ids = new Set<string>();
  if (!tenantId) {
    return ids;
  }

  for (const record of listOwnershipRecords()) {
    if (
      record.tenantId === tenantId &&
      record.subjectKind === "group" &&
      record.bindingStatus !== "revoked"
    ) {
      const subjectId = record.subjectId.trim();
      if (subjectId) {
        ids.add(subjectId);
      }
    }
  }

  try {
    const seatStore = await loadSeatAssetsStoreForTenantId(tenantId);
    for (const seat of Object.values(seatStore.seats ?? {})) {
      if (seat.tenantId !== tenantId) {
        continue;
      }
      for (const spaceId of seat.defaultSpaceIds ?? []) {
        const trimmed = spaceId.trim();
        if (trimmed) {
          ids.add(trimmed);
        }
      }
    }
    for (const binding of Object.values(seatStore.assetBindings ?? {})) {
      if (
        binding.tenantId === tenantId &&
        binding.status === "active" &&
        binding.assetType === "space"
      ) {
        const assetId = binding.assetId.trim();
        if (assetId) {
          ids.add(assetId);
        }
      }
    }
  } catch {
    // Seat store missing → still try membership-based space matching below.
  }

  const config = resolvePlatformAuthConfig(loadConfig().gateway?.auth?.trustedProxy);
  if (!config) {
    return ids;
  }
  try {
    const store = await loadStore(config);
    const memberIds = new Set<string>();
    for (const membership of Object.values(store.memberships ?? {})) {
      if (membership.enterpriseId !== tenantId) {
        continue;
      }
      const user = store.users?.[membership.userId];
      for (const candidate of [membership.userId, user?.email, user?.id]) {
        const normalized = normalizeIdentity(candidate);
        if (normalized) {
          memberIds.add(normalized);
        }
      }
    }
    for (const space of params.spaces) {
      const spaceId = (space.groupId ?? space.id)?.trim();
      if (!spaceId) {
        continue;
      }
      const owner = normalizeIdentity(space.ownerUserId);
      if (owner && memberIds.has(owner)) {
        ids.add(spaceId);
        continue;
      }
      const humans = space.members?.humans ?? [];
      if (
        humans.some((human) => {
          const status = normalizeIdentity(human.status);
          if (status && status !== "active" && status !== "paused") {
            return false;
          }
          return memberIds.has(normalizeIdentity(human.userId));
        })
      ) {
        ids.add(spaceId);
      }
    }
  } catch {
    // Auth store unavailable — keep ownership/seat ids only.
  }

  return ids;
}

export async function filterSpacesForEnterpriseTenantClient<T extends TenantSpaceLike>(
  client: GatewayClient | null | undefined,
  spaces: T[],
): Promise<T[] | null> {
  const tenantId = await resolveEnterpriseTenantIdForClient(client);
  if (!tenantId) {
    return null;
  }
  const allowed = await collectTenantVisibleSpaceIds({ tenantId, spaces });
  if (allowed.size === 0) {
    return [];
  }
  return spaces.filter((space) => {
    const spaceId = (space.groupId ?? space.id)?.trim();
    return Boolean(spaceId && allowed.has(spaceId));
  });
}

/** Visible agent ids for enterprise-admin sessions.usage / sessions.list scoping. */
export async function resolveEnterpriseTenantVisibleAgentIds(
  client: GatewayClient | null | undefined,
): Promise<Set<string> | null> {
  const tenantId = await resolveEnterpriseTenantIdForClient(client);
  if (!tenantId) {
    return null;
  }
  const tenantAgents = await listTenantMeshGrowthAgents({
    tenantId,
    cfg: loadConfig(),
  });
  return new Set(
    withEmployeeUniversalStewardAgentIds(tenantAgents.map((entry) => entry.agentId)).map((id) =>
      normalizeIdentity(id),
    ),
  );
}
