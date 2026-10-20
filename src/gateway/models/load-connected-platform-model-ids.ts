import type { OpenBotConfig } from "../../config/types.js";
import { listModelProbeStatuses } from "./model-probe-store.js";
import {
  isPlatformModelConnectionSuccessful,
  retainPlatformPoolMembers,
} from "./platform-model-connection.js";

function providerOfModelId(modelId: string): string {
  const slash = modelId.indexOf("/");
  return slash > 0 ? modelId.slice(0, slash) : "";
}

export async function loadConnectedPlatformModelIds(params: {
  cfg: OpenBotConfig | undefined;
  gatewayCatalogModelIds?: readonly string[];
  probeStorePath?: string;
}): Promise<Set<string>> {
  const { listConfiguredModelIds } =
    await import("../model-entitlement/resolve-effective-model-set.js");
  const explicit = new Set(listConfiguredModelIds(params.cfg));
  const catalog = new Set(
    (params.gatewayCatalogModelIds ?? []).map((id) => id.trim()).filter(Boolean),
  );
  const probes = await listModelProbeStatuses(params.probeStorePath);
  const universe = new Set<string>([...explicit, ...catalog, ...probes.keys()]);
  const connected = new Set<string>();
  for (const modelId of universe) {
    if (
      isPlatformModelConnectionSuccessful({
        probeStatus: probes.get(modelId) ?? null,
        inGatewayCatalog: catalog.has(modelId),
        explicitlyConfigured: explicit.has(modelId),
      })
    ) {
      connected.add(modelId);
    }
  }
  return connected;
}

/**
 * Models the platform still offers: explicitly configured provider models, plus
 * allowlisted refs whose provider is still in `models.providers`. An allowlist
 * entry for a deleted provider is not in the pool.
 */
export async function listPlatformPoolModelIds(
  cfg: OpenBotConfig | undefined,
): Promise<Set<string>> {
  const { listConfiguredModelIds } =
    await import("../model-entitlement/resolve-effective-model-set.js");
  const pool = new Set(listConfiguredModelIds(cfg));
  const providers = new Set(Object.keys(cfg?.models?.providers ?? {}));
  const allowlisted = cfg?.agents?.defaults?.models;
  if (allowlisted && typeof allowlisted === "object") {
    for (const key of Object.keys(allowlisted)) {
      const id = key.trim();
      const provider = providerOfModelId(id);
      if (id && provider && providers.has(provider)) {
        pool.add(id);
      }
    }
  }
  return pool;
}

/**
 * Platform models enterprise lists and the employee effective set may show:
 * still in the live pool, and a successful connection (#587).
 */
export async function loadEnterpriseVisiblePlatformModelIds(params: {
  cfg: OpenBotConfig | undefined;
  gatewayCatalogModelIds?: readonly string[];
  probeStorePath?: string;
}): Promise<Set<string>> {
  const [connected, pool] = await Promise.all([
    loadConnectedPlatformModelIds(params),
    listPlatformPoolModelIds(params.cfg),
  ]);
  return retainPlatformPoolMembers(connected, pool);
}
