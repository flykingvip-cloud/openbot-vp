/**
 * Memory recall deny watermark + durable revoke outbox (plan §8.5.3 mechanism 3).
 * chat.restore must commit deny before returning success so revoked memory is
 * not recallable while forgetSource is still in-flight.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  MemoryRecallDenyWatermark,
  RevokeOutboxEntry,
  SessionTranscriptUpdatePayload,
  TranscriptChangeKind,
} from "./types.js";

export type CommitTranscriptRevokeParams = {
  /** Directory for durable store (e.g. dataRoot/.meta/conversations/recall-deny). */
  storeDir: string;
  sessionFile: string;
  boundaryTurnId: string;
  boundaryTurnIndex?: number | null;
  deniedSourceIdentityIds?: string[];
  deniedMessageIds?: string[];
  sessionId?: string | null;
  bindingId?: string | null;
  conversationId?: string | null;
  dataPlaneId?: string | null;
  kind?: Extract<TranscriptChangeKind, "TRANSCRIPT_RANGE_REVOKED" | "TRANSCRIPT_TRUNCATED">;
  revokedTailArchivePath?: string;
  reason?: MemoryRecallDenyWatermark["reason"];
  now?: string;
};

export type CommitTranscriptRevokeResult = {
  deny: MemoryRecallDenyWatermark;
  outbox: RevokeOutboxEntry;
  update: SessionTranscriptUpdatePayload;
};

function normalizeSessionFile(sessionFile: string): string {
  return sessionFile.trim().split("\\").join("/");
}

function denyFilePath(storeDir: string, denyId: string): string {
  return path.join(storeDir, "denies", `${denyId}.json`);
}

function outboxFilePath(storeDir: string, outboxId: string): string {
  return path.join(storeDir, "outbox", `${outboxId}.json`);
}

function indexPath(storeDir: string): string {
  return path.join(storeDir, "index.json");
}

type DenyIndex = {
  schemaVersion: 1;
  /** sessionFile → denyIds (newest last) */
  bySessionFile: Record<string, string[]>;
  /** sourceIdentityId → denyIds */
  bySourceIdentityId: Record<string, string[]>;
  /** messageId → denyIds */
  byMessageId: Record<string, string[]>;
};

async function readIndex(storeDir: string): Promise<DenyIndex> {
  try {
    const raw = await fs.readFile(indexPath(storeDir), "utf8");
    return JSON.parse(raw) as DenyIndex;
  } catch {
    return { schemaVersion: 1, bySessionFile: {}, bySourceIdentityId: {}, byMessageId: {} };
  }
}

async function writeIndex(storeDir: string, index: DenyIndex): Promise<void> {
  await fs.mkdir(storeDir, { recursive: true, mode: 0o700 });
  const tmp = `${indexPath(storeDir)}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  await fs.rename(tmp, indexPath(storeDir));
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

function mintDenyId(sessionFile: string, boundaryTurnId: string, now: string): string {
  const digest = createHash("sha256")
    .update(sessionFile)
    .update("\0")
    .update(boundaryTurnId)
    .update("\0")
    .update(now)
    .digest("hex")
    .slice(0, 24);
  return `deny_${digest}`;
}

/**
 * Atomically commit deny watermark + outbox BEFORE chat.restore returns success.
 */
export async function commitTranscriptRangeRevoked(
  params: CommitTranscriptRevokeParams,
): Promise<CommitTranscriptRevokeResult> {
  const now = params.now ?? new Date().toISOString();
  const sessionFile = normalizeSessionFile(params.sessionFile);
  if (!sessionFile) {
    throw new Error("sessionFile required for deny watermark");
  }
  if (!params.boundaryTurnId?.trim()) {
    throw new Error("boundaryTurnId required for deny watermark");
  }

  const denyId = mintDenyId(sessionFile, params.boundaryTurnId, now);
  const deniedSourceIdentityIds = [...new Set(params.deniedSourceIdentityIds ?? [])];
  const deniedMessageIds = [...new Set(params.deniedMessageIds ?? [])];
  const kind = params.kind ?? "TRANSCRIPT_RANGE_REVOKED";

  const deny: MemoryRecallDenyWatermark = {
    schemaVersion: 1,
    denyId,
    dataPlaneId: params.dataPlaneId ?? null,
    sessionFile,
    sessionId: params.sessionId ?? null,
    bindingId: params.bindingId ?? null,
    conversationId: params.conversationId ?? null,
    boundaryTurnId: params.boundaryTurnId,
    boundaryTurnIndex: params.boundaryTurnIndex ?? null,
    deniedSourceIdentityIds,
    deniedMessageIds,
    reason: params.reason ?? "CHECKPOINT_RESTORE",
    createdAt: now,
  };

  const update: SessionTranscriptUpdatePayload = {
    sessionFile,
    kind,
    sessionId: params.sessionId ?? undefined,
    bindingId: params.bindingId ?? undefined,
    conversationId: params.conversationId ?? undefined,
    boundaryTurnId: params.boundaryTurnId,
    boundaryTurnIndex: params.boundaryTurnIndex ?? undefined,
    revokedSourceIdentityIds: deniedSourceIdentityIds,
    revokedTailArchivePath: params.revokedTailArchivePath,
    occurredAt: now,
  };

  const outboxId = `rvk_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const outbox: RevokeOutboxEntry = {
    schemaVersion: 1,
    outboxId,
    denyId,
    status: "PENDING",
    payload: update,
    attempts: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };

  await fs.mkdir(params.storeDir, { recursive: true, mode: 0o700 });
  // Persist deny first, then outbox, then index (fail-closed for recall).
  await writeJsonAtomic(denyFilePath(params.storeDir, denyId), deny);
  await writeJsonAtomic(outboxFilePath(params.storeDir, outboxId), outbox);

  const index = await readIndex(params.storeDir);
  const sf = (index.bySessionFile[sessionFile] ??= []);
  sf.push(denyId);
  for (const sid of deniedSourceIdentityIds) {
    (index.bySourceIdentityId[sid] ??= []).push(denyId);
  }
  for (const mid of deniedMessageIds) {
    (index.byMessageId[mid] ??= []).push(denyId);
  }
  await writeIndex(params.storeDir, index);

  return { deny, outbox, update };
}

export async function isSourceIdentityRecallDenied(params: {
  storeDir: string;
  sourceIdentityId: string;
}): Promise<boolean> {
  const index = await readIndex(params.storeDir);
  return (index.bySourceIdentityId[params.sourceIdentityId]?.length ?? 0) > 0;
}

export async function isMessageRecallDenied(params: {
  storeDir: string;
  messageId: string;
}): Promise<boolean> {
  const index = await readIndex(params.storeDir);
  return (index.byMessageId[params.messageId]?.length ?? 0) > 0;
}

export async function listDeniedSourceIdentityIds(params: {
  storeDir: string;
  sessionFile?: string;
}): Promise<string[]> {
  const index = await readIndex(params.storeDir);
  if (params.sessionFile) {
    const sf = normalizeSessionFile(params.sessionFile);
    const denyIds = index.bySessionFile[sf] ?? [];
    const ids = new Set<string>();
    for (const denyId of denyIds) {
      try {
        const raw = await fs.readFile(denyFilePath(params.storeDir, denyId), "utf8");
        const deny = JSON.parse(raw) as MemoryRecallDenyWatermark;
        for (const id of deny.deniedSourceIdentityIds) {
          ids.add(id);
        }
      } catch {
        // skip corrupt
      }
    }
    return [...ids];
  }
  return Object.keys(index.bySourceIdentityId);
}

export async function listPendingRevokeOutbox(storeDir: string): Promise<RevokeOutboxEntry[]> {
  const dir = path.join(storeDir, "outbox");
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: RevokeOutboxEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const raw = await fs.readFile(path.join(dir, name), "utf8");
      const entry = JSON.parse(raw) as RevokeOutboxEntry;
      if (entry.status === "PENDING" || entry.status === "FAILED") {
        out.push(entry);
      }
    } catch {
      // skip
    }
  }
  return out;
}

export async function markRevokeOutboxStatus(params: {
  storeDir: string;
  outboxId: string;
  status: RevokeOutboxEntry["status"];
  lastError?: string | null;
}): Promise<void> {
  const file = outboxFilePath(params.storeDir, params.outboxId);
  const raw = await fs.readFile(file, "utf8");
  const entry = JSON.parse(raw) as RevokeOutboxEntry;
  const next: RevokeOutboxEntry = {
    ...entry,
    status: params.status,
    attempts: entry.attempts + 1,
    lastError: params.lastError ?? null,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(file, next);
}

export function resolveRecallDenyStoreDir(dataRoot: string): string {
  return path.join(dataRoot, ".meta", "conversations", "recall-deny");
}

/** Filter helper for search/inject paths. */
export function filterDeniedSourceIds(sourceIdentityIds: string[], denied: Set<string>): string[] {
  return sourceIdentityIds.filter((id) => !denied.has(id));
}
