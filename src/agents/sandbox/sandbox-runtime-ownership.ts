/**
 * Sandbox images create `sandbox` at uid/gid 1000:1000 (see Dockerfile.sandbox).
 * Account Worker containers do not pass `--user`, so they run as that image
 * user. A Path B gateway started with `--user 0` otherwise mkdir's the
 * workspace, artifacts, and `state/browser` mounts as root:root 755. The
 * non-root container then exits immediately (entrypoint `mkdir` of
 * `Default` fails with EACCES).
 *
 * CONTRACT: SANDBOX_RUNTIME_UID/GID stay 1000 to match the canonical image.
 * A rebuild that leaves `sandbox` at 1001 (classic trap: `FROM node:*` then
 * naive `useradd sandbox`, because official node images already own 1000)
 * makes host mounts owned by 1000 while exec runs as 1001 → workspace
 * Permission denied / npm EACCES. Fix the image uid; do not retarget this
 * default away from 1000 for LIVE-compatible Path B hosts.
 *
 * Chown the directory this process can see. That inode is the host tree
 * mounted into the gateway: tenants at `OPENBOT_TENANTS_ROOT`, and after the
 * operator-workspace heal, `$STATE_DIR/operators/<user>/...` (browser profile
 * and artifacts included). The host engine bind must use that mount source.
 * Passing the in-container path string when it is a relocated bind makes the
 * engine create a second host directory (root:root 755) that this chown never
 * touches.
 *
 * Only a root gateway can chown. A non-root gateway already owns the
 * directories it creates. Classic exec sandboxes with an unset `docker.user`
 * copy that owner onto `--user` and must not be rewritten to 1000.
 */
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Image user created by Dockerfile.sandbox (`useradd --uid 1000 --gid 1000`).
 * Must stay aligned with the canonical sandbox image; see UID CONTRACT there.
 */
export const SANDBOX_RUNTIME_UID = 1000;
export const SANDBOX_RUNTIME_GID = 1000;

export type SandboxOwnershipStat = {
  uid: number;
  gid: number;
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
};

export type SandboxOwnershipEntry = {
  name: string;
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
};

export type SandboxOwnershipIo = {
  getuid?: () => number;
  chown?: (target: string, uid: number, gid: number) => Promise<void>;
  lchown?: (target: string, uid: number, gid: number) => Promise<void>;
  lstat?: (target: string) => Promise<SandboxOwnershipStat>;
  readdir?: (target: string) => Promise<SandboxOwnershipEntry[]>;
};

export type SandboxOwnershipOptions = {
  /**
   * Docker `--user` or the image user. Numeric `uid` / `uid:gid`, or `sandbox`.
   * Omit to use the image default (1000:1000) unless `requireExplicitUser`.
   */
  sandboxUser?: string;
  /**
   * Classic exec sandbox: chown only when `sandbox.docker.user` is an explicit
   * non-root id. An unset user keeps the directory owner, which
   * `resolveSandboxDockerUser` copies onto `--user`.
   */
  requireExplicitUser?: boolean;
  io?: SandboxOwnershipIo;
};

type OwnershipIo = {
  chown: (target: string, uid: number, gid: number) => Promise<void>;
  lchown: (target: string, uid: number, gid: number) => Promise<void>;
  lstat: (target: string) => Promise<SandboxOwnershipStat>;
  readdir: (target: string) => Promise<SandboxOwnershipEntry[]>;
};

export function resolveSandboxRuntimeIdentity(
  sandboxUser: string | undefined,
  requireExplicitUser: boolean,
): { uid: number; gid: number } | null {
  const trimmed = sandboxUser?.trim() ?? "";
  if (!trimmed) {
    if (requireExplicitUser) {
      return null;
    }
    return { uid: SANDBOX_RUNTIME_UID, gid: SANDBOX_RUNTIME_GID };
  }
  if (trimmed === "sandbox" || trimmed === "sandbox:sandbox") {
    return { uid: SANDBOX_RUNTIME_UID, gid: SANDBOX_RUNTIME_GID };
  }
  const match = /^(\d+)(?::(\d+))?$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const uid = Number(match[1]);
  const gid = match[2] === undefined ? uid : Number(match[2]);
  if (!Number.isInteger(uid) || !Number.isInteger(gid) || uid < 0 || gid < 0 || uid === 0) {
    return null;
  }
  return { uid, gid };
}

function readProcessUid(io?: SandboxOwnershipIo): number {
  if (io?.getuid) {
    return io.getuid();
  }
  return typeof process.getuid === "function" ? process.getuid() : -1;
}

function resolveIo(io?: SandboxOwnershipIo): OwnershipIo {
  return {
    chown: io?.chown ?? fs.chown,
    lchown: io?.lchown ?? fs.lchown,
    lstat: io?.lstat ?? fs.lstat,
    readdir: io?.readdir ?? ((target: string) => fs.readdir(target, { withFileTypes: true })),
  };
}

/**
 * Chown one inode the root gateway just created. Does not walk children.
 * Used when a new file lands inside a directory the sandbox user already owns:
 * the tree walk below leaves that directory alone.
 */
export async function ensureSandboxRuntimeNodeOwnership(
  target: string,
  options?: SandboxOwnershipOptions,
): Promise<void> {
  if (readProcessUid(options?.io) !== 0) {
    return;
  }
  const identity = resolveSandboxRuntimeIdentity(
    options?.sandboxUser,
    options?.requireExplicitUser === true,
  );
  if (!identity) {
    return;
  }
  const io = resolveIo(options?.io);
  let stat: SandboxOwnershipStat;
  try {
    stat = await io.lstat(target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (stat.uid === identity.uid && stat.gid === identity.gid) {
    return;
  }
  if (stat.isSymbolicLink()) {
    await io.lchown(target, identity.uid, identity.gid);
    return;
  }
  await io.chown(target, identity.uid, identity.gid);
}

/**
 * Give the sandbox runtime user the directory and anything a root gateway
 * already wrote inside it. Symlinks are lchown'd and not followed.
 * A directory that is already owned by the runtime user is left alone.
 */
async function alignOwnedTree(
  dir: string,
  uid: number,
  gid: number,
  io: OwnershipIo,
): Promise<void> {
  let stat: SandboxOwnershipStat;
  try {
    stat = await io.lstat(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    return;
  }
  if (stat.uid === uid && stat.gid === gid) {
    return;
  }
  await io.chown(dir, uid, gid);
  const entries = await io.readdir(dir);
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      await io.lchown(child, uid, gid);
      continue;
    }
    if (entry.isDirectory()) {
      await alignOwnedTree(child, uid, gid, io);
      continue;
    }
    await io.chown(child, uid, gid);
  }
}

export async function ensureSandboxRuntimeOwnership(
  directories: readonly string[],
  options?: SandboxOwnershipOptions,
): Promise<void> {
  if (readProcessUid(options?.io) !== 0) {
    return;
  }
  const identity = resolveSandboxRuntimeIdentity(
    options?.sandboxUser,
    options?.requireExplicitUser === true,
  );
  if (!identity) {
    return;
  }
  const io = resolveIo(options?.io);
  for (const directory of directories) {
    await alignOwnedTree(directory, identity.uid, identity.gid, io);
  }
}
