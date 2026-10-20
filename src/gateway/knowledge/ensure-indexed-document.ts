/**
 * First-reference index materialization for a catalogued knowledge file.
 *
 * Index writes stay on `ingestKnowledgeDocument` (via `ingestKnowledgePayloadToBase`).
 * Consume / picker selection only asks this helper once when text is missing; later
 * turns reuse the durable index (fingerprint skip).
 */
import fs from "node:fs";
import path from "node:path";
import type { EmbeddingProvider } from "../../memory/embeddings.js";
import {
  ownershipProofFromLocalUser,
  ownershipProofFromTenantUser,
} from "../data-governance/ownership-proof.js";
import { getKnowledgeBase } from "./knowledge-base-store.js";
import { persistKnowledgeOriginal, readKnowledgeOriginal } from "./knowledge-original-store.js";
import { isUnparsedDocumentPlaceholder } from "./personal-document-upload.js";
import { ingestKnowledgePayloadToBase } from "./personal-knowledge-ingest.js";
import { resolveLocalFolderDocument } from "./sources/local-folder-open.js";
import type { KnowledgeSourceContext } from "./sources/types.js";

export type EnsureKnowledgeDocumentIndexedStatus = "reused" | "indexed" | "unavailable" | "denied";

export type EnsureKnowledgeDocumentIndexedResult = {
  status: EnsureKnowledgeDocumentIndexedStatus;
  reason?: string;
};

type RecoveredSource = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  title: string;
};

const inflight = new Map<string, Promise<EnsureKnowledgeDocumentIndexedResult>>();

function proofFromContext(context: KnowledgeSourceContext) {
  const userId = context.userId?.trim();
  if (!userId) {
    return undefined;
  }
  const tenantId = context.tenantId?.trim() || null;
  return tenantId
    ? ownershipProofFromTenantUser({ tenantId, userId })
    : ownershipProofFromLocalUser({ userId });
}

function looksLikePdf(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from("%PDF"));
}

function isPlaceholderSource(params: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}): boolean {
  const text = params.buffer.toString("utf8");
  if (isUnparsedDocumentPlaceholder(text)) {
    return true;
  }
  const claimsPdf =
    params.fileName.toLowerCase().endsWith(".pdf") || params.mimeType === "application/pdf";
  return claimsPdf && !looksLikePdf(params.buffer) && isUnparsedDocumentPlaceholder(text);
}

function titleFromFileName(fileName: string): string {
  const base = path.basename(fileName);
  const ext = path.extname(base);
  return (ext ? base.slice(0, -ext.length) : base).trim() || base;
}

function recoverIndexableSource(params: {
  knowledgeBaseId: string;
  documentId: string;
  originalsRoot?: string;
  bindingStorePath?: string;
  linkStorePath?: string;
}): RecoveredSource | null {
  const stored = readKnowledgeOriginal({
    kbId: params.knowledgeBaseId,
    docId: params.documentId,
    originalsRoot: params.originalsRoot,
  });
  if (stored?.buffer.length) {
    if (
      isPlaceholderSource({
        buffer: stored.buffer,
        fileName: stored.manifest.fileName,
        mimeType: stored.manifest.mimeType,
      })
    ) {
      return null;
    }
    return {
      fileName: stored.manifest.fileName,
      mimeType: stored.manifest.mimeType,
      buffer: stored.buffer,
      title: titleFromFileName(stored.manifest.fileName),
    };
  }

  try {
    const resolved = resolveLocalFolderDocument({
      documentId: params.documentId,
      knowledgeBaseId: params.knowledgeBaseId,
      bindingStorePath: params.bindingStorePath,
      linkStorePath: params.linkStorePath,
    });
    const buffer = fs.readFileSync(resolved.absolutePath);
    if (!buffer.length) {
      return null;
    }
    const fileName = path.basename(resolved.relativePath) || `${params.documentId}.bin`;
    if (isPlaceholderSource({ buffer, fileName, mimeType: "application/octet-stream" })) {
      return null;
    }
    try {
      persistKnowledgeOriginal({
        kbId: params.knowledgeBaseId,
        docId: params.documentId,
        fileName,
        mimeType: "application/octet-stream",
        buffer,
        originalsRoot: params.originalsRoot,
      });
    } catch {
      // Indexing can proceed from the live folder file.
    }
    return {
      fileName,
      mimeType: "application/octet-stream",
      buffer,
      title: titleFromFileName(fileName),
    };
  } catch {
    return null;
  }
}

async function ensureKnowledgeDocumentIndexedOnce(params: {
  knowledgeBaseId: string;
  documentId: string;
  context: KnowledgeSourceContext;
  originalsRoot?: string;
  indexRoot?: string;
  storePath?: string;
  bindingStorePath?: string;
  linkStorePath?: string;
  embeddingProvider?: EmbeddingProvider | null;
}): Promise<EnsureKnowledgeDocumentIndexedResult> {
  const knowledgeBaseId = params.knowledgeBaseId.trim();
  const documentId = params.documentId.trim();
  const ownerId = params.context.userId?.trim();
  if (!knowledgeBaseId || !documentId || !ownerId) {
    return { status: "unavailable", reason: "not_found" };
  }

  const knowledgeBase = getKnowledgeBase(knowledgeBaseId, params.storePath);
  if (!knowledgeBase) {
    return { status: "unavailable", reason: "not_found" };
  }

  const source = recoverIndexableSource({
    knowledgeBaseId,
    documentId,
    originalsRoot: params.originalsRoot,
    bindingStorePath: params.bindingStorePath,
    linkStorePath: params.linkStorePath,
  });
  if (!source) {
    return {
      status: "unavailable",
      reason: knowledgeBase.documentIds.includes(documentId) ? "not_indexed" : "not_found",
    };
  }

  const outcome = await ingestKnowledgePayloadToBase({
    knowledgeBase,
    documentId,
    title: source.title,
    fileName: source.fileName,
    mimeType: source.mimeType,
    buffer: source.buffer,
    ownerId,
    indexRoot: params.indexRoot,
    originalsRoot: params.originalsRoot,
    embeddingProvider: params.embeddingProvider,
    governanceOwnershipProof: proofFromContext(params.context),
  });
  if (outcome.error === "governance_write_denied:missing_ownership_proof") {
    return { status: "denied", reason: "permission_denied" };
  }
  if (outcome.error) {
    return { status: "unavailable", reason: "not_indexed" };
  }
  if (!outcome.attempted && outcome.reason === "unparsed placeholder") {
    return { status: "unavailable", reason: "not_indexed" };
  }
  return {
    status: outcome.skipped && outcome.delta === "unchanged" ? "reused" : "indexed",
  };
}

export async function ensureKnowledgeDocumentIndexed(params: {
  knowledgeBaseId: string;
  documentId: string;
  context: KnowledgeSourceContext;
  originalsRoot?: string;
  indexRoot?: string;
  storePath?: string;
  bindingStorePath?: string;
  linkStorePath?: string;
  embeddingProvider?: EmbeddingProvider | null;
}): Promise<EnsureKnowledgeDocumentIndexedResult> {
  const key = `${params.knowledgeBaseId.trim()}::${params.documentId.trim()}`;
  const pending = inflight.get(key);
  if (pending) {
    return pending;
  }
  const run = ensureKnowledgeDocumentIndexedOnce(params).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, run);
  return run;
}
