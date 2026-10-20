import { materializeGroupCollaborationWorkspace } from "./collaboration-paths.js";
import { syncGroupCharter } from "./group-charter.js";
import {
  isOnboardingIntroductionMission,
  suggestWorkMissionAfterOnboarding,
} from "./mission-phase.js";
import {
  createWorkspaceCollaborationStores,
  ensureWorkspaceSpaceProfile,
  normalizeValue,
  readGroupOperatingState,
  writeGroupOperatingState,
} from "./shared.js";

export async function advanceCollaborationGroupMissionFromOnboarding(params: {
  groupId: string;
  actor?: string;
}) {
  const groupId = params.groupId.trim();
  if (!groupId) {
    throw new Error("groupId is required");
  }
  const { fileStore, groupStorage } = createWorkspaceCollaborationStores();
  await materializeGroupCollaborationWorkspace(groupId);
  const [profile, existingState] = await Promise.all([
    groupStorage.readProfile(groupId),
    readGroupOperatingState({ fileStore, groupId }),
  ]);
  if (!existingState) {
    throw new Error(`operating state not found for group ${groupId}`);
  }
  const previousMission =
    normalizeValue(existingState.activeContext?.currentMission) ??
    normalizeValue(existingState.groupProfile?.currentMission) ??
    normalizeValue(profile?.currentMission);
  if (!isOnboardingIntroductionMission(previousMission)) {
    return {
      groupId,
      previousMission: previousMission ?? null,
      currentMission: previousMission ?? null,
      advanced: false as const,
    };
  }

  const nextMission = suggestWorkMissionAfterOnboarding();
  const now = Date.now();
  const nextState = {
    ...existingState,
    groupProfile: {
      ...existingState.groupProfile,
      currentMission: nextMission,
    },
    activeContext: {
      ...existingState.activeContext,
      currentMission: nextMission,
      summary: `使命：${nextMission}；阶段：${existingState.activeContext?.currentOperatingPhase ?? "explore"}`,
      updatedAtMs: now,
    },
    updatedAtMs: now,
  };
  await writeGroupOperatingState({ fileStore, groupId, state: nextState });
  await ensureWorkspaceSpaceProfile({
    groupStorage,
    groupId,
    currentMission: nextMission,
  });
  await syncGroupCharter({
    fileStore,
    groupStorage,
    groupId,
    operatingState: nextState,
  });

  return {
    groupId,
    previousMission: previousMission ?? null,
    currentMission: nextMission,
    advanced: true as const,
    actor: params.actor ?? null,
  };
}
