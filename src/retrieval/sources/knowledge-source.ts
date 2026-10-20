import { groupKnowledgeBasesByIndexDb } from "../../gateway/knowledge/kb-index-groups.js";
import { openKnowledgeIndex } from "../../gateway/knowledge/kb-index.js";
import {
  kbRetrieveHitToEvidence,
  retrieveKnowledgeFromIndex,
} from "../../gateway/knowledge/kb-retrieve.js";
import { canReadKnowledgeBase } from "../../gateway/knowledge/knowledge-base-permissions.js";
import { listKnowledgeBases } from "../../gateway/knowledge/knowledge-base-store.js";
import type { EmbeddingProvider } from "../../memory/embeddings.js";
/**
 * Knowledge Retrieval Source — mounts indexed knowledge bases onto the retrieval platform.
 *
 * Resolves caller-visible KB ids via {@link canReadKnowledgeBase} (owner, member,
 * robot binding, then visibility), groups them by physical sqlite index file,
 * and issues one `kb_id IN (...)` query per index db.
 */
import { getKnowledgeRetrievalService } from "../retrieval-service.js";
import {
  allowsEmptyRetrievalQuery,
  DEFAULT_MAX_RESULTS,
  type KnowledgeEvidence,
  type RetrievalContext,
  type RetrievalOpts,
  type RetrievalSource,
} from "../types.js";

export type KnowledgeSourceDeps = {
  storePath?: string;
  indexRoot?: string;
  embeddingProvider?: EmbeddingProvider | null;
};

function intersectKbScope(accessibleIds: string[], kbScope?: string[]): string[] {
  if (!kbScope || kbScope.length === 0) {
    return accessibleIds;
  }
  const allowed = new Set(kbScope);
  return accessibleIds.filter((id) => allowed.has(id));
}

export function createKnowledgeRetrievalSource(deps: KnowledgeSourceDeps = {}): RetrievalSource {
  return {
    id: "knowledge",
    search: async (
      query: string,
      ctx: RetrievalContext,
      opts?: RetrievalOpts,
    ): Promise<KnowledgeEvidence[]> => {
      const trimmed = query.trim();
      if (!trimmed && !allowsEmptyRetrievalQuery(opts)) {
        return [];
      }

      const bases = listKnowledgeBases({}, deps.storePath);
      const actor = {
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        agentId: ctx.agentId ?? null,
        departmentId: ctx.departmentId ?? null,
        roleCode: ctx.roleCodes?.[0] ?? null,
      };
      const accessibleIds = intersectKbScope(
        bases
          .filter((base) => canReadKnowledgeBase({ knowledgeBase: base, actor }))
          .map((base) => base.id),
        opts?.kbScope,
      );
      if (accessibleIds.length === 0) {
        return [];
      }

      const accessible = bases.filter((base) => accessibleIds.includes(base.id));
      const groups = groupKnowledgeBasesByIndexDb(accessible, deps.indexRoot);
      const maxResults = opts?.maxResults ?? DEFAULT_MAX_RESULTS;
      const minScore = opts?.minScore;
      const candidatePool = Math.max(maxResults * 2, maxResults);

      const perDb: KnowledgeEvidence[] = [];
      for (const group of groups.values()) {
        const index = await openKnowledgeIndex({
          dbPath: group.dbPath,
          vectorEnabled: deps.embeddingProvider != null,
        });
        try {
          const hits = await retrieveKnowledgeFromIndex({
            index,
            query: trimmed,
            kbIds: group.kbIds,
            embeddingProvider: deps.embeddingProvider ?? null,
            maxResults: candidatePool,
            minScore,
            versionId: opts?.versionId,
            docId: opts?.docId,
            fallbackToCurrentChunks: opts?.fallbackToCurrentChunks,
          });
          for (const hit of hits) {
            perDb.push(kbRetrieveHitToEvidence(hit, group.kbTitles.get(hit.kbId)));
          }
        } finally {
          index.close();
        }
      }

      return perDb.toSorted((left, right) => right.score - left.score).slice(0, maxResults);
    },
  };
}

let knowledgeSourceRegistered = false;

export function ensureKnowledgeRetrievalSourceRegistered(deps: KnowledgeSourceDeps = {}): void {
  if (knowledgeSourceRegistered) {
    return;
  }
  getKnowledgeRetrievalService().registerSource(createKnowledgeRetrievalSource(deps));
  knowledgeSourceRegistered = true;
}

/** Test seam: allow re-registering with fresh deps. */
export function resetKnowledgeRetrievalSourceRegistrationForTests(): void {
  knowledgeSourceRegistered = false;
}
