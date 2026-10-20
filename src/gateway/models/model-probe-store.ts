/**
 * Last platform model probe, keyed by model id.
 * A later probe of one model merges; it does not wipe probes of other models.
 */

import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";

const STORE_VERSION = 1;

export type PersistedModelProbeResult = {
  provider: string;
  model?: string;
  label: string;
  source: "profile" | "env" | "models.json";
  status: string;
  latencyMs?: number;
  error?: string;
};

export type PersistedModelProbeSummary = {
  finishedAt: number;
  results: PersistedModelProbeResult[];
};

type StoredProbe = PersistedModelProbeResult & {
  modelId: string;
  finishedAt: number;
};

type Store = {
  version: number;
  probes: Record<string, StoredProbe>;
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, probes: {} };
}

export function resolveDefaultModelProbeStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-model-probe.json");
}

const withLock = createAsyncLock();

function probeModelId(result: { provider?: string; model?: string }): string {
  const model = result.model?.trim() ?? "";
  if (!model) {
    return "";
  }
  if (model.includes("/")) {
    return model;
  }
  const provider = result.provider?.trim() ?? "";
  return provider ? `${provider}/${model}` : model;
}

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultModelProbeStorePath());
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.probes !== "object" || parsed.probes === null) {
    return createEmptyStore();
  }
  return { version: STORE_VERSION, probes: parsed.probes };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultModelProbeStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

export async function recordModelProbeResults(
  summary: { finishedAt?: number; results?: PersistedModelProbeResult[] },
  storePath?: string,
): Promise<void> {
  const finishedAt =
    typeof summary.finishedAt === "number" && Number.isFinite(summary.finishedAt)
      ? summary.finishedAt
      : Date.now();
  const incoming = summary.results ?? [];
  if (incoming.length === 0) {
    return;
  }
  await withLock(async () => {
    const store = await loadStore(storePath);
    for (const result of incoming) {
      const modelId = probeModelId(result);
      if (!modelId) {
        continue;
      }
      const source =
        result.source === "profile" || result.source === "env" || result.source === "models.json"
          ? result.source
          : "env";
      store.probes[modelId] = {
        modelId,
        provider: result.provider,
        model: modelId,
        label: result.label,
        source,
        status: result.status,
        finishedAt,
        ...(typeof result.latencyMs === "number" ? { latencyMs: result.latencyMs } : {}),
        ...(result.error ? { error: result.error } : {}),
      };
    }
    await saveStore(store, storePath);
  });
}

export async function listModelProbeStatuses(storePath?: string): Promise<Map<string, string>> {
  const store = await loadStore(storePath);
  const statuses = new Map<string, string>();
  for (const [modelId, probe] of Object.entries(store.probes)) {
    const id = modelId.trim();
    if (id && probe?.status) {
      statuses.set(id, probe.status);
    }
  }
  return statuses;
}

export async function loadModelProbeSummary(
  storePath?: string,
): Promise<PersistedModelProbeSummary | null> {
  const store = await loadStore(storePath);
  const probes = Object.values(store.probes);
  if (probes.length === 0) {
    return null;
  }
  const finishedAt = probes.reduce((max, probe) => Math.max(max, probe.finishedAt), 0);
  return {
    finishedAt,
    results: probes
      .toSorted((left, right) => left.modelId.localeCompare(right.modelId))
      .map((probe) => ({
        provider: probe.provider,
        model: probe.modelId,
        label: probe.label,
        source: probe.source,
        status: probe.status,
        ...(typeof probe.latencyMs === "number" ? { latencyMs: probe.latencyMs } : {}),
        ...(probe.error ? { error: probe.error } : {}),
      })),
  };
}
