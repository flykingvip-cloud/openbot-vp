/**
 * Path B gateway bind translation.
 *
 * The gateway container sees tenant data at `OPENBOT_TENANTS_ROOT`
 * (LIVE: `/root/openbot-tenants`) because the host directory
 * `/var/lib/openbot/tenants` is mounted there. Operator trees after the
 * workspace heal live at `$STATE_DIR/operators/<user>/...` (LIVE:
 * `/root/.openbot/operators/...`), which is the state dir mount
 * (`/var/lib/openbot/state` or an identity `/root/.openbot` bind). Account
 * Worker containers are created on the host engine through the mounted
 * socket, so a bind source is a host path. Passing the in-container path of
 * a relocated bind makes the engine create a different host directory with
 * the same string. That directory stays root:root 755 and is not the tree
 * the gateway just created and chowned, so the sandbox user (uid 1000) cannot
 * `mkdir` `Default` and the browser exits immediately.
 *
 * Translation uses an explicit `OPENBOT_HOST_BIND_MAP` when set, otherwise
 * `/proc/self/mountinfo` relocated binds that cover the tenants root or the
 * state dir. Paths outside those roots are left unchanged. An identity mount
 * (`host` path equals `mount` point) is not rewritten.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { resolveTenantsRoot } from "../../gateway/tenant-store-paths.js";

/** `containerRoot=hostRoot` pairs, comma-separated. Longer container roots win. */
export const HOST_BIND_MAP_ENV = "OPENBOT_HOST_BIND_MAP";

export type HostEngineBindOptions = {
  env?: NodeJS.ProcessEnv;
  /** `undefined` reads `/proc/self/mountinfo`. `null` or `""` skips mountinfo. */
  mountinfo?: string | null;
  tenantsRoot?: string;
  /** Gateway state dir. Defaults to `resolveStateDir` (operator trees live here). */
  stateDir?: string;
};

export type RelocatedBindMount = {
  mountPoint: string;
  hostRoot: string;
};

const PSEUDO_FS = new Set([
  "autofs",
  "binfmt_misc",
  "bpf",
  "cgroup",
  "cgroup2",
  "configfs",
  "debugfs",
  "devpts",
  "devtmpfs",
  "fusectl",
  "mqueue",
  "nsfs",
  "overlay",
  "proc",
  "pstore",
  "ramfs",
  "rpc_pipefs",
  "securityfs",
  "sysfs",
  "tmpfs",
  "tracefs",
]);

function decodeMountInfoPath(value: string): string {
  return value.replace(/\\([0-7]{3})/g, (_, octal: string) =>
    String.fromCharCode(Number.parseInt(octal, 8)),
  );
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function isSafeBindRoot(root: string): boolean {
  if (!path.isAbsolute(root) || root === path.parse(root).root) {
    return false;
  }
  if (root.includes("\0")) {
    return false;
  }
  const base = path.basename(root);
  return base !== "docker.sock" && base !== "podman.sock";
}

function readMountInfo(override: string | null | undefined): string | null {
  if (override !== undefined) {
    return override;
  }
  try {
    return fs.readFileSync("/proc/self/mountinfo", "utf8");
  } catch {
    return null;
  }
}

export function parseRelocatedBindMounts(mountinfo: string | null): RelocatedBindMount[] {
  if (!mountinfo) {
    return [];
  }
  const mounts: RelocatedBindMount[] = [];
  for (const line of mountinfo.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const separator = trimmed.indexOf(" - ");
    if (separator === -1) {
      continue;
    }
    const left = trimmed.slice(0, separator).split(" ");
    const right = trimmed.slice(separator + 3).split(" ");
    if (left.length < 5 || right.length < 1) {
      continue;
    }
    const fsType = right[0] ?? "";
    if (PSEUDO_FS.has(fsType)) {
      continue;
    }
    const hostRoot = path.resolve(decodeMountInfoPath(left[3] ?? ""));
    const mountPoint = path.resolve(decodeMountInfoPath(left[4] ?? ""));
    if (!isSafeBindRoot(hostRoot) || !isSafeBindRoot(mountPoint) || hostRoot === mountPoint) {
      continue;
    }
    mounts.push({ mountPoint, hostRoot });
  }
  return mounts;
}

function applyBindMap(resolved: string, raw: string | undefined): string | null {
  const pairs: Array<{ containerRoot: string; hostRoot: string }> = [];
  for (const part of (raw ?? "").split(",")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const containerRoot = path.resolve(trimmed.slice(0, eq).trim());
    const hostRoot = path.resolve(trimmed.slice(eq + 1).trim());
    if (!isSafeBindRoot(containerRoot) || !isSafeBindRoot(hostRoot) || containerRoot === hostRoot) {
      continue;
    }
    pairs.push({ containerRoot, hostRoot });
  }
  pairs.sort((left, right) => right.containerRoot.length - left.containerRoot.length);
  for (const pair of pairs) {
    if (!isInside(resolved, pair.containerRoot)) {
      continue;
    }
    const rel = path.relative(pair.containerRoot, resolved);
    return path.resolve(pair.hostRoot, rel === "" ? "." : rel);
  }
  return null;
}

function longestCoveringMount(
  resolved: string,
  mounts: readonly RelocatedBindMount[],
): RelocatedBindMount | null {
  let best: RelocatedBindMount | null = null;
  for (const mount of mounts) {
    if (!isInside(resolved, mount.mountPoint)) {
      continue;
    }
    if (!best || mount.mountPoint.length > best.mountPoint.length) {
      best = mount;
    }
  }
  return best;
}

function translateInsideRoot(
  resolved: string,
  root: string,
  mounts: readonly RelocatedBindMount[],
): string | null {
  if (!root || !isInside(resolved, root)) {
    return null;
  }
  const mount = longestCoveringMount(
    resolved,
    mounts.filter((entry) => isInside(root, entry.mountPoint)),
  );
  if (!mount) {
    return null;
  }
  const rel = path.relative(mount.mountPoint, resolved);
  return path.resolve(mount.hostRoot, rel === "" ? "." : rel);
}

/**
 * Host-engine path for a directory this process can see.
 * Identity when the path is not under the tenants root or the state dir, or
 * that root is not a relocated bind.
 */
export function translateAccountDockerBindSource(
  containerPath: string,
  options?: HostEngineBindOptions,
): string {
  const resolved = path.resolve(containerPath);
  const env = options?.env ?? process.env;
  const mapped = applyBindMap(resolved, env[HOST_BIND_MAP_ENV]);
  if (mapped) {
    return mapped;
  }
  const mounts = parseRelocatedBindMounts(readMountInfo(options?.mountinfo));
  const roots = [
    path.resolve(options?.tenantsRoot ?? resolveTenantsRoot(env)),
    path.resolve(options?.stateDir ?? resolveStateDir(env)),
  ];
  const translated = roots
    .map((root) => ({ root, hostPath: translateInsideRoot(resolved, root, mounts) }))
    .filter((item): item is { root: string; hostPath: string } => item.hostPath !== null)
    .toSorted((left, right) => right.root.length - left.root.length);
  return translated[0]?.hostPath ?? resolved;
}

export function formatHostEngineDockerBind(
  mount: { hostPath: string; containerPath: string; access: string },
  options?: HostEngineBindOptions,
): string {
  const hostPath = translateAccountDockerBindSource(mount.hostPath, options);
  return `${hostPath}:${mount.containerPath}:${mount.access}`;
}
