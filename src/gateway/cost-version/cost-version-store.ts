/**
 * CostVersion store（平台全局）。
 * 落盘：`CONFIG_DIR/openbot-cost-versions.json`。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { listResourceModelCatalog } from "../resource-catalog/models-catalog-store.js";
import type { CostVersion, ModelCostSnapshot } from "./types.js";

const STORE_VERSION = 1;

type Store = {
  version: number;
  activeVersionId: string | null;
  versions: Record<string, CostVersion>;
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, activeVersionId: null, versions: {} };
}

export function resolveDefaultCostVersionStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-cost-versions.json");
}

const withLock = createAsyncLock();

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultCostVersionStorePath());
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.versions !== "object" || parsed.versions === null) {
    return createEmptyStore();
  }
  return {
    version: STORE_VERSION,
    activeVersionId: typeof parsed.activeVersionId === "string" ? parsed.activeVersionId : null,
    versions: parsed.versions,
  };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultCostVersionStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

export async function listCostVersions(storePath?: string): Promise<CostVersion[]> {
  const store = await loadStore(storePath);
  return Object.values(store.versions).toSorted((a, b) => b.version - a.version);
}

export async function getCostVersion(
  versionId: string,
  storePath?: string,
): Promise<CostVersion | null> {
  const id = versionId.trim();
  if (!id) {
    return null;
  }
  const store = await loadStore(storePath);
  return store.versions[id] ?? null;
}

export async function getActiveCostVersion(storePath?: string): Promise<CostVersion | null> {
  const store = await loadStore(storePath);
  if (!store.activeVersionId) {
    return null;
  }
  return store.versions[store.activeVersionId] ?? null;
}

export async function createCostVersionFromCatalog(
  storePath?: string,
  catalogStorePath?: string,
): Promise<CostVersion> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const models = await listResourceModelCatalog(catalogStorePath);
    const nextVersion =
      Object.values(store.versions).reduce((max, v) => Math.max(max, v.version), 0) + 1;
    const modelCosts: Record<string, ModelCostSnapshot> = {};
    for (const model of models) {
      modelCosts[model.modelId] = {
        modelId: model.modelId,
        tier: model.tier,
        inputCostPer1MCents: model.inputCostPer1MCents,
        outputCostPer1MCents: model.outputCostPer1MCents,
      };
    }
    const now = new Date().toISOString();
    const record: CostVersion = {
      id: randomUUID(),
      version: nextVersion,
      status: "draft",
      modelCosts,
      createdAt: now,
    };
    store.versions[record.id] = record;
    await saveStore(store, storePath);
    return record;
  });
}

export async function activateCostVersion(
  versionId: string,
  storePath?: string,
): Promise<CostVersion | null> {
  const id = versionId.trim();
  if (!id) {
    return null;
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const target = store.versions[id];
    if (!target) {
      return null;
    }
    const now = new Date().toISOString();
    for (const version of Object.values(store.versions)) {
      if (version.status === "active" && version.id !== id) {
        version.status = "deprecated";
      }
    }
    target.status = "active";
    target.activatedAt = now;
    store.activeVersionId = id;
    await saveStore(store, storePath);
    return target;
  });
}

export async function resolveModelCostRates(
  modelId: string,
  storePaths?: { costVersions?: string; modelCatalog?: string },
): Promise<{
  inputCostPer1MCents: number;
  outputCostPer1MCents: number;
  source: "cost_version" | "catalog" | "none";
}> {
  const id = modelId.trim();
  const active = await getActiveCostVersion(storePaths?.costVersions);
  const fromVersion = active?.modelCosts[id];
  if (fromVersion) {
    return {
      inputCostPer1MCents: fromVersion.inputCostPer1MCents,
      outputCostPer1MCents: fromVersion.outputCostPer1MCents,
      source: "cost_version",
    };
  }
  const models = await listResourceModelCatalog(storePaths?.modelCatalog);
  const catalog = models.find((m) => m.modelId === id);
  if (catalog) {
    return {
      inputCostPer1MCents: catalog.inputCostPer1MCents,
      outputCostPer1MCents: catalog.outputCostPer1MCents,
      source: "catalog",
    };
  }
  return { inputCostPer1MCents: 0, outputCostPer1MCents: 0, source: "none" };
}

export async function __resetCostVersionsForTest(storePath?: string): Promise<void> {
  await saveStore(createEmptyStore(), storePath);
}
