import type { KnowledgeEvidence } from "../../../retrieval/types.js";
import type { GatewayClient } from "../../server-methods/types.js";
import {
  normalizeKnowledgeConsumeRefs,
  type KnowledgeConsumePolicy,
  type KnowledgeConsumeReceiptItem,
  type KnowledgeConsumeRef,
} from "../consume-ref.js";
import { resolveKnowledgeSourceContext } from "../context.js";
import { getWorkspaceDeliverableTrace } from "../deliverables/trace-model.js";
import { ensureKnowledgeDocumentIndexed } from "../ensure-indexed-document.js";
import { filterRelationshipGraph } from "../graph-builder.js";
import { buildDocumentCiteUri } from "../ke/cite.js";
import {
  buildKnowledgeBasePermissionActor,
  canReadKnowledgeBase,
} from "../knowledge-base-permissions.js";
import { getKnowledgeBase, listKnowledgeBases } from "../knowledge-base-store.js";
import {
  readKnowledgeDocumentContent,
  type KnowledgeDocumentContentSource,
} from "../knowledge-document-preview.js";
import {
  resolveKnowledgeBaseHasIndexedChunks,
  retrievalContextFromKnowledgeSourceContext,
  searchKnowledgeEvidence,
} from "../knowledge-retrieval-runtime.js";
import { listKnowledgeRecentVisits } from "../recent-visits.js";
import {
  filterObjectsForAgentConsumption,
  resolveAgentKnowledgeType,
  stripUnauthorizedCapabilitySurface,
} from "../runtime/agent-cognitive-adapter.js";
import { buildKnowledgeRelatedGroups } from "../runtime/related-groups.js";
import { buildRelationshipRecommendations } from "../runtime/relationship-recommendation.js";
import { loadKnowledgeSourceBundle } from "../source-bundle.js";
import { planFfdQuery } from "../sources/ffd-query-planner.js";
import { resolveLocalFolderConsumeSource } from "../sources/local-folder-consume-resolve.js";
import { getApiSourceCatalog, invokeApiSource } from "../sources/source-api-runtime.js";
import { listKnowledgeSourceBindings } from "../sources/source-binding-store.js";
import { listSourceDocumentLinks } from "../sources/source-document-link-store.js";
import type { KnowledgeSourceBundle } from "../sources/types.js";
import type {
  KnowledgeAgentContext,
  KnowledgeAgentProfile,
  KnowledgeObject,
  KnowledgeObjectKind,
  KnowledgeResolveResult,
  KnowledgeSource,
  KnowledgeTaskContext,
  RelationshipGraph,
  RelationshipNode,
} from "../types.js";
import { isAbortError, runWithAbortTimeout } from "./abort-timeout.js";
import { buildKnowledgeAgentContext } from "./context-builder.js";
import { classifyKnowledgeIntent } from "./intent-classifier.js";
import {
  selectKnowledgeSources,
  selectKnowledgeSourcesWithPolicy,
  type KnowledgeSourceExclusionReason,
  type KnowledgeSourcePolicyInput,
} from "./source-selector.js";

export const KNOWLEDGE_STAGE_TIMEOUT_MS = 800;
export const LIVE_SOURCE_TIMEOUT_MS = 1_500;

export type KnowledgeResolveSourcePolicy = Omit<KnowledgeSourcePolicyInput, "aclAllowedSources"> & {
  hasExplicitLiveIntent?: boolean;
};

export type KnowledgeRuntimeDiagnostics = {
  selectedSourceCount: number;
  excludedReasons: KnowledgeSourceExclusionReason[];
  liveSkipped: boolean;
  liveInvoked: boolean;
  timeoutReason?: "stage" | "live_source";
  degraded: boolean;
};

export type KnowledgeRuntimeSelection = {
  refs: KnowledgeConsumeRef[];
};

function normalizeQuery(query: string | undefined): string {
  return (query ?? "").trim().toLowerCase();
}

function routeTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const match of query.toLowerCase().matchAll(/[\p{Script=Han}]+|[a-z0-9_.-]{2,}/gu)) {
    const token = match[0];
    terms.add(token);
    if (/^\p{Script=Han}+$/u.test(token) && token.length > 2) {
      for (let index = 0; index < token.length - 1; index += 1) {
        terms.add(token.slice(index, index + 2));
      }
    }
  }
  return [...terms];
}

function matchesQuery(object: KnowledgeObject, query: string): boolean {
  if (!query) {
    return true;
  }
  const haystack = [object.title, object.summary, object.tags.join(" "), object.source, object.kind]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function filterObjectsBySources(
  objects: KnowledgeObject[],
  sources: readonly KnowledgeSource[],
): KnowledgeObject[] {
  return objects.filter((item) => sources.includes(item.source));
}

const HUB_SOURCE_BY_OBJECT_ID: Record<string, KnowledgeSource> = {
  "obj:hub:personal": "personal",
  "obj:hub:enterprise": "enterprise",
  "obj:hub:data": "data",
};

function knowledgeSourceForGraphNode(
  node: RelationshipNode,
  objects: readonly KnowledgeObject[],
): KnowledgeSource | null {
  if (node.objectId && HUB_SOURCE_BY_OBJECT_ID[node.objectId]) {
    return HUB_SOURCE_BY_OBJECT_ID[node.objectId];
  }
  if (node.id === "node:hub:personal") {
    return "personal";
  }
  if (node.id === "node:hub:enterprise") {
    return "enterprise";
  }
  if (node.id === "node:hub:data") {
    return "data";
  }
  if (!node.objectId) {
    return null;
  }
  return objects.find((item) => item.id === node.objectId)?.source ?? null;
}

export function filterRelationshipGraphBySources(params: {
  graph: RelationshipGraph;
  objects: readonly KnowledgeObject[];
  selectedSources: readonly KnowledgeSource[];
}): RelationshipGraph {
  if (params.selectedSources.length === 0) {
    return { nodes: [], edges: [] };
  }
  const selected = new Set(params.selectedSources);
  const keptIds = new Set<string>();
  for (const node of params.graph.nodes) {
    const source = knowledgeSourceForGraphNode(node, params.objects);
    if (source && selected.has(source)) {
      keptIds.add(node.id);
    }
  }
  for (const node of params.graph.nodes) {
    if (keptIds.has(node.id) || (node.kind !== "owner" && node.kind !== "agent")) {
      continue;
    }
    const connectedToKept = params.graph.edges.some(
      (edge) =>
        (edge.sourceId === node.id && keptIds.has(edge.targetId)) ||
        (edge.targetId === node.id && keptIds.has(edge.sourceId)),
    );
    if (connectedToKept) {
      keptIds.add(node.id);
    }
  }
  return {
    nodes: params.graph.nodes.filter((node) => keptIds.has(node.id)),
    edges: params.graph.edges.filter(
      (edge) => keptIds.has(edge.sourceId) && keptIds.has(edge.targetId),
    ),
  };
}

export function filterRecentVisitMemoryHints(params: {
  visits: ReadonlyArray<{ objectId: string; title: string; source?: string }>;
  objects: readonly KnowledgeObject[];
  selectedSources: readonly KnowledgeSource[];
}): string[] {
  if (params.selectedSources.length === 0) {
    return [];
  }
  const selected = new Set(params.selectedSources);
  const byId = new Map(params.objects.map((item) => [item.id, item]));
  const hints: string[] = [];
  for (const visit of params.visits) {
    const object = byId.get(visit.objectId);
    if (!object) {
      continue;
    }
    if (object.accessState === "restricted" || object.freshnessStatus === "expired") {
      continue;
    }
    if (!selected.has(object.source)) {
      continue;
    }
    if (visit.source && visit.source !== object.source) {
      continue;
    }
    hints.push(object.title);
  }
  return hints;
}

function filterObjectsByKinds(
  objects: KnowledgeObject[],
  kinds: KnowledgeObjectKind[] | undefined,
): KnowledgeObject[] {
  if (!kinds?.length) {
    return objects;
  }
  return objects.filter((item) => kinds.includes(item.kind));
}

export function pinRequestedKnowledgeObjects(
  pool: KnowledgeObject[],
  requestedObjectIds: string[] | undefined,
  allObjects: KnowledgeObject[],
): KnowledgeObject[] {
  const requested = [...new Set((requestedObjectIds ?? []).map((id) => id.trim()).filter(Boolean))];
  if (requested.length === 0) {
    return pool;
  }
  const pinned = requested
    .map((id) => allObjects.find((item) => item.id === id))
    .filter((item): item is KnowledgeObject => Boolean(item));
  if (pinned.length === 0) {
    return pool;
  }
  const pinnedIds = new Set(pinned.map((item) => item.id));
  const rest = pool.filter((item) => !pinnedIds.has(item.id));
  return [...pinned, ...rest].slice(0, 8);
}

function aclAllowedKnowledgeSources(bundle: KnowledgeSourceBundle): KnowledgeSource[] {
  const sources: KnowledgeSource[] = ["personal"];
  if (
    bundle.sourceSummary.enterprise.accessibleCount > 0 ||
    bundle.sourceBrowse.enterprise.length > 0
  ) {
    sources.push("enterprise");
  }
  if (bundle.sourceSummary.data.grantedCount > 0) {
    sources.push("data");
  }
  return sources;
}

function canInvokeLiveSource(params: {
  sourcePolicy?: KnowledgeResolveSourcePolicy;
  consumePolicy?: KnowledgeConsumePolicy;
  apiSourceIds: ReadonlySet<string>;
  explicitApiSourceIds: ReadonlySet<string>;
}): boolean {
  if (params.apiSourceIds.size === 0) {
    return false;
  }
  // Explicit API refs express intent only. Live invocation still needs an
  // authorizing policy: inbound liveSourcesAllowed, or an audited consume allowlist.
  if (params.sourcePolicy && !params.sourcePolicy.liveSourcesAllowed) {
    return false;
  }
  const authorizedByInbound = params.sourcePolicy?.liveSourcesAllowed === true;
  const authorizedByConsume = params.consumePolicy?.allowLiveApi === true;
  if (!authorizedByInbound && !authorizedByConsume) {
    return false;
  }
  return params.explicitApiSourceIds.size > 0 || authorizedByConsume;
}

function knowledgeSourcePlaneForBinding(): KnowledgeSource {
  // Active api/external/capability sources are the data plane.
  return "data";
}

function knowledgeSourcePlaneForEvidence(
  item: KnowledgeEvidence,
  lookup: (kbId: string) => { tenantId: string | null; backendKind?: string } | null | undefined,
): KnowledgeSource | null {
  if (item.docId.startsWith("source:")) {
    return "data";
  }
  if (!item.kbId) {
    return null;
  }
  const kb = lookup(item.kbId);
  if (!kb?.backendKind) {
    return null;
  }
  return kb.backendKind === "enterprise" ? "enterprise" : "personal";
}

export function filterKnowledgeEvidenceForPrompt(params: {
  evidence: KnowledgeEvidence[];
  sourcePolicy?: KnowledgeResolveSourcePolicy;
  selectedSources?: readonly KnowledgeSource[];
  tenantId?: string | null;
  readableKnowledgeBaseIds?: ReadonlySet<string>;
  lookupKnowledgeBase?: (
    kbId: string,
  ) => { tenantId: string | null; backendKind?: string } | null | undefined;
}): { kept: KnowledgeEvidence[]; excludedReasons: string[] } {
  const excludedReasons: string[] = [];
  const lookup = params.lookupKnowledgeBase ?? ((kbId: string) => getKnowledgeBase(kbId));
  const selected = params.selectedSources ?? [];
  const kept = params.evidence.filter((item) => {
    // Non-bypassable governance invariant: suppressed/archived evidence is never
    // surfaced to the prompt, regardless of whether a caller supplied a sourcePolicy.
    if (item.governanceStatus === "suppressed" || item.governanceStatus === "archived") {
      excludedReasons.push("policy_mismatch");
      return false;
    }
    // Base tenant isolation + ACL are enforced whenever the caller provides the scope,
    // independent of sourcePolicy — a policy-less caller cannot read across the boundary.
    if (params.readableKnowledgeBaseIds && item.kbId) {
      if (!params.readableKnowledgeBaseIds.has(item.kbId)) {
        excludedReasons.push("acl_disallowed");
        return false;
      }
    }
    const kb = item.kbId ? lookup(item.kbId) : null;
    if (params.tenantId && kb?.tenantId && kb.tenantId !== params.tenantId) {
      excludedReasons.push("cross_tenant");
      return false;
    }
    // Policy-specific gates (live gating + source-plane selection) apply only when a
    // sourcePolicy is in force. Callers may only tighten past the invariants above.
    if (params.sourcePolicy) {
      const isLive = item.docId.startsWith("source:");
      if (isLive && !params.sourcePolicy.liveSourcesAllowed) {
        excludedReasons.push("live_gated");
        return false;
      }
      const plane = knowledgeSourcePlaneForEvidence(item, lookup);
      if (!plane || !selected.includes(plane)) {
        excludedReasons.push("policy_disallowed");
        return false;
      }
    }
    return true;
  });
  return { kept, excludedReasons: [...new Set(excludedReasons)].toSorted() };
}

/**
 * Build a redacted citation URI for a live/active source. The request path may carry
 * query parameters or fragments containing tokens, account identifiers or PII; those
 * must never reach the model prompt, logs or user-facing responses. We keep only the
 * route (path before `?`/`#`) as a stable logical reference.
 */
function activeSourceCitationUri(sourceId: string, requestPath: string): string {
  const routeOnly = requestPath.split(/[?#]/, 1)[0] ?? requestPath;
  return `ku://active/${sourceId}${routeOnly}`;
}

type LiveEvidenceOutcome = {
  evidence: KnowledgeEvidence[];
  liveInvoked: boolean;
  liveSkipped: boolean;
  timeoutReason?: "live_source";
};

const SELECTED_ITEM_CHAR_BUDGET = 16_000;
const SELECTED_TURN_CHAR_BUDGET = 32_000;

function receiptEvidenceKindForDocumentSource(
  source: KnowledgeDocumentContentSource,
): "original" | "local-index" | "index-chunk" {
  if (source === "original_store") {
    return "original";
  }
  return source === "local_index" ? "local-index" : "index-chunk";
}

async function resolveDeterministicSelectedEvidence(params: {
  refs: readonly KnowledgeConsumeRef[];
  query: string;
  context: Awaited<ReturnType<typeof resolveKnowledgeSourceContext>>;
  readableKnowledgeBaseIds: ReadonlySet<string>;
  agentId?: string | null;
  sourcePolicy?: KnowledgeResolveSourcePolicy;
}): Promise<{ evidence: KnowledgeEvidence[]; receipts: KnowledgeConsumeReceiptItem[] }> {
  const evidence: KnowledgeEvidence[] = [];
  const receipts: KnowledgeConsumeReceiptItem[] = [];
  let remainingChars = SELECTED_TURN_CHAR_BUDGET;

  for (const ref of params.refs) {
    if (ref.type === "api") {
      continue;
    }
    if (ref.type === "knowledge-base") {
      if (!params.readableKnowledgeBaseIds.has(ref.id)) {
        receipts.push({ ref, status: "denied", reasonCode: "permission_denied" });
        continue;
      }
      const scoped = params.query
        ? await searchKnowledgeEvidence({
            query: params.query,
            retrievalContext: retrievalContextFromKnowledgeSourceContext(params.context, {
              agentId: params.agentId,
            }),
            kbScope: [ref.id],
            maxResults: 6,
            fallbackToCurrentChunks: true,
          }).catch(() => [])
        : [];
      const accepted = scoped.filter((item) => item.kbId === ref.id);
      const refBudget = Math.min(SELECTED_ITEM_CHAR_BUDGET, remainingChars);
      let refRemaining = refBudget;
      const bounded: KnowledgeEvidence[] = [];
      for (const item of accepted) {
        if (refRemaining === 0) {
          break;
        }
        const chunkText = item.chunkText.slice(0, refRemaining);
        if (chunkText) {
          bounded.push({ ...item, chunkText });
          refRemaining -= chunkText.length;
        }
      }
      evidence.push(...bounded);
      const chars = bounded.reduce((total, item) => total + item.chunkText.length, 0);
      const totalChars = accepted.reduce((total, item) => total + item.chunkText.length, 0);
      const truncated = chars < totalChars;
      if (accepted.length > 0) {
        receipts.push({
          ref,
          status: truncated ? "partial" : "consumed",
          evidenceKind: "index-chunk",
          chunkIds: bounded.flatMap((item) => (item.chunkId ? [item.chunkId] : [])),
          chars,
          ...(truncated
            ? {
                truncationReason:
                  remainingChars < SELECTED_ITEM_CHAR_BUDGET
                    ? ("turn-budget" as const)
                    : ("item-budget" as const),
              }
            : {}),
        });
      } else {
        const knowledgeBase = getKnowledgeBase(ref.id);
        const indexed = knowledgeBase
          ? await resolveKnowledgeBaseHasIndexedChunks(knowledgeBase)
          : false;
        receipts.push({
          ref,
          status: "unavailable",
          reasonCode: indexed ? "no_match" : "not_indexed",
        });
      }
      remainingChars = Math.max(0, remainingChars - chars);
      continue;
    }
    if (ref.type === "knowledge-file") {
      if (!params.readableKnowledgeBaseIds.has(ref.parentId)) {
        receipts.push({ ref, status: "denied", reasonCode: "permission_denied" });
        continue;
      }
      let content = await readKnowledgeDocumentContent({
        knowledgeBaseId: ref.parentId,
        documentId: ref.id,
        userId: params.context.userId,
        tenantId: params.context.tenantId,
        textOnly: true,
      }).catch(() => null);
      if (!content) {
        const ensured = await ensureKnowledgeDocumentIndexed({
          knowledgeBaseId: ref.parentId,
          documentId: ref.id,
          context: params.context,
        });
        if (ensured.status === "denied") {
          receipts.push({ ref, status: "denied", reasonCode: "permission_denied" });
          continue;
        }
        if (ensured.status === "indexed" || ensured.status === "reused") {
          content = await readKnowledgeDocumentContent({
            knowledgeBaseId: ref.parentId,
            documentId: ref.id,
            userId: params.context.userId,
            tenantId: params.context.tenantId,
            textOnly: true,
          }).catch(() => null);
        }
      }
      if (!content) {
        const catalogued = getKnowledgeBase(ref.parentId)?.documentIds.includes(ref.id);
        receipts.push({
          ref,
          status: "unavailable",
          reasonCode: catalogued ? "not_indexed" : "not_found",
        });
        continue;
      }
      const text = content.buffer.toString("utf8").trim();
      if (!text) {
        receipts.push({ ref, status: "unavailable", reasonCode: "not_indexed" });
        continue;
      }
      const allowedChars = Math.min(SELECTED_ITEM_CHAR_BUDGET, remainingChars);
      if (allowedChars === 0) {
        receipts.push({
          ref,
          status: "partial",
          evidenceKind: receiptEvidenceKindForDocumentSource(content.source),
          sourceVersion: content.source,
          chunkIds: content.chunkIds,
          chars: 0,
          truncationReason: "turn-budget",
        });
        continue;
      }
      const selectedText = text.slice(0, allowedChars);
      const truncated = selectedText.length < text.length;
      const versionId = content.source;
      evidence.push({
        sourceKind: "knowledge",
        docId: ref.id,
        docTitle: content.filename,
        kbId: ref.parentId,
        versionId,
        score: 1,
        chunkText: selectedText,
        sourceUri: buildDocumentCiteUri({ kbId: ref.parentId, docId: ref.id, versionId }),
      });
      receipts.push({
        ref,
        status: truncated ? "partial" : "consumed",
        evidenceKind: receiptEvidenceKindForDocumentSource(content.source),
        sourceVersion: versionId,
        chunkIds: content.chunkIds,
        chars: selectedText.length,
        ...(truncated
          ? {
              truncationReason:
                remainingChars < SELECTED_ITEM_CHAR_BUDGET
                  ? ("turn-budget" as const)
                  : ("item-budget" as const),
            }
          : {}),
      });
      remainingChars = Math.max(0, remainingChars - selectedText.length);
      continue;
    }
    if (ref.type === "deliverable") {
      if (params.sourcePolicy) {
        receipts.push({ ref, status: "denied", reasonCode: "permission_denied" });
        continue;
      }
      const userId = params.context.userId?.trim();
      const traced = userId
        ? await getWorkspaceDeliverableTrace({
            userId,
            deliverableId: ref.id,
            groupIds: [ref.parentId],
          }).catch(() => null)
        : null;
      const body = traced?.trace.previewText?.trim() ?? "";
      if (!traced || traced.trace.deliverable.groupId !== ref.parentId || !body) {
        receipts.push({ ref, status: "unavailable", reasonCode: "not_found" });
        continue;
      }
      const allowedChars = Math.min(SELECTED_ITEM_CHAR_BUDGET, remainingChars);
      const selectedText = body.slice(0, allowedChars);
      const truncated = selectedText.length < body.length;
      const sourceVersion = String(traced.trace.deliverable.updatedAtMs);
      if (selectedText) {
        evidence.push({
          sourceKind: "artifact",
          docId: ref.id,
          docTitle: traced.trace.deliverable.title,
          kbId: `workspace:${ref.parentId}`,
          versionId: sourceVersion,
          score: 1,
          chunkText: selectedText,
          sourceUri: `ku://workspace/${encodeURIComponent(ref.parentId)}/deliverable/${encodeURIComponent(ref.id)}@${sourceVersion}`,
        });
      }
      receipts.push({
        ref,
        status: truncated ? "partial" : "consumed",
        evidenceKind: "object",
        sourceVersion,
        chars: selectedText.length,
        ...(truncated
          ? {
              truncationReason:
                remainingChars < SELECTED_ITEM_CHAR_BUDGET
                  ? ("turn-budget" as const)
                  : ("item-budget" as const),
            }
          : {}),
      });
      remainingChars = Math.max(0, remainingChars - selectedText.length);
      continue;
    }
    if (ref.type === "folder") {
      if (!ref.parentId) {
        receipts.push({ ref, status: "unavailable", reasonCode: "ambiguous_identity" });
        continue;
      }
      if (!params.readableKnowledgeBaseIds.has(ref.parentId)) {
        receipts.push({ ref, status: "denied", reasonCode: "permission_denied" });
        continue;
      }
      const folderSource = resolveLocalFolderConsumeSource({
        knowledgeBaseId: ref.parentId,
        folderId: ref.id,
      });
      if (!folderSource) {
        receipts.push({ ref, status: "unavailable", reasonCode: "not_found" });
        continue;
      }
      const links = listSourceDocumentLinks({
        sourceDescriptorId: folderSource.sourceDescriptorId,
        state: "active",
      }).toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
      const folderStartedRemaining = remainingChars;
      let folderChars = 0;
      let folderTruncated = false;
      let folderEvidenceCount = 0;
      const folderChunkIds: string[] = [];
      let folderEvidenceKind: KnowledgeConsumeReceiptItem["evidenceKind"];
      for (const link of links) {
        const allowedChars = Math.min(SELECTED_ITEM_CHAR_BUDGET - folderChars, remainingChars);
        if (allowedChars <= 0) {
          folderTruncated = true;
          break;
        }
        const content = await readKnowledgeDocumentContent({
          knowledgeBaseId: ref.parentId,
          documentId: link.docId,
          userId: params.context.userId,
          tenantId: params.context.tenantId,
          textOnly: true,
        }).catch(() => null);
        const text = content?.buffer.toString("utf8").trim() ?? "";
        if (!content || !text) {
          continue;
        }
        const selectedText = text.slice(0, allowedChars);
        folderTruncated ||= selectedText.length < text.length;
        folderEvidenceKind ??= receiptEvidenceKindForDocumentSource(content.source);
        folderChunkIds.push(...(content.chunkIds ?? []));
        folderChars += selectedText.length;
        folderEvidenceCount += 1;
        remainingChars = Math.max(0, remainingChars - selectedText.length);
        evidence.push({
          sourceKind: "knowledge",
          docId: link.docId,
          docTitle: content.filename,
          kbId: ref.parentId,
          versionId: content.source,
          score: 1,
          chunkText: selectedText,
          sourceUri: buildDocumentCiteUri({
            kbId: ref.parentId,
            docId: link.docId,
            versionId: content.source,
          }),
        });
      }
      folderTruncated ||= folderEvidenceCount < links.length;
      receipts.push(
        folderChars > 0
          ? {
              ref,
              status: folderTruncated ? "partial" : "consumed",
              evidenceKind: folderEvidenceKind,
              chunkIds: folderChunkIds,
              chars: folderChars,
              ...(folderTruncated
                ? {
                    truncationReason:
                      folderStartedRemaining < SELECTED_ITEM_CHAR_BUDGET
                        ? ("turn-budget" as const)
                        : ("item-budget" as const),
                  }
                : {}),
            }
          : {
              ref,
              status: "unavailable",
              reasonCode: links.length > 0 ? "not_indexed" : "not_found",
            },
      );
      continue;
    }
    receipts.push({ ref, status: "unavailable", reasonCode: "not_found" });
  }
  return { evidence, receipts };
}

async function collectLiveSourceEvidence(params: {
  query: string;
  context: Awaited<ReturnType<typeof resolveKnowledgeSourceContext>>;
  readableKnowledgeBaseIds: Set<string>;
  kbId?: string;
  sourcePolicy?: KnowledgeResolveSourcePolicy;
  consumePolicy?: KnowledgeConsumePolicy;
  apiSourceIds: ReadonlySet<string>;
  explicitApiSourceIds: ReadonlySet<string>;
  apiParentById: ReadonlyMap<string, string>;
  selectedSources?: readonly KnowledgeSource[];
  abortSignal?: AbortSignal;
}): Promise<LiveEvidenceOutcome> {
  const allowLive = canInvokeLiveSource(params);
  const selected = params.selectedSources ?? [];
  const selectedAllowsLive = !params.sourcePolicy || selected.includes("data");
  if (!allowLive || !selectedAllowsLive) {
    return { evidence: [], liveInvoked: false, liveSkipped: true };
  }
  const sources = listKnowledgeSourceBindings().filter((source) => {
    if (!params.apiSourceIds.has(source.id)) {
      return false;
    }
    const expectedParent = params.apiParentById.get(source.id);
    if (expectedParent && source.knowledgeBaseId !== expectedParent) {
      return false;
    }
    if (!source.knowledgeBaseId || !params.readableKnowledgeBaseIds.has(source.knowledgeBaseId)) {
      return false;
    }
    if (params.kbId && source.knowledgeBaseId !== params.kbId) {
      return false;
    }
    const kb = getKnowledgeBase(source.knowledgeBaseId);
    if (params.context.tenantId && kb?.tenantId && kb.tenantId !== params.context.tenantId) {
      return false;
    }
    if (source.metadata?.expiresAt && Date.parse(source.metadata.expiresAt) <= Date.now()) {
      return false;
    }
    if (params.sourcePolicy && !selected.includes(knowledgeSourcePlaneForBinding())) {
      return false;
    }
    return true;
  });
  const live: KnowledgeEvidence[] = [];
  let liveInvoked = false;
  let timeoutReason: "live_source" | undefined;
  for (const source of sources) {
    if (params.abortSignal?.aborted) {
      break;
    }
    const ffdPlan = source.endpoint?.includes("ffd.findesk.cn") ? planFfdQuery(params.query) : null;
    const catalog = ffdPlan ? null : getApiSourceCatalog(source.id);
    const queryTerms = routeTerms(params.query);
    let requestPath: string | undefined = ffdPlan?.path;
    let method: string | undefined = ffdPlan?.method;
    let body: Record<string, unknown> | undefined = ffdPlan?.body;
    if (!ffdPlan) {
      const entry =
        catalog?.entries.find((item) => {
          const text = JSON.stringify(item).toLowerCase();
          return queryTerms.some((term) => text.includes(term));
        }) ?? catalog?.entries[0];
      requestPath =
        entry && typeof entry === "object" && typeof (entry as { path?: unknown }).path === "string"
          ? (entry as { path: string }).path
          : source.metadata?.["request.path"];
      method =
        entry &&
        typeof entry === "object" &&
        typeof (entry as { method?: unknown }).method === "string"
          ? (entry as { method: string }).method
          : source.metadata?.["request.method"];
      const bodyValue =
        entry && typeof entry === "object" ? (entry as { body?: unknown }).body : null;
      body =
        bodyValue && typeof bodyValue === "object" && !Array.isArray(bodyValue)
          ? (bodyValue as Record<string, unknown>)
          : undefined;
    }
    if (!requestPath) {
      continue;
    }
    const invoke = async (signal?: AbortSignal) =>
      invokeApiSource(source.id, requestPath, params.context, {
        ...(ffdPlan ?? { method, body }),
        authorizedKnowledgeBaseIds: params.readableKnowledgeBaseIds,
        ...(signal ? { abortSignal: signal } : {}),
      });
    try {
      liveInvoked = true;
      // The unified live-source timeout is a non-bypassable engine default: it applies
      // regardless of whether a caller supplied a sourcePolicy, so a policy-less caller
      // cannot hang the turn on a slow connector.
      const invoked = await runWithAbortTimeout({
        timeoutMs: LIVE_SOURCE_TIMEOUT_MS,
        abortSignal: params.abortSignal,
        run: (signal) => invoke(signal),
      });
      if (invoked.status !== "ok") {
        if (invoked.status === "timeout") {
          timeoutReason = "live_source";
        }
        continue;
      }
      if (params.abortSignal?.aborted) {
        continue;
      }
      live.push({
        sourceKind: "knowledge",
        docId: `source:${source.id}`,
        docTitle: source.title,
        kbId: source.knowledgeBaseId ?? "",
        versionId: String(invoked.value.fetchedAtMs),
        score: 1,
        chunkText: JSON.stringify(invoked.value.data),
        sourceUri: activeSourceCitationUri(source.id, requestPath),
      });
    } catch (error) {
      if (isAbortError(error) || params.abortSignal?.aborted) {
        continue;
      }
      // Optional live evidence must not suppress local knowledge.
    }
  }
  return {
    evidence: live,
    liveInvoked,
    liveSkipped: !allowLive,
    timeoutReason,
  };
}

async function resolveKnowledgeEvidenceForQuery(params: {
  client: GatewayClient | null;
  query?: string;
  taskContext?: KnowledgeTaskContext;
  sourcePolicy?: KnowledgeResolveSourcePolicy;
  consumeRefs?: readonly KnowledgeConsumeRef[];
  consumePolicy?: KnowledgeConsumePolicy;
  selectedSources?: readonly KnowledgeSource[];
  abortSignal?: AbortSignal;
}): Promise<{
  evidence: KnowledgeEvidence[];
  receipts: KnowledgeConsumeReceiptItem[];
  liveSkipped: boolean;
  liveInvoked: boolean;
  timeoutReason?: "stage" | "live_source";
  excludedReasons: string[];
}> {
  const query = (params.query ?? "").trim();
  const consumeRefs = normalizeKnowledgeConsumeRefs(params.consumeRefs);
  const explicitApiRefs = consumeRefs.filter((ref) => ref.type === "api");
  const explicitApiSourceIds = new Set(explicitApiRefs.map((ref) => ref.id));
  const policyApiSourceIds = params.consumePolicy?.allowLiveApi
    ? (params.consumePolicy.allowedApiSourceIds ?? [])
    : [];
  const apiSourceIds = new Set([...explicitApiSourceIds, ...policyApiSourceIds]);
  const apiParentById = new Map(
    explicitApiRefs.flatMap((ref) => (ref.parentId ? [[ref.id, ref.parentId] as const] : [])),
  );
  const context = await resolveKnowledgeSourceContext(params.client);
  if (!context.userId && !context.seatId && !context.tenantId) {
    return {
      evidence: [],
      receipts: consumeRefs.map((ref) => ({
        ref,
        status: "denied",
        reasonCode: "permission_denied",
      })),
      liveSkipped: apiSourceIds.size > 0,
      liveInvoked: false,
      excludedReasons: [],
    };
  }
  const kbId = params.taskContext?.knowledgeBaseId?.trim();
  const actor = buildKnowledgeBasePermissionActor({
    context,
    email: params.client?.user,
    agentId: params.taskContext?.agentId,
  });
  const readableKnowledgeBaseIds = new Set(
    listKnowledgeBases()
      .filter((knowledgeBase) => canReadKnowledgeBase({ knowledgeBase, actor }))
      .map((knowledgeBase) => knowledgeBase.id),
  );
  const selected = await resolveDeterministicSelectedEvidence({
    refs: consumeRefs,
    query,
    context,
    readableKnowledgeBaseIds,
    agentId: params.taskContext?.agentId,
    sourcePolicy: params.sourcePolicy,
  });

  const loadLocal = async (signal: AbortSignal) => {
    if (!query || consumeRefs.some((ref) => ref.type !== "api")) {
      return [] as KnowledgeEvidence[];
    }
    try {
      const local = await searchKnowledgeEvidence({
        query,
        retrievalContext: retrievalContextFromKnowledgeSourceContext(context, {
          agentId: params.taskContext?.agentId,
        }),
        kbScope: kbId ? [kbId] : undefined,
        maxResults: 6,
      });
      if (signal.aborted) {
        return [] as KnowledgeEvidence[];
      }
      return local;
    } catch {
      // Active sources remain available when the passive retrieval index is unavailable.
      return [] as KnowledgeEvidence[];
    }
  };

  let local: KnowledgeEvidence[] = [];
  let timeoutReason: "stage" | "live_source" | undefined;
  if (params.sourcePolicy) {
    const staged = await runWithAbortTimeout({
      timeoutMs: KNOWLEDGE_STAGE_TIMEOUT_MS,
      abortSignal: params.abortSignal,
      run: loadLocal,
    });
    if (staged.status === "ok") {
      local = staged.value;
    } else if (staged.status === "timeout") {
      timeoutReason = "stage";
    } else {
      return {
        evidence: selected.evidence,
        receipts: selected.receipts,
        liveSkipped: apiSourceIds.size > 0,
        liveInvoked: false,
        excludedReasons: ["aborted"],
      };
    }
  } else {
    local = await loadLocal(params.abortSignal ?? new AbortController().signal);
  }

  if (params.abortSignal?.aborted) {
    return {
      evidence: [...selected.evidence, ...local],
      receipts: selected.receipts,
      liveSkipped: apiSourceIds.size > 0,
      liveInvoked: false,
      timeoutReason,
      excludedReasons: ["aborted"],
    };
  }

  const live = await collectLiveSourceEvidence({
    query,
    context,
    readableKnowledgeBaseIds,
    kbId,
    sourcePolicy: params.sourcePolicy,
    consumePolicy: params.consumePolicy,
    apiSourceIds,
    explicitApiSourceIds,
    apiParentById,
    selectedSources: params.selectedSources,
    abortSignal: params.abortSignal,
  });
  const merged = [...selected.evidence, ...local, ...live.evidence].slice(0, 8);
  const filtered = filterKnowledgeEvidenceForPrompt({
    evidence: merged,
    sourcePolicy: params.sourcePolicy,
    selectedSources: params.selectedSources,
    tenantId: context.tenantId,
    readableKnowledgeBaseIds,
  });
  const liveAllowed = canInvokeLiveSource({
    sourcePolicy: params.sourcePolicy,
    consumePolicy: params.consumePolicy,
    apiSourceIds,
    explicitApiSourceIds,
  });
  const liveReceipts = explicitApiRefs.map<KnowledgeConsumeReceiptItem>((ref) => {
    const item = live.evidence.find((entry) => entry.docId === `source:${ref.id}`);
    if (item) {
      return {
        ref,
        status: "consumed",
        evidenceKind: "live-api",
        sourceVersion: item.versionId,
        fetchedAt: Number.isFinite(Number(item.versionId))
          ? new Date(Number(item.versionId)).toISOString()
          : undefined,
        chars: item.chunkText.length,
      };
    }
    return liveAllowed
      ? {
          ref,
          status: "unavailable",
          reasonCode: live.liveInvoked ? "connector_error" : "not_found",
        }
      : { ref, status: "denied", reasonCode: "live_api_not_allowed" };
  });
  return {
    evidence: filtered.kept,
    receipts: [...selected.receipts, ...liveReceipts],
    liveSkipped: live.liveSkipped,
    liveInvoked: live.liveInvoked,
    timeoutReason: timeoutReason ?? live.timeoutReason,
    excludedReasons: filtered.excludedReasons,
  };
}

export function filterObjectsByKnowledgeBase(
  objects: KnowledgeObject[],
  knowledgeBaseId: string | null | undefined,
): KnowledgeObject[] {
  const kbId = knowledgeBaseId?.trim();
  if (!kbId) {
    return objects;
  }
  const knowledgeBase = getKnowledgeBase(kbId);
  if (!knowledgeBase) {
    return [];
  }
  const allowedObjectIds = new Set([`obj:kb:${knowledgeBase.id}`]);
  if (knowledgeBase.backendKind === "personal") {
    for (const docId of knowledgeBase.documentIds) {
      allowedObjectIds.add(`obj:personal:${docId}`);
    }
  }
  return objects.filter((object) => allowedObjectIds.has(object.id));
}

export function filterObjectsByConsumeRefs(
  objects: KnowledgeObject[],
  refs: readonly KnowledgeConsumeRef[] | undefined,
): KnowledgeObject[] {
  const normalized = normalizeKnowledgeConsumeRefs(refs);
  if (normalized.length === 0) {
    return objects;
  }
  const allowedObjectIds = new Set<string>();
  for (const ref of normalized) {
    if (ref.type === "knowledge-base") {
      allowedObjectIds.add(`obj:kb:${ref.id}`);
    } else if (ref.type === "knowledge-file") {
      const knowledgeBase = getKnowledgeBase(ref.parentId);
      if (knowledgeBase?.backendKind === "personal" && knowledgeBase.documentIds.includes(ref.id)) {
        allowedObjectIds.add(`obj:personal:${ref.id}`);
      }
    } else if (ref.type === "deliverable") {
      const deliverableId = `obj:deliverable:${ref.id}`;
      const parentKeys = new Set([`obj:kb:${ref.parentId}`, `workspace:${ref.parentId}`]);
      if (
        objects.some(
          (object) =>
            object.id === deliverableId &&
            object.relatedObjectIds?.some((related) => parentKeys.has(related)),
        )
      ) {
        allowedObjectIds.add(deliverableId);
      }
    }
  }
  return objects.filter((object) => allowedObjectIds.has(object.id));
}

function knowledgeSourcesForConsumeRefs(
  refs: readonly KnowledgeConsumeRef[] | undefined,
): KnowledgeSource[] {
  const sources = new Set<KnowledgeSource>();
  for (const ref of normalizeKnowledgeConsumeRefs(refs)) {
    if (ref.type === "api") {
      sources.add("data");
      continue;
    }
    if (
      ref.type === "knowledge-base" ||
      ref.type === "knowledge-file" ||
      (ref.type === "folder" && ref.parentId)
    ) {
      const knowledgeBaseId = ref.type === "knowledge-base" ? ref.id : ref.parentId;
      if (!knowledgeBaseId) {
        continue;
      }
      const knowledgeBase = getKnowledgeBase(knowledgeBaseId);
      if (knowledgeBase) {
        sources.add(knowledgeBase.backendKind === "enterprise" ? "enterprise" : "personal");
      }
      continue;
    }
    // Deliverable objects on trunk do not retain their workspace parent id.
  }
  return [...sources];
}

export function buildKnowledgeAgentProfile(params: {
  bundle: KnowledgeSourceBundle;
  taskContext: KnowledgeTaskContext;
  selectedSources: KnowledgeSource[];
  intentConfidence: number;
}): KnowledgeAgentProfile {
  const granted = params.bundle.dataCapabilities
    .filter((item) => item.accessState === "granted")
    .map((item) => item.id);
  const requested = params.taskContext.requestedCapabilities ?? [];
  // Allow list is the granted set only. An empty grant does not fall back to
  // customer.profile, and a request cannot admit a capability that is not granted.
  const allowDataCapabilities = requested.length
    ? granted.filter((id) => requested.includes(id))
    : granted;

  const retrievalMode =
    params.intentConfidence >= 0.8
      ? "precision"
      : params.intentConfidence <= 0.5
        ? "breadth"
        : "balanced";

  return {
    agentId: params.taskContext.agentId ?? "default-agent",
    enabledSources: params.selectedSources,
    preferredKnowledgeKinds: params.taskContext.requestedKinds ?? [
      "document",
      "policy",
      "insight",
      "project",
    ],
    retrievalMode,
    allowDataCapabilities,
    confidenceThreshold: Math.max(0.55, params.intentConfidence - 0.05),
  };
}

export async function runKnowledgeResolveEngine(
  client: GatewayClient | null,
  params: {
    taskContext: KnowledgeTaskContext;
    query?: string;
    sourcePolicy?: KnowledgeResolveSourcePolicy;
    selection?: KnowledgeRuntimeSelection;
    consumePolicy?: KnowledgeConsumePolicy;
    bundle?: KnowledgeSourceBundle;
  },
): Promise<
  KnowledgeResolveResult & { sourceSelection?: ReturnType<typeof selectKnowledgeSourcesWithPolicy> }
> {
  const agentType = resolveAgentKnowledgeType({
    agentId: params.taskContext.agentId,
    taskContext: params.taskContext,
  });
  const bundle =
    params.bundle ??
    (await loadKnowledgeSourceBundle(client, {
      agentType: params.taskContext.agentType ?? agentType,
    }));
  const query = normalizeQuery(params.query ?? params.taskContext.taskType);
  const classifiedIntent = classifyKnowledgeIntent({
    query: params.query,
    taskContext: params.taskContext,
    sourcePolicyEnabled: Boolean(params.sourcePolicy),
  });
  const explicitSources = knowledgeSourcesForConsumeRefs(params.selection?.refs);
  if (
    params.consumePolicy?.allowLiveApi &&
    (params.consumePolicy.allowedApiSourceIds?.length ?? 0) > 0 &&
    !explicitSources.includes("data")
  ) {
    explicitSources.push("data");
  }
  const intent = explicitSources.length
    ? {
        ...classifiedIntent,
        suggestedSources: [...new Set([...classifiedIntent.suggestedSources, ...explicitSources])],
        signals: [...classifiedIntent.signals, "explicit-consume-ref"],
      }
    : classifiedIntent;

  const provisionalProfile = buildKnowledgeAgentProfile({
    bundle,
    taskContext: params.taskContext,
    selectedSources: intent.suggestedSources,
    intentConfidence: intent.confidence,
  });

  const sourcePolicy = params.sourcePolicy
    ? {
        ...params.sourcePolicy,
        aclAllowedSources: aclAllowedKnowledgeSources(bundle),
      }
    : undefined;
  const sourceSelection = sourcePolicy
    ? selectKnowledgeSourcesWithPolicy({
        intent,
        taskContext: params.taskContext,
        sourcePolicy,
      })
    : undefined;
  const selectedSources = sourceSelection
    ? sourceSelection.selected
    : selectKnowledgeSources({
        intent,
        taskContext: params.taskContext,
        profile: provisionalProfile,
      });

  const profile = buildKnowledgeAgentProfile({
    bundle,
    taskContext: params.taskContext,
    selectedSources,
    intentConfidence: intent.confidence,
  });

  const agentAccessible = filterObjectsForAgentConsumption(bundle.objects).filter((item) =>
    params.sourcePolicy ? item.freshnessStatus !== "expired" : true,
  );
  const kbScoped = filterObjectsByKnowledgeBase(
    agentAccessible,
    params.taskContext.knowledgeBaseId,
  );
  const selectionScoped = filterObjectsByConsumeRefs(
    params.taskContext.knowledgeBaseId ? kbScoped : agentAccessible,
    params.selection?.refs,
  );
  const sourceFiltered = filterObjectsBySources(
    params.selection?.refs?.length
      ? selectionScoped
      : params.taskContext.knowledgeBaseId
        ? kbScoped
        : agentAccessible,
    selectedSources,
  );
  const kindFiltered = filterObjectsByKinds(sourceFiltered, profile.preferredKnowledgeKinds);
  const searchPool = kindFiltered.length ? kindFiltered : sourceFiltered;
  const matched = searchPool.filter((item) => matchesQuery(item, query));
  const objects = pinRequestedKnowledgeObjects(
    matched.length ? matched : searchPool,
    params.selection?.refs?.length || (params.sourcePolicy && selectedSources.length === 0)
      ? []
      : params.taskContext.requestedObjectIds,
    params.selection?.refs?.length ? selectionScoped : agentAccessible,
  ).filter((item) => (params.sourcePolicy ? selectedSources.includes(item.source) : true));

  const sourceScopedGraph = params.sourcePolicy
    ? filterRelationshipGraphBySources({
        graph: bundle.graph,
        objects: bundle.objects,
        selectedSources,
      })
    : bundle.graph;
  const filteredGraph = filterRelationshipGraph({
    graph: sourceScopedGraph,
    query,
    focusNodeId: null,
  });
  // Policy on: never fall back to the unfiltered bundle graph. Empty selected
  // sources therefore stay empty instead of reintroducing excluded planes.
  const graph = filteredGraph.nodes.length ? filteredGraph : sourceScopedGraph;

  const focusObjectId = objects[0]?.id ?? null;
  const recommendationObjects = params.sourcePolicy
    ? filterObjectsBySources(agentAccessible, selectedSources)
    : bundle.objects;
  const recommendations = buildRelationshipRecommendations({
    objects: recommendationObjects,
    graph: sourceScopedGraph,
    taskContext: params.taskContext,
    focusObjectId,
    limit: 6,
  }).filter((item) => (params.sourcePolicy ? selectedSources.includes(item.object.source) : true));

  const capabilities = bundle.dataCapabilities;
  const stripped = stripUnauthorizedCapabilitySurface({
    graph,
    objects,
    capabilities,
  });
  const strippedRecommendationObjects = stripUnauthorizedCapabilitySurface({
    graph: { nodes: [], edges: [] },
    objects: recommendations.map((item) => item.object),
    capabilities,
  }).objects;
  const recommendationById = new Map(strippedRecommendationObjects.map((item) => [item.id, item]));
  const strippedRecommendations = recommendations.flatMap((item) => {
    const object = recommendationById.get(item.object.id);
    return object ? [{ ...item, object }] : [];
  });

  return {
    intent,
    selectedSources,
    objects: stripped.objects,
    graph: stripped.graph,
    profile,
    recommendations: strippedRecommendations,
    ...(sourceSelection ? { sourceSelection } : {}),
  };
}

export type KnowledgeRuntimeEngineResult = {
  resolve: KnowledgeResolveResult;
  context: KnowledgeAgentContext;
  memoryHints: string[];
  receipts: KnowledgeConsumeReceiptItem[];
  diagnostics: KnowledgeRuntimeDiagnostics;
};

/**
 * Single composition pass for the AI consumption layer: it runs the resolve
 * engine ONCE and derives the agent context + memory hints from that same
 * result (object context, related groups, recent-visit memory, governance-aware
 * chunk evidence, prompt block). All Runtime Cognitive Context consumers
 * (reply path, cognitive bundle, knowledge.runtime.context) delegate here so the
 * resolve+context+memory composition lives in exactly one place.
 */
export async function runKnowledgeRuntimeEngine(
  client: GatewayClient | null,
  params: {
    taskContext: KnowledgeTaskContext;
    query?: string;
    sourcePolicy?: KnowledgeResolveSourcePolicy;
    selection?: KnowledgeRuntimeSelection;
    consumePolicy?: KnowledgeConsumePolicy;
    abortSignal?: AbortSignal;
  },
): Promise<KnowledgeRuntimeEngineResult> {
  const agentType = resolveAgentKnowledgeType({
    agentId: params.taskContext.agentId,
    taskContext: params.taskContext,
  });
  const bundle = await loadKnowledgeSourceBundle(client, {
    agentType: params.taskContext.agentType ?? agentType,
  });
  const resolveResult = await runKnowledgeResolveEngine(client, {
    ...params,
    bundle,
  });
  const primary = resolveResult.objects[0];
  const agentVisibleObjects = stripUnauthorizedCapabilitySurface({
    graph: { nodes: [], edges: [] },
    objects: bundle.objects,
    capabilities: bundle.dataCapabilities,
  }).objects;
  const relatedGroups = primary
    ? buildKnowledgeRelatedGroups({
        objectId: primary.id,
        objects: params.sourcePolicy
          ? filterObjectsBySources(agentVisibleObjects, resolveResult.selectedSources)
          : agentVisibleObjects,
        graph: resolveResult.graph,
      })
    : null;

  const context = await resolveKnowledgeSourceContext(client);
  const recentVisits = listKnowledgeRecentVisits({
    userId: context.userId,
    seatId: context.seatId,
    limit: 4,
  });
  const memoryHints = params.sourcePolicy
    ? filterRecentVisitMemoryHints({
        visits: recentVisits,
        objects: bundle.objects,
        selectedSources: resolveResult.selectedSources,
      })
    : recentVisits.map((visit) => visit.title);
  const evidenceResult = await resolveKnowledgeEvidenceForQuery({
    client,
    query: params.query,
    taskContext: params.taskContext,
    sourcePolicy: params.sourcePolicy,
    consumeRefs: params.selection?.refs,
    consumePolicy: params.consumePolicy,
    selectedSources: params.sourcePolicy ? resolveResult.selectedSources : undefined,
    abortSignal: params.abortSignal,
  });

  const agentContext = buildKnowledgeAgentContext({
    resolveResult,
    relatedGroups,
    recommendations: resolveResult.recommendations,
    memoryHints,
    evidence: evidenceResult.evidence,
    receipts: evidenceResult.receipts,
  });
  const excludedReasons = [
    ...(resolveResult.sourceSelection?.excludedReasons ?? []),
    ...evidenceResult.excludedReasons.filter(
      (reason): reason is KnowledgeSourceExclusionReason =>
        reason === "general_empty" ||
        reason === "policy_disallowed" ||
        reason === "acl_disallowed" ||
        reason === "hint_narrowed" ||
        reason === "live_gated" ||
        reason === "unknown_source",
    ),
  ];
  return {
    resolve: resolveResult,
    context: agentContext,
    memoryHints,
    receipts: evidenceResult.receipts,
    diagnostics: {
      selectedSourceCount: resolveResult.selectedSources.length,
      excludedReasons: [...new Set(excludedReasons)].toSorted(),
      liveSkipped: evidenceResult.liveSkipped,
      liveInvoked: evidenceResult.liveInvoked,
      timeoutReason: evidenceResult.timeoutReason,
      degraded: Boolean(evidenceResult.timeoutReason),
    },
  };
}

export async function runKnowledgeContextEngine(
  client: GatewayClient | null,
  params: {
    taskContext: KnowledgeTaskContext;
    query?: string;
  },
): Promise<KnowledgeAgentContext> {
  return (await runKnowledgeRuntimeEngine(client, params)).context;
}
