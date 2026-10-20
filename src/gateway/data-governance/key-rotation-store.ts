/**
 * Durable P5-b key-service pointer and receipts. Unique by tenant.
 * Not a promotion store, not a P5 longevity bundle, not a grant registry.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveKeyRotationRoot } from "./paths.js";
import type {
  KeyGenerationRecord,
  KeyRetireReceipt,
  KeyRotationReceipt,
  RewrapReceipt,
} from "./types.js";

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 20;
const LOCK_MAX_ATTEMPTS = 250;

export type CoveredWrap = {
  generation: number;
  wrapKeyId: string;
  wrappedDek: string;
};

export type CoveredObject = {
  resourceId: string;
  tenantId: string;
  algorithm: "aes-256-gcm" | "aes-256-gcm-legacy";
  contentIv: string;
  contentTag: string;
  contentCiphertext: string;
  wraps: Record<string, CoveredWrap>;
};

export type TenantKeyService = {
  schemaVersion: 1;
  revision: number;
  tenantId: string;
  activeKeyGeneration: number;
  generations: Record<string, KeyGenerationRecord>;
  rotationReceipts: Record<string, KeyRotationReceipt>;
  rewrapReceipts: Record<string, RewrapReceipt>;
  retireReceipts: Record<string, KeyRetireReceipt>;
  objects: Record<string, CoveredObject>;
};

export type KeyStoreMutateResult<T> =
  | { ok: true; value: T; service: TenantKeyService }
  | { ok: false; error: string };

function sleep(ms: number): void {
  const buf = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buf, 0, 0, ms);
}

function withExclusiveLockSync(lockPath: string, fn: () => void): void {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      try {
        fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, "utf8");
        fn();
        return;
      } finally {
        fs.closeSync(fd);
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // raced unlock
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // raced unlock
      }
      sleep(LOCK_RETRY_MS);
    }
  }
  throw new Error("key_rotation_lock_timeout");
}

function storePathFor(stateDir: string, tenantId: string): string {
  return path.join(resolveKeyRotationRoot(stateDir), tenantId, "key-service.json");
}

function writeFileDurable(storePath: string, file: object): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const payload = `${JSON.stringify(file, null, 2)}\n`;
  const tmp = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, payload, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, storePath);
}

export function emptyTenantKeyService(tenantId: string): TenantKeyService {
  const wrapKeyId = `wrap:platform_tenant:${tenantId}:g1`;
  return {
    schemaVersion: 1,
    revision: 0,
    tenantId,
    activeKeyGeneration: 1,
    generations: {
      "1": { generation: 1, state: "active", wrapKeyId },
    },
    rotationReceipts: {},
    rewrapReceipts: {},
    retireReceipts: {},
    objects: {},
  };
}

export function readTenantKeyService(params: {
  stateDir: string;
  tenantId: string;
}): TenantKeyService | null {
  const storePath = storePathFor(params.stateDir, params.tenantId);
  if (!fs.existsSync(storePath)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as TenantKeyService;
  if (
    parsed?.schemaVersion !== 1 ||
    parsed.tenantId !== params.tenantId ||
    typeof parsed.revision !== "number" ||
    typeof parsed.activeKeyGeneration !== "number"
  ) {
    throw new Error("key_generation_corrupt");
  }
  return parsed;
}

export function mutateTenantKeyService<T>(params: {
  stateDir: string;
  tenantId: string;
  fn: (
    service: TenantKeyService,
  ) => { ok: true; value: T; service: TenantKeyService } | { ok: false; error: string };
}): KeyStoreMutateResult<T> {
  const storePath = storePathFor(params.stateDir, params.tenantId);
  let outcome: KeyStoreMutateResult<T> | null = null;
  withExclusiveLockSync(`${storePath}.lock`, () => {
    const current = readTenantKeyService(params) ?? emptyTenantKeyService(params.tenantId);
    const next = params.fn(current);
    if (!next.ok) {
      outcome = next;
      return;
    }
    const written: TenantKeyService = {
      ...next.service,
      schemaVersion: 1,
      tenantId: params.tenantId,
      revision: current.revision + 1,
    };
    writeFileDurable(storePath, written);
    outcome = { ok: true, value: next.value, service: written };
  });
  return outcome ?? { ok: false, error: "key_generation_corrupt" };
}
