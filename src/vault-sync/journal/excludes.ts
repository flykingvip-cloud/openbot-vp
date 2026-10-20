import path from "node:path";
import type { SelectiveSyncOptions } from "../types.js";
import { DEFAULT_SELECTIVE_SYNC } from "../types.js";

const ALWAYS_EXCLUDE_GLOBS = [
  "**/.openbot/**",
  "**/.openclaw/**",
  "**/node_modules/**",
  "**/.git/**",
  "**/.DS_Store",
  "**/*~",
  "**/.*.swp",
  "**/.*.swo",
  "**/~$*",
  "**/*.lock",
  "**/knowledge-index*.sqlite*",
  "**/embeddings/**",
  "**/.vault-sync/**",
];

function matchGlob(relativePath: string, glob: string): boolean {
  const norm = relativePath.replace(/\\/g, "/");
  // Minimal glob: ** / * only (sufficient for built-in excludes + simple user globs)
  const escaped = glob
    .replace(/\\/g, "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DS::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DS::/g, ".*");
  // `**/foo` must also match `foo` at vault root (no leading slash segment).
  const anchored = escaped.startsWith(".*/") ? `(?:.*\\/)?${escaped.slice(3)}` : escaped;
  return new RegExp(`^${anchored}$`, "i").test(norm);
}

export function isAlwaysExcluded(relativePath: string): boolean {
  return ALWAYS_EXCLUDE_GLOBS.some((g) => matchGlob(relativePath, g));
}

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".heic", ".bmp"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi"]);
const PDF_EXT = new Set([".pdf"]);
const TEXTISH_EXT = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".csv",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
]);

function extOf(relativePath: string): string {
  return path.posix.extname(relativePath.replace(/\\/g, "/")).toLowerCase();
}

export function isSelectivelyIncluded(
  relativePath: string,
  options: SelectiveSyncOptions = DEFAULT_SELECTIVE_SYNC,
): boolean {
  if (isAlwaysExcluded(relativePath)) {
    return false;
  }
  const ext = extOf(relativePath);
  if (!ext || TEXTISH_EXT.has(ext)) {
    return options.includeFolders; // text notes treated as vault content
  }
  if (IMAGE_EXT.has(ext)) {
    return options.includeImages;
  }
  if (AUDIO_EXT.has(ext)) {
    return options.includeAudio;
  }
  if (VIDEO_EXT.has(ext)) {
    return options.includeVideo;
  }
  if (PDF_EXT.has(ext)) {
    return options.includePdf;
  }
  return options.includeOtherAttachments;
}

export function shouldSyncPath(
  relativePath: string,
  options?: SelectiveSyncOptions,
  extraExcludeGlobs: string[] = [],
): boolean {
  const norm = relativePath.replace(/\\/g, "/").replace(/^\.?\//, "");
  if (!norm || norm.includes("..")) {
    return false;
  }
  const mergedExtras = [...extraExcludeGlobs, ...(options?.excludeGlobs ?? [])];
  if (mergedExtras.some((g) => matchGlob(norm, g))) {
    return false;
  }
  return isSelectivelyIncluded(norm, options);
}

export { ALWAYS_EXCLUDE_GLOBS };
