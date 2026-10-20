type BaselineEntry = {
  relativePath: string;
  sizeBytes: number;
  mtimeMs: number;
  lastRevisionId?: string | null;
  updatedAt: string;
};

type BaselineStore = {
  version: 1;
  vaultId: string;
  deviceId: string;
  entries: Record<string, BaselineEntry>;
  updatedAt: string;
};

function storageKey(vaultId: string, deviceId: string): string {
  return `openbot:vault-sync:baseline:${vaultId}:${deviceId}`;
}

function emptyStore(vaultId: string, deviceId: string): BaselineStore {
  return {
    version: 1,
    vaultId,
    deviceId,
    entries: {},
    updatedAt: new Date(0).toISOString(),
  };
}

export function loadClientInventoryBaseline(vaultId: string, deviceId: string): BaselineStore {
  try {
    const raw = localStorage.getItem(storageKey(vaultId, deviceId));
    if (!raw) {
      return emptyStore(vaultId, deviceId);
    }
    const parsed = JSON.parse(raw) as BaselineStore;
    if (parsed.version !== 1 || parsed.vaultId !== vaultId || parsed.deviceId !== deviceId) {
      return emptyStore(vaultId, deviceId);
    }
    return parsed;
  } catch {
    return emptyStore(vaultId, deviceId);
  }
}

export function saveClientInventoryBaseline(store: BaselineStore): void {
  store.updatedAt = new Date().toISOString();
  localStorage.setItem(storageKey(store.vaultId, store.deviceId), JSON.stringify(store));
}

export function baselineEntryChanged(
  store: BaselineStore,
  relativePath: string,
  sizeBytes: number,
  mtimeMs: number,
): boolean {
  const prev = store.entries[relativePath];
  if (!prev) {
    return true;
  }
  return prev.sizeBytes !== sizeBytes || prev.mtimeMs !== mtimeMs;
}

export function upsertClientBaselineEntry(
  store: BaselineStore,
  entry: Omit<BaselineEntry, "updatedAt">,
): void {
  store.entries[entry.relativePath] = {
    ...entry,
    updatedAt: new Date().toISOString(),
  };
}

export function removeClientBaselineEntry(store: BaselineStore, relativePath: string): void {
  delete store.entries[relativePath];
}
