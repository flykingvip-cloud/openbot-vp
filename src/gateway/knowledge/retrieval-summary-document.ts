import fs from "node:fs";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "./kb-index.js";
import type { KnowledgeBase } from "./knowledge-base-store.js";
import { recallSummaryDocuments } from "./retrieval-summary-recall.js";
import { editRetrievalSummary, readRetrievalSummary } from "./retrieval-summary-store.js";
import type { RetrievalSummary } from "./retrieval-summary.js";

/** Invoked only after the RPC has resolved the current KB read/write ACL. */
export async function accessDocumentRetrievalSummary(input: {
  knowledgeBase: KnowledgeBase;
  docId: string;
  indexRoot?: string;
  fields?: NonNullable<RetrievalSummary["fields"]>;
  metadata?: Pick<RetrievalSummary, "sourceRelations" | "editorialStatus" | "reviewedBy">;
}) {
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: input.knowledgeBase.ownerId,
    tenantId: input.knowledgeBase.tenantId,
    indexRoot: input.indexRoot,
  });
  if (!fs.existsSync(dbPath)) {
    return undefined;
  }
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    const source = index.db
      .prepare(
        `SELECT d.kb_id,v.version_id,v.semantic_hash FROM documents d JOIN document_versions v ON v.version_id=d.current_version_id WHERE d.kb_id=? AND d.doc_id=?`,
      )
      .get(input.knowledgeBase.id, input.docId);
    if (!source) {
      return undefined;
    }
    if (input.fields) {
      await editRetrievalSummary(index.db, input.docId, input.fields, async () => ({
        kbId: input.knowledgeBase.id,
        versionId: String(source.version_id),
        contentHash: String(source.semantic_hash),
      }));
    }
    if (input.metadata) {
      for (const relation of input.metadata.sourceRelations ?? []) {
        const target = index.db
          .prepare("SELECT 1 FROM documents WHERE doc_id=? AND kb_id=?")
          .get(relation.documentId, input.knowledgeBase.id);
        if (!target) {
          throw Error("relation_target_not_found");
        }
      }
      const current = readRetrievalSummary(
        index.db,
        input.docId,
        new Set([input.knowledgeBase.id]),
      );
      if (current) {
        index.db
          .prepare(
            "UPDATE retrieval_summaries SET payload=?,updated_at=? WHERE doc_id=? AND kb_id=?",
          )
          .run(
            JSON.stringify({
              ...current,
              ...Object.fromEntries(
                Object.entries(input.metadata).filter(([, value]) => value !== undefined),
              ),
            }),
            Date.now(),
            input.docId,
            input.knowledgeBase.id,
          );
      }
    }
    return readRetrievalSummary(index.db, input.docId, new Set([input.knowledgeBase.id]));
  } finally {
    index.close();
  }
}

export async function recallDocumentRetrievalSummaries(input: {
  knowledgeBase: KnowledgeBase;
  query: string;
  indexRoot?: string;
  limit?: number;
}) {
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: input.knowledgeBase.ownerId,
    tenantId: input.knowledgeBase.tenantId,
    indexRoot: input.indexRoot,
  });
  if (!fs.existsSync(dbPath)) {
    return [];
  }
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    return recallSummaryDocuments(index.db, input.knowledgeBase.id, input.query, input.limit);
  } finally {
    index.close();
  }
}
