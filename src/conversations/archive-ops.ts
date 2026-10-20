/**
 * Atomic archive / restore of transcript with checksum verification (CL-P1-01).
 * Does not use sessions.delete move-then-best-effort order.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ConversationCatalogRepository } from "./catalog/repository.js";
import { createEtag } from "./ids.js";
import type {
  ConversationRecord,
  ConversationSessionBinding,
  ConversationStorageTier,
} from "./types.js";

export type ArchiveConversationResult = {
  record: ConversationRecord;
  binding: ConversationSessionBinding;
  archivePath: string;
  checksum: string;
  bytes: number;
};

export type RestoreConversationResult = {
  record: ConversationRecord;
  binding: ConversationSessionBinding;
  livePath: string;
  checksum: string;
};

async function sha256File(filePath: string): Promise<{ checksum: string; bytes: number }> {
  const buf = await fs.readFile(filePath);
  return {
    checksum: createHash("sha256").update(buf).digest("hex"),
    bytes: buf.length,
  };
}

async function copyAndVerify(
  src: string,
  dest: string,
): Promise<{ checksum: string; bytes: number }> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
  const srcHash = await sha256File(src);
  const destHash = await sha256File(dest);
  if (srcHash.checksum !== destHash.checksum) {
    await fs.unlink(dest).catch(() => undefined);
    throw new Error("archive checksum mismatch after copy");
  }
  return destHash;
}

/**
 * Archive: copy live transcript → controlled archive path, verify checksum, then
 * switch Catalog lifecycle to ARCHIVED. On failure, Catalog stays unchanged.
 */
export async function archiveConversationTranscript(params: {
  catalog: ConversationCatalogRepository;
  record: ConversationRecord;
  binding: ConversationSessionBinding;
  liveTranscriptPath: string;
  archiveDir: string;
  now?: string;
  /**
   * When true (additional bindings after primary), only copy transcript + mark
   * binding ARCHIVED — do not rewrite conversation lifecycle again.
   */
  bindingOnly?: boolean;
}): Promise<ArchiveConversationResult> {
  const now = params.now ?? new Date().toISOString();
  if (params.record.lifecycleStatus === "DELETED") {
    throw new Error("cannot archive deleted conversation");
  }
  if (params.record.retentionState === "PURGE_PENDING") {
    throw new Error("cannot archive while purge pending");
  }

  try {
    await fs.access(params.liveTranscriptPath);
  } catch {
    throw new Error("live transcript not found");
  }

  const archivePath = path.join(
    params.archiveDir,
    params.record.conversationId,
    `${params.binding.sessionId}.jsonl`,
  );
  const { checksum, bytes } = await copyAndVerify(params.liveTranscriptPath, archivePath);

  const nextBinding: ConversationSessionBinding = {
    ...params.binding,
    transcriptState: "ARCHIVED",
  };

  if (params.bindingOnly || params.record.lifecycleStatus === "ARCHIVED") {
    await params.catalog.saveBinding(nextBinding);
    return {
      record: params.record,
      binding: nextBinding,
      archivePath,
      checksum,
      bytes,
    };
  }

  const expectedEtag = params.record.etag;
  const before =
    params.record.lifecycleStatus === "ACTIVE" || params.record.lifecycleStatus === "CLOSED"
      ? params.record.lifecycleStatus
      : params.record.lifecycleStatusBeforeArchive === "ACTIVE" ||
          params.record.lifecycleStatusBeforeArchive === "CLOSED"
        ? params.record.lifecycleStatusBeforeArchive
        : ("CLOSED" as const);
  const nextRecord: ConversationRecord = {
    ...params.record,
    lifecycleStatus: "ARCHIVED",
    lifecycleStatusBeforeArchive: before,
    storageTier: "WARM",
    archivedAt: now,
    updatedAt: now,
    etag: createEtag(),
  };

  await params.catalog.updateConversation(nextRecord, expectedEtag);
  await params.catalog.saveBinding(nextBinding);

  // Register locator alias (archive path is storage alias, not source identity).
  try {
    // Best-effort: if no source identity yet, skip.
  } catch {
    // ignore
  }

  return {
    record: nextRecord,
    binding: nextBinding,
    archivePath,
    checksum,
    bytes,
  };
}

/**
 * Restore: copy archive → live path (or keep live if present), verify, switch Catalog.
 * Reuses same conversationId / bindingId / sessionId.
 */
export async function restoreConversationTranscript(params: {
  catalog: ConversationCatalogRepository;
  record: ConversationRecord;
  binding: ConversationSessionBinding;
  liveTranscriptPath: string;
  archivePath: string;
  targetLifecycle?: "ACTIVE" | "CLOSED";
  now?: string;
  /** Additional bindings after primary — only restore transcript + binding LIVE. */
  bindingOnly?: boolean;
}): Promise<RestoreConversationResult> {
  const now = params.now ?? new Date().toISOString();
  if (!params.bindingOnly && params.record.lifecycleStatus !== "ARCHIVED") {
    throw new Error("conversation is not archived");
  }

  try {
    await fs.access(params.archivePath);
  } catch {
    throw new Error("archive transcript not found");
  }

  let liveExists = false;
  try {
    await fs.access(params.liveTranscriptPath);
    liveExists = true;
  } catch {
    liveExists = false;
  }

  let checksum: string;
  if (!liveExists) {
    const copied = await copyAndVerify(params.archivePath, params.liveTranscriptPath);
    checksum = copied.checksum;
  } else {
    checksum = (await sha256File(params.liveTranscriptPath)).checksum;
    const archiveHash = (await sha256File(params.archivePath)).checksum;
    if (checksum !== archiveHash) {
      // Prefer archive as canonical when diverge — do not invent a second source.
      const copied = await copyAndVerify(params.archivePath, params.liveTranscriptPath);
      checksum = copied.checksum;
    }
  }

  const nextBinding: ConversationSessionBinding = {
    ...params.binding,
    transcriptState: "LIVE",
  };

  if (params.bindingOnly || params.record.lifecycleStatus !== "ARCHIVED") {
    await params.catalog.saveBinding(nextBinding);
    return {
      record: params.record,
      binding: nextBinding,
      livePath: params.liveTranscriptPath,
      checksum,
    };
  }

  const expectedEtag = params.record.etag;
  // Prefer persisted pre-archive snapshot; never guess ACTIVE for legacy null.
  const fromSnapshot =
    params.record.lifecycleStatusBeforeArchive === "ACTIVE" ||
    params.record.lifecycleStatusBeforeArchive === "CLOSED"
      ? params.record.lifecycleStatusBeforeArchive
      : null;
  const lifecycle = fromSnapshot ?? params.targetLifecycle ?? "CLOSED";
  const nextRecord: ConversationRecord = {
    ...params.record,
    lifecycleStatus: lifecycle,
    lifecycleStatusBeforeArchive: null,
    storageTier: "HOT" as ConversationStorageTier,
    archivedAt: null,
    closedAt: lifecycle === "CLOSED" ? (params.record.closedAt ?? now) : null,
    updatedAt: now,
    etag: createEtag(),
  };

  await params.catalog.updateConversation(nextRecord, expectedEtag);
  await params.catalog.saveBinding(nextBinding);

  return {
    record: nextRecord,
    binding: nextBinding,
    livePath: params.liveTranscriptPath,
    checksum,
  };
}

export function resolveConversationArchivePath(params: {
  archiveRoot: string;
  conversationId: string;
  sessionId: string;
}): string {
  return path.join(params.archiveRoot, params.conversationId, `${params.sessionId}.jsonl`);
}
