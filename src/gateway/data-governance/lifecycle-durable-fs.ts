/**
 * Durable filesystem primitives for purge (P2-d).
 * Directory-entry persistence requires parent-dir fsync after unlink/rm.
 * Unsupported or failed fsync is fail-closed — callers must not CAS Catalog to purged.
 *
 * Path authorization: allowedRoots are server-derived from trusted stateDir +
 * tenantId (or a bound storage handle whose roots stay inside that tenant root).
 * Callers cannot supply raw path lists.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Directory fsync is required for unlink/rename durability.
 * Unsupported platforms fail closed (`dir_fsync_failed:<label>:<code>`).
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
 * Unlink a file or recursively remove a directory, then fsync the parent.
 * Missing target is still confirmed by parent-dir fsync (restart resume).
 * Parent fsync failure throws — never treated as durable success.
 */
export function removePathDurable(target: string): void {
  const resolved = path.resolve(target);
  if (fs.existsSync(resolved)) {
    const st = fs.lstatSync(resolved);
    if (st.isDirectory()) {
      fs.rmSync(resolved, { recursive: true, force: true });
    } else {
      fs.unlinkSync(resolved);
    }
  }
  fsyncDirectory(path.dirname(resolved), "canonical_unlink");
}

function locatorLooksLikeUriOrConnectionString(locator: string): boolean {
  const trimmed = locator.trim();
  if (trimmed.includes("://") || trimmed.includes("?") || trimmed.includes("@")) {
    return true;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(trimmed) && !path.isAbsolute(trimmed)) {
    return true;
  }
  if (/^[a-zA-Z][a-zA-Z0-9_]*\s*=/u.test(trimmed)) {
    return true;
  }
  return false;
}

function isInsideOrEqual(root: string, candidate: string): boolean {
  return isPathInsideOrEqualRoot(root, candidate);
}

function isStrictlyInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function realpathIfExists(target: string): string | null {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

function resolveEntryAndParent(locator: string): { entryPath: string; parentPath: string } {
  const resolved = path.resolve(locator);
  const parent = path.dirname(resolved);
  const base = path.basename(resolved);
  const parentReal = realpathIfExists(parent);
  if (parentReal) {
    return { entryPath: path.join(parentReal, base), parentPath: parentReal };
  }
  const missing: string[] = [base];
  let cursor = parent;
  while (true) {
    const real = realpathIfExists(cursor);
    if (real) {
      const rest = missing.slice().toReversed();
      return {
        entryPath: path.join(real, ...rest),
        parentPath: rest.length > 1 ? path.join(real, ...rest.slice(0, -1)) : real,
      };
    }
    const name = path.basename(cursor);
    const next = path.dirname(cursor);
    if (next === cursor) {
      return { entryPath: resolved, parentPath: parent };
    }
    missing.push(name);
    cursor = next;
  }
}

/**
 * Realpath existing directory roots. Missing, non-dir, and filesystem-root
 * values cannot authorize a destructive purge.
 */
export function normalizePurgeAllowedRoots(allowedRoots: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of allowedRoots) {
    if (!raw || raw.includes("\0")) {
      continue;
    }
    const resolved = path.resolve(raw);
    if (resolved === path.parse(resolved).root) {
      continue;
    }
    const real = realpathIfExists(resolved);
    if (!real || real === path.parse(real).root) {
      continue;
    }
    try {
      if (!fs.lstatSync(real).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }
    if (seen.has(real)) {
      continue;
    }
    seen.add(real);
    out.push(real);
  }
  return out;
}

/**
 * Resolver-shaped allowed roots: envelope tenant + OpenBot stateDir.
 * Never derived from the Catalog locator and never taken from a caller override.
 */
export function resolvePurgeAllowedRoots(params: {
  tenantId: string | null;
  stateDir?: string;
}): string[] {
  if (!params.stateDir || !params.tenantId) {
    return [];
  }
  return [path.join(path.resolve(params.stateDir), "tenants", params.tenantId)];
}

export function isPathInsideOrEqualRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export type PurgePathContainmentResult = { ok: true } | { ok: false; reason: string };

/**
 * Containment for purge: target must be strictly inside an allowed root;
 * parent must be inside or equal; locator must not equal the root;
 * realpath of target and parent must not escape (symlink / bind-mount).
 * Missing target (resume) still requires parent (or nearest existing ancestor)
 * to remain inside the allowed root.
 */
export function assertPurgePathContained(params: {
  locator: string;
  allowedRoots: string[];
}): PurgePathContainmentResult {
  if (!params.locator || params.locator.includes("\0")) {
    return { ok: false, reason: "purge_path_not_in_allowed_root" };
  }
  const roots = normalizePurgeAllowedRoots(params.allowedRoots);
  if (roots.length === 0) {
    return { ok: false, reason: "purge_allowed_roots_missing" };
  }

  const { entryPath, parentPath } = resolveEntryAndParent(params.locator);
  const targetReal = realpathIfExists(path.resolve(params.locator));

  for (const root of roots) {
    if (entryPath === root || targetReal === root) {
      return { ok: false, reason: "purge_path_equals_allowed_root" };
    }
  }

  const entryInside = roots.some((root) => isStrictlyInside(root, entryPath));
  if (!entryInside) {
    return { ok: false, reason: "purge_path_not_in_allowed_root" };
  }

  const parentOk = roots.some((root) => isInsideOrEqual(root, parentPath));
  if (!parentOk) {
    return { ok: false, reason: "purge_parent_not_in_allowed_root" };
  }

  const parentReal = realpathIfExists(parentPath);
  if (parentReal && !roots.some((root) => isInsideOrEqual(root, parentReal))) {
    return { ok: false, reason: "purge_parent_not_in_allowed_root" };
  }

  if (targetReal) {
    if (roots.some((root) => targetReal === root)) {
      return { ok: false, reason: "purge_path_equals_allowed_root" };
    }
    if (!roots.some((root) => isStrictlyInside(root, targetReal))) {
      let isLink = false;
      try {
        isLink = fs.lstatSync(path.resolve(params.locator)).isSymbolicLink();
      } catch {
        isLink = true;
      }
      return {
        ok: false,
        reason:
          isLink || targetReal !== entryPath
            ? "purge_path_symlink_escape"
            : "purge_path_not_in_allowed_root",
      };
    }
  }

  return { ok: true };
}

function isLocalSqliteFileShape(locator: string): boolean {
  if (!locator || locator.includes("\0")) {
    return false;
  }
  if (locatorLooksLikeUriOrConnectionString(locator)) {
    return false;
  }
  if (!path.isAbsolute(locator)) {
    return false;
  }
  const resolved = path.resolve(locator);
  if (path.normalize(locator) !== resolved) {
    return false;
  }
  try {
    if (!fs.existsSync(resolved)) {
      return true;
    }
    const st = fs.lstatSync(resolved);
    return st.isFile() || st.isSymbolicLink();
  } catch {
    return false;
  }
}

export { isLocalSqliteFileShape };

/**
 * SQLite may use the filesystem eraser only when the locator is a local file
 * shape AND contained in caller-supplied allowedRoots (not locator self-auth).
 */
export function isControlledLocalSqliteFileLocator(
  locator: string,
  allowedRoots: string[],
): boolean {
  if (!isLocalSqliteFileShape(locator)) {
    return false;
  }
  return assertPurgePathContained({ locator, allowedRoots }).ok;
}
