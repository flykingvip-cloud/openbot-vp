import { Type } from "@sinclair/typebox";
import { resolveKnowledgeToolGatewayClient } from "../../gateway/knowledge/agent-run-gateway-client.js";
import type { KnowledgeConsumeRef } from "../../gateway/knowledge/consume-ref.js";
import { resolveKnowledgeSourceContext } from "../../gateway/knowledge/context.js";
import {
  documentNodeObjectId,
  parseDocumentObjectId,
} from "../../gateway/knowledge/document-ego-graph.js";
import { parseKnowledgeEvidenceUri } from "../../gateway/knowledge/kb-retrieve.js";
import {
  retrievalContextFromKnowledgeSourceContext,
  searchKnowledgeEvidence,
} from "../../gateway/knowledge/knowledge-retrieval-runtime.js";
import { knowledgeObject, knowledgeSearch } from "../../gateway/knowledge/router.js";
import type { KnowledgeObject } from "../../gateway/knowledge/types.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import type { KnowledgeEvidence } from "../../retrieval/types.js";
import { truncateUtf16Safe } from "../../utils.js";
import { jsonResult, readNumberParam, readStringParam, ToolInputError } from "./common.js";
import type { AnyAgentTool } from "./common.js";
import {
  fileIdFromKnowledgeObjectId,
  isKnowledgeTargetInConsumeScope,
  resolveKnowledgeConsumeSearchScope,
  type KnowledgeConsumeSearchScope,
} from "./knowledge-consume-scope.js";

const SEARCH_EXCERPT_CHARS = 800;
const SEARCH_DEFAULT_LIMIT = 8;
const SEARCH_MAX_LIMIT = 20;
const GET_MAX_CHUNKS = 12;
const GET_MAX_TOTAL_CHARS = 12_000;

const KnowledgeSearchToolSchema = Type.Object({
  query: Type.String({
    description: "Natural-language query for ingested Knowledge Universe documents.",
  }),
  limit: Type.Optional(
    Type.Number({
      description: `Max hits (default ${SEARCH_DEFAULT_LIMIT}, max ${SEARCH_MAX_LIMIT}).`,
    }),
  ),
  knowledgeBaseId: Type.Optional(
    Type.String({
      description: "Optional knowledge-base id to restrict indexed search.",
    }),
  ),
});

const KnowledgeGetToolSchema = Type.Object({
  objectId: Type.Optional(
    Type.String({
      description: "Knowledge object id from knowledge_search, e.g. obj:doc:<docId>.",
    }),
  ),
  sourceUri: Type.Optional(
    Type.String({
      description: "Citation URI from search, e.g. ku://kb/<kbId>/doc/<docId>@<versionId>.",
    }),
  ),
  docId: Type.Optional(Type.String({ description: "Library document id." })),
  knowledgeBaseId: Type.Optional(
    Type.String({
      description: "Knowledge-base id. Required with docId when objectId/sourceUri are absent.",
    }),
  ),
  query: Type.Optional(
    Type.String({
      description: "Optional in-document query to rank chunks. Empty loads current-version chunks.",
    }),
  ),
});

export type KnowledgeConsumeToolOptions = {
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionEnterpriseId?: string;
  gatewayClientSessionMembershipId?: string;
  agentId?: string;
  ownerUserId?: string;
  tenantId?: string;
  consumeRefs?: KnowledgeConsumeRef[];
};

type KnowledgeHitGovernance = "verified" | "conflict" | "suppressed" | null;

type KnowledgeSearchHit = {
  objectId: string;
  docId: string;
  kbId: string | null;
  title: string;
  sourceUri: string | null;
  section: string | null;
  excerpt: string;
  score: number | null;
  governance: KnowledgeHitGovernance;
};

function clampSearchLimit(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) {
    return SEARCH_DEFAULT_LIMIT;
  }
  return Math.min(Math.max(Math.floor(value), 1), SEARCH_MAX_LIMIT);
}

function formatGovernance(evidence: KnowledgeEvidence): KnowledgeHitGovernance {
  if (evidence.governanceConflict || evidence.governanceClaimConflict) {
    return "conflict";
  }
  if (evidence.governanceStatus === "suppressed") {
    return "suppressed";
  }
  if (evidence.governanceStatus === "confirmed") {
    return "verified";
  }
  return null;
}

function hitFromEvidence(evidence: KnowledgeEvidence): KnowledgeSearchHit {
  return {
    objectId: documentNodeObjectId(evidence.docId),
    docId: evidence.docId,
    kbId: evidence.kbId,
    title: evidence.docTitle,
    sourceUri: evidence.sourceUri,
    section: evidence.section ?? evidence.heading ?? null,
    excerpt: truncateUtf16Safe(
      evidence.chunkText.trim().replace(/\s+/g, " "),
      SEARCH_EXCERPT_CHARS,
    ),
    score: evidence.score,
    governance: formatGovernance(evidence),
  };
}

function hitFromObject(object: KnowledgeObject): KnowledgeSearchHit {
  return {
    objectId: object.id,
    docId: parseDocumentObjectId(object.id) ?? "",
    kbId: null,
    title: object.title,
    sourceUri: null,
    section: null,
    excerpt: truncateUtf16Safe(object.summary.trim().replace(/\s+/g, " "), SEARCH_EXCERPT_CHARS),
    score: null,
    governance: null,
  };
}

async function resolveAccess(options?: KnowledgeConsumeToolOptions) {
  const client = await resolveKnowledgeToolGatewayClient({
    gatewayClientUser: options?.gatewayClientUser,
    gatewayClientSessionDomain: options?.gatewayClientSessionDomain,
    gatewayClientPlatformUserId: options?.gatewayClientPlatformUserId,
    gatewayClientSessionEnterpriseId: options?.gatewayClientSessionEnterpriseId,
    gatewayClientSessionMembershipId: options?.gatewayClientSessionMembershipId,
    agentId: options?.agentId,
    ownerUserId: options?.ownerUserId,
    tenantId: options?.tenantId,
  });
  if (!client) {
    throw new ToolInputError("Signed-in employee session is required.");
  }
  const context = await resolveKnowledgeSourceContext(client);
  return {
    client,
    retrievalContext: retrievalContextFromKnowledgeSourceContext(context, {
      agentId: options?.agentId,
    }),
  };
}

function resolveGetTarget(
  params: Record<string, unknown>,
  consumeScope: KnowledgeConsumeSearchScope,
): {
  objectId?: string;
  docId?: string;
  knowledgeBaseId?: string;
  versionId?: string;
} {
  const sourceUri = readStringParam(params, "sourceUri");
  const parsedUri = sourceUri ? parseKnowledgeEvidenceUri(sourceUri) : null;
  if (sourceUri && !parsedUri) {
    throw new ToolInputError(
      "sourceUri must be a ku://kb/<kbId>/doc/<docId>@<versionId> citation.",
    );
  }
  const objectId = readStringParam(params, "objectId");
  const requestedDocId = readStringParam(params, "docId");
  const docId =
    parsedUri?.docId ??
    parseDocumentObjectId(objectId ?? "") ??
    fileIdFromKnowledgeObjectId(objectId) ??
    requestedDocId;
  const knowledgeBaseId = parsedUri?.kbId ?? readStringParam(params, "knowledgeBaseId");
  const resolvedObjectId = objectId ?? (docId ? documentNodeObjectId(docId) : undefined);
  if (!resolvedObjectId && !docId) {
    if (consumeScope.focused && consumeScope.docIds.length === 1) {
      return {
        docId: consumeScope.docIds[0],
        ...(consumeScope.knowledgeBaseIds[0]
          ? { knowledgeBaseId: consumeScope.knowledgeBaseIds[0] }
          : {}),
      };
    }
    throw new ToolInputError("objectId, sourceUri, or docId + knowledgeBaseId is required.");
  }
  if (docId && !knowledgeBaseId && !resolvedObjectId) {
    throw new ToolInputError("knowledgeBaseId is required when only docId is provided.");
  }
  return {
    ...(resolvedObjectId ? { objectId: resolvedObjectId } : {}),
    ...(docId ? { docId } : {}),
    ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
    ...(parsedUri?.versionId ? { versionId: parsedUri.versionId } : {}),
  };
}

function searchToolDescription(consumeScope: KnowledgeConsumeSearchScope): string {
  if (consumeScope.focused && consumeScope.docIds.length === 1) {
    return `Search only the currently selected Knowledge Universe document (${consumeScope.docIds[0]}). Do not search other libraries or authorized collections. Use knowledge_get to read more.`;
  }
  if (consumeScope.focused && consumeScope.knowledgeBaseIds.length > 0) {
    return `Search only the selected knowledge base(s): ${consumeScope.knowledgeBaseIds.join(", ")}. Do not search the rest of the library. Returns objectId and ku:// sourceUri for knowledge_get.`;
  }
  return "Search the signed-in employee's Knowledge Universe. Use for library files and for materialized enterprise feed objects such as 用友 T+ 仓库/存货. Do not use for workspace memory (memory_search) or API bind/invoke (knowledge_source). data_capability action=invoke does not return ERP rows. Returns objectId for knowledge_get. Never search the filesystem or open 云电脑 for these rows.";
}

function getToolDescription(consumeScope: KnowledgeConsumeSearchScope): string {
  if (consumeScope.focused && consumeScope.docIds.length === 1) {
    return `Read the currently selected Knowledge Universe document (${consumeScope.docIds[0]}). Omit objectId to load that file. Refuse documents outside this selection.`;
  }
  return "Read one Knowledge Universe object after knowledge_search. Pass objectId or ku:// sourceUri. For an enterprise feed object the summary is the materialized payload excerpt (warehouse and inventory rows). Not for memory files or live connector calls. Do not guess workspace paths, run exec find, or open 云电脑.";
}

async function loadScopedObject(
  client: GatewayClient,
  docId: string,
  knowledgeBaseId?: string,
): Promise<KnowledgeObject | null> {
  const candidates = [
    `obj:personal:${docId}`,
    documentNodeObjectId(docId),
    `obj:enterprise:${docId}`,
  ];
  for (const objectId of candidates) {
    const object = await knowledgeObject(client, {
      objectId,
      knowledgeBaseId,
    });
    if (object) {
      return object;
    }
  }
  return null;
}

function focusedKbScope(
  consumeScope: KnowledgeConsumeSearchScope,
  requestedKb?: string,
): string[] | undefined {
  if (requestedKb) {
    if (
      consumeScope.knowledgeBaseIds.length > 0 &&
      !consumeScope.knowledgeBaseIds.includes(requestedKb)
    ) {
      return [];
    }
    return [requestedKb];
  }
  return consumeScope.knowledgeBaseIds.length > 0 ? consumeScope.knowledgeBaseIds : undefined;
}

function budgetChunks(evidence: KnowledgeEvidence[]): {
  chunks: Array<{
    sourceUri: string;
    section: string | null;
    text: string;
    score: number;
    governance: KnowledgeHitGovernance;
  }>;
  truncated: boolean;
} {
  const chunks: Array<{
    sourceUri: string;
    section: string | null;
    text: string;
    score: number;
    governance: KnowledgeHitGovernance;
  }> = [];
  let used = 0;
  let truncated = evidence.length > GET_MAX_CHUNKS;
  for (const item of evidence.slice(0, GET_MAX_CHUNKS)) {
    const text = item.chunkText.trim();
    if (!text) {
      continue;
    }
    if (used + text.length > GET_MAX_TOTAL_CHARS) {
      truncated = true;
      break;
    }
    used += text.length;
    chunks.push({
      sourceUri: item.sourceUri,
      section: item.section ?? item.heading ?? null,
      text,
      score: item.score,
      governance: formatGovernance(item),
    });
  }
  return { chunks, truncated };
}

export function createKnowledgeSearchTool(options?: KnowledgeConsumeToolOptions): AnyAgentTool {
  const consumeScope = resolveKnowledgeConsumeSearchScope(options?.consumeRefs);
  return {
    name: "knowledge_search",
    label: "Knowledge Search",
    description: searchToolDescription(consumeScope),
    parameters: KnowledgeSearchToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const limit = clampSearchLimit(readNumberParam(params, "limit"));
      const knowledgeBaseId = readStringParam(params, "knowledgeBaseId");
      const { client, retrievalContext } = await resolveAccess(options);

      if (consumeScope.focused) {
        const kbScope = focusedKbScope(consumeScope, knowledgeBaseId);
        if (kbScope && kbScope.length === 0) {
          return jsonResult({
            ok: true,
            searchMode: "substring",
            hits: [],
            hint: "out_of_scope",
          });
        }
        if (consumeScope.docIds.length > 0) {
          const evidence: KnowledgeEvidence[] = [];
          for (const docId of consumeScope.docIds) {
            const found = await searchKnowledgeEvidence({
              query,
              retrievalContext,
              docId,
              ...(kbScope ? { kbScope } : {}),
              maxResults: limit,
              fallbackToCurrentChunks: true,
            });
            evidence.push(...found);
          }
          if (evidence.length > 0) {
            return jsonResult({
              ok: true,
              searchMode: "indexed",
              hits: evidence.slice(0, limit).map(hitFromEvidence),
            });
          }
          const hits: KnowledgeSearchHit[] = [];
          for (const docId of consumeScope.docIds) {
            const object = await loadScopedObject(client, docId, kbScope?.[0]);
            hits.push(
              object
                ? hitFromObject(object)
                : {
                    objectId: documentNodeObjectId(docId),
                    docId,
                    kbId: kbScope?.[0] ?? null,
                    title: docId,
                    sourceUri: null,
                    section: null,
                    excerpt: "",
                    score: null,
                    governance: null,
                  },
            );
          }
          return jsonResult({
            ok: true,
            searchMode: "substring",
            hits: hits.slice(0, limit),
            hint: "not_indexed",
          });
        }
        if (kbScope?.length) {
          const evidence = await searchKnowledgeEvidence({
            query,
            retrievalContext,
            kbScope,
            maxResults: limit,
          });
          if (evidence.length > 0) {
            return jsonResult({
              ok: true,
              searchMode: "indexed",
              hits: evidence.map(hitFromEvidence),
            });
          }
          return jsonResult({
            ok: true,
            searchMode: "substring",
            hits: [],
            hint: "not_indexed",
          });
        }
        return jsonResult({
          ok: true,
          searchMode: "substring",
          hits: [],
          hint: "not_indexed",
        });
      }

      if (knowledgeBaseId) {
        const evidence = await searchKnowledgeEvidence({
          query,
          retrievalContext,
          kbScope: [knowledgeBaseId],
          maxResults: limit,
        });
        if (evidence.length > 0) {
          return jsonResult({
            ok: true,
            searchMode: "indexed",
            hits: evidence.map(hitFromEvidence),
          });
        }
        return jsonResult({
          ok: true,
          searchMode: "substring",
          hits: [],
          hint: "not_indexed",
        });
      }

      const result = await knowledgeSearch(client, { query, limit });
      const feedHits = result.results
        .filter((item) => item.source === "enterprise")
        .map(hitFromObject);
      if (result.searchMode === "indexed" && result.evidence.length > 0) {
        const hits = [...feedHits, ...result.evidence.slice(0, limit).map(hitFromEvidence)].slice(
          0,
          limit,
        );
        return jsonResult({
          ok: true,
          searchMode: feedHits.length > 0 ? "enterprise_feed" : "indexed",
          hits,
          ...(feedHits.length > 0
            ? {
                note: "Enterprise feed hits are materialized knowledge objects. Cite their title and excerpt. Do not open 云电脑 and do not invoke connector actions.",
              }
            : {}),
        });
      }
      return jsonResult({
        ok: true,
        searchMode: feedHits.length > 0 ? "enterprise_feed" : "substring",
        hits: result.results.slice(0, limit).map(hitFromObject),
        ...(feedHits.length > 0
          ? {
              note: "Enterprise feed hits are materialized knowledge objects. Cite their title and excerpt. Do not open 云电脑 and do not invoke connector actions.",
            }
          : { hint: "not_indexed" }),
      });
    },
  };
}

export function createKnowledgeGetTool(options?: KnowledgeConsumeToolOptions): AnyAgentTool {
  const consumeScope = resolveKnowledgeConsumeSearchScope(options?.consumeRefs);
  return {
    name: "knowledge_get",
    label: "Knowledge Get",
    description: getToolDescription(consumeScope),
    parameters: KnowledgeGetToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const target = resolveGetTarget(params, consumeScope);
      if (!isKnowledgeTargetInConsumeScope(consumeScope, target)) {
        return jsonResult({ ok: false, error: "out_of_scope" });
      }
      const query = readStringParam(params, "query");
      const { client, retrievalContext } = await resolveAccess(options);

      const explicitObjectId = readStringParam(params, "objectId");
      const explicitDocId = readStringParam(params, "docId");
      const explicitSourceUri = readStringParam(params, "sourceUri");
      const object = target.objectId
        ? await knowledgeObject(client, {
            objectId: target.objectId,
            knowledgeBaseId: target.knowledgeBaseId,
          })
        : target.docId
          ? await loadScopedObject(client, target.docId, target.knowledgeBaseId)
          : null;
      if (!object && !target.docId) {
        return jsonResult({ ok: false, error: "not_found" });
      }
      if (!object && explicitObjectId && !explicitDocId && !explicitSourceUri) {
        return jsonResult({ ok: false, error: "not_found" });
      }
      if (
        object &&
        !isKnowledgeTargetInConsumeScope(consumeScope, {
          objectId: object.id,
          docId:
            parseDocumentObjectId(object.id) ?? fileIdFromKnowledgeObjectId(object.id) ?? undefined,
          knowledgeBaseId: target.knowledgeBaseId,
        })
      ) {
        return jsonResult({ ok: false, error: "out_of_scope" });
      }

      const docId =
        target.docId ??
        (object
          ? (parseDocumentObjectId(object.id) ??
            fileIdFromKnowledgeObjectId(object.id) ??
            undefined)
          : undefined);
      const retrievalQuery = query ?? object?.title ?? "";
      const evidence = docId
        ? await searchKnowledgeEvidence({
            query: retrievalQuery,
            retrievalContext,
            docId,
            ...(target.knowledgeBaseId ? { kbScope: [target.knowledgeBaseId] } : {}),
            ...(target.versionId ? { versionId: target.versionId } : {}),
            maxResults: GET_MAX_CHUNKS,
            fallbackToCurrentChunks: true,
          })
        : [];
      const { chunks, truncated } = budgetChunks(evidence);
      return jsonResult({
        ok: true,
        object: object
          ? {
              id: object.id,
              title: object.title,
              source: object.source,
              kind: object.kind,
              summary: object.summary,
              tags: object.tags,
            }
          : null,
        chunks,
        truncated,
        ...(chunks.length === 0 && object?.source === "enterprise"
          ? { hint: "enterprise_feed" }
          : {}),
        ...(chunks.length === 0 && object?.source !== "enterprise" ? { hint: "not_indexed" } : {}),
      });
    },
  };
}
