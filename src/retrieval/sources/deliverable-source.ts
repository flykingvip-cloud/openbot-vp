import { listDeliverableArchiveKnowledgeBaseIds } from "../../gateway/knowledge/deliverables/archive-store.js";
import { resolveDeliverableDocumentId } from "../../gateway/knowledge/deliverables/attach.js";
import { listWorkspaceDeliverables } from "../../gateway/knowledge/deliverables/read-model.js";
import { groupKnowledgeBasesByIndexDb } from "../../gateway/knowledge/kb-index-groups.js";
import { openKnowledgeIndex } from "../../gateway/knowledge/kb-index.js";
import {
  kbRetrieveHitToEvidence,
  retrieveKnowledgeFromIndex,
} from "../../gateway/knowledge/kb-retrieve.js";
import {
  listKnowledgeBases,
  type KnowledgeBase,
} from "../../gateway/knowledge/knowledge-base-store.js";
import type { EmbeddingProvider } from "../../memory/embeddings.js";
import { getKnowledgeRetrievalService } from "../retrieval-service.js";
import {
  DEFAULT_MAX_RESULTS,
  type KnowledgeEvidence,
  type RetrievalContext,
  type RetrievalOpts,
  type RetrievalSource,
} from "../types.js";
import {
  resolveAccessibleKnowledgeBases,
  type VisibilityKnowledgeBase,
} from "../visibility-resolver.js";

export type DeliverableSourceDeps = {
  storePath?: string;
  indexRoot?: string;
  archiveStorePath?: string;
  embeddingProvider?: EmbeddingProvider | null;
};

function toVisibilityKnowledgeBase(base: KnowledgeBase): VisibilityKnowledgeBase {
  return {
    id: base.id,
    visibility: base.visibility,
    ownerId: base.ownerId,
    tenantId: base.tenantId,
  };
}

async function resolveDeliverableDocIds(ctx: RetrievalContext): Promise<Set<string>> {
  if (!ctx.userId) {
    return new Set();
  }
  const { deliverables } = await listWorkspaceDeliverables({
    userId: ctx.userId,
    limit: 200,
  });
  const archiveMap = listDeliverableArchiveKnowledgeBaseIds();
  const docIds = new Set<string>();
  for (const item of deliverables) {
    if (!archiveMap[item.deliverableId]) {
      continue;
    }
    const docId = resolveDeliverableDocumentId(item.deliverableId);
    if (docId) {
      docIds.add(docId);
    }
  }
  return docIds;
}

export function createDeliverableRetrievalSource(
  deps: DeliverableSourceDeps = {},
): RetrievalSource {
  return {
    id: "artifact",
    search: async (
      query: string,
      ctx: RetrievalContext,
      opts?: RetrievalOpts,
    ): Promise<KnowledgeEvidence[]> => {
      const trimmed = query.trim();
      if (!trimmed || !ctx.userId) {
        return [];
      }

      const deliverableDocIds = await resolveDeliverableDocIds(ctx);
      if (deliverableDocIds.size === 0) {
        return [];
      }

      const archiveMap = listDeliverableArchiveKnowledgeBaseIds(deps.archiveStorePath);
      const archivedKbIds = [...new Set(Object.values(archiveMap).filter((kbId) => kbId.trim()))];
      if (archivedKbIds.length === 0) {
        return [];
      }

      const bases = listKnowledgeBases({}, deps.storePath);
      const accessibleIds = new Set(
        resolveAccessibleKnowledgeBases(
          ctx,
          bases.map((base) => toVisibilityKnowledgeBase(base)),
        ),
      );
      const scopedKbIds = archivedKbIds.filter((kbId) => accessibleIds.has(kbId));
      if (scopedKbIds.length === 0) {
        return [];
      }

      const accessible = bases.filter((base) => scopedKbIds.includes(base.id));
      const groups = groupKnowledgeBasesByIndexDb(accessible, deps.indexRoot);
      const maxResults = opts?.maxResults ?? DEFAULT_MAX_RESULTS;
      const minScore = opts?.minScore;
      const candidatePool = Math.max(maxResults * 2, maxResults);

      const hits: KnowledgeEvidence[] = [];
      for (const group of groups.values()) {
        const index = await openKnowledgeIndex({
          dbPath: group.dbPath,
          vectorEnabled: deps.embeddingProvider != null,
        });
        try {
          const rows = await retrieveKnowledgeFromIndex({
            index,
            query: trimmed,
            kbIds: group.kbIds,
            embeddingProvider: deps.embeddingProvider ?? null,
            maxResults: candidatePool,
            minScore,
            versionId: opts?.versionId,
            docId: opts?.docId,
          });
          for (const row of rows) {
            if (!deliverableDocIds.has(row.docId)) {
              continue;
            }
            hits.push({
              ...kbRetrieveHitToEvidence(row, group.kbTitles.get(row.kbId)),
              sourceKind: "artifact",
            });
          }
        } finally {
          index.close();
        }
      }

      return hits.toSorted((left, right) => right.score - left.score).slice(0, maxResults);
    },
  };
}

let deliverableSourceRegistered = false;

export function ensureDeliverableRetrievalSourceRegistered(deps: DeliverableSourceDeps = {}): void {
  if (deliverableSourceRegistered) {
    return;
  }
  getKnowledgeRetrievalService().registerSource(createDeliverableRetrievalSource(deps));
  deliverableSourceRegistered = true;
}

export function resetDeliverableRetrievalSourceRegistrationForTests(): void {
  deliverableSourceRegistered = false;
}
