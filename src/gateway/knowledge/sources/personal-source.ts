import type { AssetType, EmployeeSkillSummary } from "../../skill-lifecycle-store.js";
import {
  getPersonalSkillAssetDetail,
  listPersonalSkillAssets,
} from "../../skill-lifecycle-store.js";
import type { KnowledgeObject, KnowledgeObjectKind } from "../types.js";

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const PERSONAL_ASSET_TYPES = new Set<AssetType>(["knowledge", "template", "workflow"]);

function mapAssetTypeToKind(assetType: AssetType): KnowledgeObjectKind {
  switch (assetType) {
    case "knowledge":
      return "document";
    case "template":
      return "template";
    case "workflow":
      return "insight";
    default:
      return "document";
  }
}

function isPersonalKnowledgeAsset(assetType: AssetType, tags: string[], category: string): boolean {
  if (PERSONAL_ASSET_TYPES.has(assetType)) {
    return true;
  }
  const haystack = `${tags.join(" ")} ${category}`.toLowerCase();
  return /(知识|knowledge|faq|手册|制度|文档|document)/i.test(haystack);
}

/** Project one skill asset into a personal knowledge-graph object (or null if not knowledge-like). */
export function projectPersonalKnowledgeObject(
  asset: EmployeeSkillSummary,
): KnowledgeObject | null {
  if (
    !isPersonalKnowledgeAsset(asset.profile.assetType, asset.profile.tags, asset.profile.category)
  ) {
    return null;
  }
  return {
    id: `obj:personal:${asset.id}`,
    title: asset.profile.name,
    source: "personal" as const,
    kind: mapAssetTypeToKind(asset.profile.assetType),
    summary: asset.profile.summary,
    tags: [...asset.profile.tags],
    updatedAt: asset.lastUsedAt ?? Date.now(),
    sourceSystem: asset.sourceRobot?.name ?? "我的沉淀",
    scopeLabel: "个人知识",
    relationshipSummary: {
      relatedCount: asset.profile.tags.length,
      conflictCount: 0,
      supportingCount: asset.versionCount > 1 ? 1 : 0,
    },
    relatedObjectIds: asset.sourceRobot?.id ? [`obj:agent:${asset.sourceRobot.id}`] : undefined,
  };
}

/**
 * Personal knowledge objects for the relationship graph / source browse.
 * Fail-closed: without a caller `ownerUserId`, returns [].
 * Assets with missing `ownerUserId` (legacy) are never projected for other users.
 */
export function loadPersonalKnowledgeObjects(params?: {
  ownerUserId?: string | null;
}): KnowledgeObject[] {
  const ownerUserId = params?.ownerUserId?.trim() || null;
  if (!ownerUserId) {
    return [];
  }
  return listPersonalSkillAssets({ ownerUserId })
    .map(projectPersonalKnowledgeObject)
    .filter((item): item is KnowledgeObject => item != null);
}

/** Single-asset lookup used after save/upload (does not open the unscoped store floodgate). */
export function loadPersonalKnowledgeObjectBySkillId(skillId: string): KnowledgeObject | null {
  const id = skillId.trim();
  if (!id) {
    return null;
  }
  try {
    return projectPersonalKnowledgeObject(getPersonalSkillAssetDetail(id));
  } catch {
    return null;
  }
}

export function buildPersonalSourceSummary(objects: KnowledgeObject[]): {
  documentCount: number;
  recentUpdates: number;
} {
  const now = Date.now();
  const recentUpdates = objects.filter((item) => now - item.updatedAt <= RECENT_WINDOW_MS).length;
  return {
    documentCount: objects.length,
    recentUpdates,
  };
}
