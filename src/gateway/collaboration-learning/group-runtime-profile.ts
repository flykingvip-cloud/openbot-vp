import type { GroupCapabilityProfile, GroupProfile } from "@openbot/collaboration-core";
import type { GroupCharterDocument } from "./group-charter-types.js";
import { loadGroupCharterForRuntime } from "./group-charter.js";
import { createWorkspaceCollaborationStores, normalizeStringList } from "./shared.js";

export function appendUniqueInstructionLines(
  existing: string[] | null | undefined,
  extras: readonly string[],
): string[] {
  const next = normalizeStringList(existing);
  const seen = new Set(next);
  for (const raw of extras) {
    const line = raw.trim();
    if (!line || seen.has(line)) {
      continue;
    }
    seen.add(line);
    next.push(line);
  }
  return next;
}

export function appendCharterParticipationInstructions(
  instructions: string[] | null | undefined,
  charter: GroupCharterDocument | null | undefined,
): string[] {
  const base = normalizeStringList(instructions);
  if (!charter || charter.lifecycleStatus === "ARCHIVED") {
    return base;
  }
  const extras = [
    ...charter.participationPolicy.whenToSpeak,
    ...charter.participationPolicy.lowQualityBehaviors.map((line) => `避免：${line}`),
  ];
  return appendUniqueInstructionLines(base, extras);
}

export function composeCollaborationGroupProfileFromDisk(params: {
  groupId: string;
  profile?: GroupProfile | null;
  capabilities?: GroupCapabilityProfile | null;
}): GroupCapabilityProfile | undefined {
  const profile = params.profile ?? null;
  const capabilities = params.capabilities ?? null;
  if (!profile && !capabilities) {
    return undefined;
  }

  const groupId =
    capabilities?.groupId?.trim() || profile?.groupId?.trim() || params.groupId.trim();
  if (!groupId) {
    return undefined;
  }

  const systemInstructions = normalizeStringList(capabilities?.systemInstructions);
  const enabledSkills = normalizeStringList(capabilities?.enabledSkills);
  const blockedSkills = normalizeStringList(capabilities?.blockedSkills);

  return {
    groupId,
    ...(profile?.groupCode ? { groupCode: profile.groupCode } : {}),
    ...(profile?.displayName ? { displayName: profile.displayName } : {}),
    ...(profile?.avatar ? { avatar: profile.avatar } : {}),
    ...(profile?.visibilityScope ? { visibilityScope: profile.visibilityScope } : {}),
    ...(profile?.groupType ? { groupType: profile.groupType } : {}),
    ...(profile?.lifecycleStatus ? { lifecycleStatus: profile.lifecycleStatus } : {}),
    ...(profile?.ownerUserId ? { ownerUserId: profile.ownerUserId } : {}),
    ...(profile?.coordinatorBotId ? { coordinatorBotId: profile.coordinatorBotId } : {}),
    ...(profile?.purpose ? { purpose: profile.purpose } : {}),
    ...(profile?.currentMission ? { currentMission: profile.currentMission } : {}),
    ...(profile?.successCriteria ? { successCriteria: profile.successCriteria } : {}),
    ...(profile?.exitCriteria ? { exitCriteria: profile.exitCriteria } : {}),
    ...(profile?.collaborationMode ? { collaborationMode: profile.collaborationMode } : {}),
    ...(profile?.finalDecisionPolicy ? { finalDecisionPolicy: profile.finalDecisionPolicy } : {}),
    ...(profile?.directoryBindingId ? { directoryBindingId: profile.directoryBindingId } : {}),
    ...(profile?.createdAtMs ? { createdAtMs: profile.createdAtMs } : {}),
    ...(enabledSkills.length > 0 ? { enabledSkills } : {}),
    ...(capabilities?.requiredSkillSets
      ? { requiredSkillSets: capabilities.requiredSkillSets }
      : {}),
    ...(blockedSkills.length > 0 ? { blockedSkills } : {}),
    ...(systemInstructions.length > 0 ? { systemInstructions } : {}),
    ...(capabilities?.confidentialityTier
      ? { confidentialityTier: capabilities.confidentialityTier }
      : {}),
    updatedAtMs: Math.max(profile?.updatedAtMs ?? 0, capabilities?.updatedAtMs ?? 0, 1),
  };
}

export function mergeCollaborationGroupProfiles(
  session?: GroupCapabilityProfile | null,
  disk?: GroupCapabilityProfile | null,
): GroupCapabilityProfile | undefined {
  if (!session && !disk) {
    return undefined;
  }
  if (!disk) {
    return session ?? undefined;
  }
  if (!session) {
    return disk;
  }

  const diskInstructions = normalizeStringList(disk.systemInstructions);
  const sessionInstructions = normalizeStringList(session.systemInstructions);

  return {
    ...session,
    ...disk,
    systemInstructions: diskInstructions.length > 0 ? diskInstructions : sessionInstructions,
    updatedAtMs: Math.max(session.updatedAtMs ?? 0, disk.updatedAtMs ?? 0),
  };
}

export async function loadCollaborationGroupProfileForRuntime(
  groupId: string,
): Promise<GroupCapabilityProfile | undefined> {
  const trimmed = groupId.trim();
  if (!trimmed) {
    return undefined;
  }

  const { groupStorage, metadataStorage } = createWorkspaceCollaborationStores();
  const [profile, capabilities] = await Promise.all([
    groupStorage.readProfile(trimmed),
    metadataStorage.readGroupCapabilities(trimmed),
  ]);
  return composeCollaborationGroupProfileFromDisk({
    groupId: trimmed,
    profile,
    capabilities,
  });
}

export async function resolveCollaborationGroupProfileForRuntime(params: {
  groupId?: string | null;
  sessionProfile?: GroupCapabilityProfile | null;
}): Promise<GroupCapabilityProfile | undefined> {
  const groupId = params.groupId?.trim();
  const sessionProfile = params.sessionProfile ?? undefined;
  if (!groupId) {
    return sessionProfile;
  }
  const [diskProfile, charter] = await Promise.all([
    loadCollaborationGroupProfileForRuntime(groupId),
    loadGroupCharterForRuntime(groupId),
  ]);
  const merged = mergeCollaborationGroupProfiles(sessionProfile, diskProfile);
  if (!merged) {
    return undefined;
  }
  // Prompt-only enrich. Do not write charter back as the session SoT.
  const systemInstructions = appendCharterParticipationInstructions(
    merged.systemInstructions,
    charter,
  );
  return {
    ...merged,
    ...(systemInstructions.length > 0 ? { systemInstructions } : {}),
  };
}
