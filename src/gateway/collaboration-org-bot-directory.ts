import type { OpenBotConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import type { EmployeeWorkbenchActor } from "./employee-workbench-scope.js";
import {
  loadEnterpriseSeatAssetsStore,
  type EnterpriseSeatAssetsStore,
} from "./enterprise-seat-assets-store.js";
import { listOwnershipRecords, type OwnershipRecord } from "./ownership-store.js";
import type { GatewayClient } from "./server-methods/types.js";
import { listAgentsForGateway, type GatewayAgentRow } from "./session-utils.js";
import { resolveControlPlaneStorePathForClient } from "./tenant-context.js";
import { TENANT_SEAT_ASSETS_FILE } from "./tenant-store-paths.js";

export type CollaborationOrgBotDirectoryEntry = {
  agentId: string;
  label: string;
  ownerUserId: string | null;
  ownerLabel: string | null;
  scope: string | null;
};

function normalizeIdentity(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function resolveAgentLabel(agent: GatewayAgentRow | undefined, agentId: string): string {
  return agent?.identity?.name?.trim() || agent?.name?.trim() || agentId;
}

function looksLikeSeatOrEmployeeRef(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("employee:") || normalized.startsWith("seat:");
}

function rememberOwner(
  ownerByAgentId: Map<string, { ownerUserId: string; ownerLabel: string }>,
  agentId: string,
  ownerUserId: string,
  ownerLabel: string,
) {
  if (!agentId || !ownerUserId || ownerByAgentId.has(agentId)) {
    return;
  }
  ownerByAgentId.set(agentId, { ownerUserId, ownerLabel });
}

export function buildCollaborationOrgBotDirectory(params: {
  tenantId: string;
  agents: GatewayAgentRow[];
  ownershipRecords: OwnershipRecord[];
  seatStore: EnterpriseSeatAssetsStore;
  memberLabels?: ReadonlyMap<string, string>;
  /** Extra same-tenant agent ids (mesh / seat-owner map). Never the install-wide roster. */
  allowedAgentIds?: ReadonlySet<string>;
}): CollaborationOrgBotDirectoryEntry[] {
  const agentById = new Map(
    params.agents.map((agent) => [normalizeIdentity(agent.id), agent] as const),
  );
  const ownerByAgentId = new Map<string, { ownerUserId: string; ownerLabel: string }>();
  const tenantMemberIds = new Set<string>(
    [...(params.memberLabels?.keys() ?? [])]
      .map((value) => normalizeIdentity(value))
      .filter(Boolean),
  );

  for (const record of params.ownershipRecords) {
    if (
      record.tenantId !== params.tenantId ||
      record.subjectKind !== "agent" ||
      record.bindingStatus === "revoked"
    ) {
      continue;
    }
    const agentId = normalizeIdentity(record.subjectId);
    const ownerUserId = record.currentManagerUserId.trim();
    if (!agentId || !ownerUserId) {
      continue;
    }
    rememberOwner(
      ownerByAgentId,
      agentId,
      ownerUserId,
      record.currentManagerLabel.trim() || ownerUserId,
    );
  }

  for (const seat of Object.values(params.seatStore.seats ?? {})) {
    if (seat.tenantId !== params.tenantId) {
      continue;
    }
    const ownerUserId = seat.currentEmployeeId?.trim();
    if (ownerUserId) {
      tenantMemberIds.add(normalizeIdentity(ownerUserId));
    }
    const ownerLabel =
      (ownerUserId ? params.memberLabels?.get(normalizeIdentity(ownerUserId)) : undefined) ??
      seat.title?.trim() ??
      ownerUserId ??
      "";
    for (const rawId of seat.defaultAgentAssetIds ?? []) {
      const agentId = normalizeIdentity(rawId);
      if (agentId && ownerUserId) {
        rememberOwner(ownerByAgentId, agentId, ownerUserId, ownerLabel);
      }
    }
  }

  for (const binding of Object.values(params.seatStore.assetBindings ?? {})) {
    if (
      binding.tenantId !== params.tenantId ||
      binding.assetType !== "agent" ||
      binding.status !== "active"
    ) {
      continue;
    }
    const agentId = normalizeIdentity(binding.assetId);
    const seat = params.seatStore.seats[binding.seatId];
    const ownerUserId = seat?.currentEmployeeId?.trim();
    if (!agentId || !ownerUserId) {
      continue;
    }
    const ownerLabel =
      params.memberLabels?.get(normalizeIdentity(ownerUserId)) ??
      seat?.title?.trim() ??
      ownerUserId;
    rememberOwner(ownerByAgentId, agentId, ownerUserId, ownerLabel);
  }

  // Same-tenant only. The install-wide gateway roster must not become candidates.
  const candidateIds = new Set<string>(ownerByAgentId.keys());
  for (const rawId of params.allowedAgentIds ?? []) {
    const agentId = normalizeIdentity(rawId);
    if (agentId) {
      candidateIds.add(agentId);
    }
  }
  for (const agent of params.agents) {
    const agentId = normalizeIdentity(agent.id);
    const ownerId = normalizeIdentity(agent.ownerId);
    if (!agentId || ownerByAgentId.has(agentId)) {
      continue;
    }
    if (!ownerId || looksLikeSeatOrEmployeeRef(agent.ownerId ?? "")) {
      continue;
    }
    if (tenantMemberIds.has(ownerId)) {
      candidateIds.add(agentId);
    }
  }

  const entries: CollaborationOrgBotDirectoryEntry[] = [];
  for (const agentId of candidateIds) {
    const agent = agentById.get(agentId);
    const canonicalAgentId = agent?.id ?? agentId;
    const ownership = ownerByAgentId.get(agentId);
    const configOwnerId = agent?.ownerId?.trim() ?? "";
    const configOwnerName = agent?.ownerName?.trim() || null;
    const ownerUserId =
      ownership?.ownerUserId ??
      (configOwnerId && !looksLikeSeatOrEmployeeRef(configOwnerId) ? configOwnerId : null);
    let ownerLabel = ownership?.ownerLabel ?? configOwnerName;
    if (ownerUserId) {
      ownerLabel =
        params.memberLabels?.get(normalizeIdentity(ownerUserId)) ?? ownerLabel ?? ownerUserId;
    }
    entries.push({
      agentId: canonicalAgentId,
      label: resolveAgentLabel(agent, canonicalAgentId),
      ownerUserId: ownerUserId ?? null,
      ownerLabel: ownerLabel ?? null,
      scope: agent?.scope ?? null,
    });
  }

  return entries.toSorted((left, right) => {
    const groupLeft = left.ownerLabel ?? left.ownerUserId ?? "zzz";
    const groupRight = right.ownerLabel ?? right.ownerUserId ?? "zzz";
    if (groupLeft !== groupRight) {
      return groupLeft.localeCompare(groupRight, "zh-CN");
    }
    return left.label.localeCompare(right.label, "zh-CN");
  });
}

export function isCollaborationOrgBotOwnedByActor(
  entry: Pick<CollaborationOrgBotDirectoryEntry, "ownerUserId" | "agentId">,
  actorIdentities: ReadonlySet<string>,
  ownedAgentIds?: ReadonlySet<string>,
): boolean {
  if (ownedAgentIds?.has(entry.agentId)) {
    return true;
  }
  const ownerId = normalizeIdentity(entry.ownerUserId);
  return Boolean(ownerId && actorIdentities.has(ownerId));
}

export function collectCollaborationOrgBotIds(
  params: Parameters<typeof buildCollaborationOrgBotDirectory>[0],
): Set<string> {
  return new Set(
    buildCollaborationOrgBotDirectory(params).map((entry) => normalizeIdentity(entry.agentId)),
  );
}

/** Reject newly added / invited bots that are not proven to belong to this tenant. */
export function assertCollaborationBotsBelongToTenant(params: {
  tenantId: string;
  agents: GatewayAgentRow[];
  ownershipRecords: OwnershipRecord[];
  seatStore: EnterpriseSeatAssetsStore;
  existingMembers: Array<{ memberKind?: string | null; agentId?: string | null }>;
  nextMembers: Array<{ memberKind?: string | null; agentId?: string | null }>;
  extraAllowedAgentIds?: ReadonlySet<string>;
  memberLabels?: ReadonlyMap<string, string>;
}): void {
  const allowed = collectCollaborationOrgBotIds({
    tenantId: params.tenantId,
    agents: params.agents,
    ownershipRecords: params.ownershipRecords,
    seatStore: params.seatStore,
    memberLabels: params.memberLabels,
    allowedAgentIds: params.extraAllowedAgentIds,
  });
  const existing = new Set(
    params.existingMembers
      .filter((member) => member.memberKind === "bot")
      .map((member) => normalizeIdentity(member.agentId))
      .filter(Boolean),
  );
  for (const member of params.nextMembers) {
    if (member.memberKind !== "bot") {
      continue;
    }
    const agentId = normalizeIdentity(member.agentId);
    if (!agentId || existing.has(agentId) || allowed.has(agentId)) {
      continue;
    }
    throw new Error("只能邀请本企业租户的机器人加入协作小组");
  }
}

export async function listCollaborationOrgBotDirectoryForActor(
  actor: EmployeeWorkbenchActor,
  options?: {
    cfg?: OpenBotConfig;
    ownershipRecords?: OwnershipRecord[];
    seatStore?: EnterpriseSeatAssetsStore;
    memberLabels?: ReadonlyMap<string, string>;
    client?: GatewayClient | null;
  },
): Promise<CollaborationOrgBotDirectoryEntry[]> {
  const tenantId = actor.tenantId?.trim();
  if (!tenantId) {
    return [];
  }
  const cfg = options?.cfg ?? loadConfig();
  const agents = listAgentsForGateway(cfg).agents;
  const seatStore =
    options?.seatStore ??
    (await loadEnterpriseSeatAssetsStore(
      await resolveControlPlaneStorePathForClient(options?.client ?? null, TENANT_SEAT_ASSETS_FILE),
    ));
  const ownershipRecords = options?.ownershipRecords ?? listOwnershipRecords();
  return buildCollaborationOrgBotDirectory({
    tenantId,
    agents,
    ownershipRecords,
    seatStore,
    memberLabels: options?.memberLabels,
  });
}
