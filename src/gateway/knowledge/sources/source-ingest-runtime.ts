/**
 * Active source sync/ingest: pull a snapshot from api/external bindings and
 * project into kb-index so library panorama + RAG can see them.
 *
 * External (`enterprise-data://…`) fetch is delegated to the enterprise-data
 * plane bridge — this module must NOT import data-gateway.
 */
import { createHash } from "node:crypto";
import type { EmbeddingProvider } from "../../../memory/embeddings.js";
import type { GovernanceOwnershipProof } from "../../data-governance/write-gate.js";
import { fetchKbBoundExternalSourcePayload } from "../../enterprise-data/kb-bound-source-fetch.js";
import type { GatewayClient } from "../../server-methods/types.js";
import type { KnowledgeBase } from "../knowledge-base-store.js";
import { attachDocumentToKnowledgeBase } from "../knowledge-base-store.js";
import {
  ingestKnowledgePayloadToBase,
  type PersonalKnowledgeIngestOutcome,
} from "../personal-knowledge-ingest.js";
import { invokeApiSource } from "./source-api-runtime.js";
import {
  listKnowledgeSourceBindings,
  patchKnowledgeSourceBindingMetadata,
} from "./source-binding-store.js";
import type { SourceDescriptor } from "./source-descriptor.js";
import { upsertSourceDocumentLink } from "./source-document-link-store.js";
import type { KnowledgeSourceContext } from "./types.js";

const INGEST_RELATIVE_PATH_DEFAULT = "__snapshot__";
const MAX_SERIALIZED_BYTES = 2 * 1024 * 1024;

export type SourceIngestRuntimeOptions = {
  bindingsStorePath?: string;
  sourceDocumentLinkStorePath?: string;
  kbStorePath?: string;
  indexRoot?: string;
  path?: string;
  method?: string;
  body?: Record<string, unknown>;
  authorizedKnowledgeBaseIds?: ReadonlySet<string>;
  embeddingProvider?: EmbeddingProvider | null;
  /** Injectable for tests — otherwise uses enterprise-data bridge. */
  fetchExternal?: typeof fetchKbBoundExternalSourcePayload;
  /** Injectable for tests — otherwise uses invokeApiSource. */
  fetchApi?: typeof invokeApiSource;
};

export type SourceIngestResult = {
  ok: boolean;
  sourceDescriptorId: string;
  documentId?: string;
  knowledgeBaseId?: string;
  ingest?: PersonalKnowledgeIngestOutcome;
  reason?: string;
  binding?: SourceDescriptor;
};

function stableSourceDocumentId(sourceDescriptorId: string, relativePath: string): string {
  const key = `${sourceDescriptorId}::${relativePath}`;
  return `srcdir-${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

function serializePayload(
  payload: unknown,
  title: string,
): { buffer: Buffer; fileName: string; mimeType: string } {
  // kb-ingest accepts markdown/plain text — wrap structured payloads so RAG can index them.
  const body =
    typeof payload === "string"
      ? payload
      : [
          "# " + (title.trim() || "Source snapshot"),
          "",
          "```json",
          JSON.stringify(payload, null, 2),
          "```",
          "",
        ].join("\n");
  const buffer = Buffer.from(body, "utf8");
  return { buffer, fileName: `${sanitizeFileStem(title)}.md`, mimeType: "text/markdown" };
}

function sanitizeFileStem(title: string): string {
  const stem = title
    .trim()
    .replace(/[^\w\u4e00-\u9fff.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return stem || "source-snapshot";
}

function resolveBinding(
  sourceDescriptorId: string,
  knowledgeBaseId: string,
  options: Pick<SourceIngestRuntimeOptions, "bindingsStorePath">,
): SourceDescriptor {
  const binding = listKnowledgeSourceBindings({ knowledgeBaseId }, options.bindingsStorePath).find(
    (item) => item.id === sourceDescriptorId,
  );
  if (!binding) {
    throw new Error("source binding not found for knowledge base");
  }
  if (binding.kind !== "api" && binding.kind !== "external") {
    throw new Error("only api and external sources support sync/ingest");
  }
  return binding;
}

async function fetchActiveSourcePayload(params: {
  binding: SourceDescriptor;
  context: KnowledgeSourceContext;
  client: GatewayClient | null;
  options: SourceIngestRuntimeOptions;
}): Promise<unknown> {
  const { binding, context, client, options } = params;
  if (binding.kind === "api") {
    const pathSuffix =
      options.path?.trim() ||
      binding.metadata?.["ingest.path"] ||
      binding.metadata?.["catalog.path"] ||
      "/";
    const fetchApi = options.fetchApi ?? invokeApiSource;
    const result = await fetchApi(binding.id, pathSuffix, context, {
      method: options.method,
      body: options.body,
      bindingsStorePath: options.bindingsStorePath,
      authorizedKnowledgeBaseIds: options.authorizedKnowledgeBaseIds,
    });
    return result.data;
  }

  if (!binding.endpoint) {
    throw new Error("external source missing enterprise-data endpoint");
  }
  const fetchExternal = options.fetchExternal ?? fetchKbBoundExternalSourcePayload;
  const result = await fetchExternal({
    client,
    endpoint: binding.endpoint,
    input: options.body,
  });
  if (!result.ok) {
    throw new Error(result.reason ?? "external source fetch failed");
  }
  return result.payload;
}

/**
 * Sync a bound active source into the knowledge base index and link store.
 */
export async function ingestKnowledgeSourceBinding(params: {
  sourceDescriptorId: string;
  knowledgeBase: KnowledgeBase;
  context: KnowledgeSourceContext;
  client?: GatewayClient | null;
  ownerId: string;
  options?: SourceIngestRuntimeOptions;
  /** Trusted proof from authenticated call entry — required for tenant-scoped KBs. */
  governanceOwnershipProof?: GovernanceOwnershipProof;
}): Promise<SourceIngestResult> {
  const options = params.options ?? {};
  const sourceDescriptorId = params.sourceDescriptorId.trim();
  const knowledgeBaseId = params.knowledgeBase.id;

  let binding: SourceDescriptor;
  try {
    binding = resolveBinding(sourceDescriptorId, knowledgeBaseId, options);
  } catch (error) {
    return {
      ok: false,
      sourceDescriptorId,
      knowledgeBaseId,
      reason: error instanceof Error ? error.message : "binding resolve failed",
    };
  }

  let payload: unknown;
  try {
    payload = await fetchActiveSourcePayload({
      binding,
      context: params.context,
      client: params.client ?? null,
      options: {
        ...options,
        authorizedKnowledgeBaseIds:
          options.authorizedKnowledgeBaseIds ?? new Set([knowledgeBaseId]),
      },
    });
  } catch (error) {
    return {
      ok: false,
      sourceDescriptorId,
      knowledgeBaseId,
      reason: error instanceof Error ? error.message : "source fetch failed",
      binding,
    };
  }

  const relativePath = (options.path?.trim() || INGEST_RELATIVE_PATH_DEFAULT).replace(/\\/g, "/");
  const documentId = stableSourceDocumentId(sourceDescriptorId, relativePath);
  const { buffer, fileName, mimeType } = serializePayload(payload, binding.title);
  if (buffer.byteLength === 0) {
    return {
      ok: false,
      sourceDescriptorId,
      knowledgeBaseId,
      documentId,
      reason: "empty source payload",
      binding,
    };
  }
  if (buffer.byteLength > MAX_SERIALIZED_BYTES) {
    return {
      ok: false,
      sourceDescriptorId,
      knowledgeBaseId,
      documentId,
      reason: "source payload exceeds 2 MiB serialize limit",
      binding,
    };
  }

  const ingest = await ingestKnowledgePayloadToBase({
    knowledgeBase: params.knowledgeBase,
    documentId,
    title: binding.title,
    fileName,
    mimeType,
    buffer,
    ownerId: params.ownerId,
    sourceName: `source:${binding.kind}:${sourceDescriptorId}`,
    indexRoot: options.indexRoot,
    client: params.client ?? null,
    ...(options.embeddingProvider !== undefined
      ? { embeddingProvider: options.embeddingProvider }
      : {}),
    governanceOwnershipProof: params.governanceOwnershipProof,
  });

  if (ingest.error || (ingest.skipped && ingest.reason === "empty content")) {
    return {
      ok: false,
      sourceDescriptorId,
      knowledgeBaseId,
      documentId,
      ingest,
      reason: ingest.error ?? ingest.reason ?? "ingest failed",
      binding,
    };
  }

  attachDocumentToKnowledgeBase(knowledgeBaseId, documentId, options.kbStorePath);
  upsertSourceDocumentLink(
    {
      sourceDescriptorId,
      docId: documentId,
      relativePath,
      state: "active",
      lastSeenAt: Date.now(),
      lastIngestedVersionId: ingest.versionLabel ?? undefined,
    },
    options.sourceDocumentLinkStorePath,
  );

  const patched = patchKnowledgeSourceBindingMetadata(
    sourceDescriptorId,
    {
      lastIngestedAt: new Date().toISOString(),
      documentId,
    },
    options.bindingsStorePath,
  );

  return {
    ok: true,
    sourceDescriptorId,
    knowledgeBaseId,
    documentId,
    ingest,
    binding: patched ?? binding,
  };
}
