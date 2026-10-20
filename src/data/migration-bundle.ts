import fs from "node:fs";
import path from "node:path";

/** Migration bundle IDs (product spec §7.1). */
export type MigrationBundleId = "core" | "conversations" | "cache";

export type MigrationBundleOptions = {
  includeCache?: boolean;
};

/** Relative paths under `data.root` included in the default migration bundle. */
export const MIGRATION_CORE_RELATIVE_PATHS = [
  "agents",
  "shared",
  "memory/personal",
  ".meta",
] as const;

export const MIGRATION_CACHE_RELATIVE_PATH = "cache";

/**
 * Portable export denylist under Data Space (CW2-P1-03).
 * Canonical sqlite + bindings stay; device/runtime queues must not travel.
 */
export const MIGRATION_EXPORT_DENYLIST_RELATIVE_PREFIXES = [
  ".meta/cogniweave/outbox",
  ".meta/cogniweave/cursors",
  ".meta/cogniweave/device-cursors",
  ".meta/cogniweave/leases",
  ".meta/cogniweave/claim-leases",
  ".meta/cogniweave/locks",
  ".meta/cogniweave/runtime",
] as const;

/** Audit labels written into export manifests for denied CogniWeave runtime trees. */
export const MIGRATION_EXPORT_DENIED_CATEGORIES = [
  "cogniweave-outbox",
  "cogniweave-cursors",
  "cogniweave-leases",
  "cogniweave-locks",
  "cogniweave-runtime",
] as const;

export function resolveMigrationRelativePaths(options: MigrationBundleOptions = {}): string[] {
  const paths: string[] = [...MIGRATION_CORE_RELATIVE_PATHS];
  if (options.includeCache) {
    paths.push(MIGRATION_CACHE_RELATIVE_PATH);
  }
  return paths;
}

export function resolveMigrationAbsolutePaths(
  dataRoot: string,
  options: MigrationBundleOptions = {},
): string[] {
  const root = path.resolve(dataRoot);
  return resolveMigrationRelativePaths(options).map((rel) => path.join(root, rel));
}

/** Normalize to POSIX-ish relative path under data root (or null if outside). */
export function relativePathUnderDataRoot(dataRoot: string, absPath: string): string | null {
  const root = path.resolve(dataRoot);
  const abs = path.resolve(absPath);
  const rel = path.relative(root, abs).replaceAll("\\", "/");
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return rel === "" ? "" : null;
  }
  return rel;
}

/** True when `absPath` is a denied CogniWeave runtime subtree (or inside one). */
export function isMigrationExportDenied(dataRoot: string, absPath: string): boolean {
  const rel = relativePathUnderDataRoot(dataRoot, absPath);
  if (rel === null) {
    return true;
  }
  if (rel === "") {
    return false;
  }
  return MIGRATION_EXPORT_DENYLIST_RELATIVE_PREFIXES.some(
    (prefix) => rel === prefix || rel.startsWith(`${prefix}/`),
  );
}

export type DirectorySizeResult = {
  bytes: number;
  fileCount: number;
};

function isDirectory(entryPath: string): boolean {
  try {
    return fs.statSync(entryPath).isDirectory();
  } catch {
    return false;
  }
}

function isFile(entryPath: string): boolean {
  try {
    return fs.statSync(entryPath).isFile();
  } catch {
    return false;
  }
}

/** Sum file sizes under `dir` (best-effort; skips unreadable / denylisted entries). */
export function measureDirectorySize(
  dir: string,
  options?: { dataRoot?: string },
): DirectorySizeResult {
  let bytes = 0;
  let fileCount = 0;
  const dataRoot = options?.dataRoot ? path.resolve(options.dataRoot) : undefined;
  const stack = [path.resolve(dir)];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (dataRoot && isMigrationExportDenied(dataRoot, current)) {
      continue;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (dataRoot && isMigrationExportDenied(dataRoot, full)) {
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          bytes += fs.statSync(full).size;
          fileCount += 1;
        } catch {
          // skip unreadable files
        }
      }
    }
  }
  return { bytes, fileCount };
}

export function estimateMigrationBundleSize(
  dataRoot: string,
  options: MigrationBundleOptions = {},
): DirectorySizeResult {
  const root = path.resolve(dataRoot);
  let bytes = 0;
  let fileCount = 0;
  for (const abs of resolveMigrationAbsolutePaths(root, options)) {
    if (isMigrationExportDenied(root, abs)) {
      continue;
    }
    if (!isDirectory(abs) && !isFile(abs)) {
      continue;
    }
    if (isFile(abs)) {
      try {
        bytes += fs.statSync(abs).size;
        fileCount += 1;
      } catch {
        // skip
      }
      continue;
    }
    const measured = measureDirectorySize(abs, { dataRoot: root });
    bytes += measured.bytes;
    fileCount += measured.fileCount;
  }
  return { bytes, fileCount };
}

/** Ensure denied CogniWeave runtime dirs are absent/empty after restore (no stale sync). */
export function resetCogniWeaveRuntimeExportDirs(dataRoot: string): string[] {
  const root = path.resolve(dataRoot);
  const reset: string[] = [];
  for (const rel of MIGRATION_EXPORT_DENYLIST_RELATIVE_PREFIXES) {
    const abs = path.join(root, rel);
    try {
      if (fs.existsSync(abs)) {
        fs.rmSync(abs, { recursive: true, force: true });
        reset.push(rel);
      }
    } catch {
      // best-effort
    }
  }
  return reset;
}

export function formatBytesHuman(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 10 || unitIndex === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${String(rounded)} ${units[unitIndex]}`;
}
