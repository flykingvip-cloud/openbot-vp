/**
 * Idempotency for enterprise security writes.
 * Same key + same body returns the stored response. A different body conflicts
 * and does not run the write again.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";

export type IdempotencyRecord = {
  fingerprint: string;
  response: unknown;
};

export type IdempotencyStore = {
  get(key: string): Promise<IdempotencyRecord | null>;
  put(key: string, record: IdempotencyRecord): Promise<void>;
};

export function idempotencyStorageKey(parts: {
  tenantId: string;
  method: string;
  idempotencyKey: string;
}): string {
  return `${parts.tenantId}\n${parts.method}\n${parts.idempotencyKey}`;
}

export function fingerprintBody(body: unknown): string {
  return createHash("sha256").update(stableStringify(body)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).toSorted();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function createMemoryIdempotencyStore(): IdempotencyStore {
  const records = new Map<string, IdempotencyRecord>();
  return {
    async get(key) {
      return records.get(key) ?? null;
    },
    async put(key, record) {
      records.set(key, record);
    },
  };
}

type FileShape = {
  version: 1;
  records: Record<string, IdempotencyRecord>;
};

let writeLock: Promise<void> = Promise.resolve();

async function withWriteLock<T>(action: () => Promise<T>): Promise<T> {
  const previous = writeLock;
  let release = () => {};
  writeLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

function resolveIdempotencyPath(rootDir?: string): string {
  return path.join(rootDir ?? resolveStateDir(), "enterprise-security-idempotency.json");
}

export function createFileIdempotencyStore(rootDir?: string): IdempotencyStore {
  const filePath = resolveIdempotencyPath(rootDir);
  return {
    async get(key) {
      const loaded = await readJsonFile<FileShape>(filePath);
      return loaded?.records?.[key] ?? null;
    },
    async put(key, record) {
      await withWriteLock(async () => {
        const loaded = await readJsonFile<FileShape>(filePath);
        const records = { ...loaded?.records, [key]: record };
        await writeJsonAtomic(filePath, { version: 1, records } satisfies FileShape, {
          mode: 0o600,
          ensureDirMode: 0o700,
        });
      });
    },
  };
}

export async function withIdempotency<T>(params: {
  store: IdempotencyStore;
  key: string;
  fingerprint: string;
  conflict: T;
  produce: () => Promise<T>;
}): Promise<{ value: T; replayed: boolean }> {
  const existing = await params.store.get(params.key);
  if (existing) {
    if (existing.fingerprint === params.fingerprint) {
      return { value: existing.response as T, replayed: true };
    }
    return { value: params.conflict, replayed: false };
  }
  const value = await params.produce();
  await params.store.put(params.key, { fingerprint: params.fingerprint, response: value });
  return { value, replayed: false };
}
