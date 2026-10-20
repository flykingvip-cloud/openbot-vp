import {
  deleteKnowledgeChunksByIds,
  getKnowledgeDocument,
  listKnowledgeChunksForVersion,
  listKnowledgeDocumentVersions,
  openKnowledgeIndex,
  resolveKnowledgeIndexDbPath,
} from "../kb-index.js";

export type PurgePriorKnowledgeDocumentVersionsResult = {
  keptVersionId: string | null;
  purgedVersionIds: string[];
  purgedChunkIds: string[];
};

/**
 * Overwrite must leave one callable body. Drop every prior document_versions row
 * and any chunks still pointing at those versions. The current version stays.
 */
export async function purgePriorKnowledgeDocumentVersions(params: {
  docId: string;
  ownerId: string;
  tenantId?: string | null;
  indexRoot?: string;
  keepVersionId?: string | null;
}): Promise<PurgePriorKnowledgeDocumentVersionsResult> {
  const docId = params.docId.trim();
  if (!docId) {
    return { keptVersionId: null, purgedVersionIds: [], purgedChunkIds: [] };
  }
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: params.ownerId,
    tenantId: params.tenantId ?? null,
    indexRoot: params.indexRoot,
  });
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    const document = getKnowledgeDocument(index.db, docId);
    const versions = listKnowledgeDocumentVersions(index.db, docId);
    const keptVersionId =
      params.keepVersionId?.trim() ||
      document?.currentVersionId?.trim() ||
      versions.at(-1)?.versionId ||
      null;
    if (!keptVersionId) {
      return { keptVersionId: null, purgedVersionIds: [], purgedChunkIds: [] };
    }
    const staleVersions = versions.filter((version) => version.versionId !== keptVersionId);
    const purgedChunkIds: string[] = [];
    for (const version of staleVersions) {
      const chunks = listKnowledgeChunksForVersion({
        db: index.db,
        docId,
        versionId: version.versionId,
      });
      const chunkIds = chunks.map((chunk) => chunk.chunkId);
      if (chunkIds.length > 0) {
        deleteKnowledgeChunksByIds({ db: index.db, index, chunkIds });
        purgedChunkIds.push(...chunkIds);
      }
    }
    if (staleVersions.length > 0) {
      const deleteVersion = index.db.prepare(`DELETE FROM document_versions WHERE version_id = ?`);
      index.db.exec("BEGIN IMMEDIATE");
      try {
        for (const version of staleVersions) {
          deleteVersion.run(version.versionId);
        }
        index.db.exec("COMMIT");
      } catch (error) {
        try {
          index.db.exec("ROLLBACK");
        } catch {
          // ignore rollback failure after primary error
        }
        throw error;
      }
    }
    return {
      keptVersionId,
      purgedVersionIds: staleVersions.map((version) => version.versionId),
      purgedChunkIds,
    };
  } finally {
    index.close();
  }
}
