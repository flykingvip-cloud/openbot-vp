/**
 * Routing Policy store（平台全局）。
 * 落盘：`CONFIG_DIR/openbot-routing-policies.json`。
 */

import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import type { RoutingPolicy, RoutingPolicyId } from "./types.js";

const STORE_VERSION = 1;

export const BUILTIN_ROUTING_POLICIES: Array<
  Pick<RoutingPolicy, "id" | "name" | "description" | "selectorStrategy">
> = [
  {
    id: "cost",
    name: "Cost",
    description: "优先最低成本模型",
    selectorStrategy: "cheapest",
  },
  {
    id: "balanced",
    name: "Balanced",
    description: "成本与质量平衡",
    selectorStrategy: "balanced",
  },
  {
    id: "quality",
    name: "Quality",
    description: "优先最佳质量",
    selectorStrategy: "best_quality",
  },
];

type Store = {
  version: number;
  policies: Record<RoutingPolicyId, RoutingPolicy>;
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, policies: {} };
}

export function resolveDefaultRoutingPoliciesStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-routing-policies.json");
}

const withLock = createAsyncLock();

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultRoutingPoliciesStorePath(),
  );
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.policies !== "object" || parsed.policies === null) {
    return createEmptyStore();
  }
  return { version: STORE_VERSION, policies: parsed.policies };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultRoutingPoliciesStorePath(),
  );
  await writeJsonAtomic(resolvedPath, store);
}

export async function listRoutingPolicies(storePath?: string): Promise<RoutingPolicy[]> {
  await ensureBuiltinRoutingPolicies(storePath);
  const store = await loadStore(storePath);
  return Object.values(store.policies)
    .filter((p) => p.status === "active")
    .toSorted((a, b) => a.id.localeCompare(b.id));
}

export async function getRoutingPolicy(
  policyId: RoutingPolicyId,
  storePath?: string,
): Promise<RoutingPolicy | null> {
  await ensureBuiltinRoutingPolicies(storePath);
  const id = policyId.trim();
  if (!id) {
    return null;
  }
  const store = await loadStore(storePath);
  const policy = store.policies[id];
  return policy?.status === "active" ? policy : null;
}

export async function ensureBuiltinRoutingPolicies(storePath?: string): Promise<RoutingPolicy[]> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const now = new Date().toISOString();
    let changed = false;
    for (const seed of BUILTIN_ROUTING_POLICIES) {
      if (!store.policies[seed.id]) {
        store.policies[seed.id] = {
          ...seed,
          status: "active",
          builtin: true,
          updatedAt: now,
        };
        changed = true;
      }
    }
    if (changed) {
      await saveStore(store, storePath);
    }
    return Object.values(store.policies).toSorted((a, b) => a.id.localeCompare(b.id));
  });
}
