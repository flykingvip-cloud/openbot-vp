/**
 * Persistent Conversation Projection store under Data Root (rebuildable).
 */
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import { resolveDataRoot } from "../config/data-space.js";
import type { ConversationProjection, ProjectionStore } from "./projection.js";

export function resolveProjectionStoreDir(params: {
  cfg?: OpenBotConfig;
  dataRoot?: string;
}): string {
  const dataRoot = params.dataRoot ?? resolveDataRoot(params.cfg);
  return join(dataRoot, ".meta", "conversations", "projections");
}

export class FileProjectionStore implements ProjectionStore {
  constructor(private readonly rootDir: string) {}

  private projPath(conversationId: string): string {
    const safe = conversationId.replace(/[^a-zA-Z0-9._-]/g, "_");
    return join(this.rootDir, `${safe}.json`);
  }

  private dedupPath(conversationId: string): string {
    const safe = conversationId.replace(/[^a-zA-Z0-9._-]/g, "_");
    return join(this.rootDir, `${safe}.dedup`);
  }

  async get(conversationId: string): Promise<ConversationProjection | null> {
    try {
      const raw = await readFile(this.projPath(conversationId), "utf-8");
      return JSON.parse(raw) as ConversationProjection;
    } catch {
      return null;
    }
  }

  async save(projection: ConversationProjection, dedupKey: string): Promise<void> {
    const fp = this.projPath(projection.conversationId);
    await mkdir(dirname(fp), { recursive: true, mode: 0o700 });
    await writeFile(fp, `${JSON.stringify(projection, null, 2)}\n`, "utf-8");
    await writeFile(this.dedupPath(projection.conversationId), `${dedupKey}\n`, "utf-8");
  }

  async getDedupKey(conversationId: string): Promise<string | null> {
    try {
      const raw = await readFile(this.dedupPath(conversationId), "utf-8");
      return raw.trim() || null;
    } catch {
      return null;
    }
  }

  /** Hard-delete projection + dedup (purge DERIVED_DELETE). Idempotent. */
  async delete(conversationId: string): Promise<void> {
    await unlink(this.projPath(conversationId)).catch((err: NodeJS.ErrnoException) => {
      if (err?.code !== "ENOENT") {
        throw err;
      }
    });
    await unlink(this.dedupPath(conversationId)).catch((err: NodeJS.ErrnoException) => {
      if (err?.code !== "ENOENT") {
        throw err;
      }
    });
  }

  /** Absolute projection file path (VERIFY residual check). */
  resolvePath(conversationId: string): string {
    return this.projPath(conversationId);
  }
}

const fileStoreCache = new Map<string, FileProjectionStore>();

export function getFileProjectionStore(params: {
  cfg?: OpenBotConfig;
  dataRoot?: string;
}): FileProjectionStore {
  const dir = resolveProjectionStoreDir(params);
  const existing = fileStoreCache.get(dir);
  if (existing) {
    return existing;
  }
  const store = new FileProjectionStore(dir);
  fileStoreCache.set(dir, store);
  return store;
}

/** Test helper */
export function resetProjectionStoreCache(): void {
  fileStoreCache.clear();
}
