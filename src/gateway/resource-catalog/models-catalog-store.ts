/**
 * Resource Model Catalog store（平台全局）。
 * 落盘：`CONFIG_DIR/openbot-resource-model-catalog.json`。
 */

import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { inferModelCapabilities, normalizeModelCapabilities } from "./model-metadata.js";
import type { ModelRef, ResourceModelCatalogEntry, ResourceTierId } from "./types.js";

const STORE_VERSION = 1;

type Store = {
  version: number;
  models: Record<ModelRef, ResourceModelCatalogEntry>;
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, models: {} };
}

export function resolveDefaultResourceModelCatalogStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-resource-model-catalog.json");
}

const withLock = createAsyncLock();

function parseProvider(modelId: ModelRef): string {
  const slash = modelId.indexOf("/");
  return slash > 0 ? modelId.slice(0, slash) : modelId;
}

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultResourceModelCatalogStorePath(),
  );
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.models !== "object" || parsed.models === null) {
    return createEmptyStore();
  }
  return { version: STORE_VERSION, models: parsed.models };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultResourceModelCatalogStorePath(),
  );
  await writeJsonAtomic(resolvedPath, store);
}

export async function listResourceModelCatalog(
  storePath?: string,
): Promise<ResourceModelCatalogEntry[]> {
  const store = await loadStore(storePath);
  return Object.values(store.models).toSorted((a, b) => a.modelId.localeCompare(b.modelId));
}

export async function getResourceModelCatalogEntry(
  modelId: ModelRef,
  storePath?: string,
): Promise<ResourceModelCatalogEntry | null> {
  const id = modelId.trim();
  if (!id) {
    return null;
  }
  const store = await loadStore(storePath);
  return store.models[id] ?? null;
}

export async function upsertResourceModelCatalogEntry(
  input: {
    modelId: ModelRef;
    provider?: string;
    displayName?: string;
    tier: ResourceTierId;
    enabled?: boolean;
    contextWindow?: number;
    capabilities?: ResourceModelCatalogEntry["capabilities"];
    avgTokensPerTask?: number;
    inputCostPer1MCents?: number;
    outputCostPer1MCents?: number;
  },
  storePath?: string,
): Promise<ResourceModelCatalogEntry> {
  const modelId = input.modelId.trim();
  if (!modelId) {
    throw new Error("invalid modelId");
  }
  const tier = input.tier.trim();
  if (!tier) {
    throw new Error("tier is required");
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const now = new Date().toISOString();
    const prev = store.models[modelId];
    const displayName = input.displayName?.trim() || prev?.displayName || modelId;
    const contextWindow =
      input.contextWindow !== undefined
        ? Math.max(0, Math.floor(input.contextWindow))
        : prev?.contextWindow;
    const capabilities =
      normalizeModelCapabilities(input.capabilities) ??
      prev?.capabilities ??
      inferModelCapabilities({ modelId, displayName, contextWindow });
    const avgTokensPerTask =
      input.avgTokensPerTask !== undefined
        ? Math.max(0, Math.floor(input.avgTokensPerTask))
        : prev?.avgTokensPerTask;
    const record: ResourceModelCatalogEntry = {
      modelId,
      provider: input.provider?.trim() || prev?.provider || parseProvider(modelId),
      displayName,
      tier,
      enabled: input.enabled ?? prev?.enabled ?? true,
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(capabilities.length > 0 ? { capabilities } : {}),
      ...(avgTokensPerTask !== undefined && avgTokensPerTask > 0 ? { avgTokensPerTask } : {}),
      inputCostPer1MCents: Math.max(
        0,
        Math.floor(input.inputCostPer1MCents ?? prev?.inputCostPer1MCents ?? 0),
      ),
      outputCostPer1MCents: Math.max(
        0,
        Math.floor(input.outputCostPer1MCents ?? prev?.outputCostPer1MCents ?? 0),
      ),
      updatedAt: now,
    };
    const prevEnabled = prev?.enabled;
    const prevTier = prev?.tier;
    store.models[modelId] = record;
    await saveStore(store, storePath);
    // Immediate re-projection when enablement or tier changes (no wait for subscription events).
    if (prev && (prevEnabled !== record.enabled || prevTier !== record.tier)) {
      try {
        const { refreshEntitlementsAfterCatalogChange } =
          await import("../model-entitlement/entitlement-projection.js");
        await refreshEntitlementsAfterCatalogChange({ modelCatalogStorePath: storePath });
      } catch {
        // Projection refresh is best-effort; runtime still intersects live catalog.
      }
    }
    return record;
  });
}

export type SeedModelCatalogEntry = {
  modelId: ModelRef;
  provider: string;
  displayName: string;
  contextWindow?: number;
  defaultTier?: ResourceTierId;
  /** 默认输入成本：每 1M token，整数分（缺省 0）。 */
  inputCostPer1MCents?: number;
  /** 默认输出成本：每 1M token，整数分（缺省 0）。 */
  outputCostPer1MCents?: number;
};

/** 从配置枚举批量写入目录（已存在条目不覆盖 tier/成本，仅补缺失）。 */
export async function seedResourceModelCatalog(
  entries: SeedModelCatalogEntry[],
  opts?: { defaultTier?: ResourceTierId; storePath?: string },
): Promise<{ created: number; skipped: number; total: number }> {
  const defaultTier = opts?.defaultTier?.trim() || "tier_b";
  return withLock(async () => {
    const store = await loadStore(opts?.storePath);
    const now = new Date().toISOString();
    let created = 0;
    let skipped = 0;
    for (const entry of entries) {
      const modelId = entry.modelId.trim();
      if (!modelId) {
        continue;
      }
      if (store.models[modelId]) {
        skipped += 1;
        continue;
      }
      store.models[modelId] = {
        modelId,
        provider: entry.provider.trim() || parseProvider(modelId),
        displayName: entry.displayName.trim() || modelId,
        tier: entry.defaultTier?.trim() || defaultTier,
        enabled: true,
        ...(entry.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
        capabilities: inferModelCapabilities({
          modelId,
          displayName: entry.displayName.trim() || modelId,
          contextWindow: entry.contextWindow,
        }),
        inputCostPer1MCents: Math.max(0, Math.floor(entry.inputCostPer1MCents ?? 0)),
        outputCostPer1MCents: Math.max(0, Math.floor(entry.outputCostPer1MCents ?? 0)),
        updatedAt: now,
      };
      created += 1;
    }
    if (created > 0) {
      await saveStore(store, opts?.storePath);
    }
    return { created, skipped, total: entries.length };
  });
}
