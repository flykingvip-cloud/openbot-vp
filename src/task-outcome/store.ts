import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  BudgetCallBinding,
  CommittedSpend,
  OutcomeOutboxEvent,
  TaskOutcomeRecord,
} from "./types.js";

export type TaskOutcomeStorePaths = {
  rootDir: string;
};

export type CommitBundle = {
  commitId: string;
  taskId: string;
  expectedVersion: number;
  record: TaskOutcomeRecord;
  events: OutcomeOutboxEvent[];
  createdAt: string;
  /**
   * Optional command idempotency record applied in the same materialization boundary.
   * commitId is omitted on logs written before command receipts. Do not backfill it.
   */
  commandLog?: {
    commandId: string;
    digest: string;
    taskId: string;
    outcomeVersion: number;
    commitId?: string | null;
    snapshotFingerprint?: string;
    committedSpend?: CommittedSpend | null;
    commandDisposition?: "applied" | "replayed" | "no_effect";
    callBinding?: BudgetCallBinding | null;
  };
};

export type DurableProjection = {
  successCount: number;
  failureCount: number;
  cancelledCount: number;
  applied: Array<{ taskId: string; outcomeVersion: number; judgement: string }>;
};

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function atomicWriteJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  const fd = fs.openSync(tmp, "r+");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

function readJson<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function sleepMs(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  Atomics.wait(ia, 0, 0, ms);
}

/**
 * File-backed durable store.
 * Commits are published as a single rename-visible bundle under `commits/`, then
 * materialized into tip + version snapshot + outbox. Reopen replays unapplied commits.
 * Per-task exclusive lock (`locks/<taskId>.lock`) serializes cross-process CAS.
 */

/** Cap URL-encoded path segments; hash when over max to avoid ENAMETOOLONG (CJK space ids). */
export function boundedOutcomePathSegment(raw: string, maxEncodedLen = 160): string {
  const encoded = encodeURIComponent(raw);
  if (encoded.length > maxEncodedLen) {
    return `h-${createHash("sha256").update(raw).digest("hex")}`;
  }
  return encoded;
}

export class DurableTaskOutcomeStore {
  readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    for (const d of [
      "tips",
      "versions",
      "commits",
      "commits-applied",
      "outbox",
      "consumers",
      "contributions",
      "projections",
      "locks",
      "command-log",
    ]) {
      ensureDir(path.join(rootDir, d));
    }
    this.recoverPendingCommits();
  }

  close(): void {
    // file-backed
  }

  tipPath(taskId: string): string {
    return path.join(this.rootDir, "tips", `${boundedOutcomePathSegment(taskId)}.json`);
  }

  versionPath(taskId: string, version: number): string {
    return path.join(
      this.rootDir,
      "versions",
      `${boundedOutcomePathSegment(taskId)}__v${version}.json`,
    );
  }

  loadTask(taskId: string): TaskOutcomeRecord | undefined {
    return readJson<TaskOutcomeRecord>(this.tipPath(taskId));
  }

  /** Immutable historical snapshot for payloadRef replay. */
  loadTaskVersion(taskId: string, version: number): TaskOutcomeRecord | undefined {
    return readJson<TaskOutcomeRecord>(this.versionPath(taskId, version));
  }

  listTaskIds(): string[] {
    return fs
      .readdirSync(path.join(this.rootDir, "tips"))
      .filter((n) => n.endsWith(".json"))
      .map((n) => {
        const stem = n.replace(/\.json$/, "");
        // Hashed segments are opaque keys (not reversible); keep as-is.
        if (stem.startsWith("h-") && /^h-[a-f0-9]{64}$/.test(stem)) {
          return stem;
        }
        try {
          return decodeURIComponent(stem);
        } catch {
          return stem;
        }
      });
  }

  /**
   * Cross-process exclusive lock for one task. Stale locks from dead pids are broken.
   */
  withTaskLock<T>(taskId: string, fn: () => T, opts?: { timeoutMs?: number }): T {
    const lockPath = path.join(this.rootDir, "locks", `${boundedOutcomePathSegment(taskId)}.lock`);
    const timeoutMs = opts?.timeoutMs ?? 10_000;
    const start = Date.now();
    let fd: number | undefined;
    while (fd === undefined) {
      try {
        fd = fs.openSync(lockPath, "wx");
        fs.writeFileSync(lockPath, `${process.pid}\n`, { flag: "w" });
      } catch {
        if (Date.now() - start > timeoutMs) {
          throw new Error(`task lock timeout for ${taskId}`);
        }
        try {
          const holder = Number(fs.readFileSync(lockPath, "utf8").trim());
          if (holder && holder !== process.pid) {
            try {
              process.kill(holder, 0);
            } catch {
              // dead holder
              try {
                fs.unlinkSync(lockPath);
              } catch {
                // race
              }
            }
          }
        } catch {
          // ignore
        }
        sleepMs(5);
      }
    }
    try {
      return fn();
    } finally {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Single commit boundary: publish commit bundle then materialize tip/versions/outbox.
   * Must be called under withTaskLock for the taskId.
   * Returns false on version conflict (tip.outcomeVersion !== expectedVersion).
   */
  commitBundle(input: {
    taskId: string;
    expectedVersion: number;
    record: TaskOutcomeRecord;
    events: OutcomeOutboxEvent[];
    commandLog?: {
      commandId: string;
      digest: string;
      taskId: string;
      outcomeVersion: number;
      snapshotFingerprint?: string;
      committedSpend?: CommittedSpend | null;
      commandDisposition?: "applied" | "replayed" | "no_effect";
      callBinding?: BudgetCallBinding | null;
    };
  }):
    | { ok: true; commitId: string }
    | { ok: false; code: "version_conflict"; current?: TaskOutcomeRecord } {
    const current = this.loadTask(input.taskId);
    const currentVersion = current?.outcomeVersion ?? 0;
    if (currentVersion !== input.expectedVersion) {
      return { ok: false, code: "version_conflict", current };
    }

    const commitId = `c_${randomUUID()}`;
    const bundle: CommitBundle = {
      commitId,
      taskId: input.taskId,
      expectedVersion: input.expectedVersion,
      record: input.record,
      events: input.events,
      createdAt: new Date().toISOString(),
      ...(input.commandLog
        ? {
            commandLog: {
              ...input.commandLog,
              // The id allocated for this commit. Never a guessed backfill.
              commitId,
            },
          }
        : {}),
    };

    const staging = path.join(this.rootDir, "commits", `${commitId}.staging.json`);
    const published = path.join(this.rootDir, "commits", `${commitId}.json`);
    atomicWriteJson(staging, bundle);
    fs.renameSync(staging, published);

    this.applyCommit(bundle);
    return { ok: true, commitId };
  }

  /**
   * Idempotent materialization of a published commit.
   * Never regresses tip: older commits only backfill missing version snapshots / outbox / command log.
   */
  applyCommit(bundle: CommitBundle): void {
    const appliedMarker = path.join(this.rootDir, "commits-applied", `${bundle.commitId}.json`);
    if (fs.existsSync(appliedMarker)) {
      return;
    }

    const versionFile = this.versionPath(bundle.taskId, bundle.record.outcomeVersion);
    if (!fs.existsSync(versionFile)) {
      atomicWriteJson(versionFile, bundle.record);
    }

    const tip = this.loadTask(bundle.taskId);
    const tipVersion = tip?.outcomeVersion ?? 0;
    if (!tip || tipVersion < bundle.record.outcomeVersion) {
      atomicWriteJson(this.tipPath(bundle.taskId), bundle.record);
    }
    // tipVersion > bundle: keep newer tip (do not regress)

    for (const ev of bundle.events) {
      const file = path.join(this.rootDir, "outbox", `${ev.eventId}.json`);
      if (!fs.existsSync(file)) {
        atomicWriteJson(file, { ...ev, processingStatus: "pending", attempts: 0 });
      }
    }

    if (bundle.commandLog) {
      const cmdPath = this.commandLogPath(bundle.commandLog.commandId);
      if (!fs.existsSync(cmdPath)) {
        const log = bundle.commandLog;
        const persisted: {
          commandId: string;
          digest: string;
          taskId: string;
          outcomeVersion: number;
          commitId?: string | null;
          snapshotFingerprint?: string;
          committedSpend?: CommittedSpend | null;
          commandDisposition?: "applied" | "replayed" | "no_effect";
          callBinding?: BudgetCallBinding | null;
        } = {
          commandId: log.commandId,
          digest: log.digest,
          taskId: log.taskId,
          outcomeVersion: log.outcomeVersion,
        };
        // Only logs that recorded a commit id keep one. Missing means legacy null.
        if (Object.prototype.hasOwnProperty.call(log, "commitId")) {
          persisted.commitId =
            typeof log.commitId === "string" && log.commitId ? log.commitId : null;
        }
        if (typeof log.snapshotFingerprint === "string" && log.snapshotFingerprint) {
          persisted.snapshotFingerprint = log.snapshotFingerprint;
        }
        if (log.committedSpend) {
          persisted.committedSpend = log.committedSpend;
        }
        if (
          log.commandDisposition === "applied" ||
          log.commandDisposition === "replayed" ||
          log.commandDisposition === "no_effect"
        ) {
          persisted.commandDisposition = log.commandDisposition;
        }
        if (
          log.callBinding &&
          log.callBinding.callId &&
          log.callBinding.evidenceId &&
          log.callBinding.usageFingerprint
        ) {
          persisted.callBinding = {
            callId: log.callBinding.callId,
            evidenceId: log.callBinding.evidenceId,
            usageFingerprint: log.callBinding.usageFingerprint,
          };
        }
        atomicWriteJson(cmdPath, persisted);
      }
    }

    atomicWriteJson(appliedMarker, {
      commitId: bundle.commitId,
      taskId: bundle.taskId,
      appliedAt: new Date().toISOString(),
      tipAdvanced:
        !tip || tipVersion < bundle.record.outcomeVersion
          ? bundle.record.outcomeVersion
          : tipVersion,
    });
  }

  /**
   * Replay unpublished materializations under per-task locks, oldest version first.
   * Safe when an older commit lost its applied marker after a newer tip exists.
   */
  recoverPendingCommits(): void {
    const dir = path.join(this.rootDir, "commits");
    const bundles: CommitBundle[] = [];
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json") || name.endsWith(".staging.json")) {
        continue;
      }
      const bundle = readJson<CommitBundle>(path.join(dir, name));
      if (bundle) {
        bundles.push(bundle);
      }
    }
    bundles.sort((a, b) => {
      const av = a.record.outcomeVersion - b.record.outcomeVersion;
      if (av !== 0) {
        return av;
      }
      return a.createdAt.localeCompare(b.createdAt);
    });
    const byTask = new Map<string, CommitBundle[]>();
    for (const b of bundles) {
      const list = byTask.get(b.taskId) ?? [];
      list.push(b);
      byTask.set(b.taskId, list);
    }
    for (const [taskId, list] of byTask) {
      this.withTaskLock(taskId, () => {
        for (const bundle of list) {
          this.applyCommit(bundle);
        }
      });
    }
  }

  /** @deprecated prefer commitBundle — kept for tests that only need direct writes */
  saveTask(record: TaskOutcomeRecord): void {
    atomicWriteJson(this.tipPath(record.taskId), record);
    atomicWriteJson(this.versionPath(record.taskId, record.outcomeVersion), record);
  }

  appendOutbox(event: OutcomeOutboxEvent): void {
    const file = path.join(this.rootDir, "outbox", `${event.eventId}.json`);
    atomicWriteJson(file, { ...event, processingStatus: "pending", attempts: 0 });
  }

  listPendingOutbox(): Array<OutcomeOutboxEvent & { processingStatus: string; attempts: number }> {
    return fs
      .readdirSync(path.join(this.rootDir, "outbox"))
      .filter((n) => n.endsWith(".json"))
      .map(
        (n) =>
          readJson<OutcomeOutboxEvent & { processingStatus: string; attempts: number }>(
            path.join(this.rootDir, "outbox", n),
          )!,
      )
      .filter((e) => e && e.processingStatus === "pending")
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  markOutboxDone(eventId: string): void {
    const file = path.join(this.rootDir, "outbox", `${eventId}.json`);
    const cur = readJson<Record<string, unknown>>(file);
    if (!cur) {
      return;
    }
    atomicWriteJson(file, { ...cur, processingStatus: "done" });
  }

  consumerKey(consumerId: string, eventId: string): string {
    return path.join(
      this.rootDir,
      "consumers",
      `${boundedOutcomePathSegment(consumerId)}__${boundedOutcomePathSegment(eventId)}.json`,
    );
  }

  hasConsumed(consumerId: string, eventId: string): boolean {
    return fs.existsSync(this.consumerKey(consumerId, eventId));
  }

  markConsumed(consumerId: string, eventId: string, meta: Record<string, unknown>): void {
    atomicWriteJson(this.consumerKey(consumerId, eventId), {
      consumerId,
      eventId,
      ...meta,
      consumedAt: new Date().toISOString(),
    });
  }

  contributionPath(scopeId: string, taskId: string): string {
    return path.join(
      this.rootDir,
      "contributions",
      `${boundedOutcomePathSegment(scopeId)}__${boundedOutcomePathSegment(taskId)}.json`,
    );
  }

  loadContribution(
    scopeId: string,
    taskId: string,
  ):
    | {
        outcomeVersion: number;
        judgement: string;
        eligibilityAttribution: string;
      }
    | undefined {
    return readJson(this.contributionPath(scopeId, taskId));
  }

  saveContribution(
    scopeId: string,
    taskId: string,
    value: {
      outcomeVersion: number;
      judgement: string;
      eligibilityAttribution: string;
      taskId?: string;
    },
  ): void {
    atomicWriteJson(this.contributionPath(scopeId, taskId), value);
  }

  projectionPath(consumerId: string): string {
    return path.join(this.rootDir, "projections", `${boundedOutcomePathSegment(consumerId)}.json`);
  }

  loadProjection(consumerId: string): DurableProjection {
    return (
      readJson<DurableProjection>(this.projectionPath(consumerId)) ?? {
        successCount: 0,
        failureCount: 0,
        cancelledCount: 0,
        applied: [],
      }
    );
  }

  saveProjection(consumerId: string, projection: DurableProjection): void {
    atomicWriteJson(this.projectionPath(consumerId), projection);
  }

  commandLogPath(commandId: string): string {
    // Avoid ENAMETOOLONG on macOS when commandId embeds long / CJK space session keys.
    return path.join(this.rootDir, "command-log", `${boundedOutcomePathSegment(commandId)}.json`);
  }

  loadCommand(commandId: string):
    | {
        digest: string;
        taskId: string;
        outcomeVersion: number;
        /** Null when the on-disk log has no commit id. Not inferred from the tip. */
        commitId: string | null;
        snapshotFingerprint: string | null;
        committedSpend: CommittedSpend | null;
        commandDisposition: "applied" | "replayed" | "no_effect" | null;
        callBinding: BudgetCallBinding | null;
      }
    | undefined {
    const raw = readJson<{
      digest?: string;
      taskId?: string;
      outcomeVersion?: number;
      commitId?: string | null;
      snapshotFingerprint?: string;
      committedSpend?: CommittedSpend | null;
      commandDisposition?: string;
      callBinding?: BudgetCallBinding | null;
    }>(this.commandLogPath(commandId));
    if (
      !raw ||
      typeof raw.digest !== "string" ||
      typeof raw.taskId !== "string" ||
      typeof raw.outcomeVersion !== "number"
    ) {
      return undefined;
    }
    return {
      digest: raw.digest,
      taskId: raw.taskId,
      outcomeVersion: raw.outcomeVersion,
      commitId: typeof raw.commitId === "string" && raw.commitId.length > 0 ? raw.commitId : null,
      snapshotFingerprint:
        typeof raw.snapshotFingerprint === "string" && raw.snapshotFingerprint
          ? raw.snapshotFingerprint
          : null,
      committedSpend: raw.committedSpend ?? null,
      commandDisposition:
        raw.commandDisposition === "applied" ||
        raw.commandDisposition === "replayed" ||
        raw.commandDisposition === "no_effect"
          ? raw.commandDisposition
          : null,
      callBinding:
        raw.callBinding &&
        typeof raw.callBinding.callId === "string" &&
        typeof raw.callBinding.evidenceId === "string" &&
        typeof raw.callBinding.usageFingerprint === "string"
          ? raw.callBinding
          : null,
    };
  }

  loadCommitBundle(commitId: string): CommitBundle | undefined {
    if (!commitId) {
      return undefined;
    }
    return readJson<CommitBundle>(path.join(this.rootDir, "commits", `${commitId}.json`));
  }

  saveCommand(
    commandId: string,
    value: { digest: string; taskId: string; outcomeVersion: number },
  ): void {
    atomicWriteJson(this.commandLogPath(commandId), value);
  }
}
