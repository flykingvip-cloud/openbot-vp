import { getModelAdmission, upsertModelAdmission } from "./model-admission-store.ts";
import type { ModelAsset } from "./view-model.ts";

/** Session marks: modelId → fingerprint, or "*" for modelId-only session probe. */
const sessionVerified = new Map<string, string>();

export type ConnectionFingerprintInput = {
  modelId: string;
  /** Endpoint / base URL when known. */
  baseUrl?: string | null;
  /** Protocol / API type when known. */
  api?: string | null;
  /** Provider id (included so provider moves invalidate). */
  providerId?: string | null;
};

/** Stable fingerprint for endpoint + protocol + model identity. */
export function buildConnectionFingerprint(input: ConnectionFingerprintInput): string {
  const modelId = input.modelId.trim();
  const providerId = (input.providerId ?? "").trim().toLowerCase();
  const baseUrl = (input.baseUrl ?? "").trim().replace(/\/+$/, "").toLowerCase();
  const api = (input.api ?? "").trim().toLowerCase();
  return [providerId, modelId, api, baseUrl].join("|");
}

function isMinimalFingerprint(fingerprint: string, modelId: string): boolean {
  return fingerprint === buildConnectionFingerprint({ modelId });
}

/**
 * Models probed successfully in this page session.
 * Prefer passing endpoint/protocol identity so later config edits invalidate the mark.
 */
export function markModelConnectionVerified(
  modelId: string,
  fingerprintOrInput?: string | ConnectionFingerprintInput,
) {
  const normalized = modelId.trim();
  if (!normalized) {
    return;
  }
  let fingerprint: string | null = null;
  if (typeof fingerprintOrInput === "string" && fingerprintOrInput.trim()) {
    fingerprint = fingerprintOrInput.trim();
  } else if (fingerprintOrInput && typeof fingerprintOrInput === "object") {
    fingerprint = buildConnectionFingerprint({ ...fingerprintOrInput, modelId: normalized });
  }

  if (fingerprint && !isMinimalFingerprint(fingerprint, normalized)) {
    sessionVerified.set(normalized, fingerprint);
    upsertModelAdmission(normalized, {
      connectionFingerprint: fingerprint,
      connectionVerifiedAt: Date.now(),
    });
    return;
  }

  // modelId-only mark: session success without claiming a durable endpoint fingerprint.
  sessionVerified.set(normalized, "*");
  upsertModelAdmission(normalized, {
    connectionVerifiedAt: Date.now(),
  });
}

export function __resetModelConnectionSessionForTest() {
  sessionVerified.clear();
}

type ConnectionAsset = Pick<ModelAsset, "modelId" | "healthBasis"> & {
  liveProbe?: ModelAsset["liveProbe"];
  providerId?: string;
  /** Optional live endpoint identity used to invalidate stale session marks. */
  connectionFingerprint?: string;
  baseUrl?: string | null;
  api?: string | null;
};

function currentFingerprint(asset: ConnectionAsset): string {
  return (
    asset.connectionFingerprint ??
    buildConnectionFingerprint({
      modelId: asset.modelId,
      providerId: asset.providerId,
      baseUrl: asset.baseUrl,
      api: asset.api,
    })
  );
}

/**
 * Connection success is a live probe or a catalog verification.
 * Config inference, missing auth, and failed probes are not success.
 * Session marks only count when the fingerprint still matches (or is modelId-only "*").
 */
export function hasSuccessfulModelConnection(asset: ConnectionAsset): boolean {
  const sessionFp = sessionVerified.get(asset.modelId);
  if (sessionFp) {
    if (sessionFp === "*") {
      return true;
    }
    const currentFp = currentFingerprint(asset);
    if (sessionFp === currentFp) {
      return true;
    }
    // Stale session mark after endpoint/protocol/model identity change.
    sessionVerified.delete(asset.modelId);
  }

  const admission = getModelAdmission(asset.modelId);
  if (admission.connectionFingerprint && admission.connectionVerifiedAt) {
    const currentFp = currentFingerprint(asset);
    if (admission.connectionFingerprint === currentFp) {
      return true;
    }
  }

  if (asset.liveProbe?.status === "ok") {
    return true;
  }
  return asset.healthBasis === "live_probe_ok" || asset.healthBasis === "catalog_verified";
}

/** True when a prior admission verification exists but no longer matches current endpoint. */
export function isConnectionVerificationStale(asset: ConnectionAsset): boolean {
  const admission = getModelAdmission(asset.modelId);
  if (!admission.connectionFingerprint) {
    return false;
  }
  return admission.connectionFingerprint !== currentFingerprint(asset);
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
