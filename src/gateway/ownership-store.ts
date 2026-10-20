import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../utils.js";

export type OwnershipSubjectKind = "agent" | "group";
export type OwnershipBindingStatus = "active" | "revoked" | "transferred";

export type OwnershipRecord = {
  id: string;
  tenantId: string;
  subjectKind: OwnershipSubjectKind;
  subjectId: string;
  positionId: string;
  positionLabel: string;
  createdByUserId: string;
  createdByUserLabel: string;
  currentManagerUserId: string;
  currentManagerLabel: string;
  bindingStatus: OwnershipBindingStatus;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  revokedByUserId?: string;
  revokedByUserLabel?: string;
  transferredAt?: string;
  transferredByUserId?: string;
  transferredByUserLabel?: string;
  notes?: string;
};

export type OwnershipStore = {
  version: 1;
  records: Record<string, OwnershipRecord>;
};

const STORE_DIR = path.join(CONFIG_DIR, "organization");
const STORE_FILE = path.join(STORE_DIR, "ownerships.json");

function ensureDir(): void {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath: string, data: unknown): void {
  ensureDir();
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function normalizeTenantId(value: string): string {
  return value.trim() || "001";
}

function normalizeText(value: string | null | undefined, fallback = ""): string {
  return (value ?? fallback).trim();
}

function makeOwnershipId(params: {
  tenantId: string;
  subjectKind: OwnershipSubjectKind;
  subjectId: string;
}): string {
  return `${params.tenantId}:${params.subjectKind}:${params.subjectId}`;
}

function loadStore(): OwnershipStore {
  return readJsonFile<OwnershipStore>(STORE_FILE, { version: 1, records: {} });
}

function saveStore(store: OwnershipStore): void {
  writeJsonFile(STORE_FILE, store);
}

export function listOwnershipRecords(): OwnershipRecord[] {
  return Object.values(loadStore().records);
}

export function findActiveOwnershipRecord(params: {
  tenantId: string;
  subjectKind: OwnershipSubjectKind;
  subjectId: string;
}): OwnershipRecord | null {
  const record = getOwnershipRecord(params);
  if (!record || record.bindingStatus === "revoked") {
    return null;
  }
  return record;
}

export function getOwnershipRecord(params: {
  tenantId: string;
  subjectKind: OwnershipSubjectKind;
  subjectId: string;
}): OwnershipRecord | null {
  const id = makeOwnershipId(params);
  return loadStore().records[id] ?? null;
}

export function upsertOwnershipRecord(params: {
  tenantId: string;
  subjectKind: OwnershipSubjectKind;
  subjectId: string;
  positionId: string;
  positionLabel: string;
  createdByUserId: string;
  createdByUserLabel: string;
  currentManagerUserId: string;
  currentManagerLabel: string;
  notes?: string;
}): OwnershipRecord {
  const store = loadStore();
  const id = makeOwnershipId(params);
  const now = new Date().toISOString();
  const previous = store.records[id];
  const record: OwnershipRecord = {
    id,
    tenantId: normalizeTenantId(params.tenantId),
    subjectKind: params.subjectKind,
    subjectId: normalizeText(params.subjectId),
    positionId: normalizeText(params.positionId),
    positionLabel: normalizeText(params.positionLabel, params.positionId),
    createdByUserId: normalizeText(params.createdByUserId),
    createdByUserLabel: normalizeText(params.createdByUserLabel, params.createdByUserId),
    currentManagerUserId: normalizeText(params.currentManagerUserId),
    currentManagerLabel: normalizeText(params.currentManagerLabel, params.currentManagerUserId),
    bindingStatus: previous?.bindingStatus === "revoked" ? "revoked" : "active",
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    ...(previous?.revokedAt ? { revokedAt: previous.revokedAt } : {}),
    ...(previous?.revokedByUserId ? { revokedByUserId: previous.revokedByUserId } : {}),
    ...(previous?.revokedByUserLabel ? { revokedByUserLabel: previous.revokedByUserLabel } : {}),
    ...(previous?.transferredAt ? { transferredAt: previous.transferredAt } : {}),
    ...(previous?.transferredByUserId ? { transferredByUserId: previous.transferredByUserId } : {}),
    ...(previous?.transferredByUserLabel
      ? { transferredByUserLabel: previous.transferredByUserLabel }
      : {}),
    ...(params.notes
      ? { notes: params.notes.trim() }
      : previous?.notes
        ? { notes: previous.notes }
        : {}),
  };
  store.records[id] = record;
  saveStore(store);
  return record;
}

export function revokeOwnershipRecord(params: {
  tenantId: string;
  subjectKind: OwnershipSubjectKind;
  subjectId: string;
  revokedByUserId: string;
  revokedByUserLabel: string;
  notes?: string;
}): OwnershipRecord | null {
  const store = loadStore();
  const id = makeOwnershipId(params);
  const current = store.records[id];
  if (!current) {
    return null;
  }
  const now = new Date().toISOString();
  const next: OwnershipRecord = {
    ...current,
    bindingStatus: "revoked",
    updatedAt: now,
    revokedAt: now,
    revokedByUserId: normalizeText(params.revokedByUserId),
    revokedByUserLabel: normalizeText(params.revokedByUserLabel, params.revokedByUserId),
    ...(params.notes ? { notes: params.notes.trim() } : {}),
  };
  store.records[id] = next;
  saveStore(store);
  return next;
}

export function transferOwnershipRecord(params: {
  tenantId: string;
  subjectKind: OwnershipSubjectKind;
  subjectId: string;
  newPositionId: string;
  newPositionLabel: string;
  transferredByUserId: string;
  transferredByUserLabel: string;
  newCurrentManagerUserId: string;
  newCurrentManagerLabel: string;
  notes?: string;
}): OwnershipRecord | null {
  const store = loadStore();
  const id = makeOwnershipId(params);
  const current = store.records[id];
  if (!current) {
    return null;
  }
  const now = new Date().toISOString();
  const next: OwnershipRecord = {
    ...current,
    positionId: normalizeText(params.newPositionId),
    positionLabel: normalizeText(params.newPositionLabel, params.newPositionId),
    currentManagerUserId: normalizeText(params.newCurrentManagerUserId),
    currentManagerLabel: normalizeText(
      params.newCurrentManagerLabel,
      params.newCurrentManagerUserId,
    ),
    bindingStatus: "transferred",
    updatedAt: now,
    transferredAt: now,
    transferredByUserId: normalizeText(params.transferredByUserId),
    transferredByUserLabel: normalizeText(
      params.transferredByUserLabel,
      params.transferredByUserId,
    ),
    ...(params.notes ? { notes: params.notes.trim() } : {}),
  };
  store.records[id] = next;
  saveStore(store);
  return next;
}
