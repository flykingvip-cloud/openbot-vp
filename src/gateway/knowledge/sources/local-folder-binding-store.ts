/**
 * Device-local store for LocalFolderBinding (layer 2).
 * rootPath is persisted here only — never on SourceDescriptor.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../../utils.js";
import type {
  LocalFolderBinding,
  LocalFolderBindingMode,
  LocalFolderBindingStatus,
  LocalFolderDeletePolicy,
} from "./local-folder-types.js";

type LocalFolderBindingStoreFile = {
  bindings: Record<string, LocalFolderBinding>;
};

const DEFAULT_STORE_FILE = path.join(CONFIG_DIR, "knowledge", "local-folder-bindings.json");

const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.DS_Store"];

export function defaultLocalFolderBindingStorePath(): string {
  return DEFAULT_STORE_FILE;
}

function readStore(storePath: string): LocalFolderBindingStoreFile {
  try {
    if (!fs.existsSync(storePath)) {
      return { bindings: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf-8")) as unknown;
    const record =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const bindings =
      typeof record.bindings === "object" &&
      record.bindings !== null &&
      !Array.isArray(record.bindings)
        ? (record.bindings as Record<string, LocalFolderBinding>)
        : {};
    return { bindings };
  } catch {
    return { bindings: {} };
  }
}

function writeStore(store: LocalFolderBindingStoreFile, storePath: string): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const temporaryPath = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, storePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

export function buildLocalFolderBindingId(params: {
  knowledgeBaseId: string;
  deviceId: string;
  rootPath: string;
  mode?: LocalFolderBindingMode;
  rootLabel?: string;
  directoryId?: string;
}): string {
  const mode = params.mode ?? "local_index";
  const deviceKey = params.deviceId.trim() || "unknown-device";
  let identityKey: string;
  if (mode === "managed_push") {
    const directoryId = params.directoryId?.trim();
    if (!directoryId) {
      throw new Error("directoryId required for managed_push binding identity");
    }
    identityKey = `directory::${directoryId}`;
  } else {
    const rootPath = params.rootPath.trim();
    if (!rootPath) {
      throw new Error("rootPath required for local_index binding identity");
    }
    identityKey = path.resolve(rootPath);
  }
  const key = `${params.knowledgeBaseId}::${deviceKey}::${mode}::${identityKey}`;
  return `lfb:${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

export function upsertLocalFolderBinding(
  params: {
    bindingId?: string;
    sourceDescriptorId: string;
    knowledgeBaseId: string;
    deviceId: string;
    mode?: LocalFolderBindingMode;
    directoryId?: string;
    rootPath: string;
    rootLabel: string;
    includeGlobs?: string[];
    excludeGlobs?: string[];
    deletePolicy?: LocalFolderDeletePolicy;
    watcherEnabled?: boolean;
    status?: LocalFolderBindingStatus;
    lastScanAt?: number;
    lastEventAt?: number;
    lastError?: string | null;
  },
  storePath: string = DEFAULT_STORE_FILE,
): LocalFolderBinding {
  const mode = params.mode ?? "local_index";
  const trimmedPath = params.rootPath.trim();
  const deviceId = params.deviceId.trim() || "local";
  const directoryId = params.directoryId?.trim();
  if (mode === "local_index" && !trimmedPath) {
    throw new Error("rootPath required for local_index mode");
  }
  if (mode === "managed_push" && !directoryId) {
    throw new Error("directoryId required for managed_push mode");
  }
  // managed_push: never persist absolute paths on the gateway (device-local only).
  // local_index: resolve absolute path for same-host scan.
  const rootPath = mode === "managed_push" ? "" : path.resolve(trimmedPath);
  const bindingId =
    params.bindingId?.trim() ||
    buildLocalFolderBindingId({
      knowledgeBaseId: params.knowledgeBaseId,
      deviceId,
      rootPath,
      mode,
      directoryId,
    });
  const store = readStore(storePath);
  const existing = store.bindings[bindingId];
  if (existing) {
    if (existing.mode === "managed_push" && !existing.directoryId?.trim()) {
      throw new Error("legacy managed_push binding has no directoryId; rebind the directory");
    }
    const identityMismatch =
      existing.knowledgeBaseId !== params.knowledgeBaseId ||
      existing.deviceId !== deviceId ||
      existing.mode !== mode ||
      (mode === "managed_push" && existing.directoryId !== directoryId) ||
      (mode === "local_index" && path.resolve(existing.rootPath) !== rootPath);
    if (identityMismatch) {
      throw new Error("bindingId identity mismatch");
    }
  }
  const previousRevision =
    typeof existing?.revision === "number" && Number.isSafeInteger(existing.revision)
      ? existing.revision
      : 0;
  const binding: LocalFolderBinding = {
    bindingId,
    sourceDescriptorId: params.sourceDescriptorId,
    knowledgeBaseId: params.knowledgeBaseId,
    deviceId,
    mode,
    revision: previousRevision + 1,
    ...(mode === "managed_push" && directoryId ? { directoryId } : {}),
    rootPath,
    rootLabel: params.rootLabel.trim() || (rootPath ? path.basename(rootPath) : "") || "folder",
    includeGlobs:
      params.includeGlobs && params.includeGlobs.length > 0
        ? params.includeGlobs
        : (existing?.includeGlobs ?? ["**/*"]),
    excludeGlobs:
      params.excludeGlobs && params.excludeGlobs.length > 0
        ? params.excludeGlobs
        : (existing?.excludeGlobs ?? DEFAULT_EXCLUDE),
    deletePolicy: params.deletePolicy ?? existing?.deletePolicy ?? "snapshot",
    watcherEnabled: params.watcherEnabled ?? existing?.watcherEnabled ?? false,
    status: params.status ?? existing?.status ?? "idle",
    lastScanAt: params.lastScanAt ?? existing?.lastScanAt,
    lastEventAt: params.lastEventAt ?? existing?.lastEventAt,
    lastError: params.lastError === null ? undefined : (params.lastError ?? existing?.lastError),
  };
  store.bindings[bindingId] = binding;
  writeStore(store, storePath);
  return binding;
}

export function getLocalFolderBinding(
  bindingId: string,
  storePath: string = DEFAULT_STORE_FILE,
): LocalFolderBinding | null {
  const store = readStore(storePath);
  return store.bindings[bindingId.trim()] ?? null;
}

export function findLocalFolderBinding(params: {
  bindingId?: string;
  sourceDescriptorId?: string;
  knowledgeBaseId?: string;
  storePath?: string;
}): LocalFolderBinding | null {
  const store = readStore(params.storePath ?? DEFAULT_STORE_FILE);
  if (params.bindingId?.trim()) {
    return store.bindings[params.bindingId.trim()] ?? null;
  }
  const all = Object.values(store.bindings);
  const sourceDescriptorId = params.sourceDescriptorId?.trim();
  if (sourceDescriptorId) {
    return all.find((item) => item.sourceDescriptorId === sourceDescriptorId) ?? null;
  }
  const knowledgeBaseId = params.knowledgeBaseId?.trim();
  if (knowledgeBaseId) {
    return all.find((item) => item.knowledgeBaseId === knowledgeBaseId) ?? null;
  }
  return null;
}

export function listLocalFolderBindings(
  filter: { knowledgeBaseId?: string; deviceId?: string; sourceDescriptorId?: string } = {},
  storePath: string = DEFAULT_STORE_FILE,
): LocalFolderBinding[] {
  const store = readStore(storePath);
  return Object.values(store.bindings)
    .filter((item) =>
      filter.knowledgeBaseId ? item.knowledgeBaseId === filter.knowledgeBaseId : true,
    )
    .filter((item) => (filter.deviceId ? item.deviceId === filter.deviceId : true))
    .filter((item) =>
      filter.sourceDescriptorId ? item.sourceDescriptorId === filter.sourceDescriptorId : true,
    )
    .toSorted((a, b) => (b.lastScanAt ?? 0) - (a.lastScanAt ?? 0));
}

export function updateLocalFolderBindingStatus(
  bindingId: string,
  patch: {
    status?: LocalFolderBindingStatus;
    lastScanAt?: number;
    lastEventAt?: number;
    lastError?: string | null;
  },
  storePath: string = DEFAULT_STORE_FILE,
): LocalFolderBinding | null {
  const store = readStore(storePath);
  const existing = store.bindings[bindingId.trim()];
  if (!existing) {
    return null;
  }
  const next: LocalFolderBinding = {
    ...existing,
    status: patch.status ?? existing.status,
    lastScanAt: patch.lastScanAt ?? existing.lastScanAt,
    lastEventAt: patch.lastEventAt ?? existing.lastEventAt,
    lastError: patch.lastError === null ? undefined : (patch.lastError ?? existing.lastError),
  };
  store.bindings[bindingId.trim()] = next;
  writeStore(store, storePath);
  return next;
}

export function deleteLocalFolderBinding(
  bindingId: string,
  storePath: string = DEFAULT_STORE_FILE,
): boolean {
  const store = readStore(storePath);
  if (!store.bindings[bindingId.trim()]) {
    return false;
  }
  delete store.bindings[bindingId.trim()];
  writeStore(store, storePath);
  return true;
}

/** Fresh id when no path is known yet (rare). */
export function newLocalFolderBindingId(): string {
  return `lfb:${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}
