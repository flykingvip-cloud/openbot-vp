/**
 * Human titles for knowledge documents. Storage keys (lfdoc- / Ifdoc / skill_ / kbdoc-)
 * must never be the cabin-tree or picker label when a filename exists.
 */

import { createHash } from "node:crypto";

const INTERNAL_ID_PREFIX =
  /^(Ifdoc[:_]?|lfdoc[-:]|kbdoc[-:]|obj:|doc[-:]|dataset[-:]|skill[:_]|lin:)/i;
const BARE_HEX_ID = /^[0-9a-f]{16,}$/i;
const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SKILL_ID = /^skill_[a-z0-9]+$/i;

export function looksLikeInternalDocumentId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  if (INTERNAL_ID_PREFIX.test(trimmed)) {
    return true;
  }
  return BARE_HEX_ID.test(trimmed) || UUID_ID.test(trimmed);
}

export function sourceDisplayName(sourceName: string): string {
  const base = sourceName.trim().split(/[\\/]/).pop() ?? sourceName.trim();
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(0, dot) : base).trim() || base.trim();
}

/** True when a cabin-tree label is only a storage key, UUID, or skill catalog id. */
export function isKnowledgeCabinInternalLabel(value: string | null | undefined): boolean {
  return firstHumanDocumentTitle(value) == null;
}

export function firstHumanDocumentTitle(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed || looksLikeInternalDocumentId(trimmed)) {
      continue;
    }
    const display = sourceDisplayName(trimmed);
    if (display && !looksLikeInternalDocumentId(display)) {
      return display;
    }
  }
  return null;
}

export function resolveSkillAssetIdForDocument(docId: string): string | null {
  const trimmed = docId.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("obj:personal:")) {
    const skillId = trimmed.slice("obj:personal:".length).trim();
    return skillId || null;
  }
  return SKILL_ID.test(trimmed) ? trimmed : null;
}

/** Skill catalog ids must never be knowledge-base membership keys. */
export function isSkillAssetDocumentId(value: string): boolean {
  return resolveSkillAssetIdForDocument(value) != null;
}

/** Skill catalog refs on cabin-tree sources (id / title / documentId / deliverableId). */
export function isSkillCatalogSourceRef(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return false;
  }
  if (isSkillAssetDocumentId(trimmed)) {
    return true;
  }
  if (trimmed.startsWith("skill:")) {
    return (
      isSkillAssetDocumentId(trimmed.slice("skill:".length)) || /skill_[a-z0-9]+/i.test(trimmed)
    );
  }
  return /(?:^|[:/])skill_[a-z0-9]+$/i.test(trimmed);
}

/** Stable KB document id for content that originated from a skill asset. */
export function knowledgeDocumentIdFromSkillRef(knowledgeBaseId: string, skillId: string): string {
  const digest = createHash("sha256")
    .update(`${knowledgeBaseId.trim()}::${skillId.trim()}`)
    .digest("hex")
    .slice(0, 24);
  return `kbdoc-${digest}`;
}
