import { parsePersonalObjectId } from "../personal-mutations.js";

export type IndexedKnowledgeObjectSource = "personal" | "enterprise";

export function knowledgeObjectIdForIndexedDoc(params: {
  docId: string;
  source: IndexedKnowledgeObjectSource;
}): string {
  const docId = params.docId.trim();
  if (!docId) {
    throw new Error("docId is required");
  }
  if (params.source === "enterprise") {
    return `obj:enterprise:${docId}`;
  }
  return `obj:personal:${docId}`;
}

export function docIdFromKnowledgeObjectId(objectId: string): string | null {
  const personalSkillId = parsePersonalObjectId(objectId);
  if (personalSkillId) {
    return personalSkillId;
  }
  // Enterprise projections, KB-space nodes, deliverables, and legacy bare ids
  // are not documents with a globally safe identity. Callers must retain their
  // typed domain and parent scope instead of guessing from the suffix.
  return null;
}

export function objectLookupKeysForDocId(params: {
  docId: string;
  source: IndexedKnowledgeObjectSource;
}): string[] {
  const docId = params.docId.trim();
  return docId ? [knowledgeObjectIdForIndexedDoc({ docId, source: params.source })] : [];
}
