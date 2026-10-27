import { loadConfig } from "../../config/config.js";
import { isSharedTenantAddressingEnabled } from "../../config/data-space.js";
import { readOrganizationPresence } from "../../organization/presence.js";
import { readOrganizationTaskAssignments } from "../../organization/task-assignment.js";
import { applyRosterAuthChangeSharedCas } from "../collaboration-dispatch/task-control-cas.js";
import {
  attachSeatManagedAsset,
  type EnterpriseSeatAssetsStore,
  grantEnterpriseAccessPolicy,
  loadEnterpriseSeatAssetsStore,
  saveEnterpriseSeatAssetsStore,
} from "../enterprise-seat-assets-store.js";
import {
  listOwnershipRecords,
  transferOwnershipRecord,
  upsertOwnershipRecord,
} from "../ownership-store.js";
import { resolveSecurityProfile } from "../security-profile.js";
import {
  TENANT_SEAT_ASSETS_FILE,
  resolveTenantControlPlaneStorePath,
} from "../tenant-store-paths.js";
import { persistAuthoritativeGroupMembers } from "../workspace/group-acl.js";
import { ensureGatewayCollaborationGroupSessions } from "./event-entry.js";
import {
  applyGroupOwnerRole,
  assertSharedBotActivationsAuthorized,
  buildPersistedMembers,
  buildWorkspaceSpaceSnapshot,
  cloneMembersForReset,
  createWorkspaceCollaborationStores,
  ensureCreatorHumanMember,
  readGroupOperatingState,
  ensureWorkspaceGroupBootstrapArtifacts,
  ensureWorkspaceSpaceProfile,
  listUserScopedCollaborationExtras,
  listWorkspaceCollaborationGroupIds,
  normalizeStringList,
  readWorkspaceSpaceSnapshotFromRoot,
  normalizeValue,
  promoteSelfOwnedBotInvites,
  readSessionDerivedSpaceTitles,
  resolveGroupCollaborationPaths,
  materializeGroupCollaborationWorkspace,
  resolveNextCoordinatorBotId,
  stripBuiltinStewardGroupMembers,
  resolveEffectiveGroupOwnerUserId,
  resetCollaborationGroupSessionData,
  resetCollaborationGroupStorage,
  resolveNextGroupOwnerUserId,
  syncGroupOperatingState,
  toGroupProfile,
  writeGroupBootstrapState,
} from "./shared.js";
import type {
  GatewayCollaborationSpaceLeaveParams,
  GatewayCollaborationSpaceOwnershipTransferParams,
  GatewayCollaborationSpaceMembersUpdateParams,
  GatewayCollaborationSpaceResetParams,
  GatewayCollaborationSpaceDissolveParams,
  GatewayCollaborationSpacesListResult,
} from "./snapshot-types.js";
import { assertBuiltinStewardGroupMembershipAllowed } from "./steward-group-policy.js";

/** W1: after durable roster/profile write, force OS auth through shared CAS writer. */
async function persistRosterAuthViaSharedCas(params: {
  groupId: string;
  profile:
    | {
        ownerUserId?: string | null;
        coordinatorBotId?: string | null;
      }
    | null
    | undefined;
  members: Parameters<typeof applyRosterAuthChangeSharedCas>[0]["members"];
  invalidateTaskIds?: readonly string[];
}) {
  const { fileStore } = createWorkspaceCollaborationStores();
  const live = await readGroupOperatingState({ fileStore, groupId: params.groupId });
  if (!live) {
    // e.g. after reset wipe — sync/commitSynced creates OS with auth projection.
    return null;
  }
  return applyRosterAuthChangeSharedCas({
    groupId: params.groupId,
    profile: params.profile,
    members: params.members,
    invalidateTaskIds: params.invalidateTaskIds,
  });
}

/**
 * Maps `agentId` (lowercased) → owning employee's platform user id.
 * Sources (first wins):
 *   1) active enterprise seat agent-asset bindings
 *   2) organization ownership store `currentManagerUserId`
 *   3) agent config `ownerId` when it names a seat whose current employee is set
 *      (covers position-owned robots missing assetBindings)
 */
export function buildBotOwnerUserIdMap(
  seatStore: EnterpriseSeatAssetsStore,
  tenantId: string,
): Map<string, string> {
  const ownerByAgentId = new Map<string, string>();
  for (const binding of Object.values(seatStore.assetBindings)) {
    if (
      binding.tenantId !== tenantId ||
      binding.assetType !== "agent" ||
      binding.status !== "active"
    ) {
      continue;
    }
    const agentId = normalizeValue(binding.assetId)?.toLowerCase();
    const ownerUserId = normalizeValue(seatStore.seats[binding.seatId]?.currentEmployeeId);
    if (agentId && ownerUserId) {
      ownerByAgentId.set(agentId, ownerUserId);
    }
  }
  for (const record of listOwnershipRecords()) {
    if (
      record.tenantId !== tenantId ||
      record.subjectKind !== "agent" ||
      record.bindingStatus !== "active"
    ) {
      continue;
    }
    const agentId = normalizeValue(record.subjectId)?.toLowerCase();
    const ownerUserId = normalizeValue(record.currentManagerUserId);
    if (agentId && ownerUserId && !ownerByAgentId.has(agentId)) {
      ownerByAgentId.set(agentId, ownerUserId);
    }
  }
  const cfg = loadConfig();
  for (const agent of cfg.agents?.list ?? []) {
    const agentId = normalizeValue(agent.id)?.toLowerCase();
    const ownerId = normalizeValue(agent.ownerId);
    if (!agentId || !ownerId || ownerByAgentId.has(agentId)) {
      continue;
    }
    const seatEmployee = normalizeValue(seatStore.seats[ownerId]?.currentEmployeeId);
    if (seatEmployee) {
      ownerByAgentId.set(agentId, seatEmployee);
    }
  }
  return ownerByAgentId;
}

/** Active seat owning this collaboration space, if already bound in enterprise seat assets. */
function resolveExistingSpaceSeatId(
  seatStore: EnterpriseSeatAssetsStore,
  tenantId: string,
  groupId: string,
): string | null {
  const normalizedGroupId = normalizeValue(groupId)?.toLowerCase();
  if (!normalizedGroupId) {
    return null;
  }
  for (const binding of Object.values(seatStore.assetBindings)) {
    if (
      binding.tenantId !== tenantId ||
      binding.assetType !== "space" ||
      binding.status !== "active" ||
      binding.revokedAt
    ) {
      continue;
    }
    if (normalizeValue(binding.assetId)?.toLowerCase() === normalizedGroupId) {
      return normalizeValue(binding.seatId);
    }
  }
  return null;
}

/** Normalize stored/runtime profile before mission & policy field access. */
function workspaceProfileSnapshot(profile: Parameters<typeof toGroupProfile>[0]) {
  const groupProfile = toGroupProfile(profile);
  return {
    avatar: normalizeValue(groupProfile?.avatar) ?? undefined,
    visibilityScope: normalizeValue(groupProfile?.visibilityScope) ?? undefined,
    coordinatorBotId: normalizeValue(groupProfile?.coordinatorBotId),
    purpose: normalizeValue(groupProfile?.purpose) ?? undefined,
    currentMission: normalizeValue(groupProfile?.currentMission) ?? undefined,
    successCriteria: normalizeStringList(groupProfile?.successCriteria),
    collaborationMode: normalizeValue(groupProfile?.collaborationMode) ?? undefined,
    workspacePath: normalizeValue(groupProfile?.workspacePath) ?? undefined,
    finalDecisionPolicy: groupProfile?.finalDecisionPolicy,
  };
}

export async function listGatewayCollaborationSpaces(): Promise<GatewayCollaborationSpacesListResult> {
  const {
    workspaceDir,
    stateDir,
    collaborationWorkspaceRoot,
    fileStore,
    groupRootDir,
    groupStorage,
    learningStorage,
    memoryStorage,
    metadataStorage,
    objectStorage,
  } = createWorkspaceCollaborationStores();
  const [workspaceGroupIds, sessionDerivedTitles] = await Promise.all([
    listWorkspaceCollaborationGroupIds(groupRootDir),
    readSessionDerivedSpaceTitles(stateDir),
  ]);
  const groupIds = [...workspaceGroupIds];
  const userScoped = await listUserScopedCollaborationExtras({
    workspaceDir,
    primaryGroupRootDir: groupRootDir,
  });
  const extraGroupIds = userScoped.groupIds.filter((groupId) => !groupIds.includes(groupId));
  const spaces = await Promise.all(
    groupIds.map(async (groupId) => {
      const bootstrapState = await ensureWorkspaceGroupBootstrapArtifacts({
        stateDir,
        fileStore,
        groupStorage,
        metadataStorage,
        memoryStorage,
        learningStorage,
        objectStorage,
        groupId,
        titleFallback: sessionDerivedTitles.get(groupId) ?? null,
      });
      const paths = resolveGroupCollaborationPaths(groupId);
      const workspacePath =
        normalizeValue(bootstrapState.profile?.workspacePath) ?? paths.workspacePath;
      if (collaborationWorkspaceRoot) {
        await materializeGroupCollaborationWorkspace(groupId);
      }
      const cfg = loadConfig();
      const [presence, taskAssignments] = await Promise.all([
        readOrganizationPresence({
          cfg,
          workspaceDir,
          organizationId: groupId,
        }),
        readOrganizationTaskAssignments({
          cfg,
          workspaceDir,
          organizationId: groupId,
        }),
      ]);
      return buildWorkspaceSpaceSnapshot({
        groupId,
        profile: bootstrapState.profile,
        groupCapabilities: bootstrapState.groupCapabilities,
        operatingState: bootstrapState.operatingState,
        members: bootstrapState.members,
        presence,
        taskAssignments,
        titleFallback: sessionDerivedTitles.get(groupId) ?? null,
        ...(collaborationWorkspaceRoot ? { workspacePath } : {}),
      });
    }),
  );
  const extraSpaces = await Promise.all(
    extraGroupIds.map(async (groupId) =>
      readWorkspaceSpaceSnapshotFromRoot({
        groupRootDir: userScoped.root,
        groupId,
      }),
    ),
  );
  const mergedSpaces = [
    ...spaces,
    ...extraSpaces.filter((space): space is NonNullable<typeof space> => Boolean(space)),
  ];
  return {
    spaces: mergedSpaces.toSorted((left, right) =>
      (right.title || right.groupId).localeCompare(left.title || left.groupId),
    ),
  };
}

export async function updateGatewayCollaborationSpaceMembers(
  params: GatewayCollaborationSpaceMembersUpdateParams & { actor?: string },
) {
  const {
    collaborationWorkspaceRoot,
    fileStore,
    groupStorage,
    metadataStorage,
    memoryStorage,
    learningStorage,
    objectStorage,
  } = createWorkspaceCollaborationStores();
  const paths = resolveGroupCollaborationPaths(params.groupId);
  await materializeGroupCollaborationWorkspace(params.groupId);
  const workspacePath = paths.workspacePath;
  const [existingProfile, existingMembers] = await Promise.all([
    groupStorage.readProfile(params.groupId),
    groupStorage.readMembers(params.groupId),
  ]);
  const now = Date.now();
  const tenantId =
    typeof params.tenantId === "string" && params.tenantId.trim() ? params.tenantId : null;
  let botOwnerByAgentId = new Map<string, string>();
  let seatStoreForTenant: EnterpriseSeatAssetsStore | null = null;
  let seatStorePath: string | undefined;
  if (tenantId) {
    seatStorePath =
      isSharedTenantAddressingEnabled(loadConfig()) && tenantId
        ? resolveTenantControlPlaneStorePath(tenantId, TENANT_SEAT_ASSETS_FILE)
        : undefined;
    seatStoreForTenant = await loadEnterpriseSeatAssetsStore(seatStorePath);
    botOwnerByAgentId = buildBotOwnerUserIdMap(seatStoreForTenant, tenantId);
  }
  let nextMembers = buildPersistedMembers({
    existingMembers,
    members: params.members,
    invites: params.invites,
    now,
  });
  nextMembers = ensureCreatorHumanMember({
    existingMembers,
    nextMembers,
    actor: params.actor,
    actorEmployeeUserId: params.actorEmployeeUserId,
    creatorLabel: params.ownerUserLabel,
    now,
  });
  nextMembers = promoteSelfOwnedBotInvites({
    members: nextMembers,
    actor: params.actor,
    actorEmployeeUserId: params.actorEmployeeUserId,
    botOwnerUserIdByAgentId: botOwnerByAgentId,
    now,
  });
  const ownerUserId = resolveNextGroupOwnerUserId({
    profile: existingProfile,
    existingMembers,
    nextMembers,
    actor: params.actor,
    actorEmployeeUserId: params.actorEmployeeUserId,
  });
  let ownerPositionId =
    typeof params.ownerPositionId === "string" && params.ownerPositionId.trim()
      ? params.ownerPositionId.trim()
      : null;
  // Member/invite updates often omit seat id; reuse the space's existing seat binding.
  if (tenantId && !ownerPositionId && seatStoreForTenant) {
    ownerPositionId = resolveExistingSpaceSeatId(seatStoreForTenant, tenantId, params.groupId);
  }
  if (tenantId && !ownerPositionId) {
    throw new Error("enterprise collaboration spaces must be owned by a position seat");
  }
  if (tenantId && !ownerUserId) {
    throw new Error("enterprise collaboration spaces require an owning employee actor");
  }
  let nextMembersWithOwner = applyGroupOwnerRole(nextMembers, ownerUserId);
  // Record the owning human (platform user id) on each bot member at join /
  // authorization time so the roster is self-describing for attribution and
  // owner-audit visibility. Resolved from enterprise seat asset ownership.
  if (tenantId) {
    if (botOwnerByAgentId.size > 0) {
      nextMembersWithOwner = nextMembersWithOwner.map((member) => {
        if (member.memberKind !== "bot") {
          return member;
        }
        const agentId = normalizeValue(member.agentId)?.toLowerCase();
        const resolvedOwnerUserId = agentId ? botOwnerByAgentId.get(agentId) : undefined;
        return resolvedOwnerUserId && resolvedOwnerUserId !== member.ownerUserId
          ? { ...member, ownerUserId: resolvedOwnerUserId }
          : member;
      });
    }
  }
  assertSharedBotActivationsAuthorized({
    existingMembers,
    nextMembers: nextMembersWithOwner,
    actor: params.actor,
    actorEmployeeUserId: params.actorEmployeeUserId,
    botOwnerUserIdByAgentId: botOwnerByAgentId,
  });
  assertBuiltinStewardGroupMembershipAllowed({
    existingMembers,
    nextMembers: nextMembersWithOwner,
    ownerUserId:
      resolveEffectiveGroupOwnerUserId({
        profile: existingProfile,
        members: existingMembers,
      }) ?? ownerUserId,
    actor: params.actor,
  });
  nextMembersWithOwner = stripBuiltinStewardGroupMembers(nextMembersWithOwner);
  const coordinatorBotId = resolveNextCoordinatorBotId({
    profile: existingProfile,
    members: nextMembersWithOwner,
    requestedBotId: params.coordinatorBotId,
  });
  await ensureWorkspaceSpaceProfile({
    groupStorage,
    groupId: params.groupId,
    title: params.title,
    avatar: params.avatar,
    visibilityScope: params.visibilityScope,
    ownerUserId,
    coordinatorBotId,
    purpose: params.purpose,
    currentMission: params.currentMission,
    successCriteria: params.successCriteria,
    collaborationMode: params.collaborationMode,
    workspacePath: params.workspacePath,
    finalDecisionPolicy: params.finalDecisionPolicy,
  });
  await groupStorage.writeMembers(params.groupId, nextMembersWithOwner);
  if (tenantId) {
    const securityProfile = resolveSecurityProfile(loadConfig(), process.env);
    if (securityProfile.profile === "managed_enterprise") {
      await persistAuthoritativeGroupMembers({
        groupId: params.groupId,
        tenantId,
        profile: "managed_enterprise",
        cfg: loadConfig(),
        members: nextMembersWithOwner,
      });
    }
  }
  const profile = await groupStorage.readProfile(params.groupId);
  const title =
    normalizeValue(profile?.displayName) ?? normalizeValue(profile?.groupCode) ?? params.groupId;
  if (tenantId && ownerPositionId && ownerUserId) {
    upsertOwnershipRecord({
      tenantId,
      subjectKind: "group",
      subjectId: params.groupId,
      positionId: ownerPositionId,
      positionLabel: normalizeValue(params.ownerPositionLabel) ?? ownerPositionId,
      createdByUserId: ownerUserId,
      createdByUserLabel: normalizeValue(params.ownerUserLabel) ?? ownerUserId,
      currentManagerUserId: ownerUserId,
      currentManagerLabel: normalizeValue(params.ownerUserLabel) ?? ownerUserId,
    });
    const nowIso = new Date().toISOString();
    const seatStore = seatStoreForTenant ?? (await loadEnterpriseSeatAssetsStore(seatStorePath));
    attachSeatManagedAsset({
      store: seatStore,
      tenantId,
      seatId: ownerPositionId,
      assetType: "space",
      assetId: params.groupId,
      source: "manual",
      createdBy: ownerUserId,
      nowIso,
    });
    grantEnterpriseAccessPolicy({
      store: seatStore,
      tenantId,
      subjectType: "employee",
      subjectId: ownerUserId,
      resourceType: "space",
      resourceId: params.groupId,
      action: "read",
      nowIso,
      actorEmployeeId: ownerUserId,
    });
    await saveEnterpriseSeatAssetsStore(seatStorePath, seatStore);
  }
  await writeGroupBootstrapState({
    groupId: params.groupId,
    title,
    profile,
    members: nextMembersWithOwner,
    metadataStorage,
    memoryStorage,
    learningStorage,
    requestedSystemInstructions: params.systemInstructions,
    requestedConfidentialityTier: params.confidentialityTier,
  });
  await persistRosterAuthViaSharedCas({
    groupId: params.groupId,
    profile,
    members: nextMembersWithOwner,
  });
  const groupCapabilities = await metadataStorage.readGroupCapabilities(params.groupId);
  const operatingState = await syncGroupOperatingState({
    fileStore,
    groupStorage,
    metadataStorage,
    memoryStorage,
    learningStorage,
    objectStorage,
    groupId: params.groupId,
    titleFallback: title,
  });
  const activeBotIds = nextMembersWithOwner
    .filter((member) => member.memberKind === "bot" && member.status === "active")
    .map((member) => normalizeValue(member.agentId))
    .filter(Boolean) as string[];
  await ensureGatewayCollaborationGroupSessions({
    groupId: params.groupId,
    title,
    activeBotIds,
    resolveAgentStorePath: params.resolveAgentStorePath,
  });
  return {
    space: buildWorkspaceSpaceSnapshot({
      groupId: params.groupId,
      profile,
      groupCapabilities,
      operatingState,
      members: nextMembersWithOwner,
      tenantId,
      ...(collaborationWorkspaceRoot
        ? { workspacePath: normalizeValue(profile?.workspacePath) ?? workspacePath }
        : {}),
    }),
  };
}

export async function resetGatewayCollaborationSpace(params: GatewayCollaborationSpaceResetParams) {
  const {
    stateDir,
    collaborationWorkspaceRoot,
    fileStore,
    groupRootDir,
    groupStorage,
    metadataStorage,
    memoryStorage,
    learningStorage,
    objectStorage,
  } = createWorkspaceCollaborationStores();
  const [profile, members, existingGroupCapabilities] = await Promise.all([
    groupStorage.readProfile(params.groupId),
    groupStorage.readMembers(params.groupId),
    metadataStorage.readGroupCapabilities(params.groupId),
  ]);
  if (!profile && members.length === 0) {
    throw new Error(`协作小组不存在：${params.groupId}`);
  }
  const ownerUserId = resolveEffectiveGroupOwnerUserId({
    profile,
    members,
  });
  const actor = normalizeValue(params.actor);
  if (!ownerUserId) {
    throw new Error("当前协作小组尚未绑定群主，无法执行重置");
  }
  if (!actor || actor !== ownerUserId) {
    throw new Error("只有群主才能重置协作小组数据");
  }
  const resetMembers = stripBuiltinStewardGroupMembers(cloneMembersForReset(members, ownerUserId));
  const coordinatorBotId = resolveNextCoordinatorBotId({
    profile,
    members: resetMembers,
  });
  await resetCollaborationGroupStorage({
    stateDir,
    groupId: params.groupId,
    groupRootDir,
  });
  const sessionCleanup = await resetCollaborationGroupSessionData(stateDir, params.groupId);
  const profileSnapshot = workspaceProfileSnapshot(profile);
  await ensureWorkspaceSpaceProfile({
    groupStorage,
    groupId: params.groupId,
    title:
      normalizeValue(profile?.displayName) ?? normalizeValue(profile?.groupCode) ?? params.groupId,
    avatar: profileSnapshot.avatar,
    ownerUserId,
    coordinatorBotId,
    purpose: profileSnapshot.purpose,
    currentMission: profileSnapshot.currentMission,
    successCriteria: profileSnapshot.successCriteria,
    collaborationMode: profileSnapshot.collaborationMode,
    workspacePath: profileSnapshot.workspacePath,
    finalDecisionPolicy: profileSnapshot.finalDecisionPolicy,
  });
  await groupStorage.writeMembers(params.groupId, resetMembers);
  const rebuiltProfile = await groupStorage.readProfile(params.groupId);
  const title =
    normalizeValue(rebuiltProfile?.displayName) ??
    normalizeValue(rebuiltProfile?.groupCode) ??
    params.groupId;
  await writeGroupBootstrapState({
    groupId: params.groupId,
    title,
    profile: rebuiltProfile,
    members: resetMembers,
    metadataStorage,
    memoryStorage,
    learningStorage,
    requestedSystemInstructions: existingGroupCapabilities?.systemInstructions,
    requestedConfidentialityTier: existingGroupCapabilities?.confidentialityTier,
  });
  await persistRosterAuthViaSharedCas({
    groupId: params.groupId,
    profile: rebuiltProfile,
    members: resetMembers,
  });
  const rebuiltGroupCapabilities = await metadataStorage.readGroupCapabilities(params.groupId);
  const rebuiltOperatingState = await syncGroupOperatingState({
    fileStore,
    groupStorage,
    metadataStorage,
    memoryStorage,
    learningStorage,
    objectStorage,
    groupId: params.groupId,
    titleFallback: title,
  });
  const activeBotIds = resetMembers
    .filter((member) => member.memberKind === "bot" && member.status === "active")
    .map((member) => normalizeValue(member.agentId))
    .filter(Boolean) as string[];
  await ensureGatewayCollaborationGroupSessions({
    groupId: params.groupId,
    title,
    activeBotIds,
    resolveAgentStorePath: params.resolveAgentStorePath,
  });
  const paths = resolveGroupCollaborationPaths(params.groupId);
  const workspacePath = normalizeValue(rebuiltProfile?.workspacePath) ?? paths.workspacePath;
  return {
    space: buildWorkspaceSpaceSnapshot({
      groupId: params.groupId,
      profile: rebuiltProfile,
      groupCapabilities: rebuiltGroupCapabilities,
      operatingState: rebuiltOperatingState,
      members: resetMembers,
      ...(collaborationWorkspaceRoot ? { workspacePath } : {}),
    }),
    resetAtMs: Date.now(),
    deleted: {
      sessionEntries: sessionCleanup.removedSessionEntries,
      transcriptFiles: sessionCleanup.removedTranscriptFiles,
    },
  };
}

export async function dissolveGatewayCollaborationSpace(
  params: GatewayCollaborationSpaceDissolveParams,
) {
  const {
    stateDir,
    collaborationWorkspaceRoot,
    fileStore,
    groupStorage,
    metadataStorage,
    memoryStorage,
    learningStorage,
    objectStorage,
  } = createWorkspaceCollaborationStores();
  const [profile, members, existingGroupCapabilities] = await Promise.all([
    groupStorage.readProfile(params.groupId),
    groupStorage.readMembers(params.groupId),
    metadataStorage.readGroupCapabilities(params.groupId),
  ]);
  if (!profile && members.length === 0) {
    throw new Error(`协作小组不存在：${params.groupId}`);
  }
  const ownerUserId = resolveEffectiveGroupOwnerUserId({
    profile,
    members,
  });
  const actor = normalizeValue(params.actor);
  if (!ownerUserId) {
    throw new Error("当前协作小组尚未绑定群主，无法解散");
  }
  if (!actor || actor !== ownerUserId) {
    throw new Error("只有群主才能解散协作小组");
  }
  const currentLifecycle = normalizeValue(profile?.lifecycleStatus)?.toUpperCase();
  if (currentLifecycle === "ARCHIVED") {
    throw new Error("该协作小组已解散");
  }
  const title =
    normalizeValue(profile?.displayName) ?? normalizeValue(profile?.groupCode) ?? params.groupId;
  const notifiedUserIds = members
    .filter(
      (member) =>
        member.memberKind === "human" &&
        member.status !== "removed" &&
        member.status !== "revoked" &&
        normalizeValue(member.userId),
    )
    .map((member) => normalizeValue(member.userId) as string)
    .filter((userId) => userId !== actor);
  const dissolvedAtMs = Date.now();
  const nextMembers = members.map((member) =>
    member.status === "removed" || member.status === "revoked"
      ? member
      : {
          ...member,
          status: "removed" as const,
          updatedAtMs: dissolvedAtMs,
        },
  );
  const profileSnapshot = workspaceProfileSnapshot(profile);
  await ensureWorkspaceSpaceProfile({
    groupStorage,
    groupId: params.groupId,
    title,
    avatar: profileSnapshot.avatar,
    ownerUserId,
    coordinatorBotId: profileSnapshot.coordinatorBotId,
    purpose: profileSnapshot.purpose,
    currentMission: profileSnapshot.currentMission,
    successCriteria: profileSnapshot.successCriteria,
    collaborationMode: profileSnapshot.collaborationMode,
    workspacePath: profileSnapshot.workspacePath,
    finalDecisionPolicy: profileSnapshot.finalDecisionPolicy,
    lifecycleStatus: "archived",
  });
  await groupStorage.writeMembers(params.groupId, nextMembers);
  await writeGroupBootstrapState({
    groupId: params.groupId,
    title,
    profile: {
      ...(toGroupProfile(profile) ?? {
        groupId: params.groupId,
        groupCode: params.groupId,
        displayName: title,
        createdAtMs: dissolvedAtMs,
        updatedAtMs: dissolvedAtMs,
      }),
      lifecycleStatus: "archived",
    },
    members: nextMembers,
    metadataStorage,
    memoryStorage,
    learningStorage,
    requestedSystemInstructions: existingGroupCapabilities?.systemInstructions,
    requestedConfidentialityTier: existingGroupCapabilities?.confidentialityTier,
  });
  const rebuiltProfile = await groupStorage.readProfile(params.groupId);
  await persistRosterAuthViaSharedCas({
    groupId: params.groupId,
    profile: rebuiltProfile,
    members: nextMembers,
  });
  const groupCapabilities = await metadataStorage.readGroupCapabilities(params.groupId);
  const operatingState = await syncGroupOperatingState({
    fileStore,
    groupStorage,
    metadataStorage,
    memoryStorage,
    learningStorage,
    objectStorage,
    groupId: params.groupId,
    titleFallback: title,
  });
  const sessionCleanup = await resetCollaborationGroupSessionData(stateDir, params.groupId);
  const notificationMessage = `协作小组「${title}」已被群主解散。`;
  return {
    dissolved: true,
    groupId: params.groupId,
    title,
    dissolvedAtMs,
    notifiedUserIds,
    notificationMessage,
    actor,
    deleted: {
      sessionEntries: sessionCleanup.removedSessionEntries,
      transcriptFiles: sessionCleanup.removedTranscriptFiles,
    },
    space: buildWorkspaceSpaceSnapshot({
      groupId: params.groupId,
      profile: rebuiltProfile,
      groupCapabilities,
      operatingState,
      members: nextMembers,
      ...(collaborationWorkspaceRoot
        ? {
            workspacePath:
              normalizeValue(rebuiltProfile?.workspacePath) ??
              resolveGroupCollaborationPaths(params.groupId).workspacePath,
          }
        : {}),
    }),
  };
}

export async function leaveGatewayCollaborationSpace(
  params: GatewayCollaborationSpaceLeaveParams & { actor?: string },
) {
  const {
    collaborationWorkspaceRoot,
    fileStore,
    groupStorage,
    metadataStorage,
    memoryStorage,
    learningStorage,
    objectStorage,
  } = createWorkspaceCollaborationStores();
  const [profile, members, existingGroupCapabilities] = await Promise.all([
    groupStorage.readProfile(params.groupId),
    groupStorage.readMembers(params.groupId),
    metadataStorage.readGroupCapabilities(params.groupId),
  ]);
  if (!profile && members.length === 0) {
    throw new Error(`协作小组不存在：${params.groupId}`);
  }
  const actor = normalizeValue(params.actor);
  if (!actor) {
    throw new Error("缺少成员身份，无法退出协作小组");
  }
  const ownerUserId = resolveEffectiveGroupOwnerUserId({
    profile,
    members,
  });
  if (ownerUserId && actor === ownerUserId) {
    throw new Error("你当前是该协作小组的管理员，请先移交管理权再退出");
  }
  const actorMember = members.find(
    (member) =>
      member.memberKind === "human" &&
      normalizeValue(member.userId) === actor &&
      member.status !== "removed" &&
      member.status !== "revoked",
  );
  if (!actorMember) {
    throw new Error("你不是该协作小组成员，无法执行退出");
  }
  const nextMembers = members.map((member) =>
    member === actorMember
      ? {
          ...member,
          status: "removed" as const,
          updatedAtMs: Date.now(),
        }
      : member,
  );
  await groupStorage.writeMembers(params.groupId, nextMembers);
  const title =
    normalizeValue(profile?.displayName) ?? normalizeValue(profile?.groupCode) ?? params.groupId;
  await writeGroupBootstrapState({
    groupId: params.groupId,
    title,
    profile,
    members: nextMembers,
    metadataStorage,
    memoryStorage,
    learningStorage,
    requestedSystemInstructions: existingGroupCapabilities?.systemInstructions,
    requestedConfidentialityTier: existingGroupCapabilities?.confidentialityTier,
  });
  await persistRosterAuthViaSharedCas({
    groupId: params.groupId,
    profile,
    members: nextMembers,
  });
  const groupCapabilities = await metadataStorage.readGroupCapabilities(params.groupId);
  const operatingState = await syncGroupOperatingState({
    fileStore,
    groupStorage,
    metadataStorage,
    memoryStorage,
    learningStorage,
    objectStorage,
    groupId: params.groupId,
    titleFallback: title,
  });
  return {
    left: true,
    groupId: params.groupId,
    actor,
    space: buildWorkspaceSpaceSnapshot({
      groupId: params.groupId,
      profile,
      groupCapabilities,
      operatingState,
      members: nextMembers,
      ...(collaborationWorkspaceRoot
        ? {
            workspacePath:
              normalizeValue(profile?.workspacePath) ??
              resolveGroupCollaborationPaths(params.groupId).workspacePath,
          }
        : {}),
    }),
  };
}

export async function transferGatewayCollaborationSpaceOwnership(
  params: GatewayCollaborationSpaceOwnershipTransferParams & { actor?: string },
) {
  const {
    collaborationWorkspaceRoot,
    fileStore,
    groupStorage,
    metadataStorage,
    memoryStorage,
    learningStorage,
    objectStorage,
  } = createWorkspaceCollaborationStores();
  const [profile, members, existingGroupCapabilities] = await Promise.all([
    groupStorage.readProfile(params.groupId),
    groupStorage.readMembers(params.groupId),
    metadataStorage.readGroupCapabilities(params.groupId),
  ]);
  if (!profile && members.length === 0) {
    throw new Error(`协作小组不存在：${params.groupId}`);
  }
  const actor = normalizeValue(params.actor);
  const currentOwnerUserId = resolveEffectiveGroupOwnerUserId({
    profile,
    members,
  });
  if (!actor || !currentOwnerUserId || actor !== currentOwnerUserId) {
    throw new Error("只有当前管理员才能移交协作小组管理权");
  }
  const nextOwnerUserId = normalizeValue(params.newOwnerUserId);
  if (!nextOwnerUserId) {
    throw new Error("缺少新的管理员成员");
  }
  const targetMember = members.find(
    (member) =>
      member.memberKind === "human" &&
      normalizeValue(member.userId) === nextOwnerUserId &&
      member.status === "active",
  );
  if (!targetMember) {
    throw new Error("新的管理员必须是当前协作小组中的活跃真人成员");
  }
  await groupStorage.writeMembers(params.groupId, applyGroupOwnerRole(members, nextOwnerUserId));
  const title =
    normalizeValue(profile?.displayName) ?? normalizeValue(profile?.groupCode) ?? params.groupId;
  const profileSnapshot = workspaceProfileSnapshot(profile);
  await ensureWorkspaceSpaceProfile({
    groupStorage,
    groupId: params.groupId,
    title,
    avatar: profileSnapshot.avatar,
    visibilityScope: profileSnapshot.visibilityScope,
    ownerUserId: nextOwnerUserId,
    coordinatorBotId: profileSnapshot.coordinatorBotId,
    purpose: profileSnapshot.purpose,
    currentMission: profileSnapshot.currentMission,
    successCriteria: profileSnapshot.successCriteria,
    collaborationMode: profileSnapshot.collaborationMode,
    workspacePath: profileSnapshot.workspacePath,
    finalDecisionPolicy: profileSnapshot.finalDecisionPolicy,
  });
  await writeGroupBootstrapState({
    groupId: params.groupId,
    title,
    profile: await groupStorage.readProfile(params.groupId),
    members: await groupStorage.readMembers(params.groupId),
    metadataStorage,
    memoryStorage,
    learningStorage,
    requestedSystemInstructions: existingGroupCapabilities?.systemInstructions,
    requestedConfidentialityTier: existingGroupCapabilities?.confidentialityTier,
  });
  const ownership =
    listOwnershipRecords().find(
      (entry) =>
        entry.subjectKind === "group" &&
        entry.subjectId === params.groupId &&
        entry.bindingStatus !== "revoked",
    ) ?? null;
  if (ownership) {
    transferOwnershipRecord({
      tenantId: ownership.tenantId,
      subjectKind: "group",
      subjectId: params.groupId,
      newPositionId: ownership.positionId,
      newPositionLabel: ownership.positionLabel,
      transferredByUserId: currentOwnerUserId,
      transferredByUserLabel: currentOwnerUserId,
      newCurrentManagerUserId: nextOwnerUserId,
      newCurrentManagerLabel: normalizeValue(params.newOwnerLabel) ?? nextOwnerUserId,
    });
  }
  await persistRosterAuthViaSharedCas({
    groupId: params.groupId,
    profile: await groupStorage.readProfile(params.groupId),
    members: await groupStorage.readMembers(params.groupId),
  });
  const groupCapabilities = await metadataStorage.readGroupCapabilities(params.groupId);
  const operatingState = await syncGroupOperatingState({
    fileStore,
    groupStorage,
    metadataStorage,
    memoryStorage,
    learningStorage,
    objectStorage,
    groupId: params.groupId,
    titleFallback: title,
  });
  return {
    transferred: true,
    groupId: params.groupId,
    previousOwnerUserId: currentOwnerUserId,
    newOwnerUserId: nextOwnerUserId,
    space: buildWorkspaceSpaceSnapshot({
      groupId: params.groupId,
      profile: await groupStorage.readProfile(params.groupId),
      groupCapabilities,
      operatingState,
      members: await groupStorage.readMembers(params.groupId),
      ...(collaborationWorkspaceRoot
        ? {
            workspacePath:
              normalizeValue(profile?.workspacePath) ??
              resolveGroupCollaborationPaths(params.groupId).workspacePath,
          }
        : {}),
    }),
  };
}
