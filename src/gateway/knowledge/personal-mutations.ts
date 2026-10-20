import {
  diffSkillVersions,
  editPersonalSkillAsset,
  getPersonalSkillAssetDetail,
  listSkillVersionHistory,
  saveSkillAsset,
  SkillAssetStoreError,
  type EmployeeSkillVersionSummary,
  type SkillVersionDiff,
} from "../skill-lifecycle-store.js";
import {
  buildPersonalDocumentUploadDescription,
  derivePersonalDocumentSummary,
  derivePersonalDocumentTags,
  derivePersonalDocumentTitle,
  type PersonalDocumentUploadAttachment,
} from "./personal-document-upload.js";
import { loadPersonalKnowledgeObjectBySkillId } from "./sources/personal-source.js";
import type { KnowledgeObject } from "./types.js";

export function personalObjectId(skillId: string): string {
  return `obj:personal:${skillId}`;
}

export function parsePersonalObjectId(objectId: string): string | null {
  if (!objectId.startsWith("obj:personal:")) {
    return null;
  }
  const skillId = objectId.slice("obj:personal:".length).trim();
  return skillId || null;
}

function toKnowledgeObject(detail: { id: string }): KnowledgeObject | null {
  return loadPersonalKnowledgeObjectBySkillId(detail.id);
}

export function collectPersonalKnowledge(params: {
  title: string;
  summary: string;
  tags?: string[];
  sourceAgentId?: string;
  ownerUserId?: string | null;
  contextId?: string | null;
}): { object: KnowledgeObject; skillId: string } {
  const title = params.title.trim();
  const summary = params.summary.trim();
  if (!title || !summary) {
    throw new SkillAssetStoreError("title and summary are required");
  }
  const result = saveSkillAsset({
    sourceAgentId: params.sourceAgentId?.trim() || null,
    ownerUserId: params.ownerUserId?.trim() || null,
    contextId: params.contextId ?? null,
    profile: {
      name: title,
      summary,
      assetType: "knowledge",
      tags: params.tags ?? [],
      category: "知识收录",
      visibility: "private",
      inputDescription: params.contextId ? `收录自 ${params.contextId}` : "知识宇宙一键收录",
    },
  });
  const object = toKnowledgeObject(result.detail);
  if (!object) {
    throw new SkillAssetStoreError("failed to project collected knowledge object");
  }
  return { object, skillId: result.skillId };
}

export function uploadPersonalKnowledge(params: {
  title?: string;
  summary?: string;
  tags?: string[];
  content?: string;
  attachment?: PersonalDocumentUploadAttachment;
  sourceAgentId?: string;
  ownerUserId?: string | null;
}): { object: KnowledgeObject; skillId: string } {
  if (!params.attachment) {
    throw new SkillAssetStoreError("document attachment is required");
  }
  const title = derivePersonalDocumentTitle(params.attachment, params.title);
  const summary = derivePersonalDocumentSummary(params.attachment, params.summary);
  const content = buildPersonalDocumentUploadDescription(params.attachment);
  const result = saveSkillAsset({
    sourceAgentId: params.sourceAgentId?.trim() || null,
    ownerUserId: params.ownerUserId?.trim() || null,
    profile: {
      name: title,
      summary,
      assetType: "knowledge",
      tags: params.tags ?? derivePersonalDocumentTags(params.attachment),
      category: "上传文档",
      visibility: "private",
      outputDescription: params.content?.trim() || content,
      inputDescription: `知识宇宙文档上传: ${params.attachment.fileName}`,
    },
  });
  const object = toKnowledgeObject(result.detail);
  if (!object) {
    throw new SkillAssetStoreError("failed to project uploaded knowledge object");
  }
  return { object, skillId: result.skillId };
}

export function updatePersonalKnowledgeTags(params: {
  objectId: string;
  tags: string[];
}): KnowledgeObject {
  const skillId = parsePersonalObjectId(params.objectId);
  if (!skillId) {
    throw new SkillAssetStoreError("invalid personal knowledge objectId");
  }
  const current = getPersonalSkillAssetDetail(skillId);
  const detail = editPersonalSkillAsset({
    skillId,
    profile: {
      ...current.profile,
      tags: params.tags,
    },
    summary: "Tags updated from knowledge universe",
  });
  const object = toKnowledgeObject(detail);
  if (!object) {
    throw new SkillAssetStoreError("failed to project updated knowledge object");
  }
  return object;
}

export function listPersonalKnowledgeVersions(objectId: string): EmployeeSkillVersionSummary[] {
  const skillId = parsePersonalObjectId(objectId);
  if (!skillId) {
    throw new SkillAssetStoreError("invalid personal knowledge objectId");
  }
  return listSkillVersionHistory(skillId);
}

export function comparePersonalKnowledgeVersions(params: {
  objectId: string;
  fromVersion: string;
  toVersion: string;
}): SkillVersionDiff {
  const skillId = parsePersonalObjectId(params.objectId);
  if (!skillId) {
    throw new SkillAssetStoreError("invalid personal knowledge objectId");
  }
  return diffSkillVersions({
    skillId,
    fromVersion: params.fromVersion,
    toVersion: params.toVersion,
  });
}
