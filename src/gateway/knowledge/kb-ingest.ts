import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolveAgentDir } from "../../agents/agent-scope.js";
import { resolveMemorySearchConfig } from "../../agents/memory-search.js";
import type { OpenBotConfig } from "../../config/config.js";
import { resolveStateDir } from "../../config/paths.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { enforceEmbeddingMaxInputTokens } from "../../memory/embedding-chunk-limits.js";
import { classifyMemoryEmbeddingError } from "../../memory/embedding-error.js";
import { createEmbeddingProvider, type EmbeddingProvider } from "../../memory/embeddings.js";
import {
  buildKnowledgeResourceId,
  finalizeKnowledgeContentWriteSession,
  prepareKnowledgeContentWriteSession,
  requireKnowledgeContentWrite,
} from "../data-governance/knowledge-register.js";
import type { GovernanceOwnershipProof } from "../data-governance/write-gate.js";
import type { GatewayClient } from "../server-methods/types.js";
import { resolveAgentDirForClient } from "../tenant-context.js";
import {
  anchorHierarchicalChunks,
  anchorPreviousChunkSnapshots,
  planChunkDelta,
  summarizeChunkDelta,
  type ChunkDeltaStats,
} from "./chunk-delta.js";
import { chunkHierarchicalDocument, type HierarchicalChunking } from "./chunkers/hierarchical.js";
import {
  extractKnowledgeDocument,
  planKnowledgeDocumentVersionDelta,
  type ExtractedKnowledgeDocument,
} from "./document-extract.js";
import type { ContentVersionDelta } from "./document-fingerprint.js";
import { upsertExplicitDocumentMetadata } from "./explicit-metadata-store.js";
import { enqueuePostIngestGovernanceJobs } from "./governance/runtime/gateway-tick.js";
import {
  countKnowledgeDocumentVersions,
  deleteKnowledgeChunksByIds,
  getLatestKnowledgeDocumentVersion,
  insertKnowledgeDocumentVersion,
  listKnowledgeChunksForVersion,
  openKnowledgeIndex,
  resolveKnowledgeIndexDbPath,
  updateKnowledgeDocumentCurrentVersion,
  updateKnowledgeDocumentVersionRawHash,
  upsertKnowledgeChunks,
  upsertKnowledgeDocument,
  type KnowledgeChunkInsert,
} from "./kb-index.js";
import { assertChunkLineAnchors, assertIngestableExtract } from "./ke/ingest-gate.js";
import { assertRawHash } from "./ke/integrity.js";
import { queueRetrievalSummary } from "./retrieval-summary-store.js";
import { enqueueKnowledgeVectorizeInIndex } from "./vectorize-queue-store.js";

export const DEFAULT_KB_CHUNKING: HierarchicalChunking = {
  tokens: 400,
  overlap: 80,
};

export const FTS_ONLY_EMBEDDING_MODEL = "fts-only";

export type IngestKnowledgeDocumentParams = {
  kbId: string;
  docId: string;
  title: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  ownerId: string;
  tenantId: string | null;
  visibility?: string | null;
  source?: string | null;
  indexRoot?: string;
  embeddingProvider?: EmbeddingProvider | null;
  /**
   * Preview-save default: commit FTS/originals now and enqueue sqlite-vec in the
   * gateway tick. User-visible save does not wait on the embedding provider.
   */
  deferEmbedding?: boolean;
  chunking?: HierarchicalChunking;
  ocrEnabled?: boolean;
  cfg?: OpenBotConfig;
  publishedAt?: number;
  now?: number;
  /**
   * Optional pre-allocated version id for managed governance (Catalog resourceId).
   * When omitted, a UUID is allocated before content writes.
   */
  governanceVersionId?: string;
  /** Optional override for governance Catalog stateDir (tests). */
  governanceStateDir?: string;
  /**
   * Trusted ownership/authorization proof from authenticated call entry.
   * Required for managed (tenantId set) writes — never synthesized from write payload alone.
   */
  governanceOwnershipProof?: GovernanceOwnershipProof;
};

export type IngestKnowledgeDocumentResult = {
  delta: ContentVersionDelta;
  docId: string;
  versionId: string | null;
  versionLabel: string | null;
  chunkCount: number;
  skipped: boolean;
  /** True when FTS landed and a background vectorize job was queued. */
  vectorizeQueued?: boolean;
  extracted: ExtractedKnowledgeDocument;
  /** P4: present when a semantic rewrite applied chunk-level keep/update/add/remove. */
  chunkDelta?: ChunkDeltaStats;
};

export async function resolveKnowledgeIngestEmbeddingProvider(params: {
  cfg: OpenBotConfig;
  agentId: string;
  client?: GatewayClient | null;
}): Promise<EmbeddingProvider | null> {
  const search = resolveMemorySearchConfig(params.cfg, params.agentId);
  if (!search?.enabled) {
    return null;
  }
  // Bootstrap / retrieval paths may omit a session client; never hard-fail
  // embedding setup with unresolved_tenant — fall back to global agentDir.
  const agentDir = params.client
    ? await resolveAgentDirForClient(params.client, params.agentId, params.cfg)
    : resolveAgentDir(params.cfg, params.agentId);
  const result = await createEmbeddingProvider({
    config: params.cfg,
    agentDir,
    provider: search.provider,
    fallback: search.fallback,
    model: search.model,
    remote: search.remote,
    local: search.local,
  });
  return result.provider;
}

function nextVersionLabel(existingCount: number): string {
  return `V${existingCount + 1}`;
}

function attachHierarchyMetadata(
  base: ReturnType<typeof chunkHierarchicalDocument>,
  split: Array<{ startLine: number; endLine: number; text: string; hash: string }>,
): ReturnType<typeof chunkHierarchicalDocument> {
  return split.map((chunk) => {
    const parent =
      base.find(
        (entry) =>
          entry.startLine <= chunk.startLine &&
          entry.endLine >= chunk.endLine &&
          entry.text.includes(chunk.text.slice(0, Math.min(32, chunk.text.length))),
      ) ??
      base.find((entry) => entry.startLine === chunk.startLine) ??
      base[0];
    return {
      ...chunk,
      heading: parent?.heading ?? null,
      section: parent?.section ?? null,
    };
  });
}

function shouldDegradeKbEmbeddingFailure(error: unknown): boolean {
  const classified = classifyMemoryEmbeddingError(error);
  // Keep ingest durable under provider pressure; FTS still indexes the document.
  return classified.retryable || classified.reason === "rate_limit";
}

async function embedHierarchicalChunks(params: {
  provider: EmbeddingProvider | null;
  chunks: ReturnType<typeof chunkHierarchicalDocument>;
}): Promise<Array<{ chunk: (typeof params.chunks)[number]; embedding: number[] | undefined }>> {
  if (!params.provider) {
    return params.chunks.map((chunk) => ({ chunk, embedding: undefined }));
  }
  if (params.chunks.length === 0) {
    return [];
  }
  try {
    const memoryChunks = params.chunks.map((chunk) => ({
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      text: chunk.text,
      hash: chunk.hash,
    }));
    const split = enforceEmbeddingMaxInputTokens(params.provider, memoryChunks, undefined);
    const sized = attachHierarchyMetadata(params.chunks, split);
    const embeddings = await params.provider.embedBatch(sized.map((chunk) => chunk.text));
    return sized.map((chunk, index) => ({
      chunk,
      embedding: embeddings[index],
    }));
  } catch (error) {
    if (!shouldDegradeKbEmbeddingFailure(error)) {
      throw error;
    }
    return params.chunks.map((chunk) => ({ chunk, embedding: undefined }));
  }
}

export async function ingestKnowledgeDocument(
  params: IngestKnowledgeDocumentParams,
): Promise<IngestKnowledgeDocumentResult> {
  const extracted = await extractKnowledgeDocument({
    fileName: params.fileName,
    mimeType: params.mimeType,
    buffer: params.buffer,
    ocrEnabled: params.ocrEnabled,
    cfg: params.cfg,
  });

  assertIngestableExtract(extracted);

  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: params.ownerId,
    tenantId: params.tenantId,
    indexRoot: params.indexRoot,
  });
  const deferEmbedding = params.deferEmbedding === true;
  const embeddingProvider = deferEmbedding ? null : (params.embeddingProvider ?? null);
  const index = await openKnowledgeIndex({
    dbPath,
    vectorEnabled: embeddingProvider != null,
  });
  try {
    const latest = getLatestKnowledgeDocumentVersion(index.db, params.docId);
    const delta = planKnowledgeDocumentVersionDelta({
      existingRawHash: latest?.rawHash ?? null,
      existingSemanticHash: latest?.semanticHash ?? null,
      extracted,
    });

    if (delta === "unchanged") {
      return {
        delta,
        docId: params.docId,
        versionId: latest?.versionId ?? null,
        versionLabel: latest?.versionLabel ?? null,
        chunkCount: 0,
        skipped: true,
        extracted,
      };
    }

    const now = params.now ?? Date.now();
    const managed = Boolean(params.tenantId && params.tenantId.trim());
    const versionIdForWrite =
      delta === "raw_only"
        ? (latest?.versionId ?? null)
        : params.governanceVersionId?.trim() || randomUUID();
    const stateDir = params.governanceStateDir ?? resolveStateDir();
    const allowedRoots = [path.dirname(dbPath), stateDir];

    let writeSession: Awaited<ReturnType<typeof prepareKnowledgeContentWriteSession>> | undefined;

    // Fail-closed BEFORE any knowledge body / chunk / embedding land on disk.
    if (versionIdForWrite) {
      if (managed && !params.governanceOwnershipProof) {
        throw new Error("governance_write_denied:missing_ownership_proof");
      }
      if (delta === "raw_only") {
        // Update existing version — must already be active Catalog for managed.
        await requireKnowledgeContentWrite({
          resourceId: buildKnowledgeResourceId({
            tenantId: params.tenantId,
            contentClass: "document_version",
            docId: params.docId,
            versionId: versionIdForWrite,
          }),
          callerTenantId: params.tenantId,
          profile: managed ? "managed_enterprise" : "personal_local",
          ownershipProof: params.governanceOwnershipProof,
          allowMissingCatalog: !managed,
          stateDir,
        });
      } else {
        writeSession = await prepareKnowledgeContentWriteSession({
          tenantId: params.tenantId,
          docId: params.docId,
          versionId: versionIdForWrite,
          kbId: params.kbId,
          canonicalLocator: dbPath,
          ownershipProof: params.governanceOwnershipProof,
          stateDir,
        });
      }
    }

    try {
      // P2: persist Obsidian explicit metadata for graph enrichment (even when content unchanged).
      if (extracted.explicit) {
        try {
          upsertExplicitDocumentMetadata({
            docId: params.docId,
            title: params.title,
            knowledgeBaseId: params.kbId,
            metadata: extracted.explicit,
          });
        } catch {
          // best-effort; ingest must not fail on metadata store issues
        }
      }

      upsertKnowledgeDocument({
        db: index.db,
        docId: params.docId,
        kbId: params.kbId,
        title: params.title,
        contentType: extracted.format,
        now,
      });

      if (delta === "raw_only") {
        if (!latest) {
          throw new Error("raw_only delta requires an existing document version");
        }
        updateKnowledgeDocumentVersionRawHash({
          db: index.db,
          versionId: latest.versionId,
          rawHash: extracted.rawHash,
        });
        const storedRaw = getLatestKnowledgeDocumentVersion(index.db, params.docId);
        assertRawHash(extracted.rawHash, storedRaw?.rawHash ?? "");
        return {
          delta,
          docId: params.docId,
          versionId: latest.versionId,
          versionLabel: latest.versionLabel,
          chunkCount: 0,
          skipped: true,
          extracted,
        };
      }

      const versionCount = countKnowledgeDocumentVersions(index.db, params.docId);
      const versionId = versionIdForWrite!;
      const versionLabel = nextVersionLabel(versionCount);
      const version = insertKnowledgeDocumentVersion({
        db: index.db,
        versionId,
        docId: params.docId,
        versionLabel,
        rawHash: extracted.rawHash,
        semanticHash: extracted.semanticHash,
        publishedAt: params.publishedAt,
        now,
      });
      assertRawHash(extracted.rawHash, version.rawHash);
      updateKnowledgeDocumentCurrentVersion({
        db: index.db,
        docId: params.docId,
        versionId,
        now,
      });

      const chunking = params.chunking ?? DEFAULT_KB_CHUNKING;
      const hierarchical = chunkHierarchicalDocument(extracted.text, chunking);
      assertChunkLineAnchors(hierarchical);
      const model = embeddingProvider?.model ?? FTS_ONLY_EMBEDDING_MODEL;

      // P4: stable anchors + plan keep/update/add/remove against previous version.
      const nextAnchored = anchorHierarchicalChunks({
        kbId: params.kbId,
        docId: params.docId,
        chunks: hierarchical,
      });
      const previousRows = latest
        ? listKnowledgeChunksForVersion({
            db: index.db,
            docId: params.docId,
            versionId: latest.versionId,
          })
        : [];
      // Stable current anchors are overwritten/deleted by the delta below.
      // Preserve an immutable keyword-searchable snapshot for explicit historical reads.
      if (latest && previousRows.length) {
        upsertKnowledgeChunks({
          index,
          chunks: previousRows.map((row) => ({
            id: `history:${latest.versionId}:${row.chunkId}`,
            text: row.text,
            model: row.model,
            kbId: params.kbId,
            docId: params.docId,
            versionId: latest.versionId,
            heading: row.heading,
            section: row.section,
            startLine: row.startLine,
            endLine: row.endLine,
            visibility: params.visibility ?? null,
            source: params.source ?? null,
          })),
        });
      }
      const previous = anchorPreviousChunkSnapshots({
        kbId: params.kbId,
        docId: params.docId,
        chunks: previousRows,
      });
      const deltaPlan = planChunkDelta({
        previous,
        next: nextAnchored,
        model,
      });
      const chunkDelta = summarizeChunkDelta(deltaPlan);

      // Only embed chunks that are new or text/model-changed (index-aligned with needEmbed).
      const needEmbed = [...deltaPlan.update.map((item) => item.next), ...deltaPlan.add];
      const embedded = await embedHierarchicalChunks({
        provider: embeddingProvider,
        chunks: needEmbed,
      });
      // Map by original needEmbed order/anchor — embedHierarchicalChunks may split/reshape text
      // but we only use embeddings when the batch length matches (common path); otherwise re-embed singly.
      const embeddingByAnchor = new Map<string, number[] | undefined>();
      if (embedded.length === needEmbed.length) {
        for (let i = 0; i < needEmbed.length; i += 1) {
          embeddingByAnchor.set(needEmbed[i].anchorId, embedded[i].embedding);
        }
      } else {
        for (const next of needEmbed) {
          const one = await embedHierarchicalChunks({
            provider: embeddingProvider,
            chunks: [next],
          });
          embeddingByAnchor.set(next.anchorId, one[0]?.embedding);
        }
      }
      const embeddedAny = embedded.some((entry) => entry.embedding && entry.embedding.length > 0);
      const persistedModel = embeddedAny ? model : FTS_ONLY_EMBEDDING_MODEL;

      const source = params.source ?? params.fileName;
      const visibility = params.visibility ?? null;

      // Drop removed slots + any previous ids that will be replaced by a different stable id.
      const idsToDelete = new Set<string>(deltaPlan.remove.map((item) => item.chunkId));
      for (const item of [...deltaPlan.keep, ...deltaPlan.update]) {
        if (item.prev.chunkId !== item.next.anchorId) {
          idsToDelete.add(item.prev.chunkId);
        }
      }
      if (idsToDelete.size > 0) {
        deleteKnowledgeChunksByIds({
          db: index.db,
          index,
          chunkIds: [...idsToDelete],
        });
      }

      // Keep: same stable id + same text → retarget version/lines only (no re-embed).
      // If previous used a legacy id, treat as insert with re-embed (covered by id migration delete above).
      const keepRows: KnowledgeChunkInsert[] = [];
      const reembedAsAdd: typeof deltaPlan.add = [];
      for (const { prev, next } of deltaPlan.keep) {
        if (prev.chunkId === next.anchorId) {
          keepRows.push({
            id: next.anchorId,
            text: next.text,
            model: prev.model,
            kbId: params.kbId,
            docId: params.docId,
            versionId,
            heading: next.heading,
            section: next.section,
            startLine: next.startLine,
            endLine: next.endLine,
            visibility,
            source,
          });
        } else {
          reembedAsAdd.push(next);
        }
      }

      const updateRows: KnowledgeChunkInsert[] = deltaPlan.update.map(({ next }) => ({
        id: next.anchorId,
        text: next.text,
        model: persistedModel,
        kbId: params.kbId,
        docId: params.docId,
        versionId,
        heading: next.heading,
        section: next.section,
        startLine: next.startLine,
        endLine: next.endLine,
        visibility,
        source,
        embedding: embeddingByAnchor.get(next.anchorId),
      }));

      // Re-embed migrated keeps (legacy id → stable id).
      for (const next of reembedAsAdd) {
        if (embeddingByAnchor.has(next.anchorId)) {
          continue;
        }
        const one = await embedHierarchicalChunks({
          provider: embeddingProvider,
          chunks: [next],
        });
        embeddingByAnchor.set(next.anchorId, one[0]?.embedding);
      }

      const addRows: KnowledgeChunkInsert[] = [...deltaPlan.add, ...reembedAsAdd].map((next) => ({
        id: next.anchorId,
        text: next.text,
        model: persistedModel,
        kbId: params.kbId,
        docId: params.docId,
        versionId,
        heading: next.heading,
        section: next.section,
        startLine: next.startLine,
        endLine: next.endLine,
        visibility,
        source,
        embedding: embeddingByAnchor.get(next.anchorId),
      }));

      const chunkRows = [...keepRows, ...updateRows, ...addRows];
      upsertKnowledgeChunks({ index, chunks: chunkRows });

      // Governance only for changed/new chunks (true keeps skip re-analysis).
      const governanceChunkIds = [...updateRows, ...addRows].map((row) => row.id);
      if (governanceChunkIds.length > 0) {
        enqueuePostIngestGovernanceJobs({
          db: index.db,
          kbId: params.kbId,
          docId: params.docId,
          versionId,
          chunkIds: governanceChunkIds,
        });
      }

      // Summary work is derivative and must never invalidate committed body chunks.
      try {
        queueRetrievalSummary(index.db, {
          docId: params.docId,
          kbId: params.kbId,
          versionId,
          contentHash: extracted.semanticHash,
        });
      } catch {
        createSubsystemLogger("knowledge/retrieval-summary").warn(
          "summary queue unavailable; body remains indexed",
        );
      }

      const vectorizeQueued =
        (deferEmbedding || !embeddedAny) &&
        enqueueKnowledgeVectorizeInIndex(index.db, {
          kbId: params.kbId,
          docId: params.docId,
          versionId,
        });

      if (writeSession) {
        await finalizeKnowledgeContentWriteSession({
          session: writeSession,
          ok: true,
          stateDir,
          allowedRoots,
        });
      }

      return {
        delta,
        docId: params.docId,
        versionId: version.versionId,
        versionLabel: version.versionLabel,
        chunkCount: chunkRows.length,
        skipped: false,
        ...(vectorizeQueued ? { vectorizeQueued: true } : {}),
        extracted,
        chunkDelta,
      };
    } catch (err) {
      if (writeSession) {
        await finalizeKnowledgeContentWriteSession({
          session: writeSession,
          ok: false,
          reason: String((err as Error)?.message ?? err),
          stateDir,
          allowedRoots,
        });
      }
      throw err;
    }
  } finally {
    index.close();
  }
}
