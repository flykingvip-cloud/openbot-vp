/**
 * Persist original knowledge-document bytes for sidebar preview.
 * Indexed chunks remain in SQLite; this store keeps the upload/sync payload on disk.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";
import { computeRawContentHash } from "./document-fingerprint.js";
import { MAX_BINARY_DATA_URL_BYTES } from "./personal-document-upload.js";

export type KnowledgeOriginalManifest = {
  docId: string;
  kbId: string;
  relativePath: string;
  mimeType: string;
  fileName: string;
  rawHash: string;
  sizeBytes: number;
};

export type PersistKnowledgeOriginalParams = {
  kbId: string;
  docId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  originalsRoot?: string;
};

export type ReadKnowledgeOriginalParams = {
  kbId: string;
  docId: string;
  originalsRoot?: string;
};

export type ReadKnowledgeOriginalResult = {
  manifest: KnowledgeOriginalManifest;
  absolutePath: string;
  buffer: Buffer;
};

/** Align with personal binary upload limit (fail-closed when oversized). */
export const MAX_KNOWLEDGE_ORIGINAL_BYTES = MAX_BINARY_DATA_URL_BYTES;

const DEFAULT_ORIGINALS_ROOT = path.join(CONFIG_DIR, "knowledge", "originals");

export function resolveKnowledgeOriginalsRoot(originalsRoot?: string): string {
  return originalsRoot?.trim() || DEFAULT_ORIGINALS_ROOT;
}

function sanitizeKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "unknown";
  }
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function sanitizeKnowledgeOriginalFileName(fileName: string): string {
  const base = path.basename(fileName.replace(/\\/g, "/")).trim() || "document.bin";
  const cleaned =
    base
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\p{Cc}/gu, "_")
      .replace(/\s+/g, " ")
      .trim() || "document.bin";
  return cleaned.slice(0, 180);
}

function documentDir(params: { kbId: string; docId: string; originalsRoot?: string }): string {
  return path.join(
    resolveKnowledgeOriginalsRoot(params.originalsRoot),
    sanitizeKey(params.kbId),
    sanitizeKey(params.docId),
  );
}

function manifestPath(params: { kbId: string; docId: string; originalsRoot?: string }): string {
  return path.join(documentDir(params), "manifest.json");
}

/** Durable terminal deletion intent, separate from blobs so retries never erase it.
 * Readers of a legacy root must also check the authoritative per-base root.
 */
function deletionMarkerPath(params: ReadKnowledgeOriginalParams): string {
  const key = createHash("sha256")
    .update(JSON.stringify([params.kbId, params.docId]))
    .digest("hex");
  return path.join(resolveKnowledgeOriginalsRoot(params.originalsRoot), ".deletions", key);
}

export function isKnowledgeOriginalDeleted(params: ReadKnowledgeOriginalParams): boolean {
  try {
    fs.statSync(deletionMarkerPath(params));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    // An unreadable deletion state must never reopen a retained original.
    throw error;
  }
}

export function markKnowledgeOriginalDeleted(params: ReadKnowledgeOriginalParams): void {
  const marker = deletionMarkerPath(params);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  try {
    fs.writeFileSync(marker, "deleted\n", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}

function readManifest(params: {
  kbId: string;
  docId: string;
  originalsRoot?: string;
}): KnowledgeOriginalManifest | null {
  if (isKnowledgeOriginalDeleted(params)) {
    return null;
  }
  const filePath = manifestPath(params);
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const docId = typeof record.docId === "string" ? record.docId.trim() : "";
    const kbId = typeof record.kbId === "string" ? record.kbId.trim() : "";
    const relativePath =
      typeof record.relativePath === "string" ? record.relativePath.replace(/\\/g, "/") : "";
    const mimeType = typeof record.mimeType === "string" ? record.mimeType.trim() : "";
    const fileName = typeof record.fileName === "string" ? record.fileName.trim() : "";
    const rawHash = typeof record.rawHash === "string" ? record.rawHash.trim() : "";
    const sizeBytes = typeof record.sizeBytes === "number" ? record.sizeBytes : Number.NaN;
    if (!docId || !kbId || !relativePath || !fileName || !Number.isFinite(sizeBytes)) {
      return null;
    }
    return {
      docId,
      kbId,
      relativePath,
      mimeType: mimeType || "application/octet-stream",
      fileName,
      rawHash,
      sizeBytes,
    };
  } catch {
    return null;
  }
}

function assertPathInsideRoot(rootPath: string, absolutePath: string): string {
  const rootReal = fs.realpathSync(rootPath);
  let targetReal: string;
  try {
    targetReal = fs.realpathSync(absolutePath);
  } catch {
    throw new Error("original file not found");
  }
  const relative = path.relative(rootReal, targetReal);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("original path escapes the originals root");
  }
  return targetReal;
}

/**
 * Write original bytes + per-document manifest. Oversized payloads are refused (fail-closed).
 * Returns null when skipped (empty / oversize); otherwise the written manifest.
 */
export function persistKnowledgeOriginal(
  params: PersistKnowledgeOriginalParams,
): KnowledgeOriginalManifest | null {
  const kbId = params.kbId.trim();
  const docId = params.docId.trim();
  if (!kbId || !docId) {
    return null;
  }
  if (!params.buffer.length) {
    return null;
  }
  if (params.buffer.length > MAX_KNOWLEDGE_ORIGINAL_BYTES) {
    return null;
  }

  if (isKnowledgeOriginalDeleted(params)) {
    throw new Error("knowledge_original_deleted: use a new document identity");
  }
  const safeName = sanitizeKnowledgeOriginalFileName(params.fileName);
  const dir = documentDir({ kbId, docId, originalsRoot: params.originalsRoot });
  fs.mkdirSync(dir, { recursive: true });

  // Replace any prior blob for this doc so re-uploads do not leave stale files.
  for (const entry of fs.readdirSync(dir)) {
    if (entry === "manifest.json") {
      continue;
    }
    fs.rmSync(path.join(dir, entry), { force: true });
  }

  const absolutePath = path.join(dir, safeName);
  fs.writeFileSync(absolutePath, params.buffer);

  // Another process may have started deletion while the blob was being written.
  if (isKnowledgeOriginalDeleted(params)) {
    deleteKnowledgeOriginal(params);
    throw new Error("knowledge_original_deleted: concurrent deletion");
  }
  const manifest: KnowledgeOriginalManifest = {
    docId,
    kbId,
    relativePath: `${sanitizeKey(kbId)}/${sanitizeKey(docId)}/${safeName}`,
    mimeType: params.mimeType.trim() || "application/octet-stream",
    fileName: safeName,
    rawHash: computeRawContentHash(params.buffer),
    sizeBytes: params.buffer.length,
  };
  fs.writeFileSync(
    manifestPath({ kbId, docId, originalsRoot: params.originalsRoot }),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return manifest;
}

export function readKnowledgeOriginalFileName(params: ReadKnowledgeOriginalParams): string | null {
  const fileName = readManifest(params)?.fileName?.trim();
  return fileName || null;
}

export function hasKnowledgeOriginal(params: ReadKnowledgeOriginalParams): boolean {
  const manifest = readManifest(params);
  if (!manifest) {
    return false;
  }
  const dir = documentDir(params);
  const absolutePath = path.join(dir, path.basename(manifest.fileName));
  return fs.existsSync(absolutePath);
}

export function readKnowledgeOriginal(
  params: ReadKnowledgeOriginalParams,
): ReadKnowledgeOriginalResult | null {
  const manifest = readManifest(params);
  if (!manifest) {
    return null;
  }
  const root = resolveKnowledgeOriginalsRoot(params.originalsRoot);
  const dir = documentDir(params);
  const candidate = path.join(dir, path.basename(manifest.fileName));
  if (!fs.existsSync(candidate)) {
    return null;
  }
  const absolutePath = assertPathInsideRoot(root, candidate);
  const buffer = fs.readFileSync(absolutePath);
  return { manifest, absolutePath, buffer };
}

export function deleteKnowledgeOriginal(params: ReadKnowledgeOriginalParams): void {
  const kbId = params.kbId.trim();
  const docId = params.docId.trim();
  if (!kbId || !docId) {
    return;
  }
  const dir = documentDir({ kbId, docId, originalsRoot: params.originalsRoot });
  fs.rmSync(dir, { recursive: true, force: true });

  // Drop empty kb folder when no other docs remain.
  const kbDir = path.dirname(dir);
  try {
    if (fs.existsSync(kbDir) && fs.readdirSync(kbDir).length === 0) {
      // Atomic empty-directory removal cannot race into deleting a new sibling.
      fs.rmdirSync(kbDir);
    }
  } catch {
    // best-effort cleanup
  }
}

/** Document ids in a knowledge base that still have a readable original blob. */
export function normalizeKnowledgeOriginalFileName(value: string): string {
  return path
    .basename(value)
    .normalize("NFKC")
    .replace(/[“”"']/g, "")
    .replace(/[^a-zA-Z0-9.\u4e00-\u9fff]+/g, "")
    .toLowerCase();
}

/** Find a retained original by human filename, preferring the current knowledge base. */
export function findKnowledgeOriginalByFileName(params: {
  fileName: string;
  preferKbId?: string;
  originalsRoot?: string;
}): ReadKnowledgeOriginalResult | null {
  const target = normalizeKnowledgeOriginalFileName(params.fileName);
  if (!target) {
    return null;
  }
  const root = resolveKnowledgeOriginalsRoot(params.originalsRoot);
  if (!fs.existsSync(root)) {
    return null;
  }
  const prefer = params.preferKbId?.trim() ? sanitizeKey(params.preferKbId) : "";
  const kbDirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());
  const ordered = prefer
    ? [
        ...kbDirs.filter((entry) => entry.name === prefer),
        ...kbDirs.filter((entry) => entry.name !== prefer),
      ]
    : kbDirs;
  for (const kbDir of ordered) {
    const kbPath = path.join(root, kbDir.name);
    for (const docDir of fs.readdirSync(kbPath, { withFileTypes: true })) {
      if (!docDir.isDirectory()) {
        continue;
      }
      const found = readKnowledgeOriginal({
        kbId: kbDir.name,
        docId: docDir.name,
        originalsRoot: params.originalsRoot,
      });
      if (found && normalizeKnowledgeOriginalFileName(found.manifest.fileName) === target) {
        return found;
      }
    }
  }
  return null;
}

export function listKnowledgeOriginalDocumentIds(params: {
  kbId: string;
  originalsRoot?: string;
}): Set<string> {
  const ids = new Set<string>();
  const kbId = params.kbId.trim();
  if (!kbId) {
    return ids;
  }
  const kbDir = path.join(resolveKnowledgeOriginalsRoot(params.originalsRoot), sanitizeKey(kbId));
  if (!fs.existsSync(kbDir)) {
    return ids;
  }
  for (const entry of fs.readdirSync(kbDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (hasKnowledgeOriginal({ kbId, docId: entry.name, originalsRoot: params.originalsRoot })) {
      // Prefer the manifest's real docId when present.
      const manifest = readManifest({
        kbId,
        docId: entry.name,
        originalsRoot: params.originalsRoot,
      });
      ids.add(manifest?.docId ?? entry.name);
    }
  }
  return ids;
}
