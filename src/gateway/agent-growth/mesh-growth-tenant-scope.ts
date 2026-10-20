/**
 * P3 mesh growth — tenant-scoped agent resolution (enterprise boundary).
 *
 * Never aggregates across tenants. Tenant id comes from authoritative platform-auth
 * membership on the connected client — never from RPC params.
 */

import path from "node:path";
import { loadConfig, type OpenBotConfig } from "../../config/config.js";
import { isSharedTenantAddressingEnabled } from "../../config/data-space.js";
import { readJsonFile } from "../../infra/json-files.js";
import { listAgents, type RuntimeAgent } from "../agent-runtime-store.js";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { listOwnershipRecords, type OwnershipRecord } from "../ownership-store.js";
import { loadPlatformAuthStore, resolvePlatformAuthConfig } from "../platform-auth.js";
import {
  resolveAuthoritativeEnterpriseScopeForClient,
  type AuthoritativeScopeClient,
} from "../platform-auth/active-membership-scope.js";
import { loadSeatAssetsStoreForTenantId } from "../platform-auth/seat-store-loader.js";
import type { GatewayClient } from "../server-methods/types.js";
import { listAgentsForGateway, type GatewayAgentRow } from "../session-utils.js";
import { resolveAgentDirForClient } from "../tenant-context.js";
import type { WorkingStyle } from "./genome.js";
import type { MeshGrowthAgentInput } from "./mesh-growth-aggregate.js";
import { GROWTH_STATUS_FILENAME } from "./store.js";
import type { GrowthStatus } from "./types.js";
import {
  WORKING_STYLE_CHANGE_FILENAME,
  WORKING_STYLE_FILENAME,
  type WorkingStyleChangeRecord,
} from "./working-style-store.js";

export type MeshGrowthTenantScope =
  | { kind: "authoritative"; tenantId: string }
  | { kind: "empty" }
  | { kind: "deny"; reason: string };

function normalizeAgentKey(value: string): string {
  return value.trim().toLowerCase();
}

/** Resolve enterprise tenant for mesh growth (membership-only; fail closed). */
export async function resolveMeshGrowthTenantScope(
  client: GatewayClient | null | undefined,
  cfg?: OpenBotConfig,
): Promise<MeshGrowthTenantScope> {
  const resolvedCfg = cfg ?? loadConfig();
  const authConfig = resolvePlatformAuthConfig(resolvedCfg.gateway?.auth?.trustedProxy);
  if (!authConfig?.enabled) {
    return { kind: "empty" };
  }
  const store = await loadPlatformAuthStore(authConfig);
  const scope = resolveAuthoritativeEnterpriseScopeForClient({
    store,
    client: client as AuthoritativeScopeClient | null | undefined,
    canonicalize: (value) => value?.trim() || null,
  });
  if (scope.kind === "authoritative") {
    return { kind: "authoritative", tenantId: scope.enterpriseId };
  }
  if (scope.kind === "deny") {
    return { kind: "deny", reason: scope.reason };
  }
  return { kind: "empty" };
}

/** Pure: collect gateway agent ids belonging to a single tenant. */
export function listTenantMeshGrowthAgentsFromSources(params: {
  tenantId: string;
  gatewayAgents: GatewayAgentRow[];
  ownershipRecords: OwnershipRecord[];
  seatStore: EnterpriseSeatAssetsStore;
  runtimeAgents: RuntimeAgent[];
  positionId?: string | null;
  /** Normalized emails / user ids of current seat occupants. */
  memberOwnerKeys?: ReadonlySet<string>;
}): MeshGrowthAgentInput[] {
  const tenantId = params.tenantId.trim();
  if (!tenantId) {
    return [];
  }

  const positionFilter = params.positionId?.trim() || null;
  const allowedIds = new Set<string>();

  for (const record of params.ownershipRecords) {
    if (
      record.tenantId === tenantId &&
      record.subjectKind === "agent" &&
      record.bindingStatus !== "revoked"
    ) {
      if (positionFilter && record.positionId.trim() !== positionFilter) {
        continue;
      }
      const subjectId = record.subjectId.trim();
      if (subjectId) {
        allowedIds.add(subjectId);
      }
    }
  }

  for (const binding of Object.values(params.seatStore.assetBindings ?? {})) {
    if (
      binding.tenantId === tenantId &&
      binding.assetType === "agent" &&
      binding.status === "active"
    ) {
      if (positionFilter && binding.seatId.trim() !== positionFilter) {
        continue;
      }
      const assetId = binding.assetId.trim();
      if (assetId) {
        allowedIds.add(assetId);
      }
    }
  }

  for (const seat of Object.values(params.seatStore.seats ?? {})) {
    if (seat.tenantId !== tenantId) {
      continue;
    }
    if (positionFilter && seat.seatId.trim() !== positionFilter) {
      continue;
    }
    for (const agentId of seat.defaultAgentAssetIds ?? []) {
      const trimmed = agentId.trim();
      if (trimmed) {
        allowedIds.add(trimmed);
      }
    }
  }

  if (!positionFilter) {
    for (const runtimeAgent of params.runtimeAgents) {
      if (runtimeAgent.tenantCoverage.includes(tenantId)) {
        const runtimeId = runtimeAgent.runtimeAgentId.trim();
        if (runtimeId) {
          allowedIds.add(runtimeId);
        }
      }
    }
  }

  // Include gateway agents owned by current seat occupants (not yet seat-bound).
  if (!positionFilter && params.memberOwnerKeys && params.memberOwnerKeys.size > 0) {
    for (const agent of params.gatewayAgents) {
      const ownerKey = normalizeAgentKey(agent.ownerId ?? "");
      if (ownerKey && params.memberOwnerKeys.has(ownerKey)) {
        const agentId = agent.id.trim();
        if (agentId) {
          allowedIds.add(agentId);
        }
      }
    }
  }

  const gatewayByKey = new Map(
    params.gatewayAgents.map((agent) => [normalizeAgentKey(agent.id), agent] as const),
  );

  const results: MeshGrowthAgentInput[] = [];
  for (const rawId of allowedIds) {
    const gatewayAgent = gatewayByKey.get(normalizeAgentKey(rawId));
    if (!gatewayAgent) {
      continue;
    }
    results.push({
      agentId: gatewayAgent.id,
      name: gatewayAgent.name?.trim() || gatewayAgent.id,
    });
  }

  return results.toSorted((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

export async function listTenantMeshGrowthAgents(params: {
  tenantId: string;
  cfg: OpenBotConfig;
  positionId?: string | null;
}): Promise<MeshGrowthAgentInput[]> {
  const tenantId = params.tenantId.trim();
  if (!tenantId) {
    return [];
  }
  const gatewayAgents = listAgentsForGateway(params.cfg).agents;
  const ownershipRecords = listOwnershipRecords();
  let seatStore: EnterpriseSeatAssetsStore;
  try {
    seatStore = await loadSeatAssetsStoreForTenantId(tenantId);
  } catch {
    seatStore = {
      version: 1,
      seats: {},
      bindings: {},
      assetBindings: {},
    } as EnterpriseSeatAssetsStore;
  }
  const memberOwnerKeys = new Set<string>();
  try {
    const authConfig = resolvePlatformAuthConfig(params.cfg.gateway?.auth?.trustedProxy);
    if (authConfig?.enabled) {
      const platformStore = await loadPlatformAuthStore(authConfig);
      for (const seat of Object.values(seatStore.seats ?? {})) {
        if (seat.tenantId !== tenantId || !seat.currentEmployeeId) {
          continue;
        }
        const user = platformStore.users?.[seat.currentEmployeeId];
        for (const key of [
          seat.currentEmployeeId,
          user?.email,
          user?.normalizedEmail,
          user?.displayName,
        ]) {
          const normalized = normalizeAgentKey(key ?? "");
          if (normalized) {
            memberOwnerKeys.add(normalized);
          }
        }
      }
    }
  } catch {
    // Platform auth unavailable — seat/ownership sources still apply.
  }
  const runtimeAgents = listAgents({
    lifecycle: null,
    health: null,
    tenantId,
    searchQuery: "",
  });
  return listTenantMeshGrowthAgentsFromSources({
    tenantId,
    gatewayAgents,
    ownershipRecords,
    seatStore,
    runtimeAgents,
    positionId: params.positionId,
    memberOwnerKeys,
  });
}

async function resolveScopedAgentDir(
  cfg: OpenBotConfig,
  client: GatewayClient | null | undefined,
  agentId: string,
): Promise<string | null> {
  if (isSharedTenantAddressingEnabled(cfg) && client) {
    try {
      return await resolveAgentDirForClient(client, agentId, cfg);
    } catch {
      return null;
    }
  }
  return null;
}

export async function readRobotGrowthStatusForMeshAggregate(params: {
  cfg: OpenBotConfig;
  client?: GatewayClient | null;
  agentId: string;
}): Promise<GrowthStatus | null> {
  const scopedDir = await resolveScopedAgentDir(params.cfg, params.client, params.agentId);
  if (scopedDir) {
    return await readJsonFile<GrowthStatus>(path.join(scopedDir, GROWTH_STATUS_FILENAME));
  }
  const { readRobotGrowthStatus } = await import("./store.js");
  return await readRobotGrowthStatus(params.cfg, params.agentId);
}

export async function readRobotWorkingStyleForMeshAggregate(params: {
  cfg: OpenBotConfig;
  client?: GatewayClient | null;
  agentId: string;
}): Promise<WorkingStyle | null> {
  const scopedDir = await resolveScopedAgentDir(params.cfg, params.client, params.agentId);
  if (scopedDir) {
    return await readJsonFile<WorkingStyle>(path.join(scopedDir, WORKING_STYLE_FILENAME));
  }
  const { readRobotWorkingStyle } = await import("./working-style-store.js");
  return await readRobotWorkingStyle(params.cfg, params.agentId);
}

export async function readWorkingStyleChangeForMeshAggregate(params: {
  cfg: OpenBotConfig;
  client?: GatewayClient | null;
  agentId: string;
}): Promise<WorkingStyleChangeRecord | null> {
  const scopedDir = await resolveScopedAgentDir(params.cfg, params.client, params.agentId);
  if (scopedDir) {
    return await readJsonFile<WorkingStyleChangeRecord>(
      path.join(scopedDir, WORKING_STYLE_CHANGE_FILENAME),
    );
  }
  const { readWorkingStyleChange } = await import("./working-style-store.js");
  return await readWorkingStyleChange(params.cfg, params.agentId);
}
