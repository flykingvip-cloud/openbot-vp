import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExecLeaseRecord, ExecRevocation, ExecTaskRecord } from "./types.js";

export type IdempotencyIndexRecord = {
  tenantId: string;
  idempotencyKey: string;
  taskId: string;
  intentCanonical: string;
  createdAtMs: number;
  expiresAtMs: number;
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
  };
}

export class FileExecStore {
  readonly dir: string;
  private readonly indexPath: string;
  private readonly artifactDir: string;
  private snapshot: ExecStoreSnapshot;
  private loaded = false;

  private persistChain: Promise<void> = Promise.resolve();

  constructor(dir: string) {
    this.dir = dir;
    this.indexPath = join(dir, "control.json");
    this.artifactDir = join(dir, "artifacts");
    this.snapshot = emptySnapshot();
  }

  async load(): Promise<ExecStoreSnapshot> {
    await mkdir(this.artifactDir, { recursive: true });
    try {
      const raw = await readFile(this.indexPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<ExecStoreSnapshot>;
      this.snapshot = {
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
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
      this.snapshot = emptySnapshot();
    }
    this.loaded = true;
    return this.snapshot;
  }

  data(): ExecStoreSnapshot {
    if (!this.loaded) {
      throw new Error("exec store must be load()ed before use");
    }
    return this.snapshot;
  }

  async persist(): Promise<void> {
    const run = async () => {
      await mkdir(dirname(this.indexPath), { recursive: true });
      const tmp = `${this.indexPath}.${process.pid}.${Date.now()}.tmp`;
      const payload = `${JSON.stringify(this.snapshot, null, 2)}\n`;
      await writeFile(tmp, payload, "utf8");
      await rename(tmp, this.indexPath);
    };
    this.persistChain = this.persistChain.then(run, run);
    await this.persistChain;
  }

  async upsertTask(record: ExecTaskRecord): Promise<void> {
    this.data().tasks[record.taskId] = record;
    await this.persist();
  }

  getTask(taskId: string): ExecTaskRecord | undefined {
    return this.data().tasks[taskId];
  }

  listTasks(): ExecTaskRecord[] {
    return Object.values(this.data().tasks);
  }

  async putIdempotency(record: IdempotencyIndexRecord): Promise<void> {
    const key = `${record.tenantId}\u0000${record.idempotencyKey}`;
    this.data().idempotency[key] = record;
    await this.persist();
  }

  getIdempotency(tenantId: string, idempotencyKey: string): IdempotencyIndexRecord | undefined {
    return this.data().idempotency[`${tenantId}\u0000${idempotencyKey}`];
  }

  async putLease(record: ExecLeaseRecord): Promise<void> {
    this.data().leases[record.hash] = record;
    await this.persist();
  }

  getLeaseByHash(hash: string): ExecLeaseRecord | undefined {
    return this.data().leases[hash];
  }

  async addRevocation(revocation: ExecRevocation): Promise<void> {
    this.data().revocations.push(revocation);
    await this.persist();
  }

  listRevocations(): ExecRevocation[] {
    return this.data().revocations;
  }

  incrementProbe(probeId: string): number {
    const current = this.data().probes[probeId] ?? 0;
    const next = current + 1;
    this.data().probes[probeId] = next;
    return next;
  }

  getProbe(probeId: string): number {
    return this.data().probes[probeId] ?? 0;
  }

  async appendJournal(entry: ExecutionJournalEntry): Promise<void> {
    this.data().executionJournal.push(entry);
    await this.persist();
  }

  async putArtifactBytes(meta: ArtifactMeta, bytes: Buffer): Promise<void> {
    const fileName = `${meta.artifactId}.bin`;
    const path = join(this.artifactDir, fileName);
    await writeFile(path, bytes);
    this.data().artifacts[meta.artifactId] = { ...meta, fileName };
    await this.persist();
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
}
