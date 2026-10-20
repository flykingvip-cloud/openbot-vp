/**
 * 协作群 × 大白管家策略：
 * - 内置大白（agent `main`）不是协作小组成员，花名册禁止写入；
 * - 群 bot 回合的 entitlement / credits 归属群 owner 席位。
 */

import type { CollaborationMember } from "@openbot/collaboration-core";
import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import { loadConfig } from "../../config/config.js";
import type { CollaborationDispatchScope } from "../collaboration-dispatch/types.js";
import { loadEnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { listOwnershipRecords, type OwnershipRecord } from "../ownership-store.js";
import { loadPlatformAuthStore, resolvePlatformAuthConfig } from "../platform-auth.js";
import type { GatewayClient } from "../server-methods/types.js";
import { resolveControlPlaneStorePathForClient } from "../tenant-context.js";
import { TENANT_SEAT_ASSETS_FILE } from "../tenant-store-paths.js";
import { findExistingMember, normalizeValue, resolveEffectiveGroupOwnerUserId } from "./shared.js";

export type CollaborationGroupOwnerEntitlementScope = {
  tenantId: string;
  seatId: string;
  employeeId?: string;
  userEmail?: string;
};

function findActiveGroupOwnershipRecord(groupId: string): OwnershipRecord | null {
  const normalizedGroupId = normalizeValue(groupId);
  if (!normalizedGroupId) {
    return null;
  }
  return (
    listOwnershipRecords().find(
      (entry) =>
        entry.subjectKind === "group" &&
        entry.subjectId === normalizedGroupId &&
        entry.bindingStatus !== "revoked",
    ) ?? null
  );
}

async function resolveOwnerSeatFromSpaceAsset(
  groupId: string,
  client: GatewayClient | null,
): Promise<{ tenantId: string; seatId: string } | null> {
  const normalizedGroupId = normalizeValue(groupId);
  if (!normalizedGroupId) {
    return null;
  }
  const store = await loadEnterpriseSeatAssetsStore(
    await resolveControlPlaneStorePathForClient(client, TENANT_SEAT_ASSETS_FILE),
  );
  const binding = Object.values(store.assetBindings).find(
    (entry) =>
      entry.assetType === "space" &&
      entry.assetId === normalizedGroupId &&
      entry.status === "active" &&
      !entry.revokedAt,
  );
  if (!binding) {
    return null;
  }
  return { tenantId: binding.tenantId, seatId: binding.seatId };
}

async function resolveOwnerUserEmail(ownerUserId: string): Promise<string | undefined> {
  const cfg = loadConfig();
  const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
  if (!authConfig?.enabled) {
    return undefined;
  }
  const store = await loadPlatformAuthStore(authConfig);
  const user = Object.values(store.users).find((entry) => entry.id === ownerUserId);
  return user?.email?.trim() || undefined;
}

export function assertBuiltinStewardGroupMembershipAllowed(params: {
  existingMembers: CollaborationMember[];
  nextMembers: CollaborationMember[];
  ownerUserId: string | null;
  actor?: string;
}) {
  for (const member of params.nextMembers) {
    if (member.memberKind !== "bot") {
      continue;
    }
    if (member.status !== "active" && member.status !== "invited") {
      continue;
    }
    const agentId = normalizeValue(member.agentId);
    if (!agentId || !isBuiltinStewardAgent(agentId)) {
      continue;
    }
    const existing = findExistingMember(params.existingMembers, "bot", agentId);
    const wasAlreadyPresent =
      existing?.status === "active" ||
      existing?.status === "paused" ||
      existing?.status === "invited";
    if (wasAlreadyPresent) {
      continue;
    }
    throw new Error("大白管家不是协作小组成员，不能加入花名册");
  }
}

export async function resolveCollaborationGroupOwnerEntitlementScope(
  scope: Pick<CollaborationDispatchScope, "groupId" | "operatingState" | "members">,
  client: GatewayClient | null = null,
): Promise<CollaborationGroupOwnerEntitlementScope | null> {
  const groupId = normalizeValue(scope.groupId);
  if (!groupId) {
    return null;
  }

  const ownerUserId =
    normalizeValue(scope.operatingState?.governance?.ownerUserId) ??
    scope.members?.humans
      ?.map((entry) => normalizeValue(entry.userId))
      .find((userId): userId is string => Boolean(userId)) ??
    null;

  const ownership = findActiveGroupOwnershipRecord(groupId);
  const seatFromAsset = ownership ? null : await resolveOwnerSeatFromSpaceAsset(groupId, client);

  const tenantId = ownership?.tenantId ?? seatFromAsset?.tenantId;
  const seatId = ownership?.positionId ?? seatFromAsset?.seatId;
  if (!tenantId || !seatId) {
    return null;
  }

  const employeeId = normalizeValue(ownership?.currentManagerUserId) ?? ownerUserId ?? undefined;
  const userEmail = employeeId ? await resolveOwnerUserEmail(employeeId) : undefined;

  return {
    tenantId,
    seatId,
    ...(employeeId ? { employeeId } : {}),
    ...(userEmail ? { userEmail } : {}),
  };
}

export function resolveCollaborationGroupOwnerUserIdFromScope(
  scope: Pick<CollaborationDispatchScope, "operatingState" | "members">,
): string | null {
  const fromGovernance = normalizeValue(scope.operatingState?.governance?.ownerUserId);
  if (fromGovernance) {
    return fromGovernance;
  }
  const ownerFromRoles = scope.operatingState?.memberRoleMap?.find(
    (entry) => entry.memberKind === "human" && entry.governanceRole === "owner",
  );
  const roleOwner = normalizeValue(ownerFromRoles?.memberId);
  if (roleOwner) {
    return roleOwner;
  }
  if (!scope.members?.humans?.length) {
    return null;
  }
  return resolveEffectiveGroupOwnerUserId({
    members: scope.members.humans.map((entry) => ({
      memberId: entry.userId,
      memberKind: "human" as const,
      userId: entry.userId,
      governanceRole: "member" as const,
      status: entry.status === "active" ? ("active" as const) : ("invited" as const),
      updatedAtMs: 0,
    })),
  });
}
