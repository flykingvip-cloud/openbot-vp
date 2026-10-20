import fs from "node:fs";
import path from "node:path";

export type InventoryBaselineEntry = {
  relativePath: string;
  sizeBytes: number;
  mtimeMs: number;
  /** sha256 hex of last uploaded plaintext (optional, computed on commit). */
  contentHash?: string | null;
  lastRevisionId?: string | null;
  updatedAt: string;
};

export type InventoryBaselineStore = {
  version: 1;
  vaultId: string;
  deviceId: string;
  entries: Record<string, InventoryBaselineEntry>;
  updatedAt: string;
};

function baselinePath(localStoreDir: string, vaultId: string, deviceId: string): string {
  return path.join(localStoreDir, "inventory-baseline", `${vaultId}-${deviceId}.json`);
}

export function loadInventoryBaseline(
  localStoreDir: string,
  vaultId: string,
  deviceId: string,
): InventoryBaselineStore {
  const file = baselinePath(localStoreDir, vaultId, deviceId);
  if (!fs.existsSync(file)) {
    return {
      version: 1,
      vaultId,
      deviceId,
      entries: {},
      updatedAt: new Date(0).toISOString(),
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as InventoryBaselineStore;
    if (parsed.version !== 1 || parsed.vaultId !== vaultId || parsed.deviceId !== deviceId) {
      return {
        version: 1,
        vaultId,
        deviceId,
        entries: {},
        updatedAt: new Date(0).toISOString(),
      };
    }
    return parsed;
  } catch {
    return {
      version: 1,
      vaultId,
      deviceId,
      entries: {},
      updatedAt: new Date(0).toISOString(),
    };
  }
}

export function saveInventoryBaseline(store: InventoryBaselineStore, localStoreDir: string): void {
  const file = baselinePath(localStoreDir, store.vaultId, store.deviceId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(store, null, 2), "utf8");
}

export function baselineEntryChanged(
  baseline: InventoryBaselineStore,
  relativePath: string,
  sizeBytes: number,
  mtimeMs: number,
): boolean {
  const prev = baseline.entries[relativePath];
  if (!prev) {
    return true;
  }
  return prev.sizeBytes !== sizeBytes || prev.mtimeMs !== mtimeMs;
}

export function upsertBaselineEntry(
  baseline: InventoryBaselineStore,
  entry: Omit<InventoryBaselineEntry, "updatedAt">,
): void {
  baseline.entries[entry.relativePath] = {
    ...entry,
    updatedAt: new Date().toISOString(),
  };
}

export function removeBaselineEntry(baseline: InventoryBaselineStore, relativePath: string): void {
  delete baseline.entries[relativePath];
}
