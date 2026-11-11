import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createConnection, createServer, type Server } from "node:net";
import { dirname, join } from "node:path";
import { ExecConfigError } from "./errors.js";
import type {
  ExecLeaseRecord,
  ExecReconcileAudit,
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
  };
}

const LOCK_SOCK_NAME = "store.lock.sock";

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
  };
  for (const task of Object.values(snapshot.tasks)) {
    if (typeof task.stateVersion !== "number" || !Number.isInteger(task.stateVersion)) {
      task.stateVersion = 0;
    }
  }
  return snapshot;
}

function reconcileIndexKey(tenantId: string, reconcileRequestId: string): string {
  return `${tenantId}\u0000${reconcileRequestId}`;
}

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
    try {
      const raw = await readFile(this.indexPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<ExecStoreSnapshot>;
      this.snapshot = normalizeLoadedSnapshot(parsed);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
      this.snapshot = emptySnapshot();
    }
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

  incrementProbe(probeId: string): number {
    const current = this.data().probes[probeId] ?? 0;
    const next = current + 1;
    this.data().probes[probeId] = next;
    this.committed.probes[probeId] = next;
    return next;
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
    });
    params.task.stateVersion = nextVersion;
    params.audit.newStateVersion = nextVersion;
    params.index.newStateVersion = nextVersion;
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
