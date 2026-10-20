import type { ModelAsset } from "./view-model.ts";

const sessionVerified = new Set<string>();

/** Models probed successfully in this page session, before the snapshot health basis refreshes. */
export function markModelConnectionVerified(modelId: string) {
  const normalized = modelId.trim();
  if (normalized) {
    sessionVerified.add(normalized);
  }
}

export function __resetModelConnectionSessionForTest() {
  sessionVerified.clear();
}

type ConnectionAsset = Pick<ModelAsset, "modelId" | "healthBasis"> & {
  liveProbe?: ModelAsset["liveProbe"];
};

/**
 * Connection success is a live probe or a catalog verification.
 * Config inference, missing auth, and failed probes are not success.
 */
export function hasSuccessfulModelConnection(asset: ConnectionAsset): boolean {
  if (asset.modelId && sessionVerified.has(asset.modelId)) {
    return true;
  }
  if (asset.liveProbe?.status === "ok") {
    return true;
  }
  return asset.healthBasis === "live_probe_ok" || asset.healthBasis === "catalog_verified";
}

/** Managed pool membership requires a successful connection and an explicit pool placement. */
export function isManagedPoolModel(
  asset: ConnectionAsset & Pick<ModelAsset, "source" | "inRecommendationPool">,
): boolean {
  if (!hasSuccessfulModelConnection(asset)) {
    return false;
  }
  return asset.source === "configured" || asset.inRecommendationPool;
}
