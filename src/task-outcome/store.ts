import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { OutcomeOutboxEvent, TaskOutcomeRecord } from "./types.js";

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
    return path.join(this.rootDir, "tips", `${encodeURIComponent(taskId)}.json`);
  }

  versionPath(taskId: string, version: number): string {
    return path.join(this.rootDir, "versions", `${encodeURIComponent(taskId)}__v${version}.json`);
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
      .map((n) => decodeURIComponent(n.replace(/\.json$/, "")));
  }

  /**
   * Cross-process exclusive lock for one task. Stale locks from dead pids are broken.
   */
  withTaskLock<T>(taskId: string, fn: () => T, opts?: { timeoutMs?: number }): T {
    const lockPath = path.join(this.rootDir, "locks", `${encodeURIComponent(taskId)}.lock`);
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
    };

    const staging = path.join(this.rootDir, "commits", `${commitId}.staging.json`);
    const published = path.join(this.rootDir, "commits", `${commitId}.json`);
    atomicWriteJson(staging, bundle);
    fs.renameSync(staging, published);

    this.applyCommit(bundle);
    return { ok: true, commitId };
  }

  /** Idempotent materialization of a published commit. */
  applyCommit(bundle: CommitBundle): void {
    const appliedMarker = path.join(this.rootDir, "commits-applied", `${bundle.commitId}.json`);
    if (fs.existsSync(appliedMarker)) {
      return;
    }

    // Version snapshot first (immutable history for payloadRef).
    atomicWriteJson(this.versionPath(bundle.taskId, bundle.record.outcomeVersion), bundle.record);
    atomicWriteJson(this.tipPath(bundle.taskId), bundle.record);
    for (const ev of bundle.events) {
      const file = path.join(this.rootDir, "outbox", `${ev.eventId}.json`);
      if (!fs.existsSync(file)) {
        atomicWriteJson(file, { ...ev, processingStatus: "pending", attempts: 0 });
      }
    }
    atomicWriteJson(appliedMarker, {
      commitId: bundle.commitId,
      taskId: bundle.taskId,
      appliedAt: new Date().toISOString(),
    });
  }

  recoverPendingCommits(): void {
    const dir = path.join(this.rootDir, "commits");
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json") || name.endsWith(".staging.json")) {
        continue;
      }
      const bundle = readJson<CommitBundle>(path.join(dir, name));
      if (bundle) {
        this.applyCommit(bundle);
      }
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
      `${encodeURIComponent(consumerId)}__${encodeURIComponent(eventId)}.json`,
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
      `${encodeURIComponent(scopeId)}__${encodeURIComponent(taskId)}.json`,
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
    return path.join(this.rootDir, "projections", `${encodeURIComponent(consumerId)}.json`);
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
    return path.join(this.rootDir, "command-log", `${encodeURIComponent(commandId)}.json`);
  }

  loadCommand(
    commandId: string,
  ): { digest: string; taskId: string; outcomeVersion: number } | undefined {
    return readJson(this.commandLogPath(commandId));
  }

  saveCommand(
    commandId: string,
    value: { digest: string; taskId: string; outcomeVersion: number },
  ): void {
    atomicWriteJson(this.commandLogPath(commandId), value);
  }
}
