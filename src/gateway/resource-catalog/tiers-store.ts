/**
 * Resource Tier store（平台全局，非租户隔离）。
 * 落盘：`CONFIG_DIR/openbot-resource-tiers.json`。
 */

import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import type { ResourceTier, ResourceTierId } from "./types.js";

const STORE_VERSION = 1;

export const DEFAULT_RESOURCE_TIERS: Array<
  Pick<ResourceTier, "id" | "code" | "name" | "description" | "sortOrder">
> = [
  {
    id: "tier_a",
    code: "tier_a",
    name: "Tier A",
    description: "低成本模型层",
    sortOrder: 10,
  },
  {
    id: "tier_b",
    code: "tier_b",
    name: "Tier B",
    description: "成本与质量平衡层",
    sortOrder: 20,
  },
  {
    id: "tier_c",
    code: "tier_c",
    name: "Tier C",
    description: "高质量模型层",
    sortOrder: 30,
  },
];

type Store = {
  version: number;
  tiers: Record<ResourceTierId, ResourceTier>;
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, tiers: {} };
}

export function resolveDefaultResourceTiersStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-resource-tiers.json");
}

const withLock = createAsyncLock();

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultResourceTiersStorePath());
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.tiers !== "object" || parsed.tiers === null) {
    return createEmptyStore();
  }
  return { version: STORE_VERSION, tiers: parsed.tiers };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultResourceTiersStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

export async function listResourceTiers(storePath?: string): Promise<ResourceTier[]> {
  const store = await loadStore(storePath);
  return Object.values(store.tiers).toSorted(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
  );
}

export async function getResourceTier(
  tierId: ResourceTierId,
  storePath?: string,
): Promise<ResourceTier | null> {
  const id = tierId.trim();
  if (!id) {
    return null;
  }
  const store = await loadStore(storePath);
  return store.tiers[id] ?? null;
}

export async function ensureDefaultResourceTiers(storePath?: string): Promise<ResourceTier[]> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const now = new Date().toISOString();
    let changed = false;
    for (const seed of DEFAULT_RESOURCE_TIERS) {
      if (!store.tiers[seed.id]) {
        store.tiers[seed.id] = {
          ...seed,
          status: "active",
          createdAt: now,
          updatedAt: now,
        };
        changed = true;
      }
    }
    if (changed) {
      await saveStore(store, storePath);
    }
    return Object.values(store.tiers).toSorted((a, b) => a.sortOrder - b.sortOrder);
  });
}

export async function upsertResourceTier(
  input: {
    id: ResourceTierId;
    code: string;
    name: string;
    description?: string;
    sortOrder?: number;
    status?: ResourceTier["status"];
  },
  storePath?: string,
): Promise<ResourceTier> {
  const id = input.id.trim();
  if (!id) {
    throw new Error("invalid tier id");
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const now = new Date().toISOString();
    const prev = store.tiers[id];
    const record: ResourceTier = {
      id,
      code: input.code.trim() || id,
      name: input.name.trim() || id,
      description: input.description?.trim() ?? prev?.description ?? "",
      sortOrder: input.sortOrder ?? prev?.sortOrder ?? 100,
      status: input.status ?? prev?.status ?? "active",
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    store.tiers[id] = record;
    await saveStore(store, storePath);
    return record;
  });
}
