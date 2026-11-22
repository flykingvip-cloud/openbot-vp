import type { CollaborationMember, GroupProfile } from "@openbot/collaboration-core";

export function normalizeValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function isParticipatingCollaborationMember(member: CollaborationMember): boolean {
  const status = normalizeValue(member.status)?.toLowerCase();
  if (status === "removed" || status === "revoked") {
    return false;
  }
  return !status || status === "active" || status === "paused";
}

export function countParticipatingCollaborationMembers(members: CollaborationMember[]): number {
  return members.filter(isParticipatingCollaborationMember).length;
}

export function isArchivedCollaborationGroupProfile(
  profile: GroupProfile | null | undefined,
): boolean {
  return normalizeValue(profile?.lifecycleStatus)?.toLowerCase() === "archived";
}

export function shouldAutoArchiveCollaborationSpaceWhenVacant(params: {
  profile: GroupProfile | null | undefined;
  previousMembers: CollaborationMember[];
  nextMembers: CollaborationMember[];
}): boolean {
  if (isArchivedCollaborationGroupProfile(params.profile)) {
    return false;
  }
  const previousCount = countParticipatingCollaborationMembers(params.previousMembers);
  const nextCount = countParticipatingCollaborationMembers(params.nextMembers);
  return previousCount > 0 && nextCount === 0;
}

/** Prefer managed mirror when it already shows a vacant roster but runtime storage is stale. */
export function resolveMembersForVacancyHeal(params: {
  runtimeMembers: CollaborationMember[];
  managedMembers: CollaborationMember[] | null;
}): CollaborationMember[] {
  const runtimeParticipating = countParticipatingCollaborationMembers(params.runtimeMembers);
  if (runtimeParticipating === 0) {
    return params.runtimeMembers;
  }
  if (
    params.managedMembers &&
    countParticipatingCollaborationMembers(params.managedMembers) === 0
  ) {
    return params.managedMembers;
  }
  return params.runtimeMembers;
}

export function shouldHealVacantCollaborationSpaceOnList(params: {
  profile: GroupProfile | null | undefined;
  members: CollaborationMember[];
}): boolean {
  if (isArchivedCollaborationGroupProfile(params.profile)) {
    return false;
  }
  if (countParticipatingCollaborationMembers(params.members) > 0) {
    return false;
  }
  return Boolean(params.profile) || params.members.length > 0;
}

export function resolveEffectiveGroupOwnerUserId(params: {
  profile?: GroupProfile | null;
  members: CollaborationMember[];
}): string | null {
  const explicitOwner = normalizeValue(params.profile?.ownerUserId);
  if (explicitOwner) {
    return explicitOwner;
  }
  const ownerMember = params.members.find(
    (member) =>
      member.memberKind === "human" &&
      member.governanceRole === "owner" &&
      member.status !== "removed" &&
      member.status !== "revoked" &&
      normalizeValue(member.userId),
  );
  const ownerUserId = normalizeValue(ownerMember?.userId);
  if (ownerUserId) {
    return ownerUserId;
  }
  const activeHumans = params.members.filter(
    (member) =>
      member.memberKind === "human" && member.status === "active" && normalizeValue(member.userId),
  );
  if (activeHumans.length === 1) {
    return normalizeValue(activeHumans[0]?.userId);
  }
  return null;
}

export function resolveNextGroupOwnerUserId(params: {
  profile?: GroupProfile | null;
  existingMembers: CollaborationMember[];
  nextMembers: CollaborationMember[];
  actor?: string;
  actorEmployeeUserId?: string;
}): string | null {
  const nextHumanIds = new Set(
    params.nextMembers
      .filter((member) => member.memberKind === "human" && member.status === "active")
      .map((member) => normalizeValue(member.userId))
      .filter(Boolean) as string[],
  );
  const currentOwner = resolveEffectiveGroupOwnerUserId({
    profile: params.profile,
    members: params.existingMembers,
  });
  if (currentOwner && nextHumanIds.has(currentOwner)) {
    return currentOwner;
  }
  for (const identity of [
    normalizeValue(params.actorEmployeeUserId),
    normalizeValue(params.actor),
  ]) {
    if (identity && nextHumanIds.has(identity)) {
      return identity;
    }
  }
  if (nextHumanIds.size === 1) {
    return [...nextHumanIds][0] ?? null;
  }
  return null;
}

export function applyGroupOwnerRole(members: CollaborationMember[], ownerUserId: string | null) {
  const normalizedOwnerUserId = normalizeValue(ownerUserId);
  return members.map((member) => {
    if (member.memberKind !== "human") {
      return member;
    }
    const memberUserId = normalizeValue(member.userId);
    if (normalizedOwnerUserId && memberUserId === normalizedOwnerUserId) {
      return {
        ...member,
        governanceRole: "owner",
      } satisfies CollaborationMember;
    }
    if (member.governanceRole === "owner") {
      return {
        ...member,
        governanceRole: "member",
      } satisfies CollaborationMember;
    }
    return member;
  });
}

export function cloneMembersForReset(members: CollaborationMember[], ownerUserId: string | null) {
  const now = Date.now();
  const preserved = members
    .filter((member) => member.status !== "removed" && member.status !== "revoked")
    .map((member) => ({
      ...member,
      updatedAtMs: now,
    }));
  return applyGroupOwnerRole(preserved, ownerUserId);
}
