import {
  normalizeKnowledgeConsumeRefs,
  type KnowledgeConsumeRef,
} from "../../gateway/knowledge/consume-ref.js";

export type KnowledgeConsumeSearchScope = {
  focused: boolean;
  knowledgeBaseIds: string[];
  docIds: string[];
};

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function fileIdFromKnowledgeObjectId(objectId: string | undefined): string | null {
  const trimmed = objectId?.trim() ?? "";
  if (!trimmed) {
    return null;
  }
  for (const prefix of ["obj:doc:", "obj:personal:", "obj:enterprise:"]) {
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim() || null;
    }
  }
  if (trimmed.startsWith("obj:")) {
    return null;
  }
  return trimmed;
}

export function resolveKnowledgeConsumeSearchScope(
  refs: readonly KnowledgeConsumeRef[] | undefined,
): KnowledgeConsumeSearchScope {
  const normalized = normalizeKnowledgeConsumeRefs(refs);
  const knowledgeBaseIds: string[] = [];
  const docIds: string[] = [];
  for (const ref of normalized) {
    if (ref.type === "knowledge-base") {
      knowledgeBaseIds.push(ref.id);
      continue;
    }
    if (ref.type === "knowledge-file" || ref.type === "deliverable") {
      docIds.push(ref.id);
      if (ref.parentId && ref.parentId !== ref.id) {
        knowledgeBaseIds.push(ref.parentId);
      }
      continue;
    }
    if (ref.type === "folder") {
      // Folder ids are not document ids. Scope search to the parent library.
      knowledgeBaseIds.push(ref.parentId || ref.id);
    }
  }
  return {
    focused: knowledgeBaseIds.length > 0 || docIds.length > 0,
    knowledgeBaseIds: unique(knowledgeBaseIds),
    docIds: unique(docIds),
  };
}

export function isKnowledgeTargetInConsumeScope(
  scope: KnowledgeConsumeSearchScope,
  target: {
    objectId?: string;
    docId?: string;
    knowledgeBaseId?: string;
  },
): boolean {
  if (!scope.focused) {
    return true;
  }
  const docId = target.docId?.trim() || fileIdFromKnowledgeObjectId(target.objectId);
  const knowledgeBaseId = target.knowledgeBaseId?.trim();
  if (scope.docIds.length > 0) {
    if (docId && scope.docIds.includes(docId)) {
      return true;
    }
    if (target.objectId?.startsWith("obj:kb:")) {
      const kbId = target.objectId.slice("obj:kb:".length).trim();
      return Boolean(kbId && scope.knowledgeBaseIds.includes(kbId));
    }
    return false;
  }
  if (knowledgeBaseId) {
    return scope.knowledgeBaseIds.includes(knowledgeBaseId);
  }
  if (target.objectId?.startsWith("obj:kb:")) {
    const kbId = target.objectId.slice("obj:kb:".length).trim();
    return Boolean(kbId && scope.knowledgeBaseIds.includes(kbId));
  }
  // Library-only focus: search hits may omit knowledgeBaseId.
  return scope.knowledgeBaseIds.length > 0;
}
