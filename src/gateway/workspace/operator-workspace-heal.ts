/**
 * Path B employee workspace heal.
 *
 * Managed multitenant production still resolves account files under
 * `<OPENBOT_TENANTS_ROOT>/<tenant>/users/<user>/...`. Tenant ids such as
 * `workspace-17-…` sit before `OpenBot/agents`, so
 * `isRetiredMultitenantWritePath` refuses the write and chat fails before a
 * reply. Operators state (`$STATE_DIR/operators/<user>/...`) is the session
 * SoT and is not a retired root.
 *
 * This module remounts only the user-tree suffix after `users/<user>/`.
 * Control-plane stores stay on the tenants volume. The old path stays
 * classified retired so a missed call site still fail-closes.
 */
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ensureSandboxRuntimeNodeOwnership,
  ensureSandboxRuntimeOwnership,
  type SandboxOwnershipOptions,
} from "../../agents/sandbox/sandbox-runtime-ownership.js";
import { normalizeOperatorId } from "../../config/operator-state-scope.js";
import { resolveStateDir } from "../../config/paths.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { resolveTenantsRoot } from "../tenant-store-paths.js";

const log = createSubsystemLogger("gateway/operator-workspace-heal");
const SKIP_COPY_NAMES = new Set([".git", "node_modules"]);

function safePathSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !segment.includes("/") &&
    !segment.includes("\\") &&
    !segment.includes("\0")
  );
}

function indexOfSeparator(value: string): number {
  const slash = value.indexOf("/");
  const backslash = value.indexOf("\\");
  if (slash < 0) {
    return backslash;
  }
  if (backslash < 0) {
    return slash;
  }
  return Math.min(slash, backslash);
}

/**
 * `<tenantsRoot>/<tenant>/users/<user>/<rest>` →
 * `$STATE_DIR/operators/<user>/<rest>`.
 * Paths outside that user tree are returned unchanged.
 */
export function relocateTenantsVolumeUserPath(
  absPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const tenantsRoot = path.resolve(resolveTenantsRoot(env));
  const resolved = path.resolve(absPath);
  const relative = path.relative(tenantsRoot, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return absPath;
  }
  const parts = relative.split(path.sep).filter((part) => part.length > 0);
  if (
    parts.length < 3 ||
    parts[1] !== "users" ||
    !safePathSegment(parts[0] ?? "") ||
    !safePathSegment(parts[2] ?? "")
  ) {
    return absPath;
  }
  const operatorId = normalizeOperatorId(parts[2]);
  if (!operatorId) {
    return absPath;
  }
  return path.join(resolveStateDir(env), "operators", operatorId, ...parts.slice(3));
}

function matchUserTreeSuffix(rest: string): { userId: string; consumed: number } | null {
  const tenantSep = indexOfSeparator(rest);
  if (tenantSep <= 0) {
    return null;
  }
  const tenantId = rest.slice(0, tenantSep);
  if (!safePathSegment(tenantId)) {
    return null;
  }
  const afterTenant = rest.slice(tenantSep + 1);
  const usersToken = afterTenant.startsWith("users/")
    ? "users/"
    : afterTenant.startsWith("users\\")
      ? "users\\"
      : null;
  if (!usersToken) {
    return null;
  }
  const userRest = afterTenant.slice(usersToken.length);
  const userSep = indexOfSeparator(userRest);
  const userId = userSep < 0 ? userRest : userRest.slice(0, userSep);
  if (!safePathSegment(userId)) {
    return null;
  }
  if (userSep >= 0) {
    const boundary = userRest[userSep];
    if (boundary !== "/" && boundary !== "\\") {
      return null;
    }
  }
  return {
    userId,
    consumed: tenantSep + 1 + usersToken.length + userId.length,
  };
}

function rewritePathText(input: string, env: NodeJS.ProcessEnv): string {
  const tenantsRoot = path.resolve(resolveTenantsRoot(env));
  const prefix = tenantsRoot.endsWith(path.sep) ? tenantsRoot : `${tenantsRoot}${path.sep}`;
  if (!input.includes(prefix)) {
    return input;
  }
  let out = "";
  let cursor = 0;
  let changed = false;
  while (cursor < input.length) {
    const idx = input.indexOf(prefix, cursor);
    if (idx < 0) {
      out += input.slice(cursor);
      break;
    }
    const matched = matchUserTreeSuffix(input.slice(idx + prefix.length));
    const operatorId = matched ? normalizeOperatorId(matched.userId) : undefined;
    if (!matched || !operatorId) {
      out += input.slice(cursor, idx + prefix.length);
      cursor = idx + prefix.length;
      continue;
    }
    out += input.slice(cursor, idx);
    out += path.join(resolveStateDir(env), "operators", operatorId);
    cursor = idx + prefix.length + matched.consumed;
    changed = true;
  }
  return changed ? out : input;
}

function rewriteValue(value: unknown, env: NodeJS.ProcessEnv): unknown {
  if (typeof value === "string") {
    return rewritePathText(value, env);
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const rewritten = rewriteValue(item, env);
      if (rewritten !== item) {
        changed = true;
      }
      return rewritten;
    });
    return changed ? next : value;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const rewritten = rewriteValue(item, env);
    if (rewritten !== item) {
      changed = true;
    }
    next[key] = rewritten;
  }
  return changed ? next : value;
}

/** Rewrite embedded tenants-volume user paths. Returns the same reference when nothing changes. */
export function rewriteTenantsVolumeUserPaths<T>(
  value: T,
  env: NodeJS.ProcessEnv = process.env,
): T {
  return rewriteValue(value, env) as T;
}

/**
 * Copy files that are missing at `to`. Existing destination files stay.
 * Skips `.git`, `node_modules`, and symlinks. A missing source is a no-op
 * and is never created. The source tree is not modified (retired tenants
 * roots stay in place).
 *
 * New files and new directories are chowned to the sandbox runtime user.
 * A destination that is still root-owned is walked once so a healed operator
 * workspace is writable by uid 1000. The source path is never chowned.
 */
export async function copyMissingOperatorWorkspace(
  from: string,
  to: string,
  ownership?: SandboxOwnershipOptions,
): Promise<void> {
  const source = path.resolve(from);
  const dest = path.resolve(to);
  if (source === dest) {
    return;
  }
  const copied = await copyMissingOperatorTree(source, dest, ownership);
  if (!copied) {
    return;
  }
  await ensureSandboxRuntimeOwnership([dest], ownership);
}

async function copyMissingOperatorTree(
  source: string,
  dest: string,
  ownership?: SandboxOwnershipOptions,
): Promise<boolean> {
  let sourceStat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    sourceStat = await fs.lstat(source);
  } catch {
    return false;
  }
  if (sourceStat.isSymbolicLink()) {
    return false;
  }
  if (sourceStat.isDirectory()) {
    let destStat: Awaited<ReturnType<typeof fs.lstat>> | undefined;
    try {
      destStat = await fs.lstat(dest);
    } catch {
      destStat = undefined;
    }
    if (destStat?.isSymbolicLink() || (destStat && !destStat.isDirectory())) {
      return false;
    }
    const createdDir = !destStat;
    await fs.mkdir(dest, { recursive: true });
    // A new directory inside an already-owned parent is not reached by the
    // tree walk, which stops when the parent uid matches the sandbox user.
    if (createdDir) {
      await ensureSandboxRuntimeNodeOwnership(dest, ownership);
    }
    const entries = await fs.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_COPY_NAMES.has(entry.name)) {
        continue;
      }
      await copyMissingOperatorTree(
        path.join(source, entry.name),
        path.join(dest, entry.name),
        ownership,
      );
    }
    return true;
  }
  if (!sourceStat.isFile()) {
    return false;
  }
  try {
    await fs.lstat(dest);
    return false;
  } catch {
    // Destination is missing. Fall through to the exclusive copy.
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.copyFile(source, dest, fsConstants.COPYFILE_EXCL);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      return false;
    }
    throw err;
  }
  await ensureSandboxRuntimeNodeOwnership(dest, ownership);
  return true;
}

/**
 * Move a production workspace off the tenants volume onto the operator root
 * and copy missing files. Copy failure does not return the retired path.
 */
export async function healProductionWorkspaceDir(
  workspaceDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const healed = relocateTenantsVolumeUserPath(workspaceDir, env);
  if (path.resolve(healed) === path.resolve(workspaceDir)) {
    return workspaceDir;
  }
  try {
    await copyMissingOperatorWorkspace(workspaceDir, healed);
  } catch (err) {
    log.warn("operator workspace copy failed; write target stays on the operator root", {
      error: err instanceof Error ? err.message : "copy_failed",
    });
  }
  return healed;
}
