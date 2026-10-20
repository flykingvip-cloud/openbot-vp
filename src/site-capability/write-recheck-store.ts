/**
 * Idempotency ledger for SAR writes (R4).
 *
 * Keys are partitioned by tenant / user / binding + business key so multi-account
 * traffic with the same idempotencyKey cannot collide. Optional disk persistence
 * (atomic tmp+rename) survives process restart. Concurrent first submits use an
 * in-process lock plus an intent reservation so parallel callers do not double
 * apply; crash recovery restores confirmed receipts and never blind-replays.
 *
 * Honesty: fixture ledger persistence ≠ verified enterprise real write / R5.
 */

import fs from "node:fs";
import path from "node:path";
import type { SiteRunResult } from "./result.js";
import type { SarWriteEffect } from "./write-effect.js";

export const WRITE_LEDGER_SCHEMA = 1 as const;

export type WriteLedgerPartition = {
  tenantId: string;
  userId: string;
  bindingId: string;
  capabilityId: string;
  idempotencyKey: string;
};

export type WriteLedgerStatus = "intent" | "confirmed" | "unknown";

export type WriteLedgerEntry = {
  runId: string;
  idempotencyKey: string;
  capabilityId: string;
  version: string;
  artifactDigest: string;
  effect: SarWriteEffect;
  tenantId: string;
  userId: string;
  bindingId: string;
  payloadDigest: string;
  status: WriteLedgerStatus;
  noteId: string | null;
  contentDigest: string | null;
  evidenceRef: string;
  result: SiteRunResult;
};

export type WriteConfirmation = {
  confirmedFromRunId: string;
  idempotencyKey: string;
  capabilityId: string;
  artifactDigest: string;
  payloadDigest: string;
  contentDigest: string;
  noteId: string;
  replayed: false;
  tenantId: string;
  userId: string;
  bindingId: string;
};

export type RecheckDisposition =
  | { kind: "absent" }
  | { kind: "intent"; entry: WriteLedgerEntry }
  | { kind: "unknown"; entry: WriteLedgerEntry }
  | { kind: "confirmed"; entry: WriteLedgerEntry; confirmation: WriteConfirmation }
  | { kind: "digest_mismatch"; entry: WriteLedgerEntry }
  | { kind: "payload_conflict"; entry: WriteLedgerEntry };

export type WriteLedgerSnapshot = {
  schemaVersion: typeof WRITE_LEDGER_SCHEMA;
  entries: WriteLedgerEntry[];
  confirmations: WriteConfirmation[];
};

export type WriteRecheckStoreOptions = {
  /** When set, ledger leaves pure memory and reloads after process restart. */
  storeRoot?: string;
};

/** Partition key: tenant + user + binding + capability + idempotency. */
export function writeLedgerKey(partition: WriteLedgerPartition): string {
  return [
    partition.tenantId,
    partition.userId,
    partition.bindingId,
    partition.capabilityId,
    partition.idempotencyKey,
  ].join("\n");
}

export function partitionOf(entry: {
  tenantId: string;
  userId: string;
  bindingId: string;
  capabilityId: string;
  idempotencyKey: string;
}): WriteLedgerPartition {
  return {
    tenantId: entry.tenantId,
    userId: entry.userId,
    bindingId: entry.bindingId,
    capabilityId: entry.capabilityId,
    idempotencyKey: entry.idempotencyKey,
  };
}

/**
 * Prior write results are never blind-replayed.
 * Confirmation is a read of an existing receipt, not another dispatch.
 */
export function priorWriteMayBeReplayed(result: SiteRunResult): boolean {
  if (result.repair !== "none") {
    return false;
  }
  if (result.status === "unknown") {
    return false;
  }
  if (result.error?.retry === "not_ordinary" || result.error?.ordinaryFailure === false) {
    return false;
  }
  return false;
}

function ledgerPath(rootDir: string): string {
  return path.join(rootDir, "write-ledger.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function emptyWriteLedgerSnapshot(): WriteLedgerSnapshot {
  return { schemaVersion: WRITE_LEDGER_SCHEMA, entries: [], confirmations: [] };
}

/**
 * Load ledger snapshot. Missing / corrupt / wrong schema → empty (fail closed).
 * Orphan intents from a crash are kept as unknown so restart does not re-apply.
 */
export function loadWriteLedgerSnapshot(rootDir: string): WriteLedgerSnapshot {
  const file = ledgerPath(rootDir);
  if (!fs.existsSync(file)) {
    return emptyWriteLedgerSnapshot();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
    if (!isRecord(raw) || raw.schemaVersion !== WRITE_LEDGER_SCHEMA) {
      return emptyWriteLedgerSnapshot();
    }
    const entries = Array.isArray(raw.entries)
      ? (raw.entries as WriteLedgerEntry[]).map(normalizeLoadedEntry)
      : [];
    const confirmations = Array.isArray(raw.confirmations)
      ? (raw.confirmations as WriteConfirmation[])
      : [];
    return { schemaVersion: WRITE_LEDGER_SCHEMA, entries, confirmations };
  } catch {
    return emptyWriteLedgerSnapshot();
  }
}

function normalizeLoadedEntry(entry: WriteLedgerEntry): WriteLedgerEntry {
  // Crash mid-flight left an intent: treat as unknown so callers must recheck,
  // never blind-replay the side effect.
  if (entry.status === "intent") {
    return {
      ...entry,
      status: "unknown",
      noteId: entry.noteId ?? null,
      contentDigest: entry.contentDigest ?? null,
      result: {
        ...entry.result,
        status: "unknown",
        verification: "not_performed",
        repair: "none",
      },
    };
  }
  return {
    ...entry,
    result: { ...entry.result, repair: "none" },
  };
}

/** Atomic JSON write under rootDir (tmp + rename). */
export function saveWriteLedgerSnapshot(rootDir: string, snapshot: WriteLedgerSnapshot): void {
  fs.mkdirSync(rootDir, { recursive: true });
  const file = ledgerPath(rootDir);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const body: WriteLedgerSnapshot = {
    schemaVersion: WRITE_LEDGER_SCHEMA,
    entries: snapshot.entries,
    confirmations: snapshot.confirmations,
  };
  fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf-8");
  fs.renameSync(tmp, file);
}

export class WriteRecheckStore {
  private readonly attempts: WriteLedgerEntry[] = [];
  private readonly byRunId = new Map<string, WriteLedgerEntry>();
  private readonly latest = new Map<string, WriteLedgerEntry>();
  private readonly confirmations = new Map<string, WriteConfirmation>();
  private readonly storeRoot: string | undefined;
  /** In-process exclusive locks keyed by writeLedgerKey. */
  private readonly locks = new Map<string, Promise<void>>();

  constructor(options: WriteRecheckStoreOptions = {}) {
    this.storeRoot = options.storeRoot;
    if (this.storeRoot) {
      this.hydrate(loadWriteLedgerSnapshot(this.storeRoot));
    }
  }

  /** Run `fn` exclusively for one partition key (concurrent first submit). */
  async runExclusive<T>(partition: WriteLedgerPartition, fn: () => Promise<T>): Promise<T> {
    const key = writeLedgerKey(partition);
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(
      key,
      previous.then(() => gate),
    );
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Reserve an intent before applying a side effect.
   * Returns absent-style success when reserved; otherwise the existing disposition.
   */
  reserveIntent(entry: WriteLedgerEntry): { reserved: true } | RecheckDisposition {
    const key = writeLedgerKey(partitionOf(entry));
    const existing = this.latest.get(key);
    if (existing) {
      return this.disposition({
        ...partitionOf(entry),
        artifactDigest: entry.artifactDigest,
        payloadDigest: entry.payloadDigest,
      });
    }
    const snapshot: WriteLedgerEntry = {
      ...entry,
      status: "intent",
      noteId: null,
      contentDigest: null,
      result: { ...entry.result, repair: "none" },
    };
    this.attempts.push(snapshot);
    this.byRunId.set(snapshot.runId, snapshot);
    this.latest.set(key, snapshot);
    this.persist();
    return { reserved: true };
  }

  record(entry: WriteLedgerEntry): void {
    const key = writeLedgerKey(partitionOf(entry));
    const snapshot: WriteLedgerEntry = {
      ...entry,
      result: { ...entry.result, repair: "none" },
    };
    this.attempts.push(snapshot);
    this.byRunId.set(snapshot.runId, snapshot);
    this.latest.set(key, snapshot);
    if (snapshot.status === "confirmed" && snapshot.noteId && snapshot.contentDigest) {
      this.confirmations.set(key, {
        confirmedFromRunId: snapshot.runId,
        idempotencyKey: snapshot.idempotencyKey,
        capabilityId: snapshot.capabilityId,
        artifactDigest: snapshot.artifactDigest,
        payloadDigest: snapshot.payloadDigest,
        contentDigest: snapshot.contentDigest,
        noteId: snapshot.noteId,
        replayed: false,
        tenantId: snapshot.tenantId,
        userId: snapshot.userId,
        bindingId: snapshot.bindingId,
      });
    }
    this.persist();
  }

  /**
   * Mark a previously unknown attempt confirmed from a fixture receipt.
   * The original unknown result stays in the ledger.
   */
  confirm(input: {
    runId: string;
    idempotencyKey: string;
    capabilityId: string;
    artifactDigest: string;
    payloadDigest: string;
    noteId: string;
    contentDigest: string;
    tenantId: string;
    userId: string;
    bindingId: string;
  }): WriteConfirmation {
    const confirmation: WriteConfirmation = {
      confirmedFromRunId: input.runId,
      idempotencyKey: input.idempotencyKey,
      capabilityId: input.capabilityId,
      artifactDigest: input.artifactDigest,
      payloadDigest: input.payloadDigest,
      contentDigest: input.contentDigest,
      noteId: input.noteId,
      replayed: false,
      tenantId: input.tenantId,
      userId: input.userId,
      bindingId: input.bindingId,
    };
    this.confirmations.set(writeLedgerKey(partitionOf(input)), confirmation);
    this.persist();
    return { ...confirmation };
  }

  findByRunId(runId: string): WriteLedgerEntry | undefined {
    const found = this.byRunId.get(runId);
    return found ? { ...found, result: { ...found.result } } : undefined;
  }

  confirmationFor(partition: WriteLedgerPartition): WriteConfirmation | undefined {
    const found = this.confirmations.get(writeLedgerKey(partition));
    return found ? { ...found } : undefined;
  }

  disposition(
    input: WriteLedgerPartition & {
      artifactDigest: string;
      payloadDigest: string;
    },
  ): RecheckDisposition {
    const key = writeLedgerKey(input);
    const entry = this.latest.get(key);
    if (!entry) {
      return { kind: "absent" };
    }
    if (entry.artifactDigest !== input.artifactDigest) {
      return { kind: "digest_mismatch", entry };
    }
    if (entry.payloadDigest !== input.payloadDigest) {
      return { kind: "payload_conflict", entry };
    }
    const confirmation = this.confirmations.get(key);
    if (confirmation) {
      if (confirmation.payloadDigest !== input.payloadDigest) {
        return { kind: "payload_conflict", entry };
      }
      return { kind: "confirmed", entry, confirmation: { ...confirmation } };
    }
    if (entry.status === "intent") {
      return { kind: "intent", entry };
    }
    return { kind: "unknown", entry };
  }

  /** Test / diagnostics: count of recorded attempts (including intents). */
  attemptCount(): number {
    return this.attempts.length;
  }

  private hydrate(snapshot: WriteLedgerSnapshot): void {
    for (const entry of snapshot.entries) {
      const key = writeLedgerKey(partitionOf(entry));
      this.attempts.push(entry);
      this.byRunId.set(entry.runId, entry);
      this.latest.set(key, entry);
    }
    for (const confirmation of snapshot.confirmations) {
      this.confirmations.set(writeLedgerKey(partitionOf(confirmation)), { ...confirmation });
    }
    // Rebuild confirmations from confirmed entries when snapshot omitted them.
    for (const entry of snapshot.entries) {
      if (entry.status === "confirmed" && entry.noteId && entry.contentDigest) {
        const key = writeLedgerKey(partitionOf(entry));
        if (!this.confirmations.has(key)) {
          this.confirmations.set(key, {
            confirmedFromRunId: entry.runId,
            idempotencyKey: entry.idempotencyKey,
            capabilityId: entry.capabilityId,
            artifactDigest: entry.artifactDigest,
            payloadDigest: entry.payloadDigest,
            contentDigest: entry.contentDigest,
            noteId: entry.noteId,
            replayed: false,
            tenantId: entry.tenantId,
            userId: entry.userId,
            bindingId: entry.bindingId,
          });
        }
      }
    }
  }

  private persist(): void {
    if (!this.storeRoot) {
      return;
    }
    saveWriteLedgerSnapshot(this.storeRoot, {
      schemaVersion: WRITE_LEDGER_SCHEMA,
      entries: this.attempts.map((entry) => ({
        ...entry,
        result: { ...entry.result },
      })),
      confirmations: [...this.confirmations.values()].map((c) => ({ ...c })),
    });
  }
}
