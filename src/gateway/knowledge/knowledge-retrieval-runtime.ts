import fs from "node:fs";
import { listAgentIds } from "../../agents/agent-scope.js";
import type { OpenBotConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { getKnowledgeRetrievalService } from "../../retrieval/retrieval-service.js";
import {
  ensureDeliverableRetrievalSourceRegistered,
  type DeliverableSourceDeps,
} from "../../retrieval/sources/deliverable-source.js";
import {
  ensureKnowledgeRetrievalSourceRegistered,
  type KnowledgeSourceDeps,
} from "../../retrieval/sources/knowledge-source.js";
import {
  allowsEmptyRetrievalQuery,
  type KnowledgeEvidence,
  type RetrievalContext,
} from "../../retrieval/types.js";
import {
  isKnowledgeBaseVisible,
  resolveAccessibleKnowledgeBases,
  type VisibilityKnowledgeBase,
} from "../../retrieval/visibility-resolver.js";
import type { GatewayClient } from "../server-methods/types.js";
import { knowledgeDocumentIdFromSkillRef } from "./document-display-title.js";
import {
  knowledgeBaseHasIndexedChunks,
  openKnowledgeIndex,
  resolveKnowledgeIndexDbPath,
} from "./kb-index.js";
import { resolveKnowledgeIngestEmbeddingProvider } from "./kb-ingest.js";
import {
  getKnowledgeBase,
  listKnowledgeBases,
  type KnowledgeBase,
} from "./knowledge-base-store.js";
import { resolveKnowledgeIndexRootForBase } from "./knowledge-directory.js";
import { recallDocumentRetrievalSummaries } from "./retrieval-summary-document.js";
import { loadKnowledgeSourceBundle } from "./source-bundle.js";
import type { KnowledgeSourceContext } from "./sources/types.js";
import type { KnowledgeObject } from "./types.js";

const log = createSubsystemLogger("gateway/knowledge");

let bootstrapPromise: Promise<void> | null = null;

export type KnowledgeSearchMode = "indexed" | "substring";

export function retrievalContextFromKnowledgeSourceContext(
  context: KnowledgeSourceContext,
  extras?: { agentId?: string | null },
): RetrievalContext {
  const agentId = extras?.agentId?.trim();
  return {
    userId: context.userId,
    seatId: context.seatId,
    tenantId: context.tenantId,
    departmentId: context.departmentId ?? null,
    roleCodes: context.roleCode ? [context.roleCode] : undefined,
    ...(agentId ? { agentId } : {}),
  };
}

export function toVisibilityKnowledgeBase(base: KnowledgeBase): VisibilityKnowledgeBase {
  return {
    id: base.id,
    visibility: base.visibility,
    ownerId: base.ownerId,
    tenantId: base.tenantId,
  };
}

export async function resolveKnowledgeBaseHasIndexedChunks(
  base: KnowledgeBase,
  indexRoot?: string,
): Promise<boolean> {
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: base.ownerId,
    tenantId: base.tenantId,
    indexRoot: resolveKnowledgeIndexRootForBase(base, { indexRoot }),
  });
  if (!fs.existsSync(dbPath)) {
    return false;
  }
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    return knowledgeBaseHasIndexedChunks(index.db, base.id);
  } finally {
    index.close();
  }
}

export async function anyAccessibleKnowledgeBaseHasIndexedChunks(params: {
  retrievalContext: RetrievalContext;
  storePath?: string;
  indexRoot?: string;
}): Promise<boolean> {
  const bases = listKnowledgeBases({}, params.storePath);
  const accessibleIds = new Set(
    resolveAccessibleKnowledgeBases(
      params.retrievalContext,
      bases.map((base) => toVisibilityKnowledgeBase(base)),
    ),
  );
  for (const base of bases) {
    if (!accessibleIds.has(base.id)) {
      continue;
    }
    if (await resolveKnowledgeBaseHasIndexedChunks(base, params.indexRoot)) {
      return true;
    }
  }
  return false;
}

export async function searchKnowledgeEvidence(params: {
  query: string;
  retrievalContext: RetrievalContext;
  kbScope?: string[];
  maxResults?: number;
  minScore?: number;
  versionId?: string;
  docId?: string;
  fallbackToCurrentChunks?: boolean;
  sourceDeps?: KnowledgeSourceDeps & DeliverableSourceDeps;
}): Promise<KnowledgeEvidence[]> {
  const trimmed = params.query.trim();
  if (
    !trimmed &&
    !allowsEmptyRetrievalQuery({
      docId: params.docId,
      fallbackToCurrentChunks: params.fallbackToCurrentChunks,
    })
  ) {
    return [];
  }
  await ensureGatewayKnowledgeRetrievalBootstrapped();
  const deps = params.sourceDeps ?? {};
  ensureKnowledgeRetrievalSourceRegistered(deps);
  ensureDeliverableRetrievalSourceRegistered(deps);
  return getKnowledgeRetrievalService().search(trimmed, params.retrievalContext, {
    kbScope: params.kbScope,
    maxResults: params.maxResults,
    minScore: params.minScore,
    versionId: params.versionId,
    docId: params.docId,
    fallbackToCurrentChunks: params.fallbackToCurrentChunks,
  });
}

export async function searchScopedKnowledgeBaseEvidence(params: {
  knowledgeBaseId: string;
  query: string;
  retrievalContext: RetrievalContext;
  storePath?: string;
  indexRoot?: string;
  maxResults?: number;
  minScore?: number;
  versionId?: string;
  docId?: string;
}): Promise<{ knowledgeBase: KnowledgeBase | null; evidence: KnowledgeEvidence[] }> {
  const knowledgeBase = getKnowledgeBase(params.knowledgeBaseId, params.storePath);
  if (
    !knowledgeBase ||
    !isKnowledgeBaseVisible(params.retrievalContext, toVisibilityKnowledgeBase(knowledgeBase))
  ) {
    return { knowledgeBase: null, evidence: [] };
  }
  const hasIndex = await resolveKnowledgeBaseHasIndexedChunks(knowledgeBase, params.indexRoot);
  if (!hasIndex) {
    return { knowledgeBase, evidence: [] };
  }
  const evidence = await searchKnowledgeEvidence({
    query: params.query,
    retrievalContext: params.retrievalContext,
    kbScope: [knowledgeBase.id],
    maxResults: params.maxResults,
    minScore: params.minScore,
    versionId: params.versionId,
    docId: params.docId,
    sourceDeps: { storePath: params.storePath, indexRoot: params.indexRoot },
  });
  return { knowledgeBase, evidence };
}

function personalObjectIdForDocument(documentId: string): string {
  if (documentId.startsWith("obj:personal:")) {
    return documentId;
  }
  return `obj:personal:${documentId}`;
}

function matchesKnowledgeObjectQuery(object: KnowledgeObject, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const haystack = [object.title, object.summary, object.tags.join(" "), object.source, object.kind]
    .join(" ")
    .toLowerCase();
  return haystack.includes(normalized);
}

export async function searchScopedKnowledgeBaseWithFallback(params: {
  client: GatewayClient | null;
  knowledgeBaseId: string;
  query: string;
  retrievalContext: RetrievalContext;
  storePath?: string;
  indexRoot?: string;
  maxResults?: number;
  minScore?: number;
  versionId?: string;
  docId?: string;
}): Promise<{
  knowledgeBase: KnowledgeBase | null;
  evidence: KnowledgeEvidence[];
  searchMode: KnowledgeSearchMode;
  substringMatches: KnowledgeObject[];
}> {
  const trimmed = params.query.trim();
  const { knowledgeBase, evidence } = await searchScopedKnowledgeBaseEvidence({
    knowledgeBaseId: params.knowledgeBaseId,
    query: trimmed,
    retrievalContext: params.retrievalContext,
    storePath: params.storePath,
    indexRoot: params.indexRoot,
    maxResults: params.maxResults,
    minScore: params.minScore,
    versionId: params.versionId,
    docId: params.docId,
  });
  if (!knowledgeBase) {
    return { knowledgeBase: null, evidence: [], searchMode: "substring", substringMatches: [] };
  }
  if (!trimmed) {
    return { knowledgeBase, evidence: [], searchMode: "substring", substringMatches: [] };
  }
  const bundle = await loadKnowledgeSourceBundle(params.client);
  const objectIds = new Set<string>();
  for (const documentId of knowledgeBase.documentIds) {
    objectIds.add(documentId);
    objectIds.add(personalObjectIdForDocument(documentId));
  }
  const limit = Math.min(Math.max(params.maxResults ?? 8, 1), 50);
  // This KB has already passed resolveAccessibleKnowledgeBases above. Derivative
  // summaries never widen the authorized candidate set or become body evidence.
  const summaryHits = await recallDocumentRetrievalSummaries({
    knowledgeBase,
    query: trimmed,
    indexRoot: params.indexRoot,
    limit,
  });
  const candidates = new Map<
    string,
    KnowledgeObject & { retrievalScore: number; sourceUri?: string }
  >();
  for (const item of bundle.objects) {
    const skillRef = item.id.startsWith("obj:personal:")
      ? item.id.slice("obj:personal:".length)
      : null;
    const attachedByCanonicalId = skillRef
      ? objectIds.has(knowledgeDocumentIdFromSkillRef(knowledgeBase.id, skillRef))
      : false;
    if (
      (objectIds.has(item.id) || attachedByCanonicalId) &&
      matchesKnowledgeObjectQuery(item, trimmed)
    ) {
      candidates.set(item.id, { ...item, retrievalScore: 0.5 });
    }
  }
  for (const hit of summaryHits) {
    const existing =
      candidates.get(hit.docId) ?? candidates.get(personalObjectIdForDocument(hit.docId));
    const id = existing?.id ?? hit.docId;
    candidates.set(id, {
      ...(existing ?? {
        id,
        title: hit.title,
        source: knowledgeBase.visibility === "private" ? "personal" : "enterprise",
        kind: "document",
        summary: "检索摘要匹配；请读取原文核验。",
        tags: [],
        updatedAt: 0,
      }),
      retrievalScore: hit.score,
      retrievalNavigation: {
        docId: hit.docId,
        kbId: knowledgeBase.id,
        sourceUri: hit.sourceUri,
        score: hit.score,
      },
      sourceUri: hit.sourceUri,
    });
  }
  const substringMatches = [...candidates.values()]
    .toSorted((a, b) => b.retrievalScore - a.retrievalScore || a.id.localeCompare(b.id))
    .slice(0, limit);
  return {
    knowledgeBase,
    evidence,
    searchMode: evidence.length ? "indexed" : "substring",
    substringMatches,
  };
}

export async function ensureGatewayKnowledgeRetrievalBootstrapped(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      try {
        const cfg = loadConfig();
        await startGatewayKnowledgeRetrieval({ cfg, log });
      } catch (err) {
        log.warn(`knowledge retrieval bootstrap failed: ${String(err)}`);
        ensureKnowledgeRetrievalSourceRegistered({});
        ensureDeliverableRetrievalSourceRegistered({});
      }
    })();
  }
  await bootstrapPromise;
}

export async function startGatewayKnowledgeRetrieval(params: {
  cfg: OpenBotConfig;
  log: { info?: (msg: string) => void; warn: (msg: string) => void };
}): Promise<void> {
  let embeddingProvider = null;
  for (const agentId of listAgentIds(params.cfg)) {
    try {
      embeddingProvider = await resolveKnowledgeIngestEmbeddingProvider({
        cfg: params.cfg,
        agentId,
      });
      if (embeddingProvider) {
        break;
      }
    } catch (err) {
      params.log.warn(
        `knowledge retrieval embedding provider unavailable for agent "${agentId}": ${String(err)}`,
      );
    }
  }
  ensureKnowledgeRetrievalSourceRegistered({ embeddingProvider });
  ensureDeliverableRetrievalSourceRegistered({ embeddingProvider });
  params.log.info?.("knowledge retrieval source registered on gateway startup");
}

/** Authorized document navigation candidates across every visible KB. */
export async function searchAuthorizedSummaryCandidates(params: {
  query: string;
  retrievalContext: RetrievalContext;
  limit?: number;
}): Promise<KnowledgeObject[]> {
  const limit = Math.min(Math.max(params.limit ?? 8, 1), 50);
  const bases = listKnowledgeBases().filter((base) =>
    isKnowledgeBaseVisible(params.retrievalContext, toVisibilityKnowledgeBase(base)),
  );
  const candidates: Array<KnowledgeObject & { score: number }> = [];
  for (const base of bases) {
    const hits = await recallDocumentRetrievalSummaries({
      knowledgeBase: base,
      query: params.query,
      limit,
    });
    for (const hit of hits) {
      candidates.push({
        id: hit.docId,
        title: hit.title,
        summary: "摘要导览命中；请读取原文核验。",
        tags: [],
        updatedAt: 0,
        kind: "document",
        source: base.visibility === "private" ? "personal" : "enterprise",
        score: hit.score,
        retrievalNavigation: {
          docId: hit.docId,
          kbId: base.id,
          sourceUri: hit.sourceUri,
          score: hit.score,
        },
      });
    }
  }
  return candidates
    .toSorted((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}
