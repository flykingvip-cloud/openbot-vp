import fs from "node:fs";
import path from "node:path";
import { renderOfficePreviewHtml } from "../office-render.js";
import { InMemoryWorkspaceResourceCatalog } from "../workspace-resolver/catalog.js";
import {
  readLocalIndexDocumentContent,
  resolveWorkspaceActorTenantId,
} from "../workspace-resolver/index.js";
import { getKnowledgeBase } from "./knowledge-base-store.js";
import {
  resolveKnowledgeDirectoryLayoutForBase,
  resolveKnowledgeIndexRootForBase,
} from "./knowledge-directory.js";
import {
  findKnowledgeOriginalByFileName,
  persistKnowledgeOriginal,
  readKnowledgeOriginal,
} from "./knowledge-original-store.js";
import { readReservedDeliverableOriginal } from "./reserved-deliverable-original.js";
import { listLocalFolderBindings } from "./sources/local-folder-binding-store.js";
import { resolveLocalFolderDocument } from "./sources/local-folder-open.js";
import { findSourceDocumentLinkByDocId } from "./sources/source-document-link-store.js";

const TEXT_LIKE_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".text",
  ".log",
  ".csv",
  ".tsv",
  ".json",
  ".yaml",
  ".yml",
  ".html",
  ".htm",
  ".xml",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".text": "text/plain",
  ".log": "text/plain",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".html": "text/html",
  ".htm": "text/html",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const KNOWLEDGE_ORIGINAL_NOT_RETAINED = "original_not_retained";

export type KnowledgeDocumentContentSource = "original_store" | "local_index" | "index_text";

export type KnowledgeDocumentContent = {
  filename: string;
  relativePath?: string;
  mimeTypeHint?: string;
  buffer: Buffer;
  source: KnowledgeDocumentContentSource;
  chunkIds?: string[];
};

export type KnowledgeDocumentPreviewPayload = {
  filename: string;
  relativePath?: string;
  mimeType: string;
  byteLength: number;
  textLike: boolean;
  renderKind?: "html";
  html?: string;
  base64?: string;
  source: KnowledgeDocumentContentSource;
};

export class KnowledgeDocumentPreviewUnavailableError extends Error {
  readonly code = KNOWLEDGE_ORIGINAL_NOT_RETAINED;
  constructor(message = "original document was not retained; re-upload to preview") {
    super(message);
    this.name = "KnowledgeDocumentPreviewUnavailableError";
  }
}

function inferMimeType(ext: string, fallback?: string): string {
  return MIME_BY_EXTENSION[ext] ?? (fallback?.trim() || "application/octet-stream");
}

function readSiblingLocalIndexFile(params: {
  fileName: string;
  bindingStorePath?: string;
}): { filename: string; relativePath: string; buffer: Buffer } | null {
  const fileName = path.basename(params.fileName).trim();
  if (!fileName) {
    return null;
  }
  const bindings = listLocalFolderBindings({}, params.bindingStorePath);
  for (const binding of bindings) {
    if (binding.mode !== "local_index" || !binding.rootPath?.trim()) {
      continue;
    }
    const candidate = path.resolve(binding.rootPath, fileName);
    try {
      const rootReal = path.resolve(binding.rootPath);
      const targetReal = fs.realpathSync(candidate);
      const relative = path.relative(rootReal, targetReal);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        continue;
      }
      const stat = fs.statSync(targetReal);
      if (!stat.isFile()) {
        continue;
      }
      return {
        filename: fileName,
        relativePath: relative,
        buffer: fs.readFileSync(targetReal),
      };
    } catch {
      continue;
    }
  }
  return null;
}

function isTextLikeContent(filename: string, mimeTypeHint?: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  const mimeType = inferMimeType(ext, mimeTypeHint);
  return (
    TEXT_LIKE_EXTENSIONS.has(ext) ||
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType.endsWith("+json") ||
    mimeType.endsWith("+xml")
  );
}

async function buildPreviewPayload(params: {
  filename: string;
  relativePath?: string;
  mimeTypeHint?: string;
  buffer: Buffer;
  source: KnowledgeDocumentContentSource;
  render?: boolean;
}): Promise<KnowledgeDocumentPreviewPayload> {
  const filename = path.basename(params.filename) || "document.bin";
  const ext = path.extname(filename).toLowerCase();
  const mimeType = inferMimeType(ext, params.mimeTypeHint);
  const wantRender = params.render === true;

  if (wantRender) {
    const rendered = await renderOfficePreviewHtml({ filename, buffer: params.buffer });
    if (rendered) {
      return {
        filename,
        ...(params.relativePath ? { relativePath: params.relativePath } : {}),
        mimeType,
        byteLength: params.buffer.length,
        textLike: false,
        renderKind: "html",
        html: rendered.html,
        ...(rendered.keepBytes ? { base64: params.buffer.toString("base64") } : {}),
        source: params.source,
      };
    }
  }

  return {
    filename,
    ...(params.relativePath ? { relativePath: params.relativePath } : {}),
    mimeType,
    byteLength: params.buffer.length,
    textLike: TEXT_LIKE_EXTENSIONS.has(ext),
    base64: params.buffer.toString("base64"),
    source: params.source,
  };
}

export async function previewKnowledgeDocument(params: {
  knowledgeBaseId: string;
  documentId: string;
  render?: boolean;
  originalsRoot?: string;
  bindingStorePath?: string;
  linkStorePath?: string;
  userId?: string | null;
  tenantId?: string | null;
  indexRoot?: string;
  kbStorePath?: string;
  archiveStorePath?: string;
  tenantsRoot?: string;
  configDir?: string;
}): Promise<KnowledgeDocumentPreviewPayload> {
  const content = await readKnowledgeDocumentContent(params);
  if (!content) {
    throw new KnowledgeDocumentPreviewUnavailableError();
  }
  return buildPreviewPayload({
    filename: content.filename,
    ...(content.relativePath ? { relativePath: content.relativePath } : {}),
    ...(content.mimeTypeHint ? { mimeTypeHint: content.mimeTypeHint } : {}),
    buffer: content.buffer,
    source: content.source,
    render: params.render,
  });
}

export async function readKnowledgeDocumentContent(params: {
  knowledgeBaseId: string;
  documentId: string;
  originalsRoot?: string;
  bindingStorePath?: string;
  linkStorePath?: string;
  userId?: string | null;
  tenantId?: string | null;
  indexRoot?: string;
  textOnly?: boolean;
  kbStorePath?: string;
  archiveStorePath?: string;
  tenantsRoot?: string;
  configDir?: string;
}): Promise<KnowledgeDocumentContent | null> {
  const kbId = params.knowledgeBaseId.trim();
  const documentId = params.documentId.trim();
  if (!kbId || !documentId) {
    return null;
  }

  const base = getKnowledgeBase(kbId, params.kbStorePath);
  const originalsRoot =
    params.originalsRoot ??
    (base
      ? resolveKnowledgeDirectoryLayoutForBase(base, {
          tenantsRoot: params.tenantsRoot,
          configDir: params.configDir,
        }).originalsRoot
      : undefined);
  const stored =
    readKnowledgeOriginal({ kbId, docId: documentId, originalsRoot }) ??
    // Legacy originals were stored below CONFIG_DIR. Explicit injected roots
    // remain authoritative; automatic layout resolution may read the old root.
    (params.originalsRoot === undefined && originalsRoot
      ? readKnowledgeOriginal({ kbId, docId: documentId })
      : null);
  if (
    stored &&
    (!params.textOnly || isTextLikeContent(stored.manifest.fileName, stored.manifest.mimeType))
  ) {
    return {
      filename: stored.manifest.fileName,
      relativePath: stored.manifest.relativePath,
      mimeTypeHint: stored.manifest.mimeType,
      buffer: stored.buffer,
      source: "original_store",
    };
  }
  const retainAlias = (found: {
    filename: string;
    mimeTypeHint?: string;
    buffer: Buffer;
    source: KnowledgeDocumentContentSource;
    relativePath?: string;
  }): KnowledgeDocumentContent => {
    persistKnowledgeOriginal({
      kbId,
      docId: documentId,
      fileName: found.filename,
      mimeType: found.mimeTypeHint ?? "application/octet-stream",
      buffer: found.buffer,
      ...(originalsRoot ? { originalsRoot } : {}),
    });
    return found;
  };

  try {
    const resolved = resolveLocalFolderDocument({
      documentId,
      knowledgeBaseId: kbId,
      bindingStorePath: params.bindingStorePath,
      linkStorePath: params.linkStorePath,
    });
    const tenantId = resolveWorkspaceActorTenantId(params.tenantId);
    const userId = params.userId?.trim() || "system";
    const readResult = readLocalIndexDocumentContent({
      // Existing-shape read view only. Do not synthesize an empty Catalog
      // and do not write a production Catalog row.
      catalog: new InMemoryWorkspaceResourceCatalog({
        governanceVersion: 1,
        status: "available",
        resources: {},
        bindings: {},
      }),
      actor: { tenantId, userId },
      tenantId,
      userId,
      bindingId: resolved.bindingId,
      workspaceRoot: resolved.rootPath,
      relativePath: resolved.relativePath,
      operation: "preview",
      purpose: "knowledge.document.preview",
    });
    void import("../../memory/item7-w2-dark-dual-read-shadow.js").then(
      ({ scheduleItem7W2DarkDualReadShadow }) =>
        scheduleItem7W2DarkDualReadShadow({
          siteId: "S09-knowledge-doc-preview",
          legacyLocator: resolved.rootPath,
          replacementLocator: null,
        }),
    );
    void import("../../gateway/workspace-resolver/item7-w3-shadow.js").then(
      ({ scheduleItem7W3CatalogSynthesisShadow }) =>
        scheduleItem7W3CatalogSynthesisShadow({ ledgerId: "S09", existingResourceId: null }),
    );
    if (!readResult.ok) {
      throw new KnowledgeDocumentPreviewUnavailableError();
    }
    const filename = path.basename(resolved.relativePath) || "document.bin";
    if (params.textOnly && !isTextLikeContent(filename)) {
      throw new KnowledgeDocumentPreviewUnavailableError();
    }
    return {
      filename,
      relativePath: resolved.relativePath,
      buffer: readResult.buffer,
      source: "local_index",
    };
  } catch {
    // Fall through to filename aliases, then indexed text.
  }

  const link = findSourceDocumentLinkByDocId(documentId, params.linkStorePath);
  const linkedName = link?.relativePath?.trim() ? path.basename(link.relativePath) : "";
  if (linkedName) {
    const aliased = findKnowledgeOriginalByFileName({
      fileName: linkedName,
      preferKbId: kbId,
      originalsRoot,
    });
    if (
      aliased &&
      (!params.textOnly || isTextLikeContent(aliased.manifest.fileName, aliased.manifest.mimeType))
    ) {
      return retainAlias({
        filename: aliased.manifest.fileName,
        relativePath: aliased.manifest.relativePath,
        mimeTypeHint: aliased.manifest.mimeType,
        buffer: aliased.buffer,
        source: "original_store",
      });
    }
    const sibling = readSiblingLocalIndexFile({
      fileName: linkedName,
      bindingStorePath: params.bindingStorePath,
    });
    if (sibling && (!params.textOnly || isTextLikeContent(sibling.filename))) {
      return retainAlias({
        filename: sibling.filename,
        relativePath: sibling.relativePath,
        buffer: sibling.buffer,
        source: "local_index",
      });
    }
  }

  const reserved = readReservedDeliverableOriginal({
    knowledgeBaseId: kbId,
    documentId,
    ...(linkedName ? { linkedName } : {}),
    ...(params.kbStorePath ? { kbStorePath: params.kbStorePath } : {}),
    ...(params.archiveStorePath ? { archiveStorePath: params.archiveStorePath } : {}),
    ...(params.tenantsRoot ? { tenantsRoot: params.tenantsRoot } : {}),
    ...(params.configDir ? { configDir: params.configDir } : {}),
  });
  if (reserved && (!params.textOnly || isTextLikeContent(reserved.filename))) {
    return retainAlias({
      filename: reserved.filename,
      buffer: reserved.buffer,
      source: "original_store",
    });
  }

  return readKnowledgeDocumentFromIndexedChunks({
    knowledgeBaseId: kbId,
    documentId,
    userId: params.userId,
    tenantId: params.tenantId,
    indexRoot:
      params.indexRoot ??
      (base
        ? resolveKnowledgeIndexRootForBase(base, {
            tenantsRoot: params.tenantsRoot,
            configDir: params.configDir,
          })
        : undefined),
  });
}

async function readKnowledgeDocumentFromIndexedChunks(params: {
  knowledgeBaseId: string;
  documentId: string;
  userId?: string | null;
  tenantId?: string | null;
  indexRoot?: string;
}): Promise<KnowledgeDocumentContent | null> {
  const { openKnowledgeIndex, resolveKnowledgeIndexDbPath } = await import("./kb-index.js");
  const fs = await import("node:fs");
  const ownerId = params.userId?.trim() || "system";
  const tenantId = params.tenantId?.trim() || null;
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId,
    tenantId,
    ...(params.indexRoot ? { indexRoot: params.indexRoot } : {}),
  });
  if (!fs.existsSync(dbPath)) {
    return null;
  }
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    const doc = index.db
      .prepare(`SELECT title, content_type FROM documents WHERE kb_id = ? AND doc_id = ?`)
      .get(params.knowledgeBaseId, params.documentId) as
      | { title?: string; content_type?: string }
      | undefined;
    const rows = index.db
      .prepare(
        `SELECT c.id AS chunk_id, c.text AS text, m.start_line AS start_line
         FROM chunk_meta m
         JOIN chunks c ON c.id = m.chunk_id
         WHERE m.kb_id = ? AND m.doc_id = ?
         ORDER BY COALESCE(m.start_line, 0), m.chunk_id`,
      )
      .all(params.knowledgeBaseId, params.documentId) as Array<{
      chunk_id?: string;
      text?: string;
      start_line?: number;
    }>;
    const parts = rows
      .map((row) => (typeof row.text === "string" ? row.text.trim() : ""))
      .filter(Boolean);
    if (parts.length === 0) {
      return null;
    }
    const title =
      typeof doc?.title === "string" && doc.title.trim() ? doc.title.trim() : params.documentId;
    const ext = doc?.content_type === "docx" ? ".docx" : ".md";
    return {
      filename: `${title.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120) || "document"}${ext === ".docx" ? ".md" : ext}`,
      buffer: Buffer.from(parts.join("\n\n"), "utf8"),
      source: "index_text",
      chunkIds: rows
        .map((row) => (typeof row.chunk_id === "string" ? row.chunk_id.trim() : ""))
        .filter(Boolean),
    };
  } finally {
    index.close();
  }
}
