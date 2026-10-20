import type {
  AgentLearningAsset,
  BotParticipationProfile,
  CollaborationBinding,
  CollaborationMember,
  GroupMemoryCapsule,
  GroupProfile,
  GroupCapabilityProfile,
  LearningProjection,
  ParticipationCapabilityOverlay,
} from "@openbot/collaboration-core";

export interface GroupStorageAdapter {
  readProfile(groupId: string): Promise<GroupProfile | null>;
  writeProfile(profile: GroupProfile): Promise<void>;
  readMembers(groupId: string): Promise<CollaborationMember[]>;
  writeMembers(groupId: string, members: CollaborationMember[]): Promise<void>;
  readBindings(groupId: string): Promise<CollaborationBinding[]>;
  writeBindings(groupId: string, bindings: CollaborationBinding[]): Promise<void>;
  readParticipations(groupId: string): Promise<BotParticipationProfile[]>;
  writeParticipations(groupId: string, participations: BotParticipationProfile[]): Promise<void>;
}

export interface ObjectStorageAdapter {
  readObject<T>(groupId: string, objectType: string, objectId: string): Promise<T | null>;
  writeObject<T>(groupId: string, objectType: string, objectId: string, data: T): Promise<void>;
  listObjects<T>(groupId: string, objectType: string): Promise<T[]>;
  deleteObject(groupId: string, objectType: string, objectId: string): Promise<void>;
}

export interface MemoryStorageAdapter {
  readMemories<T>(groupId: string): Promise<T[]>;
  writeMemories<T>(groupId: string, memories: T[]): Promise<void>;
  appendMemory<T>(groupId: string, memory: T): Promise<void>;
}

export interface LearningStorageAdapter {
  readCapsules(groupId: string): Promise<GroupMemoryCapsule[]>;
  writeCapsules(groupId: string, capsules: GroupMemoryCapsule[]): Promise<void>;
  appendCapsule(groupId: string, capsule: GroupMemoryCapsule): Promise<void>;
  readProjections(groupId: string): Promise<LearningProjection[]>;
  writeProjections(groupId: string, projections: LearningProjection[]): Promise<void>;
  appendProjection(groupId: string, projection: LearningProjection): Promise<void>;
  readLearningAssets(groupId: string, botId?: string): Promise<AgentLearningAsset[]>;
  writeLearningAssets(groupId: string, assets: AgentLearningAsset[]): Promise<void>;
  appendLearningAsset(groupId: string, asset: AgentLearningAsset): Promise<void>;
}

export interface MetadataStorageAdapter {
  readHealth<T>(groupId: string): Promise<T | null>;
  writeHealth<T>(groupId: string, health: T): Promise<void>;
  readTemplate<T>(groupId: string): Promise<T | null>;
  writeTemplate<T>(groupId: string, template: T): Promise<void>;
  readGroupCapabilities(groupId: string): Promise<GroupCapabilityProfile | null>;
  writeGroupCapabilities(groupId: string, capabilities: GroupCapabilityProfile): Promise<void>;
  readParticipationOverlays(groupId: string): Promise<ParticipationCapabilityOverlay[]>;
  writeParticipationOverlays(
    groupId: string,
    overlays: ParticipationCapabilityOverlay[],
  ): Promise<void>;
}
