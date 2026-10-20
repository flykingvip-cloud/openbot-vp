/**
 * Credit Weight store（Tier → Credits 扣减权重）。
 * 落盘：`CONFIG_DIR/openbot-resource-credit-weights.json`。
 */

import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import type { CreditWeight, ResourceTierId } from "./types.js";

const STORE_VERSION = 1;

export const DEFAULT_CREDIT_WEIGHTS: Array<{ tier: ResourceTierId; creditCost: number }> = [
  { tier: "tier_a", creditCost: 1 },
  { tier: "tier_b", creditCost: 5 },
  { tier: "tier_c", creditCost: 20 },
];

type Store = {
  version: number;
  weights: Record<ResourceTierId, CreditWeight>;
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, weights: {} };
}

export function resolveDefaultCreditWeightsStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-resource-credit-weights.json");
}

const withLock = createAsyncLock();

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultCreditWeightsStorePath());
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.weights !== "object" || parsed.weights === null) {
    return createEmptyStore();
  }
  return { version: STORE_VERSION, weights: parsed.weights };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultCreditWeightsStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

export async function listCreditWeights(storePath?: string): Promise<CreditWeight[]> {
  const store = await loadStore(storePath);
  return Object.values(store.weights).toSorted((a, b) => a.tier.localeCompare(b.tier));
}

export async function ensureDefaultCreditWeights(storePath?: string): Promise<CreditWeight[]> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const now = new Date().toISOString();
    let changed = false;
    for (const seed of DEFAULT_CREDIT_WEIGHTS) {
      if (!store.weights[seed.tier]) {
        store.weights[seed.tier] = {
          tier: seed.tier,
          creditCost: seed.creditCost,
          updatedAt: now,
        };
        changed = true;
      }
    }
    if (changed) {
      await saveStore(store, storePath);
    }
    return Object.values(store.weights).toSorted((a, b) => a.tier.localeCompare(b.tier));
  });
}

export async function upsertCreditWeight(
  input: { tier: ResourceTierId; creditCost: number },
  storePath?: string,
): Promise<CreditWeight> {
  const tier = input.tier.trim();
  if (!tier) {
    throw new Error("invalid tier");
  }
  if (!Number.isFinite(input.creditCost) || input.creditCost < 0) {
    throw new Error("creditCost must be a non-negative number");
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const now = new Date().toISOString();
    const record: CreditWeight = {
      tier,
      creditCost: Math.floor(input.creditCost),
      updatedAt: now,
    };
    store.weights[tier] = record;
    await saveStore(store, storePath);
    return record;
  });
}
