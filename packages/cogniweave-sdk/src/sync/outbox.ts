import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CloudPromotionEnvelope } from "./promotion-envelope.js";

/**
 * CW2-P5-02 device-local SyncOutbox — lives under stateDir, never Data Space export.
 */

export type SyncOutboxOperation = "push" | "delete_tombstone";
export type SyncOutboxStatus = "pending" | "processing" | "done" | "failed";

export type SyncOutboxEntry = {
  id: string;
  atomId: string;
  operation: SyncOutboxOperation;
  tenantId: string;
  deviceId: string;
  envelope?: CloudPromotionEnvelope;
  atomVersion: number;
  status: SyncOutboxStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt?: string;
  lastError?: string;
};

export type SyncOutboxEnqueueInput = {
  atomId: string;
  operation: SyncOutboxOperation;
  tenantId: string;
  deviceId: string;
  atomVersion: number;
  envelope?: CloudPromotionEnvelope;
  now?: string;
};

export interface SyncOutbox {
  enqueue(input: SyncOutboxEnqueueInput): Promise<SyncOutboxEntry>;
  claimDue(limit: number, nowMs?: number): Promise<SyncOutboxEntry[]>;
  markDone(id: string): Promise<void>;
  markFailed(id: string, error: string, nextAttemptAt?: string): Promise<void>;
  get(id: string): Promise<SyncOutboxEntry | undefined>;
  list?(filter?: { status?: SyncOutboxStatus }): Promise<SyncOutboxEntry[]>;
}

export function resolveSyncOutboxDir(stateDir: string): string {
  return join(resolve(stateDir), "cogniweave", "outbox");
}

export function resolveSyncOutboxStorePath(stateDir: string): string {
  return join(resolveSyncOutboxDir(stateDir), "store.json");
}

export function buildSyncOutboxEntryId(input: {
  atomId: string;
  operation: SyncOutboxOperation;
  atomVersion: number;
}): string {
  const digest = createHash("sha256")
    .update(`${input.atomId}\0${input.operation}\0${input.atomVersion}`)
    .digest("hex")
    .slice(0, 24);
  return `sob_${digest}`;
}

function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

export class InMemorySyncOutbox implements SyncOutbox {
  private readonly entries = new Map<string, SyncOutboxEntry>();

  async enqueue(input: SyncOutboxEnqueueInput): Promise<SyncOutboxEntry> {
    const id = buildSyncOutboxEntryId(input);
    const existing = this.entries.get(id);
    if (existing && (existing.status === "pending" || existing.status === "done")) {
      return existing;
    }
    const ts = nowIso(input.now);
    const entry: SyncOutboxEntry = {
      id,
      atomId: input.atomId,
      operation: input.operation,
      tenantId: input.tenantId,
      deviceId: input.deviceId,
      envelope: input.envelope,
      atomVersion: input.atomVersion,
      status: "pending",
      attempts: 0,
      createdAt: ts,
      updatedAt: ts,
      nextAttemptAt: ts,
    };
    this.entries.set(id, entry);
    return entry;
  }

  async claimDue(limit: number, nowMs = Date.now()): Promise<SyncOutboxEntry[]> {
    const now = new Date(nowMs).toISOString();
    const due = [...this.entries.values()]
      .filter(
        (entry) =>
          (entry.status === "pending" || entry.status === "failed") &&
          (!entry.nextAttemptAt || entry.nextAttemptAt <= now),
      )
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit);
    for (const entry of due) {
      entry.status = "processing";
      entry.attempts += 1;
      entry.updatedAt = now;
      this.entries.set(entry.id, entry);
    }
    return due.map((entry) => ({ ...entry }));
  }

  async markDone(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    entry.status = "done";
    entry.updatedAt = nowIso();
    entry.lastError = undefined;
    this.entries.set(id, entry);
  }

  async markFailed(id: string, error: string, nextAttemptAt?: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    entry.status = "failed";
    entry.lastError = error;
    entry.nextAttemptAt = nextAttemptAt ?? nowIso();
    entry.updatedAt = nowIso();
    this.entries.set(id, entry);
  }

  async get(id: string): Promise<SyncOutboxEntry | undefined> {
    const entry = this.entries.get(id);
    return entry ? { ...entry } : undefined;
  }

  async list(filter?: { status?: SyncOutboxStatus }): Promise<SyncOutboxEntry[]> {
    let rows = [...this.entries.values()];
    if (filter?.status) {
      rows = rows.filter((entry) => entry.status === filter.status);
    }
    return rows.map((entry) => ({ ...entry }));
  }
}

type FileOutboxStore = { entries: SyncOutboxEntry[] };

export class FileSyncOutbox implements SyncOutbox {
  private readonly path: string;

  constructor(stateDir: string) {
    this.path = resolveSyncOutboxStorePath(stateDir);
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    try {
      readFileSync(this.path, "utf8");
    } catch {
      this.writeStore({ entries: [] });
    }
  }

  private readStore(): FileOutboxStore {
    try {
      const raw = readFileSync(this.path, "utf8");
      const parsed = JSON.parse(raw) as FileOutboxStore;
      return { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
    } catch {
      return { entries: [] };
    }
  }

  private writeStore(store: FileOutboxStore): void {
    const tmp = `${this.path}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path);
  }

  private mutate(mutator: (entries: SyncOutboxEntry[]) => void): void {
    const store = this.readStore();
    mutator(store.entries);
    this.writeStore(store);
  }

  async enqueue(input: SyncOutboxEnqueueInput): Promise<SyncOutboxEntry> {
    const id = buildSyncOutboxEntryId(input);
    const store = this.readStore();
    const existing = store.entries.find((entry) => entry.id === id);
    if (existing && (existing.status === "pending" || existing.status === "done")) {
      return existing;
    }
    const ts = nowIso(input.now);
    const entry: SyncOutboxEntry = {
      id,
      atomId: input.atomId,
      operation: input.operation,
      tenantId: input.tenantId,
      deviceId: input.deviceId,
      envelope: input.envelope,
      atomVersion: input.atomVersion,
      status: "pending",
      attempts: 0,
      createdAt: ts,
      updatedAt: ts,
      nextAttemptAt: ts,
    };
    this.mutate((entries) => {
      const idx = entries.findIndex((row) => row.id === id);
      if (idx >= 0) {
        entries[idx] = entry;
      } else {
        entries.push(entry);
      }
    });
    return entry;
  }

  async claimDue(limit: number, nowMs = Date.now()): Promise<SyncOutboxEntry[]> {
    const now = new Date(nowMs).toISOString();
    const claimed: SyncOutboxEntry[] = [];
    this.mutate((entries) => {
      const due = entries
        .filter(
          (entry) =>
            (entry.status === "pending" || entry.status === "failed") &&
            (!entry.nextAttemptAt || entry.nextAttemptAt <= now),
        )
        .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(0, limit);
      for (const entry of due) {
        entry.status = "processing";
        entry.attempts += 1;
        entry.updatedAt = now;
        claimed.push({ ...entry });
      }
    });
    return claimed;
  }

  async markDone(id: string): Promise<void> {
    this.mutate((entries) => {
      const entry = entries.find((row) => row.id === id);
      if (!entry) {
        return;
      }
      entry.status = "done";
      entry.updatedAt = nowIso();
      entry.lastError = undefined;
    });
  }

  async markFailed(id: string, error: string, nextAttemptAt?: string): Promise<void> {
    this.mutate((entries) => {
      const entry = entries.find((row) => row.id === id);
      if (!entry) {
        return;
      }
      entry.status = "failed";
      entry.lastError = error;
      entry.nextAttemptAt = nextAttemptAt ?? nowIso();
      entry.updatedAt = nowIso();
    });
  }

  async get(id: string): Promise<SyncOutboxEntry | undefined> {
    return this.readStore().entries.find((entry) => entry.id === id);
  }

  async list(filter?: { status?: SyncOutboxStatus }): Promise<SyncOutboxEntry[]> {
    let rows = this.readStore().entries;
    if (filter?.status) {
      rows = rows.filter((entry) => entry.status === filter.status);
    }
    return rows.map((entry) => ({ ...entry }));
  }
}
