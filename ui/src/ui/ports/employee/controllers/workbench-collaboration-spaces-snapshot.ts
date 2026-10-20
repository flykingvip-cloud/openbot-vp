import type {
  CollaborationSpaceBotMemberTransport,
  CollaborationSpaceHumanMemberTransport,
  CollaborationSpaceMemberRosterTransport,
  CollaborationSpacesListResult,
} from "../../../types.ts";
import type {
  WorkbenchCollaborationBotMemberSnapshot,
  WorkbenchCollaborationHumanMemberSnapshot,
  WorkbenchCollaborationMemberRosterSnapshot,
  WorkbenchCollaborationSpaceSnapshot,
  WorkbenchCollaborationSpacesSnapshot,
} from "../views/workbench-types.ts";

function normalizeValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeKey(value: string | null | undefined) {
  return normalizeValue(value)?.toLowerCase() ?? null;
}

export function isArchivedWorkbenchCollaborationSpace(
  space: Pick<WorkbenchCollaborationSpaceSnapshot, "operatingState">,
): boolean {
  return normalizeKey(space.operatingState?.groupProfile?.lifecycleStatus) === "archived";
}

function isPresent<T>(value: T | null): value is T {
  return value != null;
}

function buildHumanMemberSnapshot(
  member: CollaborationSpaceHumanMemberTransport,
): WorkbenchCollaborationHumanMemberSnapshot | null {
  const userId = normalizeValue(member.userId);
  if (!userId) {
    return null;
  }
  return {
    userId,
    name: normalizeValue(member.name),
    handle: normalizeValue(member.handle),
    status: normalizeValue(member.status),
    presenceStatus:
      member.presenceStatus === "online" || member.presenceStatus === "offline"
        ? member.presenceStatus
        : null,
    lastActiveAt: normalizeValue(member.lastActiveAt),
  };
}

function buildBotMemberSnapshot(
  member: CollaborationSpaceBotMemberTransport,
): WorkbenchCollaborationBotMemberSnapshot | null {
  const agentId = normalizeValue(member.agentId);
  if (!agentId) {
    return null;
  }
  return {
    agentId,
    name: normalizeValue(member.name),
    status: normalizeValue(member.status),
    runtimeStatus: member.runtimeStatus ?? null,
    lastActiveAt: normalizeValue(member.lastActiveAt),
    currentTask: normalizeValue(member.currentTask),
    openTaskCount:
      typeof member.openTaskCount === "number" && Number.isFinite(member.openTaskCount)
        ? member.openTaskCount
        : null,
  };
}

function buildRosterSnapshot(
  roster: CollaborationSpaceMemberRosterTransport | null | undefined,
): WorkbenchCollaborationMemberRosterSnapshot {
  return {
    humans: (roster?.humans ?? [])
      .map((member) => buildHumanMemberSnapshot(member))
      .filter(isPresent),
    bots: (roster?.bots ?? []).map((member) => buildBotMemberSnapshot(member)).filter(isPresent),
  };
}

export function buildWorkbenchCollaborationSpacesSnapshot(
  spacesResult: CollaborationSpacesListResult | null | undefined,
): WorkbenchCollaborationSpacesSnapshot {
  const archivedGroupIds = (spacesResult?.archivedGroupIds ?? [])
    .map((entry) => normalizeValue(entry))
    .filter(Boolean) as string[];
  return {
    archivedGroupIds,
    spaces: (spacesResult?.spaces ?? [])
      .map((space) => {
        const id = normalizeValue(space.id) ?? normalizeValue(space.groupId);
        if (!id) {
          return null;
        }
        return {
          id,
          groupId: normalizeValue(space.groupId),
          title: normalizeValue(space.title),
          avatar: normalizeValue(space.avatar),
          visibilityScope:
            normalizeValue(space.operatingState?.groupProfile?.visibilityScope) ??
            normalizeValue(space.visibilityScope),
          ownerUserId: normalizeValue(space.ownerUserId),
          purpose: normalizeValue(space.purpose),
          currentMission: normalizeValue(space.currentMission),
          collaborationMode: normalizeValue(space.collaborationMode),
          systemInstructions: (space.systemInstructions ?? [])
            .map((entry) => normalizeValue(entry))
            .filter(isPresent),
          confidentialityTier: normalizeValue(space.confidentialityTier),
          operatingState: space.operatingState ?? null,
          // P1-A5 ⑤ (BP-20): server-compiled EffectivePolicy + provenance, rendered verbatim.
          ...(space.effectivePolicy ? { effectivePolicy: space.effectivePolicy } : {}),
          members: buildRosterSnapshot(space.members),
          invites: buildRosterSnapshot(space.invites),
        };
      })
      .filter(isPresent)
      .filter((space) => !isArchivedWorkbenchCollaborationSpace(space)),
  };
}
