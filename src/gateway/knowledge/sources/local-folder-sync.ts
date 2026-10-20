/**
 * P3 managed_push sync: client submits inventory + missing file bytes;
 * cloud plans hash deltas and ingests. Absolute paths never leave the device.
 */
import path from "node:path";
import type { OpenBotConfig } from "../../../config/config.js";
import type { EmbeddingProvider } from "../../../memory/embeddings.js";
import type { GovernanceOwnershipProof } from "../../data-governance/write-gate.js";
import type { GatewayClient } from "../../server-methods/types.js";
import { firstHumanDocumentTitle } from "../document-display-title.js";
import { computeRawContentHash } from "../document-fingerprint.js";
import {
  isKnowledgeDocumentIngestReady,
  readKnowledgeDocumentIngestReady,
} from "../document-ingest-ready.js";
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
import { hasKnowledgeOriginal } from "../knowledge-original-store.js";
import { ingestKnowledgePayloadToBase } from "../personal-knowledge-ingest.js";
import {
  getLocalFolderBinding,
  updateLocalFolderBindingStatus,
} from "./local-folder-binding-store.js";
import { flattenManagedPushInventory } from "./local-folder-import-flatten.js";
import { buildLocalFolderDocId } from "./local-folder-runtime.js";
import {
  consumeLocalFolderSyncPlan,
  createLocalFolderSyncPlanLease,
  loadLocalFolderSyncPlan,
  recordLocalFolderSyncPlanUploads,
  type LocalFolderSyncPlanRecord,
} from "./local-folder-sync-plan-store.js";
import type {
  LocalFolderBinding,
  LocalFolderSyncCandidate,
  LocalFolderSyncCommitFile,
  LocalFolderSyncCommitPhase,
  LocalFolderSyncCommitResponse,
  LocalFolderSyncPlanResponse,
  ManagedLocalFolderSyncPlanResponse,
} from "./local-folder-types.js";
import {
  listSourceDocumentLinks,
  upsertSourceDocumentLink,
  updateSourceDocumentLinkState,
} from "./source-document-link-store.js";

const MIME_BY_EXT: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const bindingOperationTails = new Map<string, Promise<void>>();

export async function withLocalFolderBindingOperationLock<T>(
  bindingId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = bindingOperationTails.get(bindingId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  bindingOperationTails.set(bindingId, current);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (bindingOperationTails.get(bindingId) === current) {
      bindingOperationTails.delete(bindingId);
    }
  }
}

export function validateLocalFolderRelativePath(relativePath: string): string {
  if (
    !relativePath ||
    relativePath.includes("\0") ||
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    /^[A-Za-z]:/.test(relativePath)
  ) {
    throw new Error(`unsafe local-folder relativePath: ${relativePath || "<empty>"}`);
  }
  const segments = relativePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`unsafe local-folder relativePath: ${relativePath}`);
  }
  return relativePath;
}

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

function mimeForFile(fileName: string): string {
  return MIME_BY_EXT[extensionOf(fileName)] ?? "application/octet-stream";
}

function fileNameFromRelative(relativePath: string, explicit?: string): string {
  if (explicit?.trim()) {
    return explicit.trim();
  }
  const base = path.posix.basename(relativePath);
  return base || "file";
}

function decodeCommitFile(file: LocalFolderSyncCommitFile): Buffer | null {
  if (typeof file.contentBase64 === "string" && file.contentBase64.trim()) {
    try {
      return Buffer.from(file.contentBase64.trim(), "base64");
    } catch {
      return null;
    }
  }
  if (typeof file.textContent === "string") {
    return Buffer.from(file.textContent, "utf8");
  }
  return null;
}

function normalizeConnectorRelativePath(relativePath: string): string {
  if (
    !relativePath ||
    relativePath.includes("\0") ||
    relativePath.startsWith("/") ||
    relativePath.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(relativePath)
  ) {
    throw new Error(`unsafe local-folder relativePath: ${relativePath || "<empty>"}`);
  }
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  return validateLocalFolderRelativePath(normalized);
}

function normalizeCandidateHash(rawHash: string | undefined): string | undefined {
  return rawHash?.trim().toLowerCase() || undefined;
}

function validateSha256Hash(rawHash: string | undefined): string | undefined {
  const normalized = normalizeCandidateHash(rawHash);
  if (normalized && !/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error("local-folder rawHash must be a sha256 hex digest");
  }
  return normalized;
}

export function planLocalFolderSync(params: {
  binding: LocalFolderBinding;
  candidates: LocalFolderSyncCandidate[];
  retainRelativePaths?: string[];
  linkStorePath?: string;
  originalsRoot?: string;
}): LocalFolderSyncPlanResponse {
  const sourceDescriptorId = params.binding.sourceDescriptorId;
  const activeLinks = listSourceDocumentLinks(
    { sourceDescriptorId, state: "active" },
    params.linkStorePath,
  );
  const linkByRel = new Map(
    activeLinks.map((link) => {
      const relativePath = normalizeConnectorRelativePath(link.relativePath);
      return [relativePath, link] as const;
    }),
  );

  const needUpload: LocalFolderSyncPlanResponse["needUpload"] = [];
  const unchanged: string[] = [];
  const seen = new Set<string>();

  for (const candidate of params.candidates) {
    const relativePath = normalizeConnectorRelativePath(candidate.relativePath);
    // Generic connector inventories historically ignored duplicate aliases. Managed sync performs
    // strict duplicate validation before calling this compatibility planner.
    if (seen.has(relativePath)) {
      continue;
    }
    seen.add(relativePath);
    // Skill/object UUID files from an uploaded OpenBot folder are not knowledge documents.
    if (firstHumanDocumentTitle(relativePath) == null) {
      continue;
    }
    const docId = buildLocalFolderDocId(sourceDescriptorId, relativePath);
    const existing = linkByRel.get(relativePath);
    if (!existing) {
      needUpload.push({ relativePath, reason: "missing", docId });
      continue;
    }
    const clientHash = normalizeCandidateHash(candidate.rawHash);
    if (!clientHash) {
      // Without a hash we cannot prove unchanged; ask client to upload.
      needUpload.push({ relativePath, reason: "no_hash", docId });
      continue;
    }
    const serverHash = existing.rawHash?.trim().toLowerCase();
    if (serverHash && serverHash === clientHash) {
      const originalReady = hasKnowledgeOriginal({
        kbId: params.binding.knowledgeBaseId,
        docId: existing.docId || docId,
        originalsRoot: params.originalsRoot,
      });
      if (originalReady) {
        unchanged.push(relativePath);
        continue;
      }
      needUpload.push({ relativePath, reason: "missing", docId: existing.docId || docId });
      continue;
    }
    needUpload.push({
      relativePath,
      reason: serverHash ? "hash_mismatch" : "missing",
      docId,
    });
  }

  for (const raw of params.retainRelativePaths ?? []) {
    const relativePath = normalizeConnectorRelativePath(validateLocalFolderRelativePath(raw));
    if (seen.has(relativePath)) {
      throw new Error(`retain path already in candidates: ${relativePath}`);
    }
    seen.add(relativePath);
  }

  const missingOnDevice: string[] = [];
  for (const link of activeLinks) {
    const relativePath = normalizeConnectorRelativePath(link.relativePath);
    if (!seen.has(relativePath)) {
      missingOnDevice.push(relativePath);
    }
  }

  return {
    bindingId: params.binding.bindingId,
    sourceDescriptorId,
    needUpload,
    unchanged,
    missingOnDevice,
  };
}

function assertManagedBindingDevice(binding: LocalFolderBinding, deviceId: string): number {
  if (binding.mode !== "managed_push") {
    throw new Error("managed local-folder sync requires a managed_push binding");
  }
  if (!binding.directoryId?.trim()) {
    throw new Error("legacy managed_push binding has no directoryId; rebind the directory");
  }
  if (!deviceId.trim() || binding.deviceId !== deviceId.trim()) {
    throw new Error("managed local-folder deviceId mismatch");
  }
  const revision = binding.revision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("legacy managed_push binding has no valid revision; rebind the directory");
  }
  return revision;
}

function requireCurrentManagedBinding(params: {
  expectedBinding: LocalFolderBinding;
  deviceId: string;
  bindingStorePath?: string;
}): { binding: LocalFolderBinding; revision: number } {
  const current = getLocalFolderBinding(params.expectedBinding.bindingId, params.bindingStorePath);
  if (!current) {
    throw new Error("managed local-folder binding no longer exists");
  }
  const revision = assertManagedBindingDevice(current, params.deviceId);
  if (
    current.sourceDescriptorId !== params.expectedBinding.sourceDescriptorId ||
    current.knowledgeBaseId !== params.expectedBinding.knowledgeBaseId ||
    current.revision !== params.expectedBinding.revision
  ) {
    throw new Error("managed local-folder binding changed; create a new plan");
  }
  return { binding: current, revision };
}

function validateManagedSyncCandidates(
  candidates: LocalFolderSyncCandidate[],
): LocalFolderSyncCandidate[] {
  const seen = new Set<string>();
  const validated = candidates.map((candidate) => {
    const relativePath = validateLocalFolderRelativePath(candidate.relativePath);
    if (seen.has(relativePath)) {
      throw new Error(`duplicate local-folder candidate: ${relativePath}`);
    }
    seen.add(relativePath);
    const rawHash = validateSha256Hash(candidate.rawHash);
    return {
      relativePath,
      ...(rawHash ? { rawHash } : {}),
      ...(candidate.sizeBytes !== undefined ? { sizeBytes: candidate.sizeBytes } : {}),
      ...(candidate.mtimeMs !== undefined ? { mtimeMs: candidate.mtimeMs } : {}),
    };
  });
  return flattenManagedPushInventory(validated);
}

export async function createManagedLocalFolderSyncPlan(params: {
  binding: LocalFolderBinding;
  deviceId: string;
  candidates: LocalFolderSyncCandidate[];
  retainRelativePaths?: string[];
  bindingStorePath?: string;
  linkStorePath?: string;
  planStorePath?: string;
  originalsRoot?: string;
  nowMs?: number;
  ttlMs?: number;
}): Promise<ManagedLocalFolderSyncPlanResponse> {
  return withLocalFolderBindingOperationLock(params.binding.bindingId, async () => {
    const { binding, revision } = requireCurrentManagedBinding({
      expectedBinding: params.binding,
      deviceId: params.deviceId,
      bindingStorePath: params.bindingStorePath,
    });
    const candidates = validateManagedSyncCandidates(params.candidates);
    const retainRelativePaths = flattenManagedPushInventory(
      (params.retainRelativePaths ?? []).map((relativePath) => ({ relativePath })),
    ).map((item) => item.relativePath);
    const plan = planLocalFolderSync({
      binding,
      candidates,
      ...(retainRelativePaths.length > 0 ? { retainRelativePaths } : {}),
      linkStorePath: params.linkStorePath,
      originalsRoot: params.originalsRoot,
    });
    const candidatesByPath = new Map(
      candidates.map((candidate) => [candidate.relativePath, candidate.rawHash] as const),
    );
    const lease = createLocalFolderSyncPlanLease(
      {
        plan,
        deviceId: params.deviceId.trim(),
        bindingRevision: revision,
        expectedUploads: plan.needUpload.map(({ relativePath }) => ({
          relativePath,
          ...(candidatesByPath.get(relativePath)
            ? { rawHash: candidatesByPath.get(relativePath) }
            : {}),
        })),
        nowMs: params.nowMs,
        ttlMs: params.ttlMs,
      },
      params.planStorePath,
    );
    return {
      ...plan,
      planId: lease.planId,
      generation: lease.generation,
      deviceId: lease.deviceId,
      expiresAtMs: lease.expiresAtMs,
    };
  });
}

function requireCurrentManagedPlan(params: {
  bindingId: string;
  bindingRevision: number;
  planId: string;
  generation: number;
  deviceId: string;
  nowMs: number;
  planStorePath?: string;
}): LocalFolderSyncPlanRecord {
  const current = loadLocalFolderSyncPlan(params.bindingId, params.planStorePath);
  if (!current) {
    throw new Error("managed sync plan not found; create a new plan");
  }
  if (current.planId !== params.planId || current.generation !== params.generation) {
    throw new Error("managed sync plan is stale or superseded");
  }
  if (current.deviceId !== params.deviceId) {
    throw new Error("managed sync plan deviceId mismatch");
  }
  if (current.invalidatedAtMs !== undefined) {
    throw new Error("managed sync plan was invalidated by a binding lifecycle change");
  }
  if (current.state === "consumed") {
    throw new Error("managed sync plan was already consumed");
  }
  if (current.bindingRevision !== params.bindingRevision) {
    throw new Error("managed sync plan binding revision is stale");
  }
  if (params.nowMs >= current.expiresAtMs) {
    throw new Error("managed sync plan expired");
  }
  return current;
}

async function purgeIndexedDocument(params: {
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
    // best-effort
  }
  try {
    const { deleteExplicitDocumentMetadata } = await import("../explicit-metadata-store.js");
    deleteExplicitDocumentMetadata(params.docId);
  } catch {
    // best-effort
  }
  try {
    const { deleteKnowledgeOriginal } = await import("../knowledge-original-store.js");
    deleteKnowledgeOriginal({ kbId: params.knowledgeBase.id, docId: params.docId });
  } catch {
    // best-effort
  }
}

type PreparedCommitFile = {
  relativePath: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  rawHash: string;
};

function prepareCommitFile(
  file: LocalFolderSyncCommitFile,
  pathMode: "connector" | "managed",
): PreparedCommitFile {
  const relativePath =
    pathMode === "managed"
      ? validateLocalFolderRelativePath(file.relativePath)
      : normalizeConnectorRelativePath(file.relativePath);
  const buffer = decodeCommitFile(file);
  if (!buffer || buffer.length === 0) {
    throw new Error(`${relativePath}: empty or invalid content`);
  }
  const computedHash = computeRawContentHash(buffer).toLowerCase();
  const suppliedHash =
    pathMode === "managed"
      ? validateSha256Hash(file.rawHash)
      : normalizeCandidateHash(file.rawHash);
  if (pathMode === "managed" && suppliedHash && suppliedHash !== computedHash) {
    throw new Error(`${relativePath}: rawHash does not match uploaded content`);
  }
  const fileName = fileNameFromRelative(relativePath, file.fileName);
  return {
    relativePath,
    fileName,
    mimeType: file.mimeType?.trim() || mimeForFile(fileName),
    buffer,
    // Passive connectors may use opaque ETags; managed uploads always persist verified sha256.
    rawHash: pathMode === "managed" ? computedHash : (suppliedHash ?? computedHash),
  };
}

function prepareManagedCommitFiles(files: LocalFolderSyncCommitFile[]): PreparedCommitFile[] {
  const seen = new Set<string>();
  return files.map((file) => {
    const prepared = prepareCommitFile(file, "managed");
    if (seen.has(prepared.relativePath)) {
      throw new Error(`duplicate local-folder commit file: ${prepared.relativePath}`);
    }
    seen.add(prepared.relativePath);
    return prepared;
  });
}

/**
 * Generic ingest/delete primitive shared by passive connectors. Callers must provide an explicit
 * deletion set; managed_push RPCs must go through commitManagedLocalFolderSync instead.
 */
export async function commitLocalFolderSync(params: {
  binding: LocalFolderBinding;
  knowledgeBase: KnowledgeBase;
  ownerId: string;
  files: LocalFolderSyncCommitFile[];
  deletedRelativePaths?: string[];
  applyDeletes?: boolean;
  indexRoot?: string;
  originalsRoot?: string;
  kbStorePath?: string;
  bindingStorePath?: string;
  linkStorePath?: string;
  cfg?: OpenBotConfig;
  client?: GatewayClient | null;
  embeddingProvider?: EmbeddingProvider | null;
  /** Trusted proof from authenticated call entry — required for tenant-scoped KBs. */
  governanceOwnershipProof?: GovernanceOwnershipProof;
}): Promise<LocalFolderSyncCommitResponse> {
  const binding = params.binding;
  const sourceDescriptorId = binding.sourceDescriptorId;
  const result: LocalFolderSyncCommitResponse = {
    bindingId: binding.bindingId,
    sourceDescriptorId,
    ingested: 0,
    skipped: 0,
    tombstoned: 0,
    snapshotted: 0,
    errors: [],
    documents: [],
  };

  updateLocalFolderBindingStatus(
    binding.bindingId,
    { status: "scanning", lastError: null },
    params.bindingStorePath,
  );
  const now = Date.now();

  try {
    const seenFiles = new Set<string>();
    for (const input of params.files) {
      let relativePath = input.relativePath;
      try {
        const file = prepareCommitFile(input, "connector");
        relativePath = file.relativePath;
        if (seenFiles.has(file.relativePath)) {
          throw new Error(`duplicate local-folder commit file: ${file.relativePath}`);
        }
        seenFiles.add(file.relativePath);
        if (firstHumanDocumentTitle(file.relativePath) == null) {
          result.skipped += 1;
          result.errors.push(
            `${file.relativePath}: skill/object catalog file is not a knowledge document`,
          );
          continue;
        }
        const docId = buildLocalFolderDocId(sourceDescriptorId, file.relativePath);
        const title = path.basename(file.fileName, extensionOf(file.fileName)) || file.fileName;
        const outcome = await ingestKnowledgePayloadToBase({
          knowledgeBase: params.knowledgeBase,
          documentId: docId,
          title,
          fileName: file.fileName,
          mimeType: file.mimeType,
          buffer: file.buffer,
          ownerId: params.ownerId,
          sourceName: `localFolder:${binding.rootLabel}/${file.relativePath}`,
          indexRoot: params.indexRoot,
          ...(params.originalsRoot ? { originalsRoot: params.originalsRoot } : {}),
          cfg: params.cfg,
          client: params.client,
          embeddingProvider: params.embeddingProvider,
          governanceOwnershipProof: params.governanceOwnershipProof,
          deferEmbedding: true,
        });

        const ingestReady = await readKnowledgeDocumentIngestReady({
          kbId: params.knowledgeBase.id,
          docId,
          ownerId: params.ownerId,
          tenantId: params.knowledgeBase.tenantId,
          indexRoot: params.indexRoot,
          originalsRoot: params.originalsRoot,
        });
        result.documents?.push({
          relativePath: file.relativePath,
          docId,
          originalStored: ingestReady.originalStored,
          chunkCount: ingestReady.chunkCount,
          vectorCount: ingestReady.vectorCount,
          ready: isKnowledgeDocumentIngestReady(ingestReady),
        });

        if (outcome.error) {
          result.skipped += 1;
          result.errors.push(`${file.relativePath}: ${outcome.error}`);
          continue;
        }

        try {
          attachDocumentToKnowledgeBase(params.knowledgeBase.id, docId, params.kbStorePath);
        } catch {
          // already attached
        }

        upsertSourceDocumentLink(
          {
            sourceDescriptorId,
            docId,
            relativePath: file.relativePath,
            state: "active",
            lastSeenAt: now,
            lastIngestedVersionId: outcome.versionLabel ?? undefined,
            rawHash: file.rawHash,
            semanticHash: undefined,
          },
          params.linkStorePath,
        );

        if (outcome.skipped) {
          result.skipped += 1;
        } else {
          result.ingested += 1;
        }
      } catch (error) {
        result.skipped += 1;
        const message = error instanceof Error ? error.message : "local-folder ingest failed";
        result.errors.push(
          message.startsWith(`${relativePath}:`) ? message : `${relativePath}: ${message}`,
        );
      }
    }

    if (params.applyDeletes !== false) {
      const seenDeletes = new Set<string>();
      for (const input of params.deletedRelativePaths ?? []) {
        try {
          const relativePath = normalizeConnectorRelativePath(input);
          if (seenDeletes.has(relativePath)) {
            throw new Error(`duplicate local-folder delete path: ${relativePath}`);
          }
          seenDeletes.add(relativePath);
          const docId = buildLocalFolderDocId(sourceDescriptorId, relativePath);
          if (binding.deletePolicy === "sync") {
            await purgeIndexedDocument({
              knowledgeBase: params.knowledgeBase,
              docId,
              ownerId: params.ownerId,
              indexRoot: params.indexRoot,
              kbStorePath: params.kbStorePath,
            });
            updateSourceDocumentLinkState(
              {
                sourceDescriptorId,
                relativePath,
                state: "tombstoned",
                lastSeenAt: now,
              },
              params.linkStorePath,
            );
            result.tombstoned += 1;
          } else {
            updateSourceDocumentLinkState(
              {
                sourceDescriptorId,
                relativePath,
                state: "snapshotted_deleted",
                lastSeenAt: now,
              },
              params.linkStorePath,
            );
            result.snapshotted += 1;
          }
        } catch (error) {
          result.errors.push(error instanceof Error ? error.message : "local-folder delete failed");
        }
      }
    }

    updateLocalFolderBindingStatus(
      binding.bindingId,
      {
        status: "idle",
        lastScanAt: now,
        lastEventAt: now,
        lastError: result.errors[0] ?? null,
      },
      params.bindingStorePath,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "sync commit failed";
    result.errors.push(message);
    updateLocalFolderBindingStatus(
      binding.bindingId,
      { status: "error", lastError: message, lastEventAt: Date.now() },
      params.bindingStorePath,
    );
  }

  return result;
}

function commitErrorRelativePath(message: string): string | null {
  const idx = message.indexOf(": ");
  if (idx <= 0) {
    return null;
  }
  const prefix = message.slice(0, idx).trim();
  return prefix || null;
}

function uploadPathsAcceptedByCommit(
  uploadedPaths: string[],
  result: LocalFolderSyncCommitResponse,
): string[] {
  const failed = new Set(
    result.errors
      .map((message) => commitErrorRelativePath(message))
      .filter((path): path is string => Boolean(path)),
  );
  return uploadedPaths.filter((path) => {
    const document = result.documents?.find((item) => item.relativePath === path);
    if (document && (document.originalStored || document.chunkCount > 0)) {
      return true;
    }
    return result.ingested > 0 && !failed.has(path);
  });
}

function validateManagedUploadFiles(
  plan: LocalFolderSyncPlanRecord,
  files: LocalFolderSyncCommitFile[],
): string[] {
  if (files.length === 0) {
    throw new Error("managed sync upload phase requires at least one file");
  }
  const expectedByPath = new Map(
    plan.expectedUploads.map((expected) => [expected.relativePath, expected] as const),
  );
  const alreadyUploaded = new Set(plan.uploadedRelativePaths);
  const prepared = prepareManagedCommitFiles(files);
  for (const file of prepared) {
    const expected = expectedByPath.get(file.relativePath);
    if (!expected) {
      throw new Error(
        `managed sync upload was not requested by the current plan: ${file.relativePath}`,
      );
    }
    if (alreadyUploaded.has(file.relativePath)) {
      throw new Error(`managed sync upload was already recorded: ${file.relativePath}`);
    }
    if (expected.rawHash && expected.rawHash !== file.rawHash) {
      throw new Error(`${file.relativePath}: uploaded content differs from the planned inventory`);
    }
  }
  return prepared.map((file) => file.relativePath);
}

export async function commitManagedLocalFolderSync(params: {
  binding: LocalFolderBinding;
  knowledgeBase: KnowledgeBase;
  ownerId: string;
  deviceId: string;
  planId: string;
  generation: number;
  phase: LocalFolderSyncCommitPhase;
  files: LocalFolderSyncCommitFile[];
  indexRoot?: string;
  originalsRoot?: string;
  kbStorePath?: string;
  bindingStorePath?: string;
  linkStorePath?: string;
  planStorePath?: string;
  cfg?: OpenBotConfig;
  client?: GatewayClient | null;
  embeddingProvider?: EmbeddingProvider | null;
  nowMs?: number;
  /** Trusted proof from authenticated call entry — required for tenant-scoped KBs. */
  governanceOwnershipProof?: GovernanceOwnershipProof;
}): Promise<LocalFolderSyncCommitResponse> {
  return withLocalFolderBindingOperationLock(params.binding.bindingId, async () => {
    const current = requireCurrentManagedBinding({
      expectedBinding: params.binding,
      deviceId: params.deviceId,
      bindingStorePath: params.bindingStorePath,
    });
    const nowMs = params.nowMs ?? Date.now();
    const plan = requireCurrentManagedPlan({
      bindingId: current.binding.bindingId,
      bindingRevision: current.revision,
      planId: params.planId,
      generation: params.generation,
      deviceId: params.deviceId.trim(),
      nowMs,
      planStorePath: params.planStorePath,
    });

    if (params.phase === "upload") {
      const uploadedPaths = validateManagedUploadFiles(plan, params.files);
      const result = await commitLocalFolderSync({
        binding: current.binding,
        knowledgeBase: params.knowledgeBase,
        ownerId: params.ownerId,
        files: params.files,
        applyDeletes: false,
        indexRoot: params.indexRoot,
        ...(params.originalsRoot ? { originalsRoot: params.originalsRoot } : {}),
        kbStorePath: params.kbStorePath,
        bindingStorePath: params.bindingStorePath,
        linkStorePath: params.linkStorePath,
        cfg: params.cfg,
        client: params.client,
        embeddingProvider: params.embeddingProvider,
        governanceOwnershipProof: params.governanceOwnershipProof,
      });
      const succeededPaths = uploadPathsAcceptedByCommit(uploadedPaths, result);
      if (succeededPaths.length === 0 && result.errors.length > 0) {
        throw new Error(result.errors.join("; "));
      }
      const postCommit = requireCurrentManagedBinding({
        expectedBinding: current.binding,
        deviceId: params.deviceId,
        bindingStorePath: params.bindingStorePath,
      });
      const recordedAtMs = params.nowMs ?? Date.now();
      requireCurrentManagedPlan({
        bindingId: postCommit.binding.bindingId,
        bindingRevision: postCommit.revision,
        planId: params.planId,
        generation: params.generation,
        deviceId: params.deviceId.trim(),
        nowMs: recordedAtMs,
        planStorePath: params.planStorePath,
      });
      if (succeededPaths.length > 0) {
        recordLocalFolderSyncPlanUploads(
          {
            bindingId: postCommit.binding.bindingId,
            planId: params.planId,
            generation: params.generation,
            deviceId: params.deviceId.trim(),
            relativePaths: succeededPaths,
            nowMs: recordedAtMs,
          },
          params.planStorePath,
        );
      }
      return result;
    }

    if (params.files.length > 0) {
      throw new Error("managed sync finalize phase does not accept file uploads");
    }
    const uploaded = new Set(plan.uploadedRelativePaths);
    const outstanding = plan.expectedUploads
      .map((item) => item.relativePath)
      .filter((relativePath) => !uploaded.has(relativePath));
    if (outstanding.length > 0) {
      throw new Error(`managed sync plan still has ${outstanding.length} pending upload(s)`);
    }

    // The deletion set is taken exclusively from the current server-side plan.
    const result = await commitLocalFolderSync({
      binding: current.binding,
      knowledgeBase: params.knowledgeBase,
      ownerId: params.ownerId,
      files: [],
      deletedRelativePaths: plan.missingOnDevice,
      applyDeletes: true,
      indexRoot: params.indexRoot,
      kbStorePath: params.kbStorePath,
      bindingStorePath: params.bindingStorePath,
      linkStorePath: params.linkStorePath,
      cfg: params.cfg,
      client: params.client,
      embeddingProvider: params.embeddingProvider,
      governanceOwnershipProof: params.governanceOwnershipProof,
    });
    if (result.errors.length > 0) {
      throw new Error(result.errors.join("; "));
    }
    const postCommit = requireCurrentManagedBinding({
      expectedBinding: current.binding,
      deviceId: params.deviceId,
      bindingStorePath: params.bindingStorePath,
    });
    const consumedAtMs = params.nowMs ?? Date.now();
    requireCurrentManagedPlan({
      bindingId: postCommit.binding.bindingId,
      bindingRevision: postCommit.revision,
      planId: params.planId,
      generation: params.generation,
      deviceId: params.deviceId.trim(),
      nowMs: consumedAtMs,
      planStorePath: params.planStorePath,
    });
    consumeLocalFolderSyncPlan(
      {
        bindingId: postCommit.binding.bindingId,
        planId: params.planId,
        generation: params.generation,
        deviceId: params.deviceId.trim(),
        nowMs: consumedAtMs,
      },
      params.planStorePath,
    );
    return result;
  });
}
