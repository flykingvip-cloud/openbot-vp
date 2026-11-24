import { listAgentIds } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import type { EmbeddingProvider } from "../../memory/embeddings.js";
import {
  getLatestKnowledgeDocumentVersion,
  listKnowledgeChunksMissingVectors,
  openKnowledgeIndex,
  upsertKnowledgeChunks,
  type KnowledgeChunkInsert,
} from "./kb-index.js";
import { resolveKnowledgeIngestEmbeddingProvider } from "./kb-ingest.js";
import { listKnowledgeIndexDbPaths } from "./knowledge-directory.js";
import {
  listPendingKnowledgeVectorizeInIndex,
  markKnowledgeVectorizeDoneInIndex,
  markKnowledgeVectorizeErrorInIndex,
} from "./vectorize-queue-store.js";

export type KnowledgeVectorizeTickResult = {
  databases: number;
  processed: number;
  vectorized: number;
  failed: number;
};

async function embedTexts(
  provider: EmbeddingProvider,
  texts: string[],
): Promise<Array<number[] | undefined>> {
  if (texts.length === 0) {
    return [];
  }
  try {
    return await provider.embedBatch(texts);
  } catch {
    return texts.map(() => undefined);
  }
}

export async function tickKnowledgeVectorizeJobs(params?: {
  indexRoot?: string;
  tenantsRoot?: string;
  configDir?: string;
  maxDatabasesPerRound?: number;
  limitPerDb?: number;
  embeddingProvider?: EmbeddingProvider | null;
  nowMs?: number;
}): Promise<KnowledgeVectorizeTickResult> {
  const empty: KnowledgeVectorizeTickResult = {
    databases: 0,
    processed: 0,
    vectorized: 0,
    failed: 0,
  };
  const dbPaths = listKnowledgeIndexDbPaths({
    indexRoot: params?.indexRoot,
    tenantsRoot: params?.tenantsRoot,
    configDir: params?.configDir,
  });
  if (dbPaths.length === 0) {
    return empty;
  }

  const cfg = loadConfig();
  const dbLimit = params?.maxDatabasesPerRound ?? 8;
  const limitPerDb = params?.limitPerDb ?? 10;
  const now = params?.nowMs ?? Date.now();
  const result: KnowledgeVectorizeTickResult = { ...empty };

  for (const dbPath of dbPaths.slice(0, dbLimit)) {
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: true });
    try {
      const jobs = listPendingKnowledgeVectorizeInIndex(index.db, { limit: limitPerDb });
      if (jobs.length === 0) {
        continue;
      }
      result.databases += 1;
      let provider = params?.embeddingProvider;
      if (provider === undefined) {
        provider = null;
        for (const agentId of listAgentIds(cfg)) {
          try {
            const resolved = await resolveKnowledgeIngestEmbeddingProvider({
              cfg,
              agentId,
            });
            if (resolved) {
              provider = resolved;
              break;
            }
          } catch {
            continue;
          }
        }
      }
      if (!provider || !index.vectorAvailable) {
        // No embedding provider / sqlite-vec yet: keep jobs pending without burning retries.
        continue;
      }

      for (const job of jobs) {
        result.processed += 1;
        try {
          const latest = getLatestKnowledgeDocumentVersion(index.db, job.docId);
          const versionId = job.versionId?.trim() || latest?.versionId || "";
          if (!versionId) {
            markKnowledgeVectorizeDoneInIndex(index.db, {
              kbId: job.kbId,
              docId: job.docId,
              nowMs: now,
            });
            continue;
          }
          const missing = listKnowledgeChunksMissingVectors({
            db: index.db,
            docId: job.docId,
            versionId,
          }).filter((chunk) => chunk.kbId === job.kbId);
          if (missing.length === 0) {
            markKnowledgeVectorizeDoneInIndex(index.db, {
              kbId: job.kbId,
              docId: job.docId,
              nowMs: now,
            });
            continue;
          }
          const embeddings = await embedTexts(
            provider,
            missing.map((chunk) => chunk.text),
          );
          const rows: KnowledgeChunkInsert[] = [];
          for (let i = 0; i < missing.length; i += 1) {
            const chunk = missing[i];
            const embedding = embeddings[i];
            if (!embedding || embedding.length === 0) {
              continue;
            }
            rows.push({
              id: chunk.chunkId,
              text: chunk.text,
              model: provider.model,
              kbId: chunk.kbId,
              docId: job.docId,
              versionId,
              heading: chunk.heading,
              section: chunk.section,
              startLine: chunk.startLine,
              endLine: chunk.endLine,
              visibility: chunk.visibility,
              source: chunk.source,
              embedding,
            });
          }
          if (rows.length === 0) {
            throw new Error("embedding batch returned no vectors");
          }
          // Deletion/version replacement can finish while embeddings await. The conditional
          // commit checks current chunk identity under the same SQLite write transaction.
          const written = upsertKnowledgeChunks({ index, chunks: rows, existingOnly: true });
          result.vectorized += written;
          if (rows.length < missing.length) {
            throw new Error("partial embedding batch");
          }
          markKnowledgeVectorizeDoneInIndex(index.db, {
            kbId: job.kbId,
            docId: job.docId,
            nowMs: now,
          });
        } catch (error) {
          result.failed += 1;
          markKnowledgeVectorizeErrorInIndex(index.db, {
            kbId: job.kbId,
            docId: job.docId,
            error: error instanceof Error ? error.message : "vectorize failed",
            nowMs: now,
          });
        }
      }
    } finally {
      index.close();
    }
  }

  return result;
}
