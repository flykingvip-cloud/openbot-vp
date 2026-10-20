/**
 * Durable sealed-range index + watermark for session transcripts (plan §5.3 / §8.5).
 * Used by CogniWeave manager seal ingest and chat.restore deny population.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { MemorySourceIdentity, TranscriptIngestWatermark } from "../conversations/types.js";

export type SealedRangeRecord = {
  sourceIdentityId: string;
  firstTurnId: string;
  lastTurnId: string;
  turnIndexRange: [number, number];
  contentChecksum: string;
  /** Relative openbot path for UX (alias only). */
  pathAlias: string;
  /** Atom / evidence ids produced by seal writeBack (for Memory Center deny). */
  atomIds?: string[];
  evidenceIds?: string[];
};

export type SessionSourceIndex = {
  schemaVersion: 1;
  sessionFile: string;
  sessionId: string;
  dataPlaneId: string;
  conversationId: string;
  bindingId: string;
  watermark: TranscriptIngestWatermark;
  ranges: SealedRangeRecord[];
  updatedAt: string;
};

function normalizeSessionFile(sessionFile: string): string {
  return path.resolve(sessionFile).split("\\").join("/");
}

export function resolveSessionSourceIndexDir(dataRoot: string): string {
  return path.join(dataRoot, ".meta", "conversations", "session-source-index");
}

function indexFilePath(indexDir: string, sessionFile: string): string {
  const key = Buffer.from(normalizeSessionFile(sessionFile)).toString("base64url").slice(0, 80);
  return path.join(indexDir, `${key}.json`);
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

export async function loadSessionSourceIndex(params: {
  indexDir: string;
  sessionFile: string;
}): Promise<SessionSourceIndex | null> {
  try {
    const raw = await fs.readFile(indexFilePath(params.indexDir, params.sessionFile), "utf8");
    return JSON.parse(raw) as SessionSourceIndex;
  } catch {
    return null;
  }
}

export async function saveSessionSourceIndex(params: {
  indexDir: string;
  index: SessionSourceIndex;
}): Promise<void> {
  await writeJsonAtomic(indexFilePath(params.indexDir, params.index.sessionFile), params.index);
}

export function appendSealedRanges(
  index: SessionSourceIndex,
  sealed: Array<{
    identity: MemorySourceIdentity;
    pathAlias: string;
    atomIds?: string[];
    evidenceIds?: string[];
  }>,
  nextWatermark: TranscriptIngestWatermark,
  now?: string,
): SessionSourceIndex {
  const existing = new Set(index.ranges.map((r) => r.sourceIdentityId));
  const ranges = [...index.ranges];
  for (const item of sealed) {
    if (existing.has(item.identity.sourceIdentityId)) {
      // Merge atom/evidence ids into existing row when re-sealing is skipped.
      const row = ranges.find((r) => r.sourceIdentityId === item.identity.sourceIdentityId);
      if (row) {
        row.atomIds = [...new Set([...(row.atomIds ?? []), ...(item.atomIds ?? [])])];
        row.evidenceIds = [...new Set([...(row.evidenceIds ?? []), ...(item.evidenceIds ?? [])])];
      }
      continue;
    }
    ranges.push({
      sourceIdentityId: item.identity.sourceIdentityId,
      firstTurnId: item.identity.firstTurnId,
      lastTurnId: item.identity.lastTurnId,
      turnIndexRange: item.identity.turnIndexRange,
      contentChecksum: item.identity.contentChecksum,
      pathAlias: item.pathAlias,
      atomIds: item.atomIds ? [...item.atomIds] : [],
      evidenceIds: item.evidenceIds ? [...item.evidenceIds] : [],
    });
    existing.add(item.identity.sourceIdentityId);
  }
  return {
    ...index,
    watermark: nextWatermark,
    ranges,
    updatedAt: now ?? new Date().toISOString(),
  };
}

/**
 * Load sealed sourceIdentityIds for a live transcript path (archive/restore/purge).
 * Returns empty when index missing or unreadable.
 */
export async function loadSealedSourceIdentityIds(params: {
  dataRoot: string | null | undefined;
  sessionFile: string;
}): Promise<string[]> {
  if (!params.dataRoot?.trim() || !params.sessionFile?.trim()) {
    return [];
  }
  try {
    const index = await loadSessionSourceIndex({
      indexDir: resolveSessionSourceIndexDir(params.dataRoot),
      sessionFile: params.sessionFile,
    });
    if (!index?.ranges?.length) {
      return [];
    }
    return [...new Set(index.ranges.map((r) => r.sourceIdentityId).filter(Boolean))];
  } catch {
    return [];
  }
}

/** Collect atom ids whose sealed sourceIdentityId is in the deny set. */
export async function listDeniedAtomIdsFromSessionIndexes(params: {
  indexDir: string;
  deniedSourceIdentityIds: Set<string>;
}): Promise<Set<string>> {
  const deniedAtoms = new Set<string>();
  if (params.deniedSourceIdentityIds.size === 0) {
    return deniedAtoms;
  }
  let names: string[];
  try {
    names = await fs.readdir(params.indexDir);
  } catch {
    return deniedAtoms;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const raw = await fs.readFile(path.join(params.indexDir, name), "utf8");
      const index = JSON.parse(raw) as SessionSourceIndex;
      for (const range of index.ranges ?? []) {
        if (params.deniedSourceIdentityIds.has(range.sourceIdentityId)) {
          for (const atomId of range.atomIds ?? []) {
            deniedAtoms.add(atomId);
          }
        }
      }
    } catch {
      // skip corrupt
    }
  }
  return deniedAtoms;
}

/**
 * Ranges fully after boundary (turn index after boundary range, or endpoints in revoked set).
 */
export function selectRevokedSourceIdentityIds(params: {
  ranges: SealedRangeRecord[];
  boundaryTurnId: string;
  revokedMessageIds?: string[];
}): string[] {
  const revokedMsgs = new Set(params.revokedMessageIds ?? []);
  const ids = new Set<string>();

  // 1) Any sealed range whose endpoints appear in the truncated tail message ids.
  for (const r of params.ranges) {
    if (revokedMsgs.has(r.firstTurnId) || revokedMsgs.has(r.lastTurnId)) {
      ids.add(r.sourceIdentityId);
    }
  }

  // 2) Ranges strictly after the sealed range that ends at the boundary.
  const endAtBoundary = params.ranges.find((r) => r.lastTurnId === params.boundaryTurnId);
  if (endAtBoundary) {
    for (const r of params.ranges) {
      if (r.turnIndexRange[0] > endAtBoundary.turnIndexRange[1]) {
        ids.add(r.sourceIdentityId);
      }
    }
  } else {
    // Boundary may sit inside a range: revoke ranges with firstTurn after any range
    // that contains the boundary as firstTurnId.
    const containsBoundary = params.ranges.find(
      (r) => r.firstTurnId === params.boundaryTurnId || r.lastTurnId === params.boundaryTurnId,
    );
    if (containsBoundary) {
      for (const r of params.ranges) {
        if (r.turnIndexRange[0] > containsBoundary.turnIndexRange[1]) {
          ids.add(r.sourceIdentityId);
        }
      }
    }
  }

  return [...ids];
}

export function emptySessionSourceIndex(params: {
  sessionFile: string;
  sessionId: string;
  dataPlaneId: string;
  conversationId: string;
  bindingId: string;
  now?: string;
}): SessionSourceIndex {
  const now = params.now ?? new Date().toISOString();
  return {
    schemaVersion: 1,
    sessionFile: normalizeSessionFile(params.sessionFile),
    sessionId: params.sessionId,
    dataPlaneId: params.dataPlaneId,
    conversationId: params.conversationId,
    bindingId: params.bindingId,
    watermark: {
      schemaVersion: 1,
      dataPlaneId: params.dataPlaneId,
      bindingId: params.bindingId,
      sessionId: params.sessionId,
      lastSealedTurnId: null,
      lastSealedTurnIndex: null,
      lastContentChecksum: null,
      updatedAt: now,
    },
    ranges: [],
    updatedAt: now,
  };
}
