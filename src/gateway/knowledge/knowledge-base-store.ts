/**
 * Knowledge Base container store.
 *
 * Persists knowledge-base *containers* (not their indexed chunks — that is the
 * RAG index layer, added in a later phase). A KB declares ownership, visibility,
 * backend kind, attached robots, tags and document membership. Stored as a single
 * JSON file under the OpenBot config dir, mirroring `skill-lifecycle-store` conventions.
 *
 * All public functions accept an optional `storePath` to keep them unit-testable
 * without touching the real user config directory.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";
import { isRecord } from "../records.js";
import { isSkillAssetDocumentId } from "./document-display-title.js";

export type KnowledgeBaseVisibility = "private" | "team" | "enterprise";
/** Internal storage/compat field derived from visibility on create — not the UI space taxonomy. */
export type KnowledgeBaseBackendKind = "personal" | "enterprise";

export type KnowledgeBase = {
  id: string;
  title: string;
  description: string;
  ownerId: string;
  tenantId: string | null;
  visibility: KnowledgeBaseVisibility;
  /** Prefer `visibility` for grouping; backendKind is create-time derivation only. */
  backendKind: KnowledgeBaseBackendKind;
  /** Enterprise KB may map to a governance projection (reserved for the index phase). */
  projectionSpecId?: string;
  robotIds: string[];
  tags: string[];
  documentIds: string[];
  /** Documents removed from active membership but retained for restore. */
  recycledDocumentIds: string[];
  documentCount: number;
  createdAtMs: number;
  updatedAtMs: number;
};

export class KnowledgeBaseStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeBaseStoreError";
  }
}

type KnowledgeBaseStoreData = { bases: KnowledgeBase[] };

const DEFAULT_STORE_FILE = path.join(CONFIG_DIR, "knowledge", "bases.json");

export function resolveKnowledgeBaseStorePath(storePath: string = DEFAULT_STORE_FILE): string {
  return storePath;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((entry) => stringValue(entry)).filter(Boolean))];
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeVisibility(value: unknown): KnowledgeBaseVisibility {
  return value === "team" || value === "enterprise" ? value : "private";
}

function normalizeBackendKind(value: unknown): KnowledgeBaseBackendKind {
  return value === "enterprise" ? "enterprise" : "personal";
}

function sanitizeBase(value: unknown): KnowledgeBase | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  const title = stringValue(value.title);
  const ownerId = stringValue(value.ownerId);
  if (!id || !title || !ownerId) {
    return null;
  }
  const documentIds = stringArray(value.documentIds).filter(
    (docId) => !isSkillAssetDocumentId(docId),
  );
  const recycledDocumentIds = stringArray(value.recycledDocumentIds).filter(
    (docId) => !isSkillAssetDocumentId(docId),
  );
  const tenantId = stringValue(value.tenantId);
  const projectionSpecId = stringValue(value.projectionSpecId);
  const now = Date.now();
  return {
    id,
    title,
    description: stringValue(value.description),
    ownerId,
    tenantId: tenantId || null,
    visibility: normalizeVisibility(value.visibility),
    backendKind: normalizeBackendKind(value.backendKind),
    ...(projectionSpecId ? { projectionSpecId } : {}),
    robotIds: stringArray(value.robotIds),
    tags: stringArray(value.tags),
    documentIds,
    recycledDocumentIds,
    documentCount: documentIds.length,
    createdAtMs: numberValue(value.createdAtMs, now),
    updatedAtMs: numberValue(value.updatedAtMs, now),
  };
}

function baseHadSkillMembership(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    stringArray(value.documentIds).some((docId) => isSkillAssetDocumentId(docId)) ||
    stringArray(value.recycledDocumentIds).some((docId) => isSkillAssetDocumentId(docId))
  );
}

function readStore(storePath: string): KnowledgeBaseStoreData {
  try {
    if (!fs.existsSync(storePath)) {
      return { bases: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf-8")) as unknown;
    const record = isRecord(parsed) ? parsed : {};
    const rawBases = Array.isArray(record.bases) ? record.bases : [];
    const dirty = rawBases.some((entry) => baseHadSkillMembership(entry));
    const bases = rawBases
      .map(sanitizeBase)
      .filter((entry): entry is KnowledgeBase => entry !== null);
    const store = { bases };
    if (dirty) {
      writeStore(store, storePath);
    }
    return store;
  } catch {
    return { bases: [] };
  }
}

function writeStore(store: KnowledgeBaseStoreData, storePath: string): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
}

export function readKnowledgeBaseStoreSnapshot(
  storePath: string = DEFAULT_STORE_FILE,
): string | null {
  if (!fs.existsSync(storePath)) {
    return null;
  }
  return fs.readFileSync(storePath, "utf-8");
}

export function restoreKnowledgeBaseStoreSnapshot(
  snapshot: string | null,
  storePath: string = DEFAULT_STORE_FILE,
): void {
  if (snapshot == null) {
    if (fs.existsSync(storePath)) {
      fs.unlinkSync(storePath);
    }
    return;
  }
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, snapshot, "utf-8");
}

function findBase(store: KnowledgeBaseStoreData, id: string): KnowledgeBase {
  const base = store.bases.find((entry) => entry.id === id);
  if (!base) {
    throw new KnowledgeBaseStoreError(`knowledge base ${id} not found`);
  }
  return base;
}

export type CreateKnowledgeBaseParams = {
  title: string;
  description?: string;
  ownerId: string;
  tenantId?: string | null;
  visibility?: KnowledgeBaseVisibility;
  backendKind?: KnowledgeBaseBackendKind;
  projectionSpecId?: string;
  robotIds?: string[];
  tags?: string[];
};

export function createKnowledgeBase(
  params: CreateKnowledgeBaseParams,
  storePath: string = DEFAULT_STORE_FILE,
): KnowledgeBase {
  const title = stringValue(params.title);
  const ownerId = stringValue(params.ownerId);
  if (!title) {
    throw new KnowledgeBaseStoreError("knowledge base title is required");
  }
  if (!ownerId) {
    throw new KnowledgeBaseStoreError("knowledge base ownerId is required");
  }
  const store = readStore(storePath);
  const now = Date.now();
  const projectionSpecId = stringValue(params.projectionSpecId);
  const base: KnowledgeBase = {
    id: `kb_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    title,
    description: stringValue(params.description),
    ownerId,
    tenantId: stringValue(params.tenantId ?? "") || null,
    visibility: normalizeVisibility(params.visibility),
    backendKind: normalizeBackendKind(params.backendKind),
    ...(projectionSpecId ? { projectionSpecId } : {}),
    robotIds: stringArray(params.robotIds),
    tags: stringArray(params.tags),
    documentIds: [],
    recycledDocumentIds: [],
    documentCount: 0,
    createdAtMs: now,
    updatedAtMs: now,
  };
  store.bases.push(base);
  writeStore(store, storePath);
  return base;
}

export function listKnowledgeBases(
  filter: { ownerId?: string; tenantId?: string } = {},
  storePath: string = DEFAULT_STORE_FILE,
): KnowledgeBase[] {
  const store = readStore(storePath);
  return store.bases
    .filter((base) => (filter.ownerId ? base.ownerId === filter.ownerId : true))
    .filter((base) => (filter.tenantId ? base.tenantId === filter.tenantId : true))
    .toSorted((left, right) => right.updatedAtMs - left.updatedAtMs);
}

export function getKnowledgeBase(
  id: string,
  storePath: string = DEFAULT_STORE_FILE,
): KnowledgeBase | null {
  return readStore(storePath).bases.find((base) => base.id === id) ?? null;
}

export type UpdateKnowledgeBasePatch = {
  title?: string;
  description?: string;
  visibility?: KnowledgeBaseVisibility;
  robotIds?: string[];
  tags?: string[];
};

export function updateKnowledgeBase(
  id: string,
  patch: UpdateKnowledgeBasePatch,
  storePath: string = DEFAULT_STORE_FILE,
): KnowledgeBase {
  const store = readStore(storePath);
  const base = findBase(store, id);
  if (patch.title !== undefined) {
    const title = stringValue(patch.title);
    if (!title) {
      throw new KnowledgeBaseStoreError("knowledge base title cannot be empty");
    }
    base.title = title;
  }
  if (patch.description !== undefined) {
    base.description = stringValue(patch.description);
  }
  if (patch.visibility !== undefined) {
    base.visibility = normalizeVisibility(patch.visibility);
  }
  if (patch.robotIds !== undefined) {
    base.robotIds = stringArray(patch.robotIds);
  }
  if (patch.tags !== undefined) {
    base.tags = stringArray(patch.tags);
  }
  base.updatedAtMs = Date.now();
  writeStore(store, storePath);
  return base;
}

export function deleteKnowledgeBase(
  id: string,
  storePath: string = DEFAULT_STORE_FILE,
): { ok: true } {
  const store = readStore(storePath);
  findBase(store, id);
  store.bases = store.bases.filter((base) => base.id !== id);
  writeStore(store, storePath);
  return { ok: true };
}

export function attachDocumentToKnowledgeBase(
  id: string,
  documentId: string,
  storePath: string = DEFAULT_STORE_FILE,
): KnowledgeBase {
  const docId = stringValue(documentId);
  if (!docId) {
    throw new KnowledgeBaseStoreError("documentId is required");
  }
  if (isSkillAssetDocumentId(docId)) {
    return findBase(readStore(storePath), id);
  }
  const store = readStore(storePath);
  const base = findBase(store, id);
  if (!base.documentIds.includes(docId)) {
    base.recycledDocumentIds = base.recycledDocumentIds.filter((entry) => entry !== docId);
    base.documentIds.push(docId);
    base.documentCount = base.documentIds.length;
    base.updatedAtMs = Date.now();
    writeStore(store, storePath);
  }
  return base;
}

export function detachDocumentFromKnowledgeBase(
  id: string,
  documentId: string,
  storePath: string = DEFAULT_STORE_FILE,
): KnowledgeBase {
  const docId = stringValue(documentId);
  if (!docId) {
    throw new KnowledgeBaseStoreError("documentId is required");
  }
  const store = readStore(storePath);
  const base = findBase(store, id);
  const active = base.documentIds.filter((entry) => entry !== docId);
  if (active.length === base.documentIds.length) {
    throw new KnowledgeBaseStoreError("document is not attached to knowledge base");
  }
  base.documentIds = active;
  if (!base.recycledDocumentIds.includes(docId)) {
    base.recycledDocumentIds.push(docId);
  }
  base.documentCount = base.documentIds.length;
  base.updatedAtMs = Date.now();
  writeStore(store, storePath);
  return base;
}

export function restoreDocumentToKnowledgeBase(
  id: string,
  documentId: string,
  storePath: string = DEFAULT_STORE_FILE,
): KnowledgeBase {
  const docId = stringValue(documentId);
  if (!docId) {
    throw new KnowledgeBaseStoreError("documentId is required");
  }
  if (isSkillAssetDocumentId(docId)) {
    throw new KnowledgeBaseStoreError("skill assets cannot be restored into a knowledge base");
  }
  const store = readStore(storePath);
  const base = findBase(store, id);
  if (!base.recycledDocumentIds.includes(docId)) {
    throw new KnowledgeBaseStoreError("document is not in recycle bin");
  }
  base.recycledDocumentIds = base.recycledDocumentIds.filter((entry) => entry !== docId);
  if (!base.documentIds.includes(docId)) {
    base.documentIds.push(docId);
  }
  base.documentCount = base.documentIds.length;
  base.updatedAtMs = Date.now();
  writeStore(store, storePath);
  return base;
}

export function deleteDocumentFromKnowledgeBase(
  id: string,
  documentId: string,
  storePath: string = DEFAULT_STORE_FILE,
): KnowledgeBase {
  const docId = stringValue(documentId);
  if (!docId) {
    throw new KnowledgeBaseStoreError("documentId is required");
  }
  const store = readStore(storePath);
  const base = findBase(store, id);
  const hadActive = base.documentIds.includes(docId);
  const hadRecycled = base.recycledDocumentIds.includes(docId);
  if (!hadActive && !hadRecycled) {
    // Cabin-tree reserved/local-folder shells can be listed without membership.
    return base;
  }
  base.documentIds = base.documentIds.filter((entry) => entry !== docId);
  base.recycledDocumentIds = base.recycledDocumentIds.filter((entry) => entry !== docId);
  base.documentCount = base.documentIds.length;
  base.updatedAtMs = Date.now();
  writeStore(store, storePath);
  return base;
}
