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
    indexRoot,
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
  if (evidence.length > 0) {
    return { knowledgeBase, evidence, searchMode: "indexed", substringMatches: [] };
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
  const substringMatches = bundle.objects
    .filter((item) => objectIds.has(item.id) && matchesKnowledgeObjectQuery(item, trimmed))
    .slice(0, limit);
  return { knowledgeBase, evidence: [], searchMode: "substring", substringMatches };
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
