import path from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { OpenBotAuthStorage } from "./auth-storage.js";

export type ResolvedPiModelRuntime = {
  runtime: ModelRuntime;
  registry: ModelRegistry;
};

const runtimeByAuthStorage = new WeakMap<OpenBotAuthStorage, Promise<ResolvedPiModelRuntime>>();

export async function createPiModelRuntime(params: {
  authStorage: OpenBotAuthStorage;
  agentDir: string;
}): Promise<ResolvedPiModelRuntime> {
  const cached = runtimeByAuthStorage.get(params.authStorage);
  if (cached) {
    return cached;
  }
  const created = ModelRuntime.create({
    credentials: params.authStorage,
    authPath: path.join(params.agentDir, "auth.json"),
    modelsPath: path.join(params.agentDir, "models.json"),
    refreshOnCreate: false,
  }).then((runtime) => ({
    runtime,
    registry: new ModelRegistry(runtime),
  }));
  runtimeByAuthStorage.set(params.authStorage, created);
  return created;
}

type ModelApiKeyRegistry = {
  getApiKeyAndHeaders?: (
    model: Model<Api>,
  ) => Promise<{ ok: true; apiKey?: string } | { ok: false; error: string }>;
  getApiKey?: (model: Model<Api>) => Promise<string | undefined>;
};

export async function resolveModelApiKey(
  registry: ModelApiKeyRegistry,
  model: Model<Api>,
): Promise<string | undefined> {
  if (typeof registry.getApiKeyAndHeaders === "function") {
    const result = await registry.getApiKeyAndHeaders(model);
    if (!result.ok) {
      return undefined;
    }
    return result.apiKey;
  }
  if (typeof registry.getApiKey === "function") {
    return registry.getApiKey(model);
  }
  return undefined;
}
