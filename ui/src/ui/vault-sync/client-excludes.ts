import type { SelectiveSyncOptions } from "./client-sync-types.ts";

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
  const escaped = glob
    .replace(/\\/g, "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DS::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DS::/g, ".*");
  const anchored = escaped.startsWith(".*/") ? `(?:.*\\/)?${escaped.slice(3)}` : escaped;
  return new RegExp(`^${anchored}$`, "i").test(norm);
}

function extOf(relativePath: string): string {
  const base = relativePath.replace(/\\/g, "/").split("/").pop() ?? "";
  const idx = base.lastIndexOf(".");
  return idx >= 0 ? base.slice(idx).toLowerCase() : "";
}

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".heic", ".bmp"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi"]);
const PDF_EXT = new Set([".pdf"]);

export function isAlwaysExcluded(relativePath: string): boolean {
  return ALWAYS_EXCLUDE_GLOBS.some((g) => matchGlob(relativePath, g));
}

export function shouldSyncPath(relativePath: string, selective: SelectiveSyncOptions): boolean {
  if (isAlwaysExcluded(relativePath)) {
    return false;
  }
  for (const glob of selective.excludeGlobs ?? []) {
    if (matchGlob(relativePath, glob)) {
      return false;
    }
  }
  const ext = extOf(relativePath);
  if (!ext) {
    return selective.includeFolders;
  }
  if (IMAGE_EXT.has(ext)) {
    return selective.includeImages;
  }
  if (AUDIO_EXT.has(ext)) {
    return selective.includeAudio;
  }
  if (VIDEO_EXT.has(ext)) {
    return selective.includeVideo;
  }
  if (PDF_EXT.has(ext)) {
    return selective.includePdf;
  }
  return selective.includeOtherAttachments;
}

export function guessMime(fileName: string): string {
  const ext = extOf(fileName);
  const map: Record<string, string> = {
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  };
  return map[ext] ?? "application/octet-stream";
}
