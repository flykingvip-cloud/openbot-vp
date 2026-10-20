import {
  normalizeKnowledgeTitleKey,
  titleKeysForWikilinkTarget,
} from "../document-obsidian-extract.js";
/**
 * P2: merge Obsidian explicit signals into KnowledgeObjects before inferred graph build.
 * - tags from frontmatter / hashtags
 * - relatedObjectIds from wikilink title resolution
 */
import {
  listExplicitDocumentMetadata,
  type ExplicitDocumentMetadataRecord,
} from "../explicit-metadata-store.js";
import type { KnowledgeObject } from "../types.js";

function indexObjectsByTitle(objects: KnowledgeObject[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const object of objects) {
    const key = normalizeKnowledgeTitleKey(object.title);
    if (!key) {
      continue;
    }
    const list = map.get(key) ?? [];
    list.push(object.id);
    map.set(key, list);
  }
  return map;
}

function resolveWikilinkTargets(
  record: ExplicitDocumentMetadataRecord,
  byTitle: Map<string, string[]>,
  selfObjectId: string | null,
): string[] {
  const resolved = new Set<string>();
  for (const link of record.wikilinks) {
    for (const key of titleKeysForWikilinkTarget(link.target)) {
      for (const objectId of byTitle.get(key) ?? []) {
        if (objectId !== selfObjectId) {
          resolved.add(objectId);
        }
      }
    }
  }
  return [...resolved];
}

/**
 * Attach explicit tags / relatedObjectIds onto matching knowledge objects.
 * Match by document id only — never by bare title (prevents cross-space bleed).
 */
export function enrichKnowledgeObjectsWithExplicitMetadata(params: {
  objects: KnowledgeObject[];
  metadataRecords?: ExplicitDocumentMetadataRecord[];
  storePath?: string;
  /** When set, only use metadata rows for these knowledge bases. */
  knowledgeBaseIds?: string[];
}): KnowledgeObject[] {
  let records = params.metadataRecords ?? listExplicitDocumentMetadata({}, params.storePath);
  if (params.knowledgeBaseIds && params.knowledgeBaseIds.length > 0) {
    const allowed = new Set(params.knowledgeBaseIds);
    records = records.filter((item) => item.knowledgeBaseId && allowed.has(item.knowledgeBaseId));
  }
  if (records.length === 0) {
    return params.objects;
  }

  // Wikilink resolution is restricted to objects in the same input set (same graph load).
  const byTitle = indexObjectsByTitle(params.objects);
  const byDocId = new Map(records.map((item) => [item.docId, item]));

  return params.objects.map((object) => {
    // Exact doc id match only (lfdoc-… / legacy lfdoc:…, pcdoc:…, skill ids used as docId).
    // Do NOT fall back to title equality — titles collide across spaces.
    const record =
      byDocId.get(object.id) ??
      byDocId.get(object.id.replace(/^obj:personal:/, "")) ??
      byDocId.get(object.id.replace(/^obj:/, ""));
    if (!record) {
      return object;
    }

    const explicitTags = record.tags.filter(Boolean);
    const tags = [...new Set([...object.tags, ...explicitTags])].slice(0, 24);
    const resolved = resolveWikilinkTargets(record, byTitle, object.id);
    const relatedObjectIds = [...new Set([...(object.relatedObjectIds ?? []), ...resolved])];

    if (
      tags.length === object.tags.length &&
      relatedObjectIds.length === (object.relatedObjectIds?.length ?? 0) &&
      tags.every((tag, index) => tag === object.tags[index])
    ) {
      return object;
    }

    return {
      ...object,
      tags,
      relatedObjectIds: relatedObjectIds.length > 0 ? relatedObjectIds : object.relatedObjectIds,
    };
  });
}
