import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createConnection, createServer, type Server } from "node:net";
import { dirname, join } from "node:path";
import { ExecConfigError } from "./errors.js";
import type {
  ExecLeaseRecord,
  ExecReconcileAudit,
  ExecReconcileSyncRecord,
  ExecRevocation,
  ExecTaskRecord,
} from "./types.js";

export type IdempotencyIndexRecord = {
  tenantId: string;
  idempotencyKey: string;
  taskId: string;
  intentCanonical: string;
  createdAtMs: number;
  expiresAtMs: number;
};

export type ReconcileIndexRecord = {
  tenantId: string;
  reconcileRequestId: string;
  taskId: string;
  conclusion: string;
  expectedStateVersion: number;
  evidenceKey: string;
  operator: string;
  at: string;
  atMs: number;
  previousState: string;
  newState: string;
  reason: string;
  previousStateVersion: number;
  newStateVersion: number;
  conclusionDigest: string;
};

export type ArtifactMeta = {
  artifactId: string;
  taskId: string;
  toolCallId: string;
  tenantId: string;
  sha256: string;
  byteCount: number;
  fileName: string;
};

export type ExecutionJournalEntry = {
  atMs: number;
  at: string;
  taskId: string;
  role: "control-plane" | "execution-site";
  event: string;
};

export type ExecStoreSnapshot = {
  tasks: Record<string, ExecTaskRecord>;
  idempotency: Record<string, IdempotencyIndexRecord>;
  leases: Record<string, ExecLeaseRecord>;
  revocations: ExecRevocation[];
  probes: Record<string, number>;
  artifacts: Record<string, ArtifactMeta>;
  executionJournal: ExecutionJournalEntry[];
  hostCommands: Array<{ reason: string; atMs: number; taskId?: string }>;
  reconcileAudits: ExecReconcileAudit[];
  reconcileIndex: Record<string, ReconcileIndexRecord>;
  reconcileSync: Record<string, ExecReconcileSyncRecord>;
};

function emptySnapshot(): ExecStoreSnapshot {
  return {
    tasks: {},
    idempotency: {},
    leases: {},
    revocations: [],
    probes: {},
    artifacts: {},
    executionJournal: [],
    hostCommands: [],
    reconcileAudits: [],
    reconcileIndex: {},
    reconcileSync: {},
  };
}

/**
 * Unix-domain socket used as a single-writer fence. Validated only on a
 * local POSIX filesystem (see store-lock-recovery tests for `df -T` /
 * `findmnt` of the test directory). NOT validated for NFS, SMB, or other
 * shared/network filesystems and must not be used there until tested.
 */
export const STORE_LOCK_SOCK_NAME = "store.lock.sock";
const LOCK_SOCK_NAME = STORE_LOCK_SOCK_NAME;
const CONTROL_JSON_NAME = "control.json";

function listenLock(path: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ path }, () => resolve(server));
  });
}

function isLockHeld(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ path });
    const finish = (held: boolean) => {
      socket.removeAllListeners();
      socket.on("error", () => undefined);
      socket.destroy();
      resolve(held);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function cloneSnapshot(snapshot: ExecStoreSnapshot): ExecStoreSnapshot {
  return structuredClone(snapshot);
}

function normalizeLoadedSnapshot(parsed: Partial<ExecStoreSnapshot>): ExecStoreSnapshot {
  const snapshot: ExecStoreSnapshot = {
    ...emptySnapshot(),
    ...parsed,
    tasks: parsed.tasks ?? {},
    idempotency: parsed.idempotency ?? {},
    leases: parsed.leases ?? {},
    revocations: parsed.revocations ?? [],
    probes: parsed.probes ?? {},
    artifacts: parsed.artifacts ?? {},
    executionJournal: parsed.executionJournal ?? [],
    hostCommands: parsed.hostCommands ?? [],
    reconcileAudits: parsed.reconcileAudits ?? [],
    reconcileIndex: parsed.reconcileIndex ?? {},
    reconcileSync: parsed.reconcileSync ?? {},
  };
  for (const task of Object.values(snapshot.tasks)) {
    if (typeof task.stateVersion !== "number" || !Number.isInteger(task.stateVersion)) {
      task.stateVersion = 0;
    }
  }
  for (const entry of Object.values(snapshot.reconcileIndex)) {
    if (typeof entry.conclusionDigest !== "string") {
      entry.conclusionDigest = "";
    }
  }
  return snapshot;
}

function reconcileIndexKey(tenantId: string, reconcileRequestId: string): string {
  return `${tenantId}\u0000${reconcileRequestId}`;
}

function isControlTmpName(name: string): boolean {
  return name.startsWith(`${CONTROL_JSON_NAME}.`) && name.endsWith(".tmp");
}

async function tryParseSnapshotFile(path: string): Promise<ExecStoreSnapshot | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return normalizeLoadedSnapshot(parsed as Partial<ExecStoreSnapshot>);
  } catch {
    return undefined;
  }
}

/**
 * Test-only helper for crash / partial-write simulation. Tests must not
 * edit store files directly except through this helper.
 */
export async function injectTornPersistForTest(
  dir: string,
  options: {
    tornControlContents?: string;
    removeControl?: boolean;
    completeTmpSnapshot?: ExecStoreSnapshot;
    tmpFileName?: string;
  },
): Promise<{ controlPath: string; tmpPath?: string }> {
  await mkdir(dir, { recursive: true });
  const controlPath = join(dir, CONTROL_JSON_NAME);
  if (options.removeControl) {
    try {
      await unlink(controlPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  } else if (options.tornControlContents !== undefined) {
    await writeFile(controlPath, options.tornControlContents, "utf8");
  }
  let tmpPath: string | undefined;
  if (options.completeTmpSnapshot) {
    const tmpFileName = options.tmpFileName ?? `${CONTROL_JSON_NAME}.crash.${Date.now()}.tmp`;
    tmpPath = join(dir, tmpFileName);
    await writeFile(tmpPath, `${JSON.stringify(options.completeTmpSnapshot, null, 2)}\n`, "utf8");
  }
  return { controlPath, tmpPath };
}

/**
 * File-backed exec store with a process-local single-writer lock.
 *
 * The lock and persist path are validated on a local POSIX filesystem
 * only (typically Linux ext4/xfs/overlay on the isolation box). They are
 * NOT validated on shared or network filesystems (NFS, SMB, etc.) and
 * must not be used there until tested. `KeyedLock` / `persistChain` are
 * also in-process and are not a cross-process idempotency protocol.
 */
export class FileExecStore {
  readonly dir: string;
  private readonly indexPath: string;
  private readonly artifactDir: string;
  private readonly lockPath: string;
  private snapshot: ExecStoreSnapshot;
  private committed: ExecStoreSnapshot;
  private loaded = false;
  private lockServer: Server | undefined;
  private persistChain: Promise<void> = Promise.resolve();
  private failPersistRemaining = 0;

  constructor(dir: string) {
    this.dir = dir;
    this.indexPath = join(dir, "control.json");
    this.artifactDir = join(dir, "artifacts");
    this.lockPath = join(dir, LOCK_SOCK_NAME);
    this.snapshot = emptySnapshot();
    this.committed = emptySnapshot();
  }

  async load(): Promise<ExecStoreSnapshot> {
    await mkdir(this.artifactDir, { recursive: true });
    await this.acquireStoreLock();
    if (this.loaded) {
      return this.snapshot;
    }
    this.snapshot = await this.loadSnapshotFromDisk();
    this.committed = cloneSnapshot(this.snapshot);
    this.loaded = true;
    return this.snapshot;
  }

  async close(): Promise<void> {
    this.loaded = false;
    this.snapshot = emptySnapshot();
    this.committed = emptySnapshot();
    const server = this.lockServer;
    this.lockServer = undefined;
    if (!server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    try {
      await unlink(this.lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  data(): ExecStoreSnapshot {
    if (!this.loaded) {
      throw new Error("exec store must be load()ed before use");
    }
    return this.snapshot;
  }

  failNextPersist(count = 1): void {
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error("failNextPersist count must be a positive integer");
    }
    this.failPersistRemaining += count;
  }

  async persist(): Promise<void> {
    const run = async () => {
      if (this.failPersistRemaining > 0) {
        this.failPersistRemaining -= 1;
        throw new Error("injected persist failure");
      }
      await mkdir(dirname(this.indexPath), { recursive: true });
      const tmp = `${this.indexPath}.${process.pid}.${Date.now()}.tmp`;
      const payload = `${JSON.stringify(this.snapshot, null, 2)}\n`;
      await writeFile(tmp, payload, "utf8");
      await rename(tmp, this.indexPath);
      this.committed = cloneSnapshot(this.snapshot);
    };
    this.persistChain = this.persistChain.then(run, run);
    await this.persistChain;
  }

  async upsertTask(record: ExecTaskRecord): Promise<void> {
    const previous = this.committed.tasks[record.taskId];
    const nextVersion = (previous?.stateVersion ?? 0) + 1;
    await this.commitMutation((next) => {
      next.tasks[record.taskId] = structuredClone({ ...record, stateVersion: nextVersion });
    });
    record.stateVersion = nextVersion;
  }

  getTask(taskId: string): ExecTaskRecord | undefined {
    return this.data().tasks[taskId];
  }

  listTasks(): ExecTaskRecord[] {
    return Object.values(this.data().tasks);
  }

  async putIdempotency(record: IdempotencyIndexRecord): Promise<void> {
    const key = `${record.tenantId}\u0000${record.idempotencyKey}`;
    await this.commitMutation((next) => {
      next.idempotency[key] = structuredClone(record);
    });
  }

  getIdempotency(tenantId: string, idempotencyKey: string): IdempotencyIndexRecord | undefined {
    return this.data().idempotency[`${tenantId}\u0000${idempotencyKey}`];
  }

  async putLease(record: ExecLeaseRecord): Promise<void> {
    await this.commitMutation((next) => {
      next.leases[record.hash] = structuredClone(record);
    });
  }

  getLeaseByHash(hash: string): ExecLeaseRecord | undefined {
    return this.data().leases[hash];
  }

  async addRevocation(revocation: ExecRevocation): Promise<void> {
    await this.commitMutation((next) => {
      next.revocations.push(structuredClone(revocation));
    });
  }

  listRevocations(): ExecRevocation[] {
    return this.data().revocations;
  }

  /**
   * Diagnostic isolation counter for `side-effect-probe` tests.
   *
   * This value does NOT participate in task state transitions, quota, or
   * success/failure determination. Those use `task.state`,
   * `sideEffectApplied`, and artifact checksums. A failed or delayed
   * probe persist must not by itself mark a task succeeded or failed, or
   * consume quota. The increment is a complete durable commit of the
   * counter only.
   */
  async incrementProbe(probeId: string): Promise<number> {
    let next = 0;
    await this.commitMutation((snapshot) => {
      next = (snapshot.probes[probeId] ?? 0) + 1;
      snapshot.probes[probeId] = next;
    });
    return next;
  }

  /**
   * Atomically persist a task mutation together with a diagnostic probe
   * increment. The probe count remains diagnostic-only; the task record
   * carries the protocol-relevant `sideEffectApplied` flag.
   */
  async commitTaskAndDiagnosticProbe(record: ExecTaskRecord, probeId: string): Promise<number> {
    const previous = this.committed.tasks[record.taskId];
    const nextVersion = (previous?.stateVersion ?? 0) + 1;
    let nextProbe = 0;
    await this.commitMutation((next) => {
      next.tasks[record.taskId] = structuredClone({ ...record, stateVersion: nextVersion });
      nextProbe = (next.probes[probeId] ?? 0) + 1;
      next.probes[probeId] = nextProbe;
    });
    record.stateVersion = nextVersion;
    return nextProbe;
  }

  getProbe(probeId: string): number {
    return this.data().probes[probeId] ?? 0;
  }

  async appendJournal(entry: ExecutionJournalEntry): Promise<void> {
    await this.commitMutation((next) => {
      next.executionJournal.push(structuredClone(entry));
    });
  }

  async putArtifactBytes(meta: ArtifactMeta, bytes: Buffer): Promise<void> {
    const fileName = meta.fileName || `${meta.artifactId}.bin`;
    const path = join(this.artifactDir, fileName);
    const existed = this.committed.artifacts[meta.artifactId];
    await writeFile(path, bytes);
    try {
      await this.commitMutation((next) => {
        next.artifacts[meta.artifactId] = structuredClone({ ...meta, fileName });
      });
    } catch (error) {
      if (!existed) {
        try {
          await unlink(path);
        } catch {
          // The snapshot rollback is authoritative; a leftover file is not a success state.
        }
      }
      throw error;
    }
  }

  async getArtifactBytes(
    artifactId: string,
  ): Promise<{ meta: ArtifactMeta; bytes: Buffer } | undefined> {
    const meta = this.data().artifacts[artifactId];
    if (!meta) {
      return undefined;
    }
    const bytes = await readFile(join(this.artifactDir, meta.fileName));
    return { meta, bytes };
  }

  getArtifactMeta(artifactId: string): ArtifactMeta | undefined {
    return this.data().artifacts[artifactId];
  }

  getReconcileIndex(
    tenantId: string,
    reconcileRequestId: string,
  ): ReconcileIndexRecord | undefined {
    return this.data().reconcileIndex[reconcileIndexKey(tenantId, reconcileRequestId)];
  }

  listReconcileAudits(taskId?: string): ExecReconcileAudit[] {
    const audits = this.data().reconcileAudits;
    if (!taskId) {
      return audits;
    }
    return audits.filter((entry) => entry.taskId === taskId);
  }

  async commitReconcile(params: {
    task: ExecTaskRecord;
    audit: ExecReconcileAudit;
    index: ReconcileIndexRecord;
    sync?: ExecReconcileSyncRecord;
  }): Promise<void> {
    const previous = this.committed.tasks[params.task.taskId];
    const nextVersion = (previous?.stateVersion ?? 0) + 1;
    const key = reconcileIndexKey(params.index.tenantId, params.index.reconcileRequestId);
    await this.commitMutation((next) => {
      const storedTask = structuredClone({ ...params.task, stateVersion: nextVersion });
      const storedAudit = structuredClone({
        ...params.audit,
        newStateVersion: nextVersion,
      });
      const storedIndex = structuredClone({
        ...params.index,
        newStateVersion: nextVersion,
      });
      next.tasks[params.task.taskId] = storedTask;
      next.reconcileAudits.push(storedAudit);
      next.reconcileIndex[key] = storedIndex;
      if (params.sync) {
        const storedSync = structuredClone({
          ...params.sync,
          aStateVersionAtCommit: nextVersion,
        });
        next.reconcileSync[key] = storedSync;
      }
    });
    params.task.stateVersion = nextVersion;
    params.audit.newStateVersion = nextVersion;
    params.index.newStateVersion = nextVersion;
    if (params.sync) {
      params.sync.aStateVersionAtCommit = nextVersion;
    }
  }

  getReconcileSync(
    tenantId: string,
    reconcileRequestId: string,
  ): ExecReconcileSyncRecord | undefined {
    return this.data().reconcileSync[reconcileIndexKey(tenantId, reconcileRequestId)];
  }

  listReconcileSyncs(taskId?: string): ExecReconcileSyncRecord[] {
    const records = Object.values(this.data().reconcileSync);
    if (!taskId) {
      return records;
    }
    return records.filter((entry) => entry.taskId === taskId);
  }

  listPendingReconcileSyncs(): ExecReconcileSyncRecord[] {
    return this.listReconcileSyncs().filter((entry) => entry.syncState === "pending_sync");
  }

  latestReconcileSync(taskId: string): ExecReconcileSyncRecord | undefined {
    const records = this.listReconcileSyncs(taskId);
    if (records.length === 0) {
      return undefined;
    }
    return records.reduce((latest, entry) =>
      entry.committedAtMs >= latest.committedAtMs ? entry : latest,
    );
  }

  /**
   * Persist only the sync-record status. Does not change task.state or
   * task.stateVersion: A and B versions stay independently owned, and a
   * later remain_unconfirmed → closing reconcile still CASes against the
   * conclusion's A stateVersion.
   */
  async updateReconcileSync(record: ExecReconcileSyncRecord): Promise<void> {
    const key = reconcileIndexKey(record.tenantId, record.reconcileRequestId);
    await this.commitMutation((next) => {
      next.reconcileSync[key] = structuredClone(record);
    });
  }

  private async commitMutation(mutate: (next: ExecStoreSnapshot) => void): Promise<void> {
    const next = cloneSnapshot(this.committed);
    mutate(next);
    this.snapshot = next;
    try {
      await this.persist();
    } catch (error) {
      this.snapshot = cloneSnapshot(this.committed);
      throw error;
    }
  }

  private async loadSnapshotFromDisk(): Promise<ExecStoreSnapshot> {
    const primaryExists = await fileExists(this.indexPath);
    const primary = await tryParseSnapshotFile(this.indexPath);
    if (primary) {
      await this.discardStaleTmpFiles();
      return primary;
    }
    const recovered = await this.recoverFromTmpFiles();
    if (recovered) {
      return recovered;
    }
    if (!primaryExists) {
      return emptySnapshot();
    }
    throw new ExecConfigError(
      `exec store refused: control.json is torn or unreadable and no complete tmp snapshot could be recovered (${this.indexPath})`,
      [CONTROL_JSON_NAME],
    );
  }

  private async recoverFromTmpFiles(): Promise<ExecStoreSnapshot | undefined> {
    const tmpPaths = await this.listControlTmpPaths();
    const ranked: Array<{ path: string; mtimeMs: number }> = [];
    for (const path of tmpPaths) {
      try {
        const info = await stat(path);
        ranked.push({ path, mtimeMs: info.mtimeMs });
      } catch {
        // Skip tmp files that disappeared between readdir and stat.
      }
    }
    ranked.sort((left, right) => right.mtimeMs - left.mtimeMs);
    for (const entry of ranked) {
      const snapshot = await tryParseSnapshotFile(entry.path);
      if (!snapshot) {
        continue;
      }
      const recoveredTmp = `${this.indexPath}.recovered.${process.pid}.${Date.now()}.tmp`;
      await writeFile(recoveredTmp, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      await rename(recoveredTmp, this.indexPath);
      return snapshot;
    }
    return undefined;
  }

  private async discardStaleTmpFiles(): Promise<void> {
    for (const path of await this.listControlTmpPaths()) {
      try {
        await unlink(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }
  }

  private async listControlTmpPaths(): Promise<string[]> {
    try {
      const names = await readdir(this.dir);
      return names.filter(isControlTmpName).map((name) => join(this.dir, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async acquireStoreLock(): Promise<void> {
    if (this.lockServer) {
      return;
    }
    await mkdir(this.dir, { recursive: true });
    try {
      this.lockServer = await listenLock(this.lockPath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE") {
        throw error;
      }
    }
    const held = await isLockHeld(this.lockPath);
    if (held) {
      throw new ExecConfigError(
        `exec store refused: another process already holds this store (${this.lockPath})`,
        [LOCK_SOCK_NAME],
      );
    }
    try {
      await unlink(this.lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    try {
      this.lockServer = await listenLock(this.lockPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EADDRINUSE") {
        throw new ExecConfigError(
          `exec store refused: another process already holds this store (${this.lockPath})`,
          [LOCK_SOCK_NAME],
        );
      }
      throw error;
    }
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
