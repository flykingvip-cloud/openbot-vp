import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../../utils.js";
import type { ArchivedDeliverableRecord } from "./save-decision.js";

export type DeliverableArchiveRecord = ArchivedDeliverableRecord & {
  updatedAtMs: number;
};

export type DeliverableArchiveLookup = {
  deliverableId: string;
  record: DeliverableArchiveRecord;
};

type DeliverableArchiveStore = {
  archives: Record<string, DeliverableArchiveRecord>;
};

const DEFAULT_STORE_FILE = path.join(CONFIG_DIR, "knowledge", "deliverable-archives.json");

function asTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRecord(entry: unknown, knowledgeBaseId: string): DeliverableArchiveRecord {
  const record =
    typeof entry === "object" && entry !== null && !Array.isArray(entry)
      ? (entry as Record<string, unknown>)
      : {};
  const updatedAtMs =
    typeof record.updatedAtMs === "number" && Number.isFinite(record.updatedAtMs)
      ? record.updatedAtMs
      : Date.now();
  return {
    knowledgeBaseId,
    documentId: asTrimmed(record.documentId),
    ...(asTrimmed(record.logicalId) ? { logicalId: asTrimmed(record.logicalId) } : {}),
    ...(asTrimmed(record.rawHash) ? { rawHash: asTrimmed(record.rawHash) } : {}),
    ...(asTrimmed(record.filename) ? { filename: asTrimmed(record.filename) } : {}),
    ...(asTrimmed(record.title) ? { title: asTrimmed(record.title) } : {}),
    ...(asTrimmed(record.archivedByAgentId)
      ? { archivedByAgentId: asTrimmed(record.archivedByAgentId) }
      : {}),
    ...(asTrimmed(record.archivedByGroupId)
      ? { archivedByGroupId: asTrimmed(record.archivedByGroupId) }
      : {}),
    ...(asTrimmed(record.archivedByUserId)
      ? { archivedByUserId: asTrimmed(record.archivedByUserId) }
      : {}),
    ...(asTrimmed(record.derivedFromDocumentId)
      ? { derivedFromDocumentId: asTrimmed(record.derivedFromDocumentId) }
      : {}),
    ...(asTrimmed(record.derivedFromRawHash)
      ? { derivedFromRawHash: asTrimmed(record.derivedFromRawHash) }
      : {}),
    updatedAtMs,
  };
}

function readStore(storePath: string): DeliverableArchiveStore {
  try {
    if (!fs.existsSync(storePath)) {
      return { archives: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf-8")) as unknown;
    const record =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const archives =
      typeof record.archives === "object" &&
      record.archives !== null &&
      !Array.isArray(record.archives)
        ? (record.archives as Record<string, unknown>)
        : {};
    const normalized: DeliverableArchiveStore["archives"] = {};
    for (const [deliverableId, entry] of Object.entries(archives)) {
      const raw =
        typeof entry === "object" && entry !== null && !Array.isArray(entry)
          ? (entry as Record<string, unknown>)
          : {};
      const knowledgeBaseId = asTrimmed(raw.knowledgeBaseId);
      if (!deliverableId.trim() || !knowledgeBaseId) {
        continue;
      }
      normalized[deliverableId] = normalizeRecord(raw, knowledgeBaseId);
    }
    return { archives: normalized };
  } catch {
    return { archives: {} };
  }
}

function writeStore(store: DeliverableArchiveStore, storePath: string): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function toLookup(
  deliverableId: string,
  record: DeliverableArchiveRecord,
): DeliverableArchiveLookup {
  return { deliverableId, record };
}

export function getDeliverableArchiveKnowledgeBaseId(
  deliverableId: string,
  storePath: string = DEFAULT_STORE_FILE,
): string | null {
  const entry = readStore(storePath).archives[deliverableId.trim()];
  return entry?.knowledgeBaseId ?? null;
}

export function getDeliverableArchiveRecord(
  deliverableId: string,
  storePath: string = DEFAULT_STORE_FILE,
): DeliverableArchiveRecord | null {
  return readStore(storePath).archives[deliverableId.trim()] ?? null;
}

export function setDeliverableArchiveKnowledgeBaseId(params: {
  deliverableId: string;
  knowledgeBaseId: string;
  storePath?: string;
}): void {
  setDeliverableArchiveRecord({
    deliverableId: params.deliverableId,
    knowledgeBaseId: params.knowledgeBaseId,
    storePath: params.storePath,
  });
}

export function setDeliverableArchiveRecord(params: {
  deliverableId: string;
  knowledgeBaseId: string;
  documentId?: string | null;
  logicalId?: string | null;
  rawHash?: string | null;
  filename?: string | null;
  title?: string | null;
  archivedByAgentId?: string | null;
  archivedByGroupId?: string | null;
  archivedByUserId?: string | null;
  derivedFromDocumentId?: string | null;
  derivedFromRawHash?: string | null;
  storePath?: string;
}): void {
  const deliverableId = params.deliverableId.trim();
  const knowledgeBaseId = params.knowledgeBaseId.trim();
  if (!deliverableId || !knowledgeBaseId) {
    return;
  }
  const storePath = params.storePath ?? DEFAULT_STORE_FILE;
  const store = readStore(storePath);
  const previous = store.archives[deliverableId];
  store.archives[deliverableId] = normalizeRecord(
    {
      ...previous,
      knowledgeBaseId,
      ...(params.documentId !== undefined ? { documentId: params.documentId } : {}),
      ...(params.logicalId !== undefined ? { logicalId: params.logicalId } : {}),
      ...(params.rawHash !== undefined ? { rawHash: params.rawHash } : {}),
      ...(params.filename !== undefined ? { filename: params.filename } : {}),
      ...(params.title !== undefined ? { title: params.title } : {}),
      ...(params.archivedByAgentId !== undefined
        ? { archivedByAgentId: params.archivedByAgentId }
        : {}),
      ...(params.archivedByGroupId !== undefined
        ? { archivedByGroupId: params.archivedByGroupId }
        : {}),
      ...(params.archivedByUserId !== undefined
        ? { archivedByUserId: params.archivedByUserId }
        : {}),
      ...(params.derivedFromDocumentId !== undefined
        ? { derivedFromDocumentId: params.derivedFromDocumentId }
        : {}),
      ...(params.derivedFromRawHash !== undefined
        ? { derivedFromRawHash: params.derivedFromRawHash }
        : {}),
      updatedAtMs: Date.now(),
    },
    knowledgeBaseId,
  );
  writeStore(store, storePath);
}

export function findDeliverableArchiveByDocumentId(
  documentId: string,
  storePath: string = DEFAULT_STORE_FILE,
): DeliverableArchiveLookup | null {
  const wanted = documentId.trim();
  if (!wanted) {
    return null;
  }
  for (const [deliverableId, record] of Object.entries(readStore(storePath).archives)) {
    if (record.documentId?.trim() === wanted) {
      return toLookup(deliverableId, record);
    }
  }
  return null;
}

export function findDeliverableArchiveByLogicalId(params: {
  knowledgeBaseId: string;
  logicalId: string;
  storePath?: string;
}): DeliverableArchiveLookup | null {
  const knowledgeBaseId = params.knowledgeBaseId.trim();
  const logicalId = params.logicalId.trim();
  if (!knowledgeBaseId || !logicalId) {
    return null;
  }
  const storePath = params.storePath ?? DEFAULT_STORE_FILE;
  for (const [deliverableId, record] of Object.entries(readStore(storePath).archives)) {
    if (record.knowledgeBaseId === knowledgeBaseId && record.logicalId?.trim() === logicalId) {
      return toLookup(deliverableId, record);
    }
  }
  return null;
}

export function listDeliverableArchivesForKnowledgeBase(
  knowledgeBaseId: string,
  storePath: string = DEFAULT_STORE_FILE,
): DeliverableArchiveLookup[] {
  const kbId = knowledgeBaseId.trim();
  if (!kbId) {
    return [];
  }
  const out: DeliverableArchiveLookup[] = [];
  for (const [deliverableId, record] of Object.entries(readStore(storePath).archives)) {
    if (record.knowledgeBaseId === kbId) {
      out.push(toLookup(deliverableId, record));
    }
  }
  return out;
}

export function listDeliverableArchiveFilenames(
  knowledgeBaseId: string,
  storePath: string = DEFAULT_STORE_FILE,
): string[] {
  const kbId = knowledgeBaseId.trim();
  if (!kbId) {
    return [];
  }
  const names = new Set<string>();
  for (const record of Object.values(readStore(storePath).archives)) {
    const filename = record.filename?.trim();
    if (record.knowledgeBaseId === kbId && filename) {
      names.add(filename);
    }
  }
  return [...names];
}

export function syncDeliverableArchiveRawHash(params: {
  documentId: string;
  rawHash: string;
  filename?: string | null;
  storePath?: string;
}): void {
  const documentId = params.documentId.trim();
  const rawHash = params.rawHash.trim();
  if (!documentId || !rawHash) {
    return;
  }
  const storePath = params.storePath ?? DEFAULT_STORE_FILE;
  const store = readStore(storePath);
  let changed = false;
  for (const [deliverableId, record] of Object.entries(store.archives)) {
    if (record.documentId?.trim() !== documentId) {
      continue;
    }
    store.archives[deliverableId] = normalizeRecord(
      {
        ...record,
        rawHash,
        ...(params.filename !== undefined ? { filename: params.filename } : {}),
        updatedAtMs: Date.now(),
      },
      record.knowledgeBaseId,
    );
    changed = true;
  }
  if (changed) {
    writeStore(store, storePath);
  }
}

export function listDeliverableArchiveKnowledgeBaseIds(
  storePath: string = DEFAULT_STORE_FILE,
): Record<string, string> {
  const store = readStore(storePath);
  return Object.fromEntries(
    Object.entries(store.archives).map(([deliverableId, entry]) => [
      deliverableId,
      entry.knowledgeBaseId,
    ]),
  );
}
