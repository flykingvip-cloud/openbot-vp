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
import type {
  GroupStorageAdapter,
  LearningStorageAdapter,
  MemoryStorageAdapter,
  MetadataStorageAdapter,
  ObjectStorageAdapter,
} from "./interfaces.js";

type StoredRecord = Record<string, unknown>;

type ManagedSpaceLike = StoredRecord & {
  id: string;
  name: string;
  groupId?: string;
  groupCode?: string;
  displayName?: string;
  avatar?: string;
  visibilityScope?: string;
  groupType?: string;
  lifecycleStatus?: string;
  ownerUserId?: string;
  coordinatorBotId?: string;
  purpose?: string;
  currentMission?: string;
  successCriteria?: string[];
  exitCriteria?: string[];
  collaborationMode?: string;
  finalDecisionPolicy?: GroupProfile["finalDecisionPolicy"];
  directoryBindingId?: string;
  workspacePath?: string;
  createdAtMs: number;
  updatedAtMs: number;
};

type GroupFileReader = <T>(params: {
  groupId: string;
  filename: string;
  baseDir?: string;
}) => Promise<T | null>;

type GroupFileWriter = (params: {
  groupId: string;
  filename: string;
  data: unknown;
  baseDir?: string;
}) => Promise<void>;

type GroupStoreFunctions = {
  loadGroupProfile: (groupId: string, baseDir?: string) => Promise<ManagedSpaceLike | null>;
  saveGroupProfile: (space: ManagedSpaceLike, baseDir?: string) => Promise<void>;
  loadGroupMembers: (groupId: string, baseDir?: string) => Promise<CollaborationMember[]>;
  saveGroupMembers: (
    groupId: string,
    members: CollaborationMember[],
    baseDir?: string,
  ) => Promise<void>;
  loadGroupBindings: (groupId: string, baseDir?: string) => Promise<CollaborationBinding[]>;
  saveGroupBindings: (
    groupId: string,
    bindings: CollaborationBinding[],
    baseDir?: string,
  ) => Promise<void>;
  loadGroupParticipations: (
    groupId: string,
    baseDir?: string,
  ) => Promise<BotParticipationProfile[]>;
  saveGroupParticipations: (
    groupId: string,
    participations: BotParticipationProfile[],
    baseDir?: string,
  ) => Promise<void>;
};

type FileStoreFunctions = {
  readGroupFile: GroupFileReader;
  writeGroupFile: GroupFileWriter;
};

type ObjectSpec = {
  filename: string;
  collectionKey?: string;
  idKey: string;
};

const OBJECT_SPECS: Record<string, ObjectSpec> = {
  task: { filename: "tasks.json", collectionKey: "tasks", idKey: "taskId" },
  deliverable: {
    filename: "deliverables.json",
    collectionKey: "deliverables",
    idKey: "deliverableId",
  },
  review: { filename: "reviews.json", collectionKey: "reviews", idKey: "reviewId" },
  decision: { filename: "decisions.json", idKey: "decisionId" },
  capsule: { filename: "capsules.json", collectionKey: "capsules", idKey: "capsuleId" },
  projection: {
    filename: "projections.json",
    collectionKey: "projections",
    idKey: "projectionId",
  },
  learning_asset: {
    filename: "learning-assets.json",
    collectionKey: "assets",
    idKey: "assetId",
  },
};

function toGroupProfile(space: ManagedSpaceLike): GroupProfile {
  const groupId =
    typeof space.groupId === "string" && space.groupId.trim() ? space.groupId : space.id;
  const displayName =
    typeof space.displayName === "string" && space.displayName.trim()
      ? space.displayName
      : space.name;

  return {
    groupId,
    groupCode:
      typeof space.groupCode === "string" && space.groupCode.trim() ? space.groupCode : groupId,
    displayName,
    ...(typeof space.avatar === "string" ? { avatar: space.avatar } : {}),
    ...(typeof space.visibilityScope === "string"
      ? { visibilityScope: space.visibilityScope as GroupProfile["visibilityScope"] }
      : {}),
    ...(typeof space.groupType === "string"
      ? { groupType: space.groupType as GroupProfile["groupType"] }
      : {}),
    ...(typeof space.lifecycleStatus === "string"
      ? { lifecycleStatus: space.lifecycleStatus as GroupProfile["lifecycleStatus"] }
      : {}),
    ...(typeof space.ownerUserId === "string" ? { ownerUserId: space.ownerUserId } : {}),
    ...(typeof space.coordinatorBotId === "string"
      ? { coordinatorBotId: space.coordinatorBotId }
      : {}),
    ...(typeof space.purpose === "string" ? { purpose: space.purpose } : {}),
    ...(typeof space.currentMission === "string" ? { currentMission: space.currentMission } : {}),
    ...(Array.isArray(space.successCriteria)
      ? { successCriteria: space.successCriteria.filter(isString) }
      : {}),
    ...(Array.isArray(space.exitCriteria)
      ? { exitCriteria: space.exitCriteria.filter(isString) }
      : {}),
    ...(typeof space.collaborationMode === "string"
      ? { collaborationMode: space.collaborationMode as GroupProfile["collaborationMode"] }
      : {}),
    ...(space.finalDecisionPolicy ? { finalDecisionPolicy: space.finalDecisionPolicy } : {}),
    ...(typeof space.directoryBindingId === "string"
      ? { directoryBindingId: space.directoryBindingId }
      : {}),
    ...(typeof space.workspacePath === "string" ? { workspacePath: space.workspacePath } : {}),
    createdAtMs: space.createdAtMs,
    updatedAtMs: space.updatedAtMs,
  };
}

function mergeProfileIntoSpace(
  existing: ManagedSpaceLike | null,
  profile: GroupProfile,
): ManagedSpaceLike {
  const base: ManagedSpaceLike = existing ?? {
    id: profile.groupId,
    name: profile.displayName,
    scope: "user",
    groupId: profile.groupId,
    createdAtMs: profile.createdAtMs,
    updatedAtMs: profile.updatedAtMs,
  };

  return {
    ...base,
    id: base.id || profile.groupId,
    name: profile.displayName,
    groupId: profile.groupId,
    groupCode: profile.groupCode,
    displayName: profile.displayName,
    ...(profile.avatar ? { avatar: profile.avatar } : {}),
    ...(profile.visibilityScope ? { visibilityScope: profile.visibilityScope } : {}),
    ...(profile.groupType ? { groupType: profile.groupType } : {}),
    ...(profile.lifecycleStatus ? { lifecycleStatus: profile.lifecycleStatus } : {}),
    ...(profile.ownerUserId ? { ownerUserId: profile.ownerUserId } : {}),
    ...(profile.coordinatorBotId
      ? { coordinatorBotId: profile.coordinatorBotId }
      : profile.coordinatorBotId === ""
        ? { coordinatorBotId: undefined }
        : {}),
    ...(profile.purpose ? { purpose: profile.purpose } : {}),
    ...(profile.currentMission ? { currentMission: profile.currentMission } : {}),
    ...(profile.successCriteria ? { successCriteria: profile.successCriteria } : {}),
    ...(profile.exitCriteria ? { exitCriteria: profile.exitCriteria } : {}),
    ...(profile.collaborationMode ? { collaborationMode: profile.collaborationMode } : {}),
    ...(profile.finalDecisionPolicy ? { finalDecisionPolicy: profile.finalDecisionPolicy } : {}),
    ...(profile.directoryBindingId ? { directoryBindingId: profile.directoryBindingId } : {}),
    ...(profile.workspacePath ? { workspacePath: profile.workspacePath } : {}),
    createdAtMs: existing?.createdAtMs ?? profile.createdAtMs,
    updatedAtMs: profile.updatedAtMs,
  };
}

function requireObjectSpec(objectType: string): ObjectSpec {
  const spec = OBJECT_SPECS[objectType];
  if (!spec) {
    throw new Error(`Unsupported object type: ${objectType}`);
  }
  return spec;
}

function extractCollection<T>(raw: unknown, spec: ObjectSpec): T[] {
  if (spec.collectionKey) {
    if (!raw || typeof raw !== "object") {
      return [];
    }
    const value = (raw as StoredRecord)[spec.collectionKey];
    return Array.isArray(value) ? (value as T[]) : [];
  }
  return Array.isArray(raw) ? (raw as T[]) : [];
}

function buildCollectionPayload<T>(items: T[], spec: ObjectSpec): T[] | Record<string, T[]> {
  if (!spec.collectionKey) {
    return items;
  }
  return { [spec.collectionKey]: items };
}

function readObjectId(object: unknown, idKey: string): string | null {
  if (!object || typeof object !== "object") {
    return null;
  }
  const value = (object as StoredRecord)[idKey];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function upsertCollectionObject<T>(items: T[], object: T, idKey: string): T[] {
  const objectId = readObjectId(object, idKey);
  if (!objectId) {
    throw new Error(`Object is missing required identifier: ${idKey}`);
  }
  const filtered = items.filter((entry) => readObjectId(entry, idKey) !== objectId);
  return [...filtered, object];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export class OpenBotGroupStorage implements GroupStorageAdapter {
  constructor(
    private readonly baseDir?: string,
    private readonly storeFunctions?: GroupStoreFunctions,
  ) {}

  async readProfile(groupId: string): Promise<GroupProfile | null> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    const space = await this.storeFunctions.loadGroupProfile(groupId, this.baseDir);
    return space ? toGroupProfile(space) : null;
  }

  async writeProfile(profile: GroupProfile): Promise<void> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    const existing = await this.storeFunctions.loadGroupProfile(profile.groupId, this.baseDir);
    await this.storeFunctions.saveGroupProfile(
      mergeProfileIntoSpace(existing, profile),
      this.baseDir,
    );
  }

  async readMembers(groupId: string): Promise<CollaborationMember[]> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    return this.storeFunctions.loadGroupMembers(groupId, this.baseDir);
  }

  async writeMembers(groupId: string, members: CollaborationMember[]): Promise<void> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    await this.storeFunctions.saveGroupMembers(groupId, members, this.baseDir);
  }

  async readBindings(groupId: string): Promise<CollaborationBinding[]> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    return this.storeFunctions.loadGroupBindings(groupId, this.baseDir);
  }

  async writeBindings(groupId: string, bindings: CollaborationBinding[]): Promise<void> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    await this.storeFunctions.saveGroupBindings(groupId, bindings, this.baseDir);
  }

  async readParticipations(groupId: string): Promise<BotParticipationProfile[]> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    return this.storeFunctions.loadGroupParticipations(groupId, this.baseDir);
  }

  async writeParticipations(
    groupId: string,
    participations: BotParticipationProfile[],
  ): Promise<void> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    await this.storeFunctions.saveGroupParticipations(groupId, participations, this.baseDir);
  }
}

export class OpenBotObjectStorage implements ObjectStorageAdapter {
  constructor(
    private readonly baseDir?: string,
    private readonly storeFunctions?: FileStoreFunctions,
  ) {}

  async readObject<T>(groupId: string, objectType: string, objectId: string): Promise<T | null> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    const spec = requireObjectSpec(objectType);
    const raw = await this.storeFunctions.readGroupFile({
      groupId,
      filename: spec.filename,
      baseDir: this.baseDir,
    });
    const items = extractCollection<T>(raw, spec);
    return items.find((entry) => readObjectId(entry, spec.idKey) === objectId) ?? null;
  }

  async writeObject<T>(
    groupId: string,
    objectType: string,
    objectId: string,
    data: T,
  ): Promise<void> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    const spec = requireObjectSpec(objectType);
    const raw = await this.storeFunctions.readGroupFile({
      groupId,
      filename: spec.filename,
      baseDir: this.baseDir,
    });
    const items = extractCollection<T>(raw, spec);
    const dataId = readObjectId(data, spec.idKey);
    if (dataId && dataId !== objectId) {
      throw new Error(
        `Object identifier mismatch for ${objectType}: expected ${objectId}, received ${dataId}`,
      );
    }
    const nextItems = upsertCollectionObject(items, data, spec.idKey);
    await this.storeFunctions.writeGroupFile({
      groupId,
      filename: spec.filename,
      data: buildCollectionPayload(nextItems, spec),
      baseDir: this.baseDir,
    });
  }

  async listObjects<T>(groupId: string, objectType: string): Promise<T[]> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    const spec = requireObjectSpec(objectType);
    const raw = await this.storeFunctions.readGroupFile({
      groupId,
      filename: spec.filename,
      baseDir: this.baseDir,
    });
    return extractCollection<T>(raw, spec);
  }

  async deleteObject(groupId: string, objectType: string, objectId: string): Promise<void> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    const spec = requireObjectSpec(objectType);
    const raw = await this.storeFunctions.readGroupFile({
      groupId,
      filename: spec.filename,
      baseDir: this.baseDir,
    });
    const items = extractCollection<unknown>(raw, spec);
    const nextItems = items.filter((entry) => readObjectId(entry, spec.idKey) !== objectId);
    await this.storeFunctions.writeGroupFile({
      groupId,
      filename: spec.filename,
      data: buildCollectionPayload(nextItems, spec),
      baseDir: this.baseDir,
    });
  }
}

export class OpenBotMemoryStorage implements MemoryStorageAdapter {
  constructor(
    private readonly baseDir?: string,
    private readonly storeFunctions?: FileStoreFunctions,
  ) {}

  async readMemories<T>(groupId: string): Promise<T[]> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    const memories = await this.storeFunctions.readGroupFile<T[]>({
      groupId,
      filename: "memories.json",
      baseDir: this.baseDir,
    });
    return memories ?? [];
  }

  async writeMemories<T>(groupId: string, memories: T[]): Promise<void> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    await this.storeFunctions.writeGroupFile({
      groupId,
      filename: "memories.json",
      data: memories,
      baseDir: this.baseDir,
    });
  }

  async appendMemory<T>(groupId: string, memory: T): Promise<void> {
    const memories = await this.readMemories<T>(groupId);
    memories.push(memory);
    await this.writeMemories(groupId, memories);
  }
}

export class OpenBotLearningStorage implements LearningStorageAdapter {
  constructor(
    private readonly baseDir?: string,
    private readonly storeFunctions?: FileStoreFunctions,
  ) {}

  async readCapsules(groupId: string): Promise<GroupMemoryCapsule[]> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    const raw = await this.storeFunctions.readGroupFile({
      groupId,
      filename: "capsules.json",
      baseDir: this.baseDir,
    });
    return extractCollection<GroupMemoryCapsule>(raw, OBJECT_SPECS.capsule);
  }

  async writeCapsules(groupId: string, capsules: GroupMemoryCapsule[]): Promise<void> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    await this.storeFunctions.writeGroupFile({
      groupId,
      filename: "capsules.json",
      data: buildCollectionPayload(capsules, OBJECT_SPECS.capsule),
      baseDir: this.baseDir,
    });
  }

  async appendCapsule(groupId: string, capsule: GroupMemoryCapsule): Promise<void> {
    const capsules = await this.readCapsules(groupId);
    const nextCapsules = upsertCollectionObject(capsules, capsule, OBJECT_SPECS.capsule.idKey);
    await this.writeCapsules(groupId, nextCapsules);
  }

  async readProjections(groupId: string): Promise<LearningProjection[]> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    const raw = await this.storeFunctions.readGroupFile({
      groupId,
      filename: "projections.json",
      baseDir: this.baseDir,
    });
    return extractCollection<LearningProjection>(raw, OBJECT_SPECS.projection);
  }

  async writeProjections(groupId: string, projections: LearningProjection[]): Promise<void> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    await this.storeFunctions.writeGroupFile({
      groupId,
      filename: "projections.json",
      data: buildCollectionPayload(projections, OBJECT_SPECS.projection),
      baseDir: this.baseDir,
    });
  }

  async appendProjection(groupId: string, projection: LearningProjection): Promise<void> {
    const projections = await this.readProjections(groupId);
    const nextProjections = upsertCollectionObject(
      projections,
      projection,
      OBJECT_SPECS.projection.idKey,
    );
    await this.writeProjections(groupId, nextProjections);
  }

  async readLearningAssets(groupId: string, botId?: string): Promise<AgentLearningAsset[]> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    const raw = await this.storeFunctions.readGroupFile({
      groupId,
      filename: "learning-assets.json",
      baseDir: this.baseDir,
    });
    const assets = extractCollection<AgentLearningAsset>(raw, OBJECT_SPECS.learning_asset);
    if (!botId) {
      return assets;
    }
    return assets.filter((asset) => asset.botId === botId);
  }

  async writeLearningAssets(groupId: string, assets: AgentLearningAsset[]): Promise<void> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    await this.storeFunctions.writeGroupFile({
      groupId,
      filename: "learning-assets.json",
      data: buildCollectionPayload(assets, OBJECT_SPECS.learning_asset),
      baseDir: this.baseDir,
    });
  }

  async appendLearningAsset(groupId: string, asset: AgentLearningAsset): Promise<void> {
    const assets = await this.readLearningAssets(groupId);
    const nextAssets = upsertCollectionObject(assets, asset, OBJECT_SPECS.learning_asset.idKey);
    await this.writeLearningAssets(groupId, nextAssets);
  }
}

export class OpenBotMetadataStorage implements MetadataStorageAdapter {
  constructor(
    private readonly baseDir?: string,
    private readonly storeFunctions?: FileStoreFunctions,
  ) {}

  async readHealth<T>(groupId: string): Promise<T | null> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    return this.storeFunctions.readGroupFile<T>({
      groupId,
      filename: "health.json",
      baseDir: this.baseDir,
    });
  }

  async writeHealth<T>(groupId: string, health: T): Promise<void> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    await this.storeFunctions.writeGroupFile({
      groupId,
      filename: "health.json",
      data: health,
      baseDir: this.baseDir,
    });
  }

  async readTemplate<T>(groupId: string): Promise<T | null> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    return this.storeFunctions.readGroupFile<T>({
      groupId,
      filename: "template.json",
      baseDir: this.baseDir,
    });
  }

  async writeTemplate<T>(groupId: string, template: T): Promise<void> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    await this.storeFunctions.writeGroupFile({
      groupId,
      filename: "template.json",
      data: template,
      baseDir: this.baseDir,
    });
  }

  async readGroupCapabilities(groupId: string): Promise<GroupCapabilityProfile | null> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    return this.storeFunctions.readGroupFile<GroupCapabilityProfile>({
      groupId,
      filename: "capabilities.json",
      baseDir: this.baseDir,
    });
  }

  async writeGroupCapabilities(
    groupId: string,
    capabilities: GroupCapabilityProfile,
  ): Promise<void> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    await this.storeFunctions.writeGroupFile({
      groupId,
      filename: "capabilities.json",
      data: capabilities,
      baseDir: this.baseDir,
    });
  }

  async readParticipationOverlays(groupId: string): Promise<ParticipationCapabilityOverlay[]> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    const overlays = await this.storeFunctions.readGroupFile<ParticipationCapabilityOverlay[]>({
      groupId,
      filename: "participation-overlays.json",
      baseDir: this.baseDir,
    });
    return overlays ?? [];
  }

  async writeParticipationOverlays(
    groupId: string,
    overlays: ParticipationCapabilityOverlay[],
  ): Promise<void> {
    if (!this.storeFunctions) {
      throw new Error("Store functions not provided");
    }
    await this.storeFunctions.writeGroupFile({
      groupId,
      filename: "participation-overlays.json",
      data: overlays,
      baseDir: this.baseDir,
    });
  }
}
