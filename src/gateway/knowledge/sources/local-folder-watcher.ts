import fs from "node:fs";
import path from "node:path";
/**
 * P1.1 continuous local-folder watchers (chokidar).
 * Debounced full reconcile via scanLocalFolderBinding — document-level delta skips unchanged files.
 */
import chokidar, { type FSWatcher } from "chokidar";
import { getKnowledgeBase } from "../knowledge-base-store.js";
import {
  findLocalFolderBinding,
  listLocalFolderBindings,
  updateLocalFolderBindingStatus,
} from "./local-folder-binding-store.js";
import { scanLocalFolderBinding, type LocalFolderScanSummary } from "./local-folder-runtime.js";
import type { LocalFolderBinding } from "./local-folder-types.js";

export type LocalFolderWatchScanFn = (params: {
  binding: LocalFolderBinding;
}) => Promise<LocalFolderScanSummary | void>;

type WatcherEntry = {
  bindingId: string;
  rootPath: string;
  watcher: FSWatcher;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  scanning: boolean;
  pending: boolean;
};

const DEBOUNCE_MS = 750;

const active = new Map<string, WatcherEntry>();
let scanFn: LocalFolderWatchScanFn | null = null;

export function setLocalFolderWatchScanFn(fn: LocalFolderWatchScanFn | null): void {
  scanFn = fn;
}

export function isLocalFolderWatcherRunning(bindingId: string): boolean {
  return active.has(bindingId.trim());
}

export function listRunningLocalFolderWatcherIds(): string[] {
  return [...active.keys()];
}

async function defaultScan(params: {
  binding: LocalFolderBinding;
}): Promise<LocalFolderScanSummary | void> {
  const kb = getKnowledgeBase(params.binding.knowledgeBaseId);
  if (!kb) {
    updateLocalFolderBindingStatus(params.binding.bindingId, {
      status: "error",
      lastError: "knowledge base not found for watcher scan",
    });
    return;
  }
  return scanLocalFolderBinding({
    binding: params.binding,
    knowledgeBase: kb,
    ownerId: kb.ownerId,
    embeddingProvider: null,
  });
}

async function runDebouncedScan(bindingId: string): Promise<void> {
  const entry = active.get(bindingId);
  if (!entry) {
    return;
  }
  if (entry.scanning) {
    entry.pending = true;
    return;
  }
  entry.scanning = true;
  entry.pending = false;
  try {
    const binding = findLocalFolderBinding({ bindingId });
    if (!binding || !binding.watcherEnabled || binding.mode !== "local_index") {
      await stopLocalFolderWatcher(bindingId);
      return;
    }
    const fn = scanFn ?? defaultScan;
    await fn({ binding });
  } catch (error) {
    const message = error instanceof Error ? error.message : "watcher scan failed";
    updateLocalFolderBindingStatus(bindingId, {
      status: "error",
      lastError: message,
      lastEventAt: Date.now(),
    });
  } finally {
    const current = active.get(bindingId);
    if (current) {
      current.scanning = false;
      if (current.pending) {
        current.pending = false;
        scheduleScan(bindingId);
      }
    }
  }
}

function scheduleScan(bindingId: string): void {
  const entry = active.get(bindingId);
  if (!entry) {
    return;
  }
  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer);
  }
  entry.debounceTimer = setTimeout(() => {
    entry.debounceTimer = null;
    void runDebouncedScan(bindingId);
  }, DEBOUNCE_MS);
  entry.debounceTimer.unref?.();
  updateLocalFolderBindingStatus(bindingId, { lastEventAt: Date.now() });
}

export function startLocalFolderWatcher(binding: LocalFolderBinding): boolean {
  if (binding.mode !== "local_index" || !binding.watcherEnabled) {
    return false;
  }
  const rootPath = path.resolve(binding.rootPath);
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    updateLocalFolderBindingStatus(binding.bindingId, {
      status: "error",
      lastError: `watcher root missing: ${rootPath}`,
    });
    return false;
  }

  const existing = active.get(binding.bindingId);
  if (existing) {
    if (existing.rootPath === rootPath) {
      return true;
    }
    void stopLocalFolderWatcher(binding.bindingId);
  }

  const ignored = [
    /(^|[\\/])\../, // dotfiles
    /(^|[\\/])node_modules([\\/]|$)/,
    /(^|[\\/])\.git([\\/]|$)/,
    /(^|[\\/])dist([\\/]|$)/,
  ];

  const watcher = chokidar.watch(rootPath, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 400,
      pollInterval: 100,
    },
    ignored,
    depth: 12,
  });

  const entry: WatcherEntry = {
    bindingId: binding.bindingId,
    rootPath,
    watcher,
    debounceTimer: null,
    scanning: false,
    pending: false,
  };
  active.set(binding.bindingId, entry);

  watcher.on("all", () => {
    scheduleScan(binding.bindingId);
  });
  watcher.on("error", (err) => {
    updateLocalFolderBindingStatus(binding.bindingId, {
      status: "error",
      lastError: `watcher error: ${String(err)}`,
      lastEventAt: Date.now(),
    });
    void stopLocalFolderWatcher(binding.bindingId);
  });

  return true;
}

export async function stopLocalFolderWatcher(bindingId: string): Promise<boolean> {
  const entry = active.get(bindingId.trim());
  if (!entry) {
    return false;
  }
  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer);
    entry.debounceTimer = null;
  }
  active.delete(bindingId.trim());
  try {
    await entry.watcher.close();
  } catch {
    // ignore close errors
  }
  return true;
}

export async function stopAllLocalFolderWatchers(): Promise<void> {
  const ids = [...active.keys()];
  await Promise.all(ids.map((id) => stopLocalFolderWatcher(id)));
}

/**
 * Resume watchers for bindings with watcherEnabled (local_index only).
 * Safe to call on gateway startup.
 */
export function resumeLocalFolderWatchers(params?: {
  storePath?: string;
  log?: { info?: (msg: string) => void; warn?: (msg: string) => void };
}): { started: number; skipped: number } {
  const bindings = listLocalFolderBindings({}, params?.storePath);
  let started = 0;
  let skipped = 0;
  for (const binding of bindings) {
    if (!binding.watcherEnabled || binding.mode !== "local_index") {
      skipped += 1;
      continue;
    }
    const ok = startLocalFolderWatcher(binding);
    if (ok) {
      started += 1;
    } else {
      skipped += 1;
      params?.log?.warn?.(
        `local-folder watcher not started for ${binding.bindingId} (${binding.rootLabel})`,
      );
    }
  }
  if (started > 0) {
    params?.log?.info?.(`local-folder watchers resumed: ${started}`);
  }
  return { started, skipped };
}

/** Test helper: clear registry without awaiting chokidar (best-effort). */
export async function resetLocalFolderWatchersForTests(): Promise<void> {
  setLocalFolderWatchScanFn(null);
  await stopAllLocalFolderWatchers();
}

/** Test helper: simulate a filesystem event for an active watcher. */
export function emitLocalFolderWatcherEventForTests(bindingId: string): void {
  if (!active.has(bindingId.trim())) {
    throw new Error(`no active watcher for ${bindingId}`);
  }
  scheduleScan(bindingId.trim());
}
