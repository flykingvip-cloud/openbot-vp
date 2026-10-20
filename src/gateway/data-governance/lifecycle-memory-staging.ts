/**
 * Durable staging for P2-c markdown_root/filesystem memory forget.
 *
 * Payload is fsync+renamed before meta (commit point). Canonical unlink is
 * allowed only after meta is durable. Staging is removed only after Catalog
 * CAS to purged (or leftover cleanup when already purged).
 */

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { isRecord } from "../records.js";
import { resolveMemoryForgetStagingRoot } from "./paths.js";
import { assertSafeRecoveryReceiptToken } from "./recovery-receipt.js";

export const MEMORY_FORGET_STAGING_SCHEMA_VERSION = 1 as const;
export const MEMORY_FORGET_STAGING_KIND = "memory_forget_filesystem" as const;

export type MemoryForgetStagingMeta = {
  schemaVersion: typeof MEMORY_FORGET_STAGING_SCHEMA_VERSION;
  kind: typeof MEMORY_FORGET_STAGING_KIND;
  operationId: string;
  resourceId: string;
  bindingId: string;
  locator: string;
  storageKind: "filesystem";
  canonicalKind: "markdown_root";
  contentSha256: string;
  byteLength: number;
  mode: number;
  uid: number;
  gid: number;
  mtimeMs: number;
};

export type MemoryForgetStagingRecord = {
  dir: string;
  payloadPath: string;
  metaPath: string;
  meta: MemoryForgetStagingMeta;
  payload: Buffer;
};

export function resolveMemoryForgetStagingPaths(params: {
  operationId: string;
  stateDir?: string;
}): { dir: string; payloadPath: string; metaPath: string } {
  const operationId = assertSafeRecoveryReceiptToken(params.operationId, "operationId");
  const root = resolveMemoryForgetStagingRoot(params.stateDir ?? resolveStateDir());
  const dir = path.resolve(root, operationId);
  const rel = path.relative(path.resolve(root), dir);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("invalid_memory_forget_staging_path");
  }
  return {
    dir,
    payloadPath: path.join(dir, "payload.bin"),
    metaPath: path.join(dir, "meta.json"),
  };
}

export function fingerprintBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Directory fsync is required for unlink/rename durability.
 * Unsupported platforms fail closed (`dir_fsync_failed:<label>:<code>`) so Catalog
 * cannot CAS to purged after a non-durable unlink. No silent swallow.
 */
export function fsyncDirectory(dir: string, label: string): void {
  try {
    const dirFd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "unknown";
    throw new Error(`dir_fsync_failed:${label}:${code}`, { cause: err });
  }
}

/**
 * mkdir -p, then fsync **parents** of every newly created directory.
 * Fsyncing the new directory itself does not persist its directory entry in the parent.
 */
export function mkdirDurableSync(dir: string): void {
  const resolved = path.resolve(dir);
  const parentsToFsync: string[] = [];
  let cursor = resolved;
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    parentsToFsync.push(parent);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  fs.mkdirSync(resolved, { recursive: true });
  const seen = new Set<string>();
  for (const parent of parentsToFsync) {
    if (seen.has(parent)) {
      continue;
    }
    seen.add(parent);
    fsyncDirectory(parent, "mkdir_parent");
  }
}

/** Write+fsync+rename; directory fsync after rename (throws if dir fsync fails). */
export function writeFileDurableSync(dest: string, data: Buffer | string, mode = 0o600): void {
  const resolved = path.resolve(dest);
  mkdirDurableSync(path.dirname(resolved));
  const tmp = `${resolved}.${process.pid}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, "w", mode);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, resolved);
  fsyncDirectory(path.dirname(resolved), "write_rename");
}

/**
 * Unlink then fsync the parent directory. Catalog may CAS to purged only after
 * this returns — a missing dir fsync must throw, not continue.
 */
export function unlinkFileDurable(target: string): void {
  const resolved = path.resolve(target);
  if (fs.existsSync(resolved)) {
    fs.unlinkSync(resolved);
  }
  fsyncDirectory(path.dirname(resolved), "canonical_unlink");
}

function parseMeta(raw: unknown): MemoryForgetStagingMeta | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (raw.schemaVersion !== MEMORY_FORGET_STAGING_SCHEMA_VERSION) {
    return null;
  }
  if (raw.kind !== MEMORY_FORGET_STAGING_KIND) {
    return null;
  }
  const {
    operationId,
    resourceId,
    bindingId,
    locator,
    storageKind,
    canonicalKind,
    contentSha256,
    byteLength,
    mode,
    uid,
    gid,
    mtimeMs,
  } = raw;
  if (
    typeof operationId !== "string" ||
    typeof resourceId !== "string" ||
    typeof bindingId !== "string" ||
    typeof locator !== "string" ||
    storageKind !== "filesystem" ||
    canonicalKind !== "markdown_root" ||
    typeof contentSha256 !== "string" ||
    typeof byteLength !== "number" ||
    typeof mode !== "number" ||
    typeof uid !== "number" ||
    typeof gid !== "number" ||
    typeof mtimeMs !== "number"
  ) {
    return null;
  }
  return {
    schemaVersion: MEMORY_FORGET_STAGING_SCHEMA_VERSION,
    kind: MEMORY_FORGET_STAGING_KIND,
    operationId,
    resourceId,
    bindingId,
    locator,
    storageKind,
    canonicalKind,
    contentSha256,
    byteLength,
    mode,
    uid,
    gid,
    mtimeMs,
  };
}

/**
 * Load a complete staging record. Incomplete / hash-mismatch / meta-mismatch
 * is treated as missing (fail closed — never guess success).
 */
export function loadMemoryForgetStaging(params: {
  operationId: string;
  resourceId: string;
  stateDir?: string;
}): MemoryForgetStagingRecord | null {
  const paths = resolveMemoryForgetStagingPaths(params);
  if (!fs.existsSync(paths.metaPath) || !fs.existsSync(paths.payloadPath)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(paths.metaPath, "utf8"));
  } catch {
    return null;
  }
  const meta = parseMeta(parsed);
  if (!meta) {
    return null;
  }
  if (meta.operationId !== params.operationId || meta.resourceId !== params.resourceId) {
    return null;
  }
  const payload = fs.readFileSync(paths.payloadPath);
  if (payload.byteLength !== meta.byteLength) {
    return null;
  }
  if (fingerprintBytes(payload) !== meta.contentSha256) {
    return null;
  }
  return { ...paths, meta, payload };
}

export function writeMemoryForgetStaging(params: {
  operationId: string;
  resourceId: string;
  bindingId: string;
  locator: string;
  payload: Buffer;
  mode: number;
  uid: number;
  gid: number;
  mtimeMs: number;
  stateDir?: string;
}): MemoryForgetStagingRecord {
  const paths = resolveMemoryForgetStagingPaths(params);
  mkdirDurableSync(paths.dir);
  const contentSha256 = fingerprintBytes(params.payload);
  writeFileDurableSync(paths.payloadPath, params.payload, 0o600);
  const meta: MemoryForgetStagingMeta = {
    schemaVersion: MEMORY_FORGET_STAGING_SCHEMA_VERSION,
    kind: MEMORY_FORGET_STAGING_KIND,
    operationId: params.operationId,
    resourceId: params.resourceId,
    bindingId: params.bindingId,
    locator: params.locator,
    storageKind: "filesystem",
    canonicalKind: "markdown_root",
    contentSha256,
    byteLength: params.payload.byteLength,
    mode: params.mode,
    uid: params.uid,
    gid: params.gid,
    mtimeMs: params.mtimeMs,
  };
  writeFileDurableSync(paths.metaPath, `${JSON.stringify(meta, null, 2)}\n`, 0o600);
  return { ...paths, meta, payload: params.payload };
}

/**
 * Remove operation staging then fsync the staging root so deleted sensitive
 * bytes cannot reappear after power loss. Throws on dir fsync failure; leftover
 * staging is retryable via purged+leftover recovery.
 */
export function cleanupMemoryForgetStaging(params: {
  operationId: string;
  stateDir?: string;
}): void {
  const paths = resolveMemoryForgetStagingPaths(params);
  const stagingRoot = resolveMemoryForgetStagingRoot(params.stateDir ?? resolveStateDir());
  fs.rmSync(paths.dir, { recursive: true, force: true });
  if (fs.existsSync(stagingRoot)) {
    fsyncDirectory(stagingRoot, "memory_forget_staging_root");
  }
}
