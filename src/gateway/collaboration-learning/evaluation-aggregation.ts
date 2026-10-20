import type { Decision, Deliverable, Review, Task } from "@openbot/collaboration-core";
import {
  createWorkspaceCollaborationStores,
  ensureWorkspaceGroupBootstrapArtifacts,
} from "./shared.js";
import type {
  GatewayCollaborationLearningSnapshot,
  GatewayCollaborationLearningSnapshotParams,
} from "./snapshot-types.js";

export async function loadGatewayCollaborationLearningSnapshot(
  params: GatewayCollaborationLearningSnapshotParams,
): Promise<GatewayCollaborationLearningSnapshot> {
  const {
    stateDir,
    fileStore,
    groupStorage,
    learningStorage,
    memoryStorage,
    metadataStorage,
    objectStorage,
  } = createWorkspaceCollaborationStores();

  const bootstrapState = await ensureWorkspaceGroupBootstrapArtifacts({
    stateDir,
    fileStore,
    groupStorage,
    metadataStorage,
    memoryStorage,
    learningStorage,
    objectStorage,
    groupId: params.groupId,
  });

  const [
    participationOverlays,
    participations,
    capsules,
    projections,
    assets,
    tasks,
    deliverables,
    reviews,
    decisions,
  ] = await Promise.all([
    metadataStorage.readParticipationOverlays(params.groupId),
    groupStorage.readParticipations(params.groupId),
    learningStorage.readCapsules(params.groupId),
    learningStorage.readProjections(params.groupId),
    learningStorage.readLearningAssets(params.groupId),
    objectStorage.listObjects<Task>(params.groupId, "task"),
    objectStorage.listObjects<Deliverable>(params.groupId, "deliverable"),
    objectStorage.listObjects<Review>(params.groupId, "review"),
    objectStorage.listObjects<Decision>(params.groupId, "decision"),
  ]);

  const botId = params.botId?.trim() || null;
  const filteredParticipations = botId
    ? participations.filter((entry) => entry.botId === botId)
    : participations;
  const filteredOverlays = botId
    ? participationOverlays.filter((entry) => entry.botId === botId)
    : participationOverlays;
  const filteredProjections = botId
    ? projections.filter((entry) => entry.targetBotId === botId)
    : projections;
  const filteredAssets = botId ? assets.filter((entry) => entry.botId === botId) : assets;

  return {
    groupId: params.groupId,
    ...(botId ? { botId } : {}),
    groupCapabilities: bootstrapState.groupCapabilities,
    groupOperatingState: bootstrapState.operatingState,
    participations: filteredParticipations,
    participationOverlays: filteredOverlays,
    capsules,
    projections: filteredProjections,
    assets: filteredAssets,
    tasks,
    deliverables,
    reviews,
    decisions,
  };
}
