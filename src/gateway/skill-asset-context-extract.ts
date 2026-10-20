/**
 * skill-asset-context-extract.ts — resolve assistant-doc / session context into asset profile fields.
 */

import { loadSessionStore, type SessionEntry } from "../config/sessions.js";
import { normalizeAgentId, parseAgentSessionKey } from "../routing/session-key.js";
import {
  artifactHashMatches,
  extractArtifactHash,
  hashArtifactBody,
} from "../shared/preview-artifact/artifact-hash.js";
import { extractDeliverableEnvelope } from "../shared/preview-artifact/deliverable-envelope.js";
import { resolvePreviewArtifactRecord } from "../shared/preview-artifact/resolve-preview-artifact.js";
import type { GatewayClient } from "./server-methods/types.js";
import { loadSessionEntry, readSessionMessages } from "./session-utils.js";
import {
  mergeSkillProfileWithFieldMeta,
  type ProfileFieldMetaMap,
} from "./skill-profile-field-meta.js";
import { extractTemplateVariables, type TemplateVariable } from "./skill-profile-inference.js";
import { buildSessionStorePathResolver } from "./tenant-context.js";

const MAX_SESSIONS_TO_SCAN = 25;
const SUMMARY_MAX_LENGTH = 160;

type SkillContextAssetType =
  | "prompt"
  | "template"
  | "workflow"
  | "knowledge"
  | "agent"
  | "capability";

export type SkillSourceLineage = {
  artifactId: string;
  artifactHash: string;
  legacyArtifactId?: string;
  legacyArtifactHash?: string;
  sourceSessionId?: string;
  sourceMessageOffset?: number;
  revision: number;
  capturedAt: string;
};

export type SkillContextProfilePatch = {
  name?: string;
  summary?: string;
  assetType?: SkillContextAssetType;
  usageExamples?: string[];
  inputDescription?: string;
  outputDescription?: string;
  tags?: string[];
  category?: string;
  templateVariables?: TemplateVariable[];
};

export type ResolvedSkillContextDeliverable = {
  title: string;
  body: string;
  artifactId: string;
  legacyArtifactId?: string;
  sessionKey?: string;
  sourceSessionId?: string;
  sourceMessageOffset?: number;
};

export type ResolvedSkillContextProfile = {
  profile: SkillContextProfilePatch;
  confidence: number;
  deliverable: ResolvedSkillContextDeliverable;
  lineage: SkillSourceLineage;
};

export type { TemplateVariable } from "./skill-profile-inference.js";
export type {
  ProfileFieldMeta,
  ProfileFieldMetaMap,
  ProfileFieldSource,
} from "./skill-profile-field-meta.js";
export { markUserProfileFields } from "./skill-profile-field-meta.js";

function extractTitleFromBody(body: string): string {
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  for (const line of lines) {
    if (!line) {
      continue;
    }
    const heading = line
      .replace(/^#+\s*/, "")
      .replace(/[*_`~]/g, "")
      .trim();
    if (heading) {
      return heading.slice(0, 80);
    }
  }
  return body.slice(0, 40).trim();
}

function cleanDisplayTitle(title: string): string {
  return title
    .replace(/^📋\s*/, "")
    .replace(/[：:]+$/, "")
    .replace(/\{\{[^}]+\}\}/g, "")
    .trim()
    .slice(0, 80);
}

function buildSummary(body: string, title: string): string {
  const plain = body
    .replace(/^#+\s+/gm, "")
    .replace(/\{\{[^}]+\}\}/g, "…")
    .replace(/\s+/g, " ")
    .trim();
  const seed = plain || title;
  if (seed.length <= SUMMARY_MAX_LENGTH) {
    return seed;
  }
  return `${seed.slice(0, SUMMARY_MAX_LENGTH).trim()}…`;
}

function inferAssetType(title: string, body: string): SkillContextAssetType {
  const haystack = `${title}\n${body}`;
  if (/\{\{[^}]+\}\}/.test(body) || /模版|模板|template/i.test(haystack)) {
    return "template";
  }
  if (/流程|步骤|workflow/i.test(haystack)) {
    return "workflow";
  }
  if (/^#{1,3}\s/m.test(body) && body.length > 400) {
    return "knowledge";
  }
  return "capability";
}

function inferCategory(title: string, body: string): string {
  const haystack = `${title}\n${body}`;
  if (/会议|invite|invitation/i.test(haystack)) {
    return "会议协作";
  }
  if (/客户|售后|投诉/.test(haystack)) {
    return "客户服务";
  }
  if (/周报|月报|汇报/.test(haystack)) {
    return "工作汇报";
  }
  return "";
}

function inferTags(title: string, body: string): string[] {
  const tags = new Set<string>();
  const haystack = `${title}\n${body}`;
  if (/会议/.test(haystack)) {
    tags.add("会议");
  }
  if (/模版|模板/.test(haystack)) {
    tags.add("模版");
  }
  if (/\{\{/.test(body)) {
    tags.add("变量槽位");
  }
  if (/腾讯会议|线上|线下|混合/.test(haystack)) {
    tags.add("混合会议");
  }
  return [...tags];
}

function inferUsageExamples(title: string, body: string): string[] {
  const haystack = `${title}\n${body}`;
  const examples: string[] = [];
  if (/会议/.test(haystack)) {
    examples.push("向参会人发送混合会议邀请");
    examples.push("同步会议时间、议程与线上接入信息");
  } else if (/模版|模板/.test(haystack)) {
    examples.push("在同类业务场景中复用该模版");
  }
  if (examples.length === 0 && body.length >= 80) {
    examples.push("在日常重复任务中复用该成果");
  }
  return examples;
}

function inferInputDescription(
  assetType: SkillContextAssetType,
  title: string,
  body: string,
): string {
  if (assetType === "template") {
    if (/会议/.test(`${title}\n${body}`)) {
      return "提供会议主题、时间、参会人、议程、线上会议号/链接与线下地点等信息。";
    }
    return "提供需要填入模版的业务字段与上下文。";
  }
  return "提供与本次成果相关的业务素材或上下文。";
}

function providerMetadata(artifact: Record<string, unknown>): Record<string, unknown> | null {
  const meta = artifact.providerMetadata;
  return meta && typeof meta === "object" && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : null;
}

function buildDeliverableFromPreviewArtifact(
  artifact: Record<string, unknown>,
  sessionKey: string,
  sourceSessionId: string,
  sourceMessageOffset: number,
): ResolvedSkillContextDeliverable | null {
  const artifactId = typeof artifact.artifactId === "string" ? artifact.artifactId.trim() : "";
  if (!artifactId.startsWith("assistant-doc:")) {
    return null;
  }
  const sourceMessage =
    typeof artifact.sourceMessage === "string" ? artifact.sourceMessage.trim() : "";
  if (!sourceMessage) {
    return null;
  }
  const envelopeBody = extractDeliverableEnvelope(sourceMessage)?.body.trim();
  const body = envelopeBody || sourceMessage;
  const rawTitle = typeof artifact.title === "string" ? artifact.title.trim() : "";
  const title = cleanDisplayTitle(rawTitle || extractTitleFromBody(body));
  const meta = providerMetadata(artifact);
  const legacyArtifactId =
    typeof meta?.legacyArtifactId === "string" ? meta.legacyArtifactId.trim() : undefined;
  return {
    title,
    body,
    artifactId,
    legacyArtifactId,
    sessionKey,
    sourceSessionId,
    sourceMessageOffset,
  };
}

function deliverableMatchesHash(
  deliverable: ResolvedSkillContextDeliverable,
  artifact: Record<string, unknown>,
  requestedHash: string,
): boolean {
  const directHash = extractArtifactHash(deliverable.artifactId);
  if (directHash === requestedHash) {
    return true;
  }
  if (
    deliverable.legacyArtifactId &&
    extractArtifactHash(deliverable.legacyArtifactId) === requestedHash
  ) {
    return true;
  }
  const title = typeof artifact.title === "string" ? artifact.title : deliverable.title;
  const legacySource =
    typeof artifact.sourceMessage === "string" ? artifact.sourceMessage : deliverable.body;
  return artifactHashMatches(requestedHash, {
    body: deliverable.body,
    legacyTitle: title,
    legacySourceMessage: legacySource,
    legacyArtifactId: deliverable.legacyArtifactId,
  });
}

async function scanSessionMessages(params: {
  sessionKey: string;
  artifactHash?: string | null;
  preferLatest?: boolean;
  resolveAgentStorePath: (agentId: string) => string;
}): Promise<ResolvedSkillContextDeliverable | null> {
  const { entry, storePath } = loadSessionEntry(params.sessionKey, {
    resolveAgentStorePath: params.resolveAgentStorePath,
  });
  if (!entry?.sessionId) {
    return null;
  }
  const messages = readSessionMessages(entry.sessionId, storePath, entry.sessionFile);
  let latest: ResolvedSkillContextDeliverable | null = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const artifact = resolvePreviewArtifactRecord(message);
    if (!artifact) {
      continue;
    }
    const deliverable = buildDeliverableFromPreviewArtifact(
      artifact,
      params.sessionKey,
      entry.sessionId,
      index,
    );
    if (!deliverable) {
      continue;
    }
    if (params.artifactHash) {
      if (deliverableMatchesHash(deliverable, artifact, params.artifactHash)) {
        return deliverable;
      }
      continue;
    }
    if (params.preferLatest) {
      return deliverable;
    }
    latest = deliverable;
  }
  return latest;
}

async function listAgentSessionEntries(
  agentId: string,
  resolveAgentStorePath: (agentId: string) => string,
): Promise<Array<{ key: string; entry: SessionEntry }>> {
  const normalizedAgentId = normalizeAgentId(agentId);
  const storePath = resolveAgentStorePath(normalizedAgentId);
  const store = loadSessionStore(storePath);
  return Object.entries(store)
    .filter(([key]) => {
      const parsed = parseAgentSessionKey(key);
      return parsed && normalizeAgentId(parsed.agentId) === normalizedAgentId;
    })
    .map(([key, entry]) => ({ key, entry }))
    .toSorted((left, right) => (right.entry.updatedAt ?? 0) - (left.entry.updatedAt ?? 0))
    .slice(0, MAX_SESSIONS_TO_SCAN);
}

function parseAssistantDocContextId(contextId: string): string | null {
  const trimmed = contextId.trim();
  if (!trimmed.startsWith("assistant-doc:")) {
    return null;
  }
  const hash = trimmed.slice("assistant-doc:".length).trim();
  return hash || null;
}

function buildProfileFromDeliverable(
  deliverable: ResolvedSkillContextDeliverable,
): SkillContextProfilePatch {
  const title = deliverable.title.trim() || extractTitleFromBody(deliverable.body);
  const assetType = inferAssetType(title, deliverable.body);
  const templateVariables =
    assetType === "template" || /\{\{/.test(deliverable.body)
      ? extractTemplateVariables(deliverable.body)
      : undefined;
  return {
    name: title,
    summary: buildSummary(deliverable.body, title),
    assetType,
    outputDescription: deliverable.body,
    inputDescription: inferInputDescription(assetType, title, deliverable.body),
    usageExamples: inferUsageExamples(title, deliverable.body),
    tags: inferTags(title, deliverable.body),
    category: inferCategory(title, deliverable.body),
    ...(templateVariables?.length ? { templateVariables } : {}),
  };
}

function buildLineageFromDeliverable(
  deliverable: ResolvedSkillContextDeliverable,
): SkillSourceLineage {
  const artifactHash =
    extractArtifactHash(deliverable.artifactId) ?? hashArtifactBody(deliverable.body);
  return {
    artifactId: deliverable.artifactId,
    artifactHash,
    ...(deliverable.legacyArtifactId ? { legacyArtifactId: deliverable.legacyArtifactId } : {}),
    ...(deliverable.legacyArtifactId
      ? { legacyArtifactHash: extractArtifactHash(deliverable.legacyArtifactId) ?? undefined }
      : {}),
    ...(deliverable.sourceSessionId ? { sourceSessionId: deliverable.sourceSessionId } : {}),
    ...(typeof deliverable.sourceMessageOffset === "number"
      ? { sourceMessageOffset: deliverable.sourceMessageOffset }
      : {}),
    revision: 1,
    capturedAt: new Date().toISOString(),
  };
}

function shouldResolveSkillContext(contextId?: string | null): boolean {
  const id = contextId?.trim() ?? "";
  if (!id) {
    return false;
  }
  if (id.startsWith("assistant-doc:")) {
    return true;
  }
  return Boolean(parseAgentSessionKey(id));
}

export async function resolveSkillContextProfile(params: {
  agentId: string;
  contextId?: string | null;
  lineage?: SkillSourceLineage | null;
  client?: GatewayClient | null;
}): Promise<ResolvedSkillContextProfile | null> {
  const agentId = params.agentId.trim();
  if (!agentId || !shouldResolveSkillContext(params.contextId)) {
    return null;
  }
  const contextId = params.contextId?.trim() ?? "";
  const artifactHash = parseAssistantDocContextId(contextId);

  let deliverable: ResolvedSkillContextDeliverable | null = null;

  try {
    const resolveAgentStorePath = await buildSessionStorePathResolver(params.client ?? null);
    if (params.lineage?.sourceSessionId && typeof params.lineage.sourceMessageOffset === "number") {
      const sessionKey = [...(await listAgentSessionEntries(agentId, resolveAgentStorePath))].find(
        (session) => session.entry.sessionId === params.lineage?.sourceSessionId,
      )?.key;
      if (sessionKey) {
        const { entry, storePath } = loadSessionEntry(sessionKey, { resolveAgentStorePath });
        if (entry?.sessionId) {
          const messages = readSessionMessages(entry.sessionId, storePath, entry.sessionFile);
          const message = messages[params.lineage.sourceMessageOffset];
          const artifact = message ? resolvePreviewArtifactRecord(message) : null;
          if (artifact) {
            deliverable = buildDeliverableFromPreviewArtifact(
              artifact,
              sessionKey,
              entry.sessionId,
              params.lineage.sourceMessageOffset,
            );
          }
        }
      }
    }
    if (!deliverable && artifactHash) {
      for (const session of await listAgentSessionEntries(agentId, resolveAgentStorePath)) {
        deliverable = await scanSessionMessages({
          sessionKey: session.key,
          artifactHash,
          resolveAgentStorePath,
        });
        if (deliverable) {
          break;
        }
      }
    } else if (!deliverable && parseAgentSessionKey(contextId)) {
      deliverable = await scanSessionMessages({
        sessionKey: contextId,
        preferLatest: true,
        resolveAgentStorePath,
      });
    }
  } catch {
    return null;
  }

  if (!deliverable) {
    return null;
  }

  return {
    profile: buildProfileFromDeliverable(deliverable),
    confidence: artifactHash ? 0.92 : 0.84,
    deliverable,
    lineage: buildLineageFromDeliverable(deliverable),
  };
}

export {
  hashArtifactBody,
  legacyHashPreviewText as hashPreviewText,
} from "../shared/preview-artifact/artifact-hash.js";

export function mergeSkillProfileWithContext<
  T extends {
    name: string;
    summary: string;
    assetType: SkillContextAssetType;
    usageExamples: string[];
    inputDescription: string;
    outputDescription: string;
    tags: string[];
    category: string;
    fieldMeta?: ProfileFieldMetaMap;
    templateVariables?: TemplateVariable[];
  },
>(profile: T, context: SkillContextProfilePatch, confidence = 0.84): T {
  const merged = mergeSkillProfileWithFieldMeta({
    profile,
    fieldMeta: profile.fieldMeta,
    patch: context,
    patchMeta: "inferred",
    patchConfidence: confidence,
  });
  return {
    ...merged.profile,
    fieldMeta: merged.fieldMeta,
    templateVariables: context.templateVariables?.length
      ? context.templateVariables
      : profile.templateVariables,
  };
}
