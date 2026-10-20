import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import { isManagedDataMode, resolveDataRoot } from "../config/data-space.js";
import { shortenHomePath } from "../utils.js";
import {
  estimateMigrationBundleSize,
  formatBytesHuman,
  type MigrationBundleOptions,
} from "./migration-bundle.js";

export type DataRootInfo = {
  mode: "local" | "managed";
  /** Absolute path on disk (local only). */
  rootPath?: string;
  /** User-visible path, e.g. `~/OpenBot`. */
  displayRoot?: string;
  /** Volume / disk label when detectable. */
  volumeName?: string;
  usedBytes?: number;
  usedBytesLabel?: string;
  fileCount?: number;
  previousRoot?: string;
  previousRootExpiresAt?: string;
};

const BLOCKED_MIGRATION_TARGET_PREFIXES = [
  "/System",
  "/usr",
  "/bin",
  "/sbin",
  "/etc",
  "/var",
  "/private/var",
  "/Library/Application Support",
];

export function resolveVolumeNameForPath(absPath: string): string | undefined {
  const resolved = path.resolve(absPath);
  if (process.platform === "darwin") {
    const volumesRoot = "/Volumes/";
    if (resolved.startsWith(volumesRoot)) {
      const rest = resolved.slice(volumesRoot.length);
      const name = rest.split("/")[0]?.trim();
      return name || undefined;
    }
    return "Macintosh HD";
  }
  if (process.platform === "linux") {
    if (resolved.startsWith("/Volumes/")) {
      const rest = resolved.slice("/Volumes/".length);
      return rest.split("/")[0]?.trim() || undefined;
    }
    return os.hostname() || "Local disk";
  }
  return undefined;
}

export function buildDataRootInfo(
  cfg: OpenBotConfig | undefined,
  options: MigrationBundleOptions = {},
): DataRootInfo {
  if (isManagedDataMode(cfg)) {
    return { mode: "managed" };
  }
  const rootPath = resolveDataRoot(cfg);
  const measured = estimateMigrationBundleSize(rootPath, options);
  return {
    mode: "local",
    rootPath,
    displayRoot: shortenHomePath(rootPath),
    volumeName: resolveVolumeNameForPath(rootPath),
    usedBytes: measured.bytes,
    usedBytesLabel: formatBytesHuman(measured.bytes),
    fileCount: measured.fileCount,
    previousRoot: cfg?.data?.previousRoot?.trim() || undefined,
    previousRootExpiresAt: cfg?.data?.previousRootExpiresAt?.trim() || undefined,
  };
}

export type MigrationTargetValidation = {
  ok: boolean;
  resolvedPath?: string;
  error?: string;
  availableBytes?: number;
};

export function validateMigrationTargetPath(rawTarget: string): MigrationTargetValidation {
  const trimmed = rawTarget.trim();
  if (!trimmed) {
    return { ok: false, error: "目标路径不能为空。" };
  }
  const resolved = path.resolve(
    trimmed.startsWith("~") ? path.join(os.homedir(), trimmed.slice(1)) : trimmed,
  );
  if (resolved === path.parse(resolved).root) {
    return { ok: false, error: "不能迁移到磁盘根目录。" };
  }
  for (const prefix of BLOCKED_MIGRATION_TARGET_PREFIXES) {
    if (resolved === prefix || resolved.startsWith(`${prefix}/`)) {
      // macOS user temp dirs live under /var/folders — not system paths.
      if (prefix === "/var" && resolved.startsWith("/var/folders/")) {
        continue;
      }
      return { ok: false, error: "不能迁移到系统目录。" };
    }
  }
  try {
    fs.accessSync(resolved, fs.constants.W_OK | fs.constants.X_OK);
  } catch {
    return { ok: false, error: "目标路径不可写或不存在。" };
  }
  let availableBytes: number | undefined;
  try {
    const statfs = (
      fs as unknown as { statfsSync?: (p: string) => { bavail: number; bsize: number } }
    ).statfsSync;
    if (statfs) {
      const info = statfs(resolved);
      availableBytes = info.bavail * info.bsize;
    }
  } catch {
    // statfs optional
  }
  return { ok: true, resolvedPath: resolved, availableBytes };
}

export type MountedVolume = {
  id: string;
  label: string;
  path: string;
};

/** List mounted volumes useful for migration target selection (macOS /Volumes). */
export function listMountedVolumes(): MountedVolume[] {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    return [];
  }
  const volumesDir = "/Volumes";
  try {
    const entries = fs.readdirSync(volumesDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => ({
        id: entry.name,
        label: entry.name,
        path: path.join(volumesDir, entry.name),
      }));
  } catch {
    return [];
  }
}
