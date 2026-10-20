import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CloudPromotionEnvelope } from "./promotion-envelope.js";

/**
 * CW2-P5-03 Local Intelligence Mirror — device-local pull cache under stateDir.
 * Never part of portable Data Space export. Offline reads last good + freshness.
 */

export type MirrorFreshnessStatus = "fresh" | "stale" | "never_synced";

export type MirrorFreshness = {
  status: MirrorFreshnessStatus;
  lastPullAt?: string;
  lastSuccessAt?: string;
  cursor?: string;
  /** Age threshold used for fresh vs stale (ms). */
  maxAgeMs: number;
};

export type MirrorLiveEntry = {
  kind: "live";
  atomId: string;
  tenantId: string;
  envelope: CloudPromotionEnvelope;
  etag: string;
  pulledAt: string;
};

export type MirrorTombstoneEntry = {
  kind: "tombstone";
  atomId: string;
  tenantId: string;
  atomVersion: number;
  etag: string;
  pulledAt: string;
};

export type MirrorEntry = MirrorLiveEntry | MirrorTombstoneEntry;

export type MirrorPullBatchItem =
  | {
      kind: "live";
      envelope: CloudPromotionEnvelope;
      etag: string;
    }
  | {
      kind: "tombstone";
      atomId: string;
      atomVersion: number;
      etag: string;
    };

export type MirrorQueryFilter = {
  tenantId: string;
  workspaceId?: string;
  projectId?: string;
  agentId?: string;
  /** When true, include tombstones (default: live only). */
  includeTombstones?: boolean;
};

export interface LocalIntelligenceMirror {
  applyPullBatch(input: {
    tenantId: string;
    items: ReadonlyArray<MirrorPullBatchItem>;
    cursor?: string;
    now?: string;
  }): Promise<{ applied: number; skipped: number }>;
  markPullAttempt(input: {
    ok: boolean;
    cursor?: string;
    now?: string;
    error?: string;
  }): Promise<void>;
  query(filter: MirrorQueryFilter): Promise<MirrorEntry[]>;
  get(atomId: string): Promise<MirrorEntry | undefined>;
  getFreshness(nowMs?: number): Promise<MirrorFreshness>;
  getCursor(): Promise<string | undefined>;
}

export function resolveLocalMirrorDir(stateDir: string): string {
  return join(resolve(stateDir), "cogniweave", "mirror");
}

export function resolveLocalMirrorStorePath(stateDir: string): string {
  return join(resolveLocalMirrorDir(stateDir), "store.json");
}

export function buildMirrorEtag(input: {
  atomId: string;
  atomVersion: number;
  kind: "live" | "tombstone";
}): string {
  return createHash("sha256")
    .update(`${input.kind}\0${input.atomId}\0${input.atomVersion}`)
    .digest("hex")
    .slice(0, 24);
}

function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

function entryVersion(entry: MirrorEntry): number {
  return entry.kind === "live" ? entry.envelope.versioning.version : entry.atomVersion;
}

/**
 * Conflict rules (plan §10.5): tombstone wins; higher version wins; equal etag no-op.
 */
export function shouldApplyMirrorItem(
  existing: MirrorEntry | undefined,
  incoming: MirrorPullBatchItem,
): boolean {
  if (!existing) {
    return true;
  }
  if (incoming.kind === "tombstone") {
    if (existing.kind === "tombstone") {
      if (incoming.atomVersion !== existing.atomVersion) {
        return incoming.atomVersion > existing.atomVersion;
      }
      return incoming.etag !== existing.etag;
    }
    // Tombstone wins over live at same or higher version.
    return incoming.atomVersion >= entryVersion(existing);
  }
  if (existing.kind === "tombstone") {
    // Live cannot resurrect unless strictly newer than tombstone version.
    return incoming.envelope.versioning.version > existing.atomVersion;
  }
  const nextVersion = incoming.envelope.versioning.version;
  const prevVersion = existing.envelope.versioning.version;
  if (nextVersion !== prevVersion) {
    return nextVersion > prevVersion;
  }
  return incoming.etag !== existing.etag;
}

type MirrorStoreMeta = {
  cursor?: string;
  lastPullAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  maxAgeMs: number;
};

type MirrorStore = {
  meta: MirrorStoreMeta;
  entries: MirrorEntry[];
};

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function computeFreshness(meta: MirrorStoreMeta, nowMs: number): MirrorFreshness {
  if (!meta.lastSuccessAt) {
    return { status: "never_synced", maxAgeMs: meta.maxAgeMs, cursor: meta.cursor };
  }
  const successMs = Date.parse(meta.lastSuccessAt);
  const age = Number.isFinite(successMs) ? nowMs - successMs : Number.POSITIVE_INFINITY;
  // Failed pull after last success → stale (offline may still query last-good).
  const status: MirrorFreshnessStatus = meta.lastError || age > meta.maxAgeMs ? "stale" : "fresh";
  return {
    status,
    lastPullAt: meta.lastPullAt,
    lastSuccessAt: meta.lastSuccessAt,
    cursor: meta.cursor,
    maxAgeMs: meta.maxAgeMs,
  };
}

function toEntry(tenantId: string, item: MirrorPullBatchItem, pulledAt: string): MirrorEntry {
  if (item.kind === "tombstone") {
    return {
      kind: "tombstone",
      atomId: item.atomId,
      tenantId,
      atomVersion: item.atomVersion,
      etag: item.etag,
      pulledAt,
    };
  }
  return {
    kind: "live",
    atomId: item.envelope.atomId,
    tenantId,
    envelope: item.envelope,
    etag: item.etag,
    pulledAt,
  };
}

export class InMemoryLocalIntelligenceMirror implements LocalIntelligenceMirror {
  private readonly entries = new Map<string, MirrorEntry>();
  private meta: MirrorStoreMeta;

  constructor(options?: { maxAgeMs?: number }) {
    this.meta = { maxAgeMs: options?.maxAgeMs ?? DEFAULT_MAX_AGE_MS };
  }

  async applyPullBatch(input: {
    tenantId: string;
    items: ReadonlyArray<MirrorPullBatchItem>;
    cursor?: string;
    now?: string;
  }): Promise<{ applied: number; skipped: number }> {
    const pulledAt = nowIso(input.now);
    let applied = 0;
    let skipped = 0;
    for (const item of input.items) {
      const atomId = item.kind === "live" ? item.envelope.atomId : item.atomId;
      const existing = this.entries.get(atomId);
      if (!shouldApplyMirrorItem(existing, item)) {
        skipped += 1;
        continue;
      }
      this.entries.set(atomId, toEntry(input.tenantId, item, pulledAt));
      applied += 1;
    }
    if (input.cursor !== undefined) {
      this.meta.cursor = input.cursor;
    }
    return { applied, skipped };
  }

  async markPullAttempt(input: {
    ok: boolean;
    cursor?: string;
    now?: string;
    error?: string;
  }): Promise<void> {
    const ts = nowIso(input.now);
    this.meta.lastPullAt = ts;
    if (input.cursor !== undefined) {
      this.meta.cursor = input.cursor;
    }
    if (input.ok) {
      this.meta.lastSuccessAt = ts;
      this.meta.lastError = undefined;
    } else {
      this.meta.lastError = input.error;
    }
  }

  async query(filter: MirrorQueryFilter): Promise<MirrorEntry[]> {
    return [...this.entries.values()].filter((entry) => matchesFilter(entry, filter));
  }

  async get(atomId: string): Promise<MirrorEntry | undefined> {
    const entry = this.entries.get(atomId);
    return entry ? ({ ...entry } as MirrorEntry) : undefined;
  }

  async getFreshness(nowMs = Date.now()): Promise<MirrorFreshness> {
    return computeFreshness(this.meta, nowMs);
  }

  async getCursor(): Promise<string | undefined> {
    return this.meta.cursor;
  }
}

function matchesFilter(entry: MirrorEntry, filter: MirrorQueryFilter): boolean {
  if (entry.tenantId !== filter.tenantId) {
    return false;
  }
  if (!filter.includeTombstones && entry.kind === "tombstone") {
    return false;
  }
  if (entry.kind === "tombstone") {
    return true;
  }
  const scope = entry.envelope.scope;
  if (filter.workspaceId && scope.workspaceId !== filter.workspaceId) {
    return false;
  }
  if (filter.projectId && scope.projectId !== filter.projectId) {
    return false;
  }
  if (filter.agentId && scope.agentId !== filter.agentId) {
    return false;
  }
  return true;
}

export class FileLocalIntelligenceMirror implements LocalIntelligenceMirror {
  private readonly path: string;
  private readonly maxAgeMs: number;

  constructor(stateDir: string, options?: { maxAgeMs?: number }) {
    this.path = resolveLocalMirrorStorePath(stateDir);
    this.maxAgeMs = options?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    try {
      readFileSync(this.path, "utf8");
    } catch {
      this.writeStore({
        meta: { maxAgeMs: this.maxAgeMs },
        entries: [],
      });
    }
  }

  private readStore(): MirrorStore {
    try {
      const raw = readFileSync(this.path, "utf8");
      const parsed = JSON.parse(raw) as MirrorStore;
      return {
        meta: {
          maxAgeMs: parsed.meta?.maxAgeMs ?? this.maxAgeMs,
          cursor: parsed.meta?.cursor,
          lastPullAt: parsed.meta?.lastPullAt,
          lastSuccessAt: parsed.meta?.lastSuccessAt,
          lastError: parsed.meta?.lastError,
        },
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      };
    } catch {
      return { meta: { maxAgeMs: this.maxAgeMs }, entries: [] };
    }
  }

  private writeStore(store: MirrorStore): void {
    const tmp = `${this.path}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path);
  }

  async applyPullBatch(input: {
    tenantId: string;
    items: ReadonlyArray<MirrorPullBatchItem>;
    cursor?: string;
    now?: string;
  }): Promise<{ applied: number; skipped: number }> {
    const store = this.readStore();
    const pulledAt = nowIso(input.now);
    let applied = 0;
    let skipped = 0;
    const byId = new Map(store.entries.map((entry) => [entry.atomId, entry]));
    for (const item of input.items) {
      const atomId = item.kind === "live" ? item.envelope.atomId : item.atomId;
      const existing = byId.get(atomId);
      if (!shouldApplyMirrorItem(existing, item)) {
        skipped += 1;
        continue;
      }
      byId.set(atomId, toEntry(input.tenantId, item, pulledAt));
      applied += 1;
    }
    if (input.cursor !== undefined) {
      store.meta.cursor = input.cursor;
    }
    store.entries = [...byId.values()];
    this.writeStore(store);
    return { applied, skipped };
  }

  async markPullAttempt(input: {
    ok: boolean;
    cursor?: string;
    now?: string;
    error?: string;
  }): Promise<void> {
    const store = this.readStore();
    const ts = nowIso(input.now);
    store.meta.lastPullAt = ts;
    if (input.cursor !== undefined) {
      store.meta.cursor = input.cursor;
    }
    if (input.ok) {
      store.meta.lastSuccessAt = ts;
      store.meta.lastError = undefined;
    } else {
      store.meta.lastError = input.error;
    }
    this.writeStore(store);
  }

  async query(filter: MirrorQueryFilter): Promise<MirrorEntry[]> {
    return this.readStore().entries.filter((entry) => matchesFilter(entry, filter));
  }

  async get(atomId: string): Promise<MirrorEntry | undefined> {
    return this.readStore().entries.find((entry) => entry.atomId === atomId);
  }

  async getFreshness(nowMs = Date.now()): Promise<MirrorFreshness> {
    return computeFreshness(this.readStore().meta, nowMs);
  }

  async getCursor(): Promise<string | undefined> {
    return this.readStore().meta.cursor;
  }
}
