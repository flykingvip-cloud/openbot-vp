import crypto from "node:crypto";
import path from "node:path";
import {
  readJsonFileWithFallback,
  withFileLock,
  writeJsonFileAtomically,
} from "openclaw/plugin-sdk/media-monitor";
import type {
  AuditEntry,
  MonitorEvent,
  MonitorLease,
  MonitorStoreData,
  MonitorTarget,
  NotificationOutboxRow,
} from "./types.js";

export const EMPTY_STORE: MonitorStoreData = {
  version: 1,
  targets: [],
  events: [],
  outbox: [],
  leases: [],
  audit: [],
};

export function resolveMonitorStorePath(stateDir: string): string {
  return path.join(stateDir, "plugins", "media-monitor", "store.json");
}

/** Soft caps for the MVP single-process JSON store (not a production DB). */
export const STORE_MAX_EVENTS = 5_000;
export const STORE_MAX_OUTBOX = 2_000;
export const STORE_MAX_AUDIT = 2_000;

function normalizeStore(raw: MonitorStoreData | null | undefined): MonitorStoreData {
  if (!raw || raw.version !== 1) {
    return structuredClone(EMPTY_STORE);
  }
  return {
    version: 1,
    targets: Array.isArray(raw.targets) ? raw.targets : [],
    events: Array.isArray(raw.events) ? raw.events : [],
    outbox: Array.isArray(raw.outbox) ? raw.outbox : [],
    leases: Array.isArray(raw.leases) ? raw.leases : [],
    audit: Array.isArray(raw.audit) ? raw.audit : [],
  };
}

/** Drop oldest events / terminal outbox / audit when soft caps are exceeded. */
export function pruneMonitorStore(data: MonitorStoreData): void {
  if (data.events.length > STORE_MAX_EVENTS) {
    data.events.splice(0, data.events.length - STORE_MAX_EVENTS);
  }
  if (data.outbox.length > STORE_MAX_OUTBOX) {
    const terminal = data.outbox
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.status === "sent" || row.status === "dead_letter");
    const overflow = data.outbox.length - STORE_MAX_OUTBOX;
    const dropIds = new Set(terminal.slice(0, Math.max(0, overflow)).map(({ row }) => row.id));
    if (dropIds.size > 0) {
      data.outbox = data.outbox.filter((row) => !dropIds.has(row.id));
    }
    if (data.outbox.length > STORE_MAX_OUTBOX) {
      data.outbox.splice(0, data.outbox.length - STORE_MAX_OUTBOX);
    }
  }
  if (data.audit.length > STORE_MAX_AUDIT) {
    data.audit.splice(0, data.audit.length - STORE_MAX_AUDIT);
  }
}

export async function readMonitorStore(storePath: string): Promise<MonitorStoreData> {
  const { value } = await readJsonFileWithFallback<MonitorStoreData>(storePath, EMPTY_STORE);
  return normalizeStore(value);
}

export async function writeMonitorStore(storePath: string, data: MonitorStoreData): Promise<void> {
  const normalized = normalizeStore(data);
  pruneMonitorStore(normalized);
  // Keep caller object in sync when it is the same reference.
  data.events = normalized.events;
  data.outbox = normalized.outbox;
  data.audit = normalized.audit;
  await writeJsonFileAtomically(storePath, normalized);
}

const STORE_LOCK_OPTIONS = {
  retries: {
    retries: 8,
    factor: 1.4,
    minTimeout: 10,
    maxTimeout: 250,
    randomize: true,
  },
  stale: 60_000,
} as const;

export async function withMonitorStore<T>(
  storePath: string,
  fn: (data: MonitorStoreData) => T | Promise<T>,
): Promise<T> {
  return await withFileLock(storePath, STORE_LOCK_OPTIONS, async () => {
    const data = await readMonitorStore(storePath);
    const result = await fn(data);
    await writeMonitorStore(storePath, data);
    return result;
  });
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export function nowIso(now = Date.now()): string {
  return new Date(now).toISOString();
}

export function findTarget(data: MonitorStoreData, targetId: string): MonitorTarget | undefined {
  return data.targets.find((t) => t.id === targetId);
}

export function assertTenantAccess(params: {
  target: MonitorTarget;
  tenantId?: string;
  agentId?: string;
}): void {
  if (params.tenantId && params.target.tenantId !== params.tenantId) {
    throw new Error("forbidden: tenant mismatch");
  }
  if (params.agentId && params.target.agentId !== params.agentId) {
    throw new Error("forbidden: agent mismatch");
  }
}

export function hasDedupeKey(data: MonitorStoreData, dedupeKey: string): boolean {
  return data.events.some((event) => event.dedupeKey === dedupeKey);
}

export function insertEventIfAbsent(
  data: MonitorStoreData,
  event: MonitorEvent,
): { inserted: boolean; event: MonitorEvent } {
  const existing = data.events.find((row) => row.dedupeKey === event.dedupeKey);
  if (existing) {
    return { inserted: false, event: existing };
  }
  data.events.push(event);
  return { inserted: true, event };
}

export function enqueueOutbox(
  data: MonitorStoreData,
  row: NotificationOutboxRow,
): NotificationOutboxRow {
  // Idempotent on eventId: one outbox row per event.
  const existing = data.outbox.find((item) => item.eventId === row.eventId);
  if (existing) {
    return existing;
  }
  data.outbox.push(row);
  return row;
}

export function pushAudit(
  data: MonitorStoreData,
  entry: Omit<AuditEntry, "id" | "at"> & { id?: string; at?: string },
): void {
  data.audit.push({
    id: entry.id ?? newId("audit"),
    at: entry.at ?? nowIso(),
    action: entry.action,
    targetId: entry.targetId,
    eventId: entry.eventId,
    tenantId: entry.tenantId,
    agentId: entry.agentId,
    detail: entry.detail,
  });
  if (data.audit.length > 2000) {
    data.audit.splice(0, data.audit.length - 2000);
  }
}

export function getLease(data: MonitorStoreData, targetId: string): MonitorLease | undefined {
  return data.leases.find((lease) => lease.targetId === targetId);
}

export function upsertLease(data: MonitorStoreData, lease: MonitorLease): void {
  const idx = data.leases.findIndex((row) => row.targetId === lease.targetId);
  if (idx >= 0) {
    data.leases[idx] = lease;
  } else {
    data.leases.push(lease);
  }
}

export function releaseLease(data: MonitorStoreData, targetId: string, owner: string): boolean {
  const idx = data.leases.findIndex((row) => row.targetId === targetId);
  if (idx < 0) {
    return true;
  }
  const current = data.leases[idx]!;
  if (current.leaseOwner !== owner) {
    return false;
  }
  data.leases.splice(idx, 1);
  return true;
}
