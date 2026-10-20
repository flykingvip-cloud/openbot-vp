/**
 * Device-local selective sync preferences (P2.3).
 * Stored under localStoreDir — never uploaded as plaintext policy to the control plane.
 */
import fs from "node:fs";
import path from "node:path";
import type { SelectiveSyncOptions } from "./types.js";
import { DEFAULT_SELECTIVE_SYNC } from "./types.js";

export type StoredSelectiveSync = SelectiveSyncOptions & {
  excludeGlobs: string[];
  updatedAt: string;
};

export function normalizeSelectiveSync(
  input?: (Partial<SelectiveSyncOptions> & { excludeGlobs?: string[] }) | null,
): StoredSelectiveSync {
  return {
    includeFolders: input?.includeFolders ?? DEFAULT_SELECTIVE_SYNC.includeFolders,
    includeImages: input?.includeImages ?? DEFAULT_SELECTIVE_SYNC.includeImages,
    includeAudio: input?.includeAudio ?? DEFAULT_SELECTIVE_SYNC.includeAudio,
    includeVideo: input?.includeVideo ?? DEFAULT_SELECTIVE_SYNC.includeVideo,
    includePdf: input?.includePdf ?? DEFAULT_SELECTIVE_SYNC.includePdf,
    includeOtherAttachments:
      input?.includeOtherAttachments ?? DEFAULT_SELECTIVE_SYNC.includeOtherAttachments,
    excludeGlobs: [...(input?.excludeGlobs ?? [])].map((g) => g.trim()).filter(Boolean),
    updatedAt: new Date().toISOString(),
  };
}

function storePath(localStoreDir: string, vaultId: string, deviceId: string): string {
  return path.join(localStoreDir, vaultId, deviceId, "selective-sync.json");
}

export function loadSelectiveSync(
  localStoreDir: string,
  vaultId: string,
  deviceId: string,
): StoredSelectiveSync {
  const file = storePath(localStoreDir, vaultId, deviceId);
  if (!fs.existsSync(file)) {
    return normalizeSelectiveSync();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<StoredSelectiveSync>;
    return normalizeSelectiveSync(raw);
  } catch {
    return normalizeSelectiveSync();
  }
}

export function saveSelectiveSync(
  localStoreDir: string,
  vaultId: string,
  deviceId: string,
  input?: (Partial<SelectiveSyncOptions> & { excludeGlobs?: string[] }) | null,
): StoredSelectiveSync {
  const next = normalizeSelectiveSync(input);
  const file = storePath(localStoreDir, vaultId, deviceId);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return next;
}
