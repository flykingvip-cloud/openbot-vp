import type { AppPortState } from "../app-port-state.ts";
import type {
  LocalFolderSyncCandidate,
  LocalFolderSyncCommitDocument,
  LocalFolderSyncCommitFile,
  LocalFolderSyncCommitResponse,
  LocalFolderSyncPlanResponse,
} from "../capability/knowledge-universe/endpoints.ts";
import type { KnowledgeUniverseGateway } from "../capability/knowledge-universe/gateway-client.ts";
import { bytesToBase64, sha256Hex } from "../vault-sync/bytes.ts";
import { withBrowserOperationLock } from "./browser-operation-lock.ts";

const MAX_WALK_FILES = 2_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_DIRECTORY_DEPTH = 64;
const DIRECTORY_ID_DB = "openbot-knowledge-local-folder-identities";
const DIRECTORY_ID_STORE = "directories";
const DIRECTORY_ID_LOCK = "openbot:knowledge:local-folder:directory-identity";
const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
  ".csv",
  ".docx",
  ".markdown",
  ".md",
  ".pdf",
  ".pptx",
  ".txt",
  ".xlsx",
]);

export type ManagedPushDirectorySelection = {
  directory: FileSystemDirectoryHandle;
  directoryId: string;
};

type PersistedDirectoryIdentity = {
  directoryId: string;
  handle: FileSystemDirectoryHandle;
};

const directoriesByState = new WeakMap<AppPortState, ManagedPushDirectorySelection>();
const directoryIdsByHandle = new WeakMap<FileSystemDirectoryHandle, string>();
const sessionDirectoryIdentities: PersistedDirectoryIdentity[] = [];

type DirectoryPickerWindow = Window &
  typeof globalThis & {
    showDirectoryPicker: (options?: {
      mode?: "read" | "readwrite";
    }) => Promise<FileSystemDirectoryHandle>;
  };

type ManagedPushFile = {
  relativePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  mtimeMs: number;
  rawHash: string;
  file: File;
};

export type ManagedPushSkipReason =
  | "unreadable"
  | "empty"
  | "too_large"
  | "folder_too_large"
  | "changed"
  | "upload_failed"
  | "index_deferred";

export type ManagedPushSkippedFile = {
  relativePath: string;
  fileName: string;
  reason: ManagedPushSkipReason;
};

export type ManagedPushSyncSummary = {
  candidateCount: number;
  uploadedCount: number;
  deletedCount: number;
  commitCount: number;
  documents: LocalFolderSyncCommitDocument[];
  readyCount: number;
  allReady: boolean;
  skipped: ManagedPushSkippedFile[];
};

const RETAINED_SKIP_REASONS = new Set<ManagedPushSkipReason>([
  "unreadable",
  "too_large",
  "folder_too_large",
  "changed",
  "upload_failed",
  "index_deferred",
]);

export function isLocalFolderVecUnavailableMessage(text: string): boolean {
  return /no such module:\s*vec0/i.test(text);
}

function newDirectoryId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `directory:${globalThis.crypto.randomUUID()}`;
  }
  const random = Math.random().toString(36).slice(2);
  return `directory:${Date.now().toString(36)}-${random}`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB request failed")),
      { once: true },
    );
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("IndexedDB transaction failed")),
      { once: true },
    );
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
      { once: true },
    );
  });
}

async function openDirectoryIdentityDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return null;
  }
  const request = indexedDB.open(DIRECTORY_ID_DB, 1);
  request.addEventListener(
    "upgradeneeded",
    () => {
      if (!request.result.objectStoreNames.contains(DIRECTORY_ID_STORE)) {
        request.result.createObjectStore(DIRECTORY_ID_STORE, { keyPath: "directoryId" });
      }
    },
    { once: true },
  );
  return requestResult(request);
}

function rememberSessionDirectoryIdentity(
  directory: FileSystemDirectoryHandle,
  directoryId: string,
): void {
  directoryIdsByHandle.set(directory, directoryId);
  const existing = sessionDirectoryIdentities.find((record) => record.handle === directory);
  if (existing) {
    existing.directoryId = directoryId;
    return;
  }
  sessionDirectoryIdentities.push({ directoryId, handle: directory });
}

async function findSessionDirectoryId(
  directory: FileSystemDirectoryHandle,
): Promise<string | undefined> {
  const direct = directoryIdsByHandle.get(directory);
  if (direct) {
    return direct;
  }
  for (const record of sessionDirectoryIdentities) {
    if (record.handle === directory) {
      return record.directoryId;
    }
    try {
      if (
        typeof directory.isSameEntry === "function" &&
        (await directory.isSameEntry(record.handle))
      ) {
        rememberSessionDirectoryIdentity(directory, record.directoryId);
        return record.directoryId;
      }
    } catch {
      // Revoked handles are ignored; IndexedDB or a fresh identity can recover below.
    }
  }
  return undefined;
}

async function resolvePersistentDirectoryId(directory: FileSystemDirectoryHandle): Promise<string> {
  return withBrowserOperationLock(DIRECTORY_ID_LOCK, async () => {
    const sessionId = await findSessionDirectoryId(directory);
    if (sessionId) {
      return sessionId;
    }

    let database: IDBDatabase | null = null;
    try {
      database = await openDirectoryIdentityDatabase();
      if (database) {
        const read = database.transaction(DIRECTORY_ID_STORE, "readonly");
        const records = (await requestResult(
          read.objectStore(DIRECTORY_ID_STORE).getAll(),
        )) as PersistedDirectoryIdentity[];
        await transactionComplete(read);
        for (const record of records) {
          try {
            if (await directory.isSameEntry(record.handle)) {
              rememberSessionDirectoryIdentity(directory, record.directoryId);
              return record.directoryId;
            }
          } catch {
            // A stale or revoked handle is ignored; a fresh identity is stored below.
          }
        }

        const directoryId = newDirectoryId();
        const write = database.transaction(DIRECTORY_ID_STORE, "readwrite");
        write.objectStore(DIRECTORY_ID_STORE).put({ directoryId, handle: directory });
        await transactionComplete(write);
        rememberSessionDirectoryIdentity(directory, directoryId);
        return directoryId;
      }
    } catch {
      // IndexedDB/structured-clone support varies by browser. Session identity remains safe.
    } finally {
      database?.close();
    }

    const directoryId = newDirectoryId();
    rememberSessionDirectoryIdentity(directory, directoryId);
    return directoryId;
  });
}

function validateRelativePath(relativePath: string): string {
  if (
    !relativePath ||
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    /^[A-Za-z]:/.test(relativePath)
  ) {
    throw new Error(`Unsafe local-folder path: ${relativePath || "<empty>"}`);
  }
  const segments = relativePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Unsafe local-folder path: ${relativePath}`);
  }
  return relativePath;
}

function assertUniquePaths(paths: string[], label: string): void {
  const seen = new Set<string>();
  for (const path of paths) {
    validateRelativePath(path);
    if (seen.has(path)) {
      throw new Error(`Duplicate ${label} path: ${path}`);
    }
    seen.add(path);
  }
}

export function getManagedPushDirectorySelection(
  state: AppPortState,
): ManagedPushDirectorySelection | null {
  return directoriesByState.get(state) ?? null;
}

export function getManagedPushDirectory(state: AppPortState): FileSystemDirectoryHandle | null {
  return getManagedPushDirectorySelection(state)?.directory ?? null;
}

export function getManagedPushDirectoryId(state: AppPortState): string | null {
  return getManagedPushDirectorySelection(state)?.directoryId ?? null;
}

export function rememberManagedPushDirectory(
  state: AppPortState,
  directory: FileSystemDirectoryHandle,
  explicitDirectoryId?: string,
): string {
  const directoryId =
    explicitDirectoryId?.trim() || directoryIdsByHandle.get(directory) || newDirectoryId();
  rememberSessionDirectoryIdentity(directory, directoryId);
  directoriesByState.set(state, { directory, directoryId });
  return directoryId;
}

export function clearManagedPushDirectory(state: AppPortState): void {
  directoriesByState.delete(state);
}

export function resolveManagedPushFolderDisplayPath(directory: FileSystemDirectoryHandle): string {
  const candidate = directory as FileSystemDirectoryHandle & { path?: unknown };
  if (typeof candidate.path === "string" && candidate.path.trim()) {
    return candidate.path.trim();
  }
  return directory.name.trim() || "folder";
}

export async function pickManagedPushDirectory(
  state: AppPortState,
): Promise<FileSystemDirectoryHandle> {
  if (typeof window === "undefined" || !("showDirectoryPicker" in window)) {
    throw new Error(
      "This client cannot read local folder contents. Use a supported Chromium browser.",
    );
  }
  const directory = await (window as DirectoryPickerWindow).showDirectoryPicker({ mode: "read" });
  const directoryId = await resolvePersistentDirectoryId(directory);
  rememberManagedPushDirectory(state, directory, directoryId);
  return directory;
}

export type ManagedPushProgress = {
  phase: "scan" | "upload" | "index" | "finalize";
  current: number;
  total: number;
  fileName?: string;
  readyCount?: number;
  scanStage?: "listing" | "hashing";
};

export class ManagedPushReadError extends Error {
  readonly code: "permission-denied" | "file-unreadable";
  readonly relativePath?: string;

  constructor(code: "permission-denied" | "file-unreadable", relativePath?: string) {
    super(code);
    this.name = "ManagedPushReadError";
    this.code = code;
    this.relativePath = relativePath;
  }
}

type PermissionCapableHandle = {
  queryPermission?: (options: { mode: "read" }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: "read" }) => Promise<PermissionState>;
};

export async function ensureManagedPushDirectoryReadable(
  directory: FileSystemDirectoryHandle,
): Promise<boolean> {
  const handle = directory as FileSystemDirectoryHandle & PermissionCapableHandle;
  try {
    if (typeof handle.queryPermission === "function") {
      const status = await handle.queryPermission({ mode: "read" });
      if (status === "granted") {
        return true;
      }
    }
    if (typeof handle.requestPermission === "function") {
      return (await handle.requestPermission({ mode: "read" })) === "granted";
    }
    return true;
  } catch {
    return false;
  }
}

function fileExtension(fileName: string): string {
  const lowerName = fileName.toLowerCase();
  const extensionIndex = lowerName.lastIndexOf(".");
  return extensionIndex > 0 ? lowerName.slice(extensionIndex) : "";
}

function shouldInspectManagedPushFile(fileName: string): boolean {
  return SUPPORTED_DOCUMENT_EXTENSIONS.has(fileExtension(fileName));
}

function isSupportedManagedPushDocument(fileName: string, _mimeType: string): boolean {
  return shouldInspectManagedPushFile(fileName);
}

function flattenManagedPushBasename(relativePath: string): string {
  const parts = relativePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || relativePath;
}

function uniquifyManagedPushBasename(fileName: string, used: Set<string>): string {
  if (!used.has(fileName)) {
    return fileName;
  }
  const extension = fileExtension(fileName);
  const stem =
    extension && fileName.toLowerCase().endsWith(extension)
      ? fileName.slice(0, -extension.length)
      : fileName;
  let n = 2;
  let next = `${stem}-${n}${extension}`;
  while (used.has(next)) {
    n += 1;
    next = `${stem}-${n}${extension}`;
  }
  return next;
}

function flattenManagedPushFiles(files: ManagedPushFile[]): ManagedPushFile[] {
  const used = new Set<string>();
  return files.map((file) => {
    const unique = uniquifyManagedPushBasename(
      flattenManagedPushBasename(file.fileName || file.relativePath),
      used,
    );
    used.add(unique);
    return { ...file, relativePath: unique, fileName: unique };
  });
}

export function isBrowserFileUnreadable(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = "name" in error ? String(error.name) : "";
  const message = error instanceof Error ? error.message : "";
  return (
    name === "NotReadableError" ||
    name === "NotAllowedError" ||
    message.includes("could not be read") ||
    message.includes("after a reference to a file was acquired")
  );
}

function skipEntry(
  entry: { relativePath: string; fileName: string },
  reason: ManagedPushSkipReason,
): ManagedPushSkippedFile {
  return { relativePath: entry.relativePath, fileName: entry.fileName, reason };
}

async function collectManagedPushFiles(
  root: FileSystemDirectoryHandle,
  onProgress?: (progress: ManagedPushProgress) => void,
): Promise<{ files: ManagedPushFile[]; skipped: ManagedPushSkippedFile[] }> {
  const excludedDirectoryNames = new Set([".git", "node_modules", "dist"]);
  const excludedFileNames = new Set([".DS_Store"]);
  const discovered: Array<{
    relativePath: string;
    fileName: string;
    handle: FileSystemFileHandle;
  }> = [];
  const seen = new Set<string>();

  async function visit(directory: FileSystemDirectoryHandle, prefix: string, depth: number) {
    if (depth > MAX_DIRECTORY_DEPTH) {
      throw new Error(`Folder nesting exceeds ${MAX_DIRECTORY_DEPTH} levels.`);
    }
    for await (const entry of directory.values()) {
      // Match the gateway's default exclusions before recursion or byte reads.
      if (entry.kind === "directory" && excludedDirectoryNames.has(entry.name)) {
        continue;
      }
      if (entry.kind === "file" && excludedFileNames.has(entry.name)) {
        continue;
      }
      if (entry.kind === "file" && !shouldInspectManagedPushFile(entry.name)) {
        continue;
      }
      const relativePath = validateRelativePath(prefix ? `${prefix}/${entry.name}` : entry.name);
      if (entry.kind === "directory") {
        await visit(entry, relativePath, depth + 1);
        continue;
      }
      if (entry.kind !== "file") {
        throw new Error(`Unsupported folder entry: ${relativePath}`);
      }
      if (seen.has(relativePath)) {
        throw new Error(`Duplicate local-folder path: ${relativePath}`);
      }
      if (discovered.length >= MAX_WALK_FILES) {
        throw new Error(`Folder contains more than ${MAX_WALK_FILES} files.`);
      }
      seen.add(relativePath);
      discovered.push({ relativePath, fileName: entry.name, handle: entry });
      onProgress?.({
        phase: "scan",
        current: discovered.length,
        total: 0,
        fileName: entry.name,
        scanStage: "listing",
      });
    }
  }

  // Enumerate the entire tree before reading any bytes. An oversized/truncated inventory fails
  // without producing a partial candidate list that could later imply server-side deletions.
  await visit(root, "", 0);

  const files: ManagedPushFile[] = [];
  const skipped: ManagedPushSkippedFile[] = [];
  let totalBytes = 0;
  let hashed = 0;
  for (const entry of discovered) {
    hashed += 1;
    onProgress?.({
      phase: "scan",
      current: hashed,
      total: discovered.length,
      fileName: entry.fileName,
      scanStage: "hashing",
    });
    let file: File;
    try {
      file = await entry.handle.getFile();
    } catch (error) {
      if (isBrowserFileUnreadable(error)) {
        skipped.push(skipEntry(entry, "unreadable"));
        continue;
      }
      throw error;
    }
    // Keep the inventory aligned with the gateway extractor. Unsupported files must not become
    // required uploads that can never complete (images, legacy Office files, JSON, archives, etc.).
    if (!isSupportedManagedPushDocument(entry.fileName, file.type)) {
      continue;
    }
    // The current gateway cannot ingest zero-byte documents. Omitting them keeps one empty file
    // from aborting an otherwise valid folder import; a previously non-empty file is then deleted.
    if (file.size === 0) {
      skipped.push(skipEntry(entry, "empty"));
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      skipped.push(skipEntry(entry, "too_large"));
      continue;
    }
    if (totalBytes + file.size > MAX_TOTAL_BYTES) {
      skipped.push(skipEntry(entry, "folder_too_large"));
      for (const rest of discovered.slice(hashed)) {
        skipped.push(skipEntry(rest, "folder_too_large"));
      }
      break;
    }
    totalBytes += file.size;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      if (isBrowserFileUnreadable(error)) {
        skipped.push(skipEntry(entry, "unreadable"));
        continue;
      }
      throw error;
    }
    if (bytes.byteLength !== file.size) {
      skipped.push(skipEntry(entry, "changed"));
      continue;
    }
    files.push({
      relativePath: entry.relativePath,
      fileName: entry.fileName,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      mtimeMs: file.lastModified,
      rawHash: await sha256Hex(bytes),
      file,
    });
  }
  return { files: flattenManagedPushFiles(files), skipped };
}

async function toCommitFile(file: ManagedPushFile): Promise<LocalFolderSyncCommitFile> {
  const bytes = new Uint8Array(await file.file.arrayBuffer());
  if (bytes.byteLength !== file.sizeBytes || (await sha256Hex(bytes)) !== file.rawHash) {
    throw new Error(`File changed after sync planning: ${file.relativePath}`);
  }
  return {
    relativePath: file.relativePath,
    fileName: file.fileName,
    mimeType: file.mimeType,
    contentBase64: bytesToBase64(bytes),
    rawHash: file.rawHash,
  };
}

function assertCommitSucceeded(response: LocalFolderSyncCommitResponse): void {
  if (response.errors.length > 0) {
    throw new Error(response.errors.join("; "));
  }
}

function commitDocumentStored(document: LocalFolderSyncCommitDocument): boolean {
  return document.originalStored || document.chunkCount > 0;
}

function classifyUploadCommit(params: {
  source: ManagedPushFile;
  response: LocalFolderSyncCommitResponse;
  documents: LocalFolderSyncCommitDocument[];
  skipped: ManagedPushSkippedFile[];
}): boolean {
  for (const document of params.response.documents ?? []) {
    params.documents.push(document);
  }
  const stored = (params.response.documents ?? []).some(commitDocumentStored);
  if (params.response.errors.length === 0) {
    return true;
  }
  const indexDeferred = params.response.errors.every((message) =>
    isLocalFolderVecUnavailableMessage(message),
  );
  if (stored || indexDeferred) {
    if (indexDeferred) {
      params.skipped.push(skipEntry(params.source, "index_deferred"));
    }
    return true;
  }
  params.skipped.push(skipEntry(params.source, "upload_failed"));
  return false;
}

function assertPlanLease(
  plan: LocalFolderSyncPlanResponse,
  bindingId: string,
  deviceId: string,
): void {
  if (plan.bindingId !== bindingId) {
    throw new Error("Managed folder sync plan returned a different binding.");
  }
  if (plan.deviceId !== deviceId) {
    throw new Error("Managed folder sync plan returned a different device identity.");
  }
  if (
    !plan.planId.trim() ||
    !Number.isSafeInteger(plan.generation) ||
    plan.generation < 1 ||
    !Number.isFinite(plan.expiresAtMs)
  ) {
    throw new Error("Managed folder sync plan returned an invalid lease.");
  }
}

export async function syncManagedPushDirectory(params: {
  gateway: KnowledgeUniverseGateway;
  bindingId: string;
  deviceId: string;
  directory: FileSystemDirectoryHandle;
  onProgress?: (progress: ManagedPushProgress) => void;
}): Promise<ManagedPushSyncSummary> {
  const planSync = params.gateway.localFolderSyncPlan;
  const commitSync = params.gateway.localFolderSyncCommit;
  if (!planSync || !commitSync) {
    throw new Error("This gateway does not support managed folder uploads.");
  }

  // Finish the complete inventory before planning. Any read/truncation failure therefore
  // happens before the server can infer deletions from an incomplete device snapshot.
  params.onProgress?.({ phase: "scan", current: 0, total: 0, scanStage: "listing" });
  const collected = await collectManagedPushFiles(params.directory, params.onProgress);
  const files = collected.files;
  const skipped = [...collected.skipped];
  const filesByPath = new Map(files.map((file) => [file.relativePath, file]));
  const candidates: LocalFolderSyncCandidate[] = files.map((file) => ({
    relativePath: file.relativePath,
    rawHash: file.rawHash,
    sizeBytes: file.sizeBytes,
    mtimeMs: file.mtimeMs,
  }));
  const retainRelativePaths = skipped
    .filter((item) => RETAINED_SKIP_REASONS.has(item.reason))
    .map((item) => item.relativePath);
  const plan: LocalFolderSyncPlanResponse = await planSync({
    bindingId: params.bindingId,
    deviceId: params.deviceId,
    candidates,
    retainRelativePaths,
  });
  assertPlanLease(plan, params.bindingId, params.deviceId);

  const uploadPaths = plan.needUpload.map((item) => item.relativePath);
  assertUniquePaths(uploadPaths, "upload");
  assertUniquePaths(plan.missingOnDevice, "delete");
  for (const path of uploadPaths) {
    if (!filesByPath.has(path)) {
      throw new Error(`Sync plan requested a file outside the device inventory: ${path}`);
    }
  }
  for (const path of plan.missingOnDevice) {
    if (filesByPath.has(path)) {
      throw new Error(`Sync plan tried to delete a present device file: ${path}`);
    }
  }

  let batch: LocalFolderSyncCommitFile[] = [];
  let commitCount = 0;
  const documents: LocalFolderSyncCommitDocument[] = [];
  const flushUploads = async (source: ManagedPushFile): Promise<boolean> => {
    if (batch.length === 0) {
      return true;
    }
    const response = await commitSync({
      bindingId: params.bindingId,
      deviceId: params.deviceId,
      planId: plan.planId,
      generation: plan.generation,
      phase: "upload",
      files: batch,
    });
    commitCount += 1;
    const accepted = classifyUploadCommit({ source, response, documents, skipped });
    if (documents.length > 0) {
      const readyCount = documents.filter((item) => item.ready).length;
      params.onProgress?.({
        phase: "index",
        current: readyCount,
        total: documents.length,
        readyCount,
      });
    }
    batch = [];
    return accepted;
  };

  let uploaded = 0;
  let plannedUploadFailed = false;
  for (const path of uploadPaths) {
    const source = filesByPath.get(path)!;
    params.onProgress?.({
      phase: "upload",
      current: uploaded + 1,
      total: uploadPaths.length,
      fileName: source.fileName,
    });
    try {
      batch.push(await toCommitFile(source));
      // One file per commit so the import page can show per-file progress
      // while the gateway embeds (DashScope pages of 10).
      const accepted = await flushUploads(source);
      if (accepted) {
        uploaded += 1;
      } else {
        plannedUploadFailed = true;
      }
    } catch (error) {
      plannedUploadFailed = true;
      const message = error instanceof Error ? error.message : String(error);
      skipped.push(
        skipEntry(
          source,
          isBrowserFileUnreadable(error)
            ? "unreadable"
            : isLocalFolderVecUnavailableMessage(message)
              ? "index_deferred"
              : "upload_failed",
        ),
      );
      batch = [];
    }
  }

  if (!plannedUploadFailed) {
    params.onProgress?.({
      phase: "finalize",
      current: uploadPaths.length,
      total: Math.max(uploadPaths.length, 1),
    });
    // Finalize only after every requested upload succeeded. The server owns the deletion set.
    const finalResponse = await commitSync({
      bindingId: params.bindingId,
      deviceId: params.deviceId,
      planId: plan.planId,
      generation: plan.generation,
      phase: "finalize",
      files: [],
    });
    assertCommitSucceeded(finalResponse);
    commitCount += 1;
  }
  const readyCount = documents.filter((item) => item.ready).length;

  return {
    candidateCount: files.length,
    uploadedCount: uploaded,
    deletedCount: plannedUploadFailed ? 0 : plan.missingOnDevice.length,
    commitCount,
    documents,
    readyCount,
    allReady: documents.every((item) => item.ready),
    skipped,
  };
}
