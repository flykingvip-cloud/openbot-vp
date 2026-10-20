/**
 * P1 local-mode runtime: scan a LocalFolderBinding root, ingest into knowledge index,
 * maintain SourceDocumentLink rows, apply deletePolicy (sync | snapshot).
 *
 * Continuous watching: see local-folder-watcher.ts (debounced full reconcile).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { OpenBotConfig } from "../../../config/config.js";
import type { EmbeddingProvider } from "../../../memory/embeddings.js";
import type { GovernanceOwnershipProof } from "../../data-governance/write-gate.js";
import type { GatewayClient } from "../../server-methods/types.js";
import {
  deleteKnowledgeDocumentFromIndex,
  openKnowledgeIndex,
  resolveKnowledgeIndexDbPath,
} from "../kb-index.js";
import {
  attachDocumentToKnowledgeBase,
  deleteDocumentFromKnowledgeBase,
  detachDocumentFromKnowledgeBase,
  type KnowledgeBase,
} from "../knowledge-base-store.js";
import { isSupportedPersonalDocument } from "../personal-document-upload.js";
import { ingestKnowledgePayloadToBase } from "../personal-knowledge-ingest.js";
import { updateLocalFolderBindingStatus } from "./local-folder-binding-store.js";
import { type LocalFolderBinding, type LocalFolderScanNowResponse } from "./local-folder-types.js";
import {
  countActiveSourceDocumentLinks,
  listSourceDocumentLinks,
  upsertSourceDocumentLink,
  updateSourceDocumentLinkState,
  deleteSourceDocumentLinksForSource,
} from "./source-document-link-store.js";

export const LOCAL_FOLDER_SCAN_MAX_FILES = 500;

const MIME_BY_EXT: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Live local-folder docId prefix. Must satisfy governance SAFE_ID (no colon). */
export const LOCAL_FOLDER_DOC_ID_PREFIX = "lfdoc-";
/** Legacy prefix from pre-SAFE_ID snapshots. Readers must still recognize it. */
export const LOCAL_FOLDER_DOC_ID_PREFIX_LEGACY = "lfdoc:";

export function isLocalFolderDocId(docId: string): boolean {
  return (
    docId.startsWith(LOCAL_FOLDER_DOC_ID_PREFIX) ||
    docId.startsWith(LOCAL_FOLDER_DOC_ID_PREFIX_LEGACY)
  );
}

export function buildLocalFolderDocId(sourceDescriptorId: string, relativePath: string): string {
  const key = `${sourceDescriptorId}::${relativePath.replace(/\\/g, "/")}`;
  return `${LOCAL_FOLDER_DOC_ID_PREFIX}${createHash("sha256").update(key).digest("hex").slice(0, 28)}`;
}

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

function mimeForFile(fileName: string): string {
  return MIME_BY_EXT[extensionOf(fileName)] ?? "application/octet-stream";
}

/** Minimal glob: supports *, **, and path separators. */
export function matchSimpleGlob(pattern: string, relativePath: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  const normalizedPath = relativePath.replace(/\\/g, "/");
  if (normalizedPattern === "**/*" || normalizedPattern === "**") {
    return true;
  }
  // Escape regex specials except * which we expand.
  let regexSource = "";
  for (let i = 0; i < normalizedPattern.length; i += 1) {
    const ch = normalizedPattern[i];
    if (ch === "*" && normalizedPattern[i + 1] === "*") {
      regexSource += ".*";
      i += 1;
      if (normalizedPattern[i + 1] === "/") {
        i += 1;
        regexSource += "/?";
      }
      continue;
    }
    if (ch === "*") {
      regexSource += "[^/]*";
      continue;
    }
    if ("\\.{}()+?^$|[]".includes(ch)) {
      regexSource += `\\${ch}`;
      continue;
    }
    regexSource += ch;
  }
  return new RegExp(`^${regexSource}$`, "i").test(normalizedPath);
}

export function isPathIncluded(params: {
  relativePath: string;
  includeGlobs: string[];
  excludeGlobs: string[];
}): boolean {
  const rel = params.relativePath.replace(/\\/g, "/");
  const included =
    params.includeGlobs.length === 0
      ? true
      : params.includeGlobs.some((glob) => matchSimpleGlob(glob, rel));
  if (!included) {
    return false;
  }
  return !params.excludeGlobs.some((glob) => matchSimpleGlob(glob, rel));
}

export type ScannedLocalFile = {
  absolutePath: string;
  relativePath: string;
  fileName: string;
};

export function walkLocalFolderFiles(params: {
  rootPath: string;
  includeGlobs: string[];
  excludeGlobs: string[];
  maxFiles?: number;
}): { files: ScannedLocalFile[]; truncated: boolean } {
  const root = path.resolve(params.rootPath);
  const maxFiles = params.maxFiles ?? LOCAL_FOLDER_SCAN_MAX_FILES;
  const files: ScannedLocalFile[] = [];
  let truncated = false;

  const visit = (dir: string) => {
    if (files.length >= maxFiles) {
      truncated = true;
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
      const absolutePath = path.join(dir, entry.name);
      const relativePath = path.relative(root, absolutePath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (
          !isPathIncluded({
            relativePath: `${relativePath}/`,
            includeGlobs: ["**/*"],
            excludeGlobs: params.excludeGlobs,
          })
        ) {
          // Still allow walking if only files match include; exclude dir name.
          if (
            params.excludeGlobs.some(
              (glob) =>
                matchSimpleGlob(glob, relativePath) ||
                matchSimpleGlob(glob, `${relativePath}/`) ||
                matchSimpleGlob(glob, `${relativePath}/**`),
            )
          ) {
            continue;
          }
        }
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (
        !isPathIncluded({
          relativePath,
          includeGlobs: params.includeGlobs,
          excludeGlobs: params.excludeGlobs,
        })
      ) {
        continue;
      }
      const fileName = entry.name;
      if (!isSupportedPersonalDocument(fileName, mimeForFile(fileName))) {
        continue;
      }
      files.push({ absolutePath, relativePath, fileName });
    }
  };

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`local folder root does not exist or is not a directory: ${root}`);
  }
  visit(root);
  return { files, truncated };
}

export type LocalFolderScanSummary = {
  bindingId: string;
  sourceDescriptorId: string;
  scanned: number;
  ingested: number;
  skipped: number;
  tombstoned: number;
  snapshotted: number;
  truncated: boolean;
  errors: string[];
};

/** Shared purge for localFolder + passive connectors (KB attach + index + explicit metadata). */
export async function purgeIndexedDocument(params: {
  knowledgeBase: KnowledgeBase;
  docId: string;
  ownerId: string;
  indexRoot?: string;
  kbStorePath?: string;
}): Promise<void> {
  try {
    deleteDocumentFromKnowledgeBase(params.knowledgeBase.id, params.docId, params.kbStorePath);
  } catch {
    try {
      detachDocumentFromKnowledgeBase(params.knowledgeBase.id, params.docId, params.kbStorePath);
    } catch {
      // ignore
    }
  }
  try {
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: params.ownerId,
      tenantId: params.knowledgeBase.tenantId,
      indexRoot: params.indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      deleteKnowledgeDocumentFromIndex({ db: index.db, index, docId: params.docId });
    } finally {
      index.close();
    }
  } catch {
    // best-effort index cleanup
  }
  try {
    const { deleteExplicitDocumentMetadata } = await import("../explicit-metadata-store.js");
    deleteExplicitDocumentMetadata(params.docId);
  } catch {
    // best-effort metadata cleanup
  }
  try {
    const { deleteKnowledgeOriginal } = await import("../knowledge-original-store.js");
    deleteKnowledgeOriginal({ kbId: params.knowledgeBase.id, docId: params.docId });
  } catch {
    // best-effort original cleanup
  }
}

export async function scanLocalFolderBinding(params: {
  binding: LocalFolderBinding;
  knowledgeBase: KnowledgeBase;
  ownerId: string;
  indexRoot?: string;
  kbStorePath?: string;
  bindingStorePath?: string;
  linkStorePath?: string;
  cfg?: OpenBotConfig;
  client?: GatewayClient | null;
  embeddingProvider?: EmbeddingProvider | null;
  maxFiles?: number;
  /** Trusted proof from authenticated call entry — required for tenant-scoped KBs. */
  governanceOwnershipProof?: GovernanceOwnershipProof;
}): Promise<LocalFolderScanSummary> {
  const binding = params.binding;
  const summary: LocalFolderScanSummary = {
    bindingId: binding.bindingId,
    sourceDescriptorId: binding.sourceDescriptorId,
    scanned: 0,
    ingested: 0,
    skipped: 0,
    tombstoned: 0,
    snapshotted: 0,
    truncated: false,
    errors: [],
  };

  updateLocalFolderBindingStatus(
    binding.bindingId,
    { status: "scanning", lastError: null },
    params.bindingStorePath,
  );

  try {
    const walked = walkLocalFolderFiles({
      rootPath: binding.rootPath,
      includeGlobs: binding.includeGlobs,
      excludeGlobs: binding.excludeGlobs,
      maxFiles: params.maxFiles,
    });
    summary.truncated = walked.truncated;
    const seenRelative = new Set<string>();
    const now = Date.now();

    for (const file of walked.files) {
      summary.scanned += 1;
      seenRelative.add(file.relativePath);
      const docId = buildLocalFolderDocId(binding.sourceDescriptorId, file.relativePath);
      let buffer: Buffer;
      try {
        buffer = fs.readFileSync(file.absolutePath);
      } catch (error) {
        summary.skipped += 1;
        summary.errors.push(
          `${file.relativePath}: ${error instanceof Error ? error.message : "read failed"}`,
        );
        continue;
      }
      if (buffer.length === 0) {
        summary.skipped += 1;
        continue;
      }
      const title = path.basename(file.fileName, extensionOf(file.fileName)) || file.fileName;
      const outcome = await ingestKnowledgePayloadToBase({
        knowledgeBase: params.knowledgeBase,
        documentId: docId,
        title,
        fileName: file.fileName,
        mimeType: mimeForFile(file.fileName),
        buffer,
        ownerId: params.ownerId,
        sourceName: `localFolder:${binding.rootLabel}/${file.relativePath}`,
        indexRoot: params.indexRoot,
        cfg: params.cfg,
        client: params.client,
        embeddingProvider: params.embeddingProvider,
        governanceOwnershipProof: params.governanceOwnershipProof,
        deferEmbedding: true,
      });
      if (outcome.error) {
        summary.skipped += 1;
        summary.errors.push(`${file.relativePath}: ${outcome.error}`);
        continue;
      }
      try {
        attachDocumentToKnowledgeBase(params.knowledgeBase.id, docId, params.kbStorePath);
      } catch {
        // already attached or store race
      }
      upsertSourceDocumentLink(
        {
          sourceDescriptorId: binding.sourceDescriptorId,
          docId,
          relativePath: file.relativePath,
          state: "active",
          lastSeenAt: now,
          lastIngestedVersionId: outcome.versionLabel ?? undefined,
        },
        params.linkStorePath,
      );
      if (outcome.skipped) {
        summary.skipped += 1;
      } else {
        summary.ingested += 1;
      }
    }

    // Reconcile missing files against prior active links.
    const priorActive = listSourceDocumentLinks(
      { sourceDescriptorId: binding.sourceDescriptorId, state: "active" },
      params.linkStorePath,
    );
    for (const link of priorActive) {
      if (seenRelative.has(link.relativePath)) {
        continue;
      }
      if (binding.deletePolicy === "sync") {
        await purgeIndexedDocument({
          knowledgeBase: params.knowledgeBase,
          docId: link.docId,
          ownerId: params.ownerId,
          indexRoot: params.indexRoot,
          kbStorePath: params.kbStorePath,
        });
        updateSourceDocumentLinkState(
          {
            sourceDescriptorId: binding.sourceDescriptorId,
            relativePath: link.relativePath,
            state: "tombstoned",
            lastSeenAt: now,
          },
          params.linkStorePath,
        );
        summary.tombstoned += 1;
      } else {
        // snapshot: keep Runtime searchable; mark link only.
        updateSourceDocumentLinkState(
          {
            sourceDescriptorId: binding.sourceDescriptorId,
            relativePath: link.relativePath,
            state: "snapshotted_deleted",
            lastSeenAt: now,
          },
          params.linkStorePath,
        );
        summary.snapshotted += 1;
      }
    }

    updateLocalFolderBindingStatus(
      binding.bindingId,
      {
        status: "idle",
        lastScanAt: now,
        lastEventAt: now,
        lastError: summary.errors[0] ?? null,
      },
      params.bindingStorePath,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "scan failed";
    summary.errors.push(message);
    updateLocalFolderBindingStatus(
      binding.bindingId,
      { status: "error", lastError: message, lastEventAt: Date.now() },
      params.bindingStorePath,
    );
  }

  return summary;
}

export function buildLocalFolderScanNowResponse(
  summary: LocalFolderScanSummary,
  status: LocalFolderBinding["status"],
): LocalFolderScanNowResponse & { summary: LocalFolderScanSummary } {
  return {
    accepted: true,
    bindingId: summary.bindingId,
    status,
    summary,
  };
}

export async function unbindLocalFolderRuntime(params: {
  binding: LocalFolderBinding;
  knowledgeBase?: KnowledgeBase | null;
  ownerId?: string | null;
  purgeProjected?: boolean;
  indexRoot?: string;
  kbStorePath?: string;
  linkStorePath?: string;
}): Promise<{ ok: boolean; purged: number }> {
  let purged = 0;
  if (params.purgeProjected && params.knowledgeBase && params.ownerId) {
    const links = listSourceDocumentLinks(
      { sourceDescriptorId: params.binding.sourceDescriptorId },
      params.linkStorePath,
    );
    for (const link of links) {
      if (link.state === "tombstoned") {
        continue;
      }
      await purgeIndexedDocument({
        knowledgeBase: params.knowledgeBase,
        docId: link.docId,
        ownerId: params.ownerId,
        indexRoot: params.indexRoot,
        kbStorePath: params.kbStorePath,
      });
      purged += 1;
    }
  }
  deleteSourceDocumentLinksForSource(params.binding.sourceDescriptorId, params.linkStorePath);
  return { ok: true, purged };
}

export function activeDocumentCountForSource(
  sourceDescriptorId: string,
  linkStorePath?: string,
): number {
  return countActiveSourceDocumentLinks(sourceDescriptorId, linkStorePath);
}
