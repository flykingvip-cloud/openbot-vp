/**
 * Directory snapshots for Account Computer P4 export / restore.
 *
 * Copies regular files only. Symlinks and sockets are refused so a profile
 * cannot pull in a host path. Callers swap one directory at a time and never
 * remove the parent account tree.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export type AccountTreeManifest = {
  version: 1;
  files: Array<{ rel: string; sha256: string; bytes: number }>;
};

export type AccountTreeSnapshotReason = "missing" | "symlink" | "unsupported-entry" | "escape";

export class AccountTreeSnapshotError extends Error {
  readonly reason: AccountTreeSnapshotReason;

  constructor(reason: AccountTreeSnapshotReason, message: string) {
    super(message);
    this.name = "AccountTreeSnapshotError";
    this.reason = reason;
  }
}

/** Basename sentinels for WebAuthn, passkeys, and device-bound 2FA. */
export const ACCOUNT_BROWSER_REAUTH_SENTINELS = [
  "device-bound",
  "webauthn",
  "passkeys",
  "device-bound-2fa",
] as const;

const SENTINEL_NAMES = new Set<string>(ACCOUNT_BROWSER_REAUTH_SENTINELS);

export function isLegacySharedOpenClawUserData(dir: string): boolean {
  const parts = path
    .resolve(dir)
    .split(path.sep)
    .filter((part) => part.length > 0);
  return parts.at(-1) === "user-data" && parts.at(-2) === "openclaw" && parts.at(-3) === "browser";
}

export function isPathInside(parent: string, candidate: string): boolean {
  const root = path.resolve(parent);
  const target = path.resolve(candidate);
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(filePath: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    bytes += buf.byteLength;
    hash.update(buf);
  }
  return { sha256: hash.digest("hex"), bytes };
}

async function walkFiles(
  root: string,
  prefix: string,
  visit: (abs: string, rel: string) => Promise<void>,
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : "";
    if (code === "ENOENT") {
      throw new AccountTreeSnapshotError("missing", `missing directory: ${root}`);
    }
    throw error;
  }
  for (const entry of entries) {
    const abs = path.join(root, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) {
      throw new AccountTreeSnapshotError("symlink", `refusing symlink: ${rel}`);
    }
    if (entry.isDirectory()) {
      await walkFiles(abs, rel, visit);
      continue;
    }
    if (!entry.isFile()) {
      throw new AccountTreeSnapshotError("unsupported-entry", `refusing non-file entry: ${rel}`);
    }
    await visit(abs, rel);
  }
}

export async function createTreeManifest(root: string): Promise<AccountTreeManifest> {
  const files: AccountTreeManifest["files"] = [];
  await walkFiles(root, "", async (abs, rel) => {
    const hashed = await sha256File(abs);
    files.push({ rel, sha256: hashed.sha256, bytes: hashed.bytes });
  });
  files.sort((left, right) => left.rel.localeCompare(right.rel));
  return { version: 1, files };
}

export async function treeMatchesManifest(
  root: string,
  manifest: AccountTreeManifest,
): Promise<boolean> {
  try {
    const actual = await createTreeManifest(root);
    if (actual.files.length !== manifest.files.length) {
      return false;
    }
    for (let i = 0; i < actual.files.length; i += 1) {
      const found = actual.files[i];
      const expected = manifest.files[i];
      if (
        !found ||
        !expected ||
        found.rel !== expected.rel ||
        found.sha256 !== expected.sha256 ||
        found.bytes !== expected.bytes
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function scanReauthSentinel(root: string): Promise<boolean> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (SENTINEL_NAMES.has(entry.name.toLowerCase())) {
      return true;
    }
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      if (await scanReauthSentinel(path.join(root, entry.name))) {
        return true;
      }
    }
  }
  return false;
}

export async function directoryHasReauthSentinel(root: string): Promise<boolean> {
  if (!(await pathExists(root))) {
    return false;
  }
  try {
    return await scanReauthSentinel(root);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : "";
    if (code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function copyDirectory(source: string, dest: string): Promise<void> {
  if (!(await pathExists(source))) {
    throw new AccountTreeSnapshotError("missing", `missing directory: ${source}`);
  }
  if (path.resolve(source) === path.resolve(dest) || isPathInside(source, dest)) {
    throw new AccountTreeSnapshotError("escape", "refusing to copy a directory into itself");
  }
  await createTreeManifest(source);
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(source, dest, { recursive: true, verbatimSymlinks: true });
}

/**
 * Replace `liveDir` with `incomingDir` (or remove it when incoming is null).
 * The previous live tree is kept at `rollbackDir`. On failure the live tree
 * is put back. The parent of `liveDir` is not removed.
 */
export async function swapDirectory(params: {
  liveDir: string;
  incomingDir: string | null;
  rollbackDir: string;
}): Promise<{ previousExisted: boolean }> {
  const previousExisted = await pathExists(params.liveDir);
  await fs.rm(params.rollbackDir, { recursive: true, force: true });
  if (previousExisted) {
    await copyDirectory(params.liveDir, params.rollbackDir);
  }
  try {
    await fs.rm(params.liveDir, { recursive: true, force: true });
    if (params.incomingDir) {
      await fs.mkdir(path.dirname(params.liveDir), { recursive: true });
      await copyDirectory(params.incomingDir, params.liveDir);
    }
  } catch (error) {
    await fs.rm(params.liveDir, { recursive: true, force: true });
    if (previousExisted) {
      await copyDirectory(params.rollbackDir, params.liveDir);
    }
    throw error;
  }
  return { previousExisted };
}

export async function restoreSwappedDirectory(params: {
  liveDir: string;
  rollbackDir: string;
  previousExisted: boolean;
}): Promise<void> {
  await fs.rm(params.liveDir, { recursive: true, force: true });
  if (!params.previousExisted) {
    return;
  }
  await fs.mkdir(path.dirname(params.liveDir), { recursive: true });
  await copyDirectory(params.rollbackDir, params.liveDir);
}
