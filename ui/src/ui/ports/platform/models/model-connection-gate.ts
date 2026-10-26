import {
  expireFormalCapabilityEvidence,
  getModelAdmission,
  upsertModelAdmission,
} from "./model-admission-store.ts";
import type { ModelAsset } from "./view-model.ts";

/** Session marks: modelId → fingerprint, or "*" for modelId-only session probe. */
const sessionVerified = new Map<string, string>();

/** Track which modelRefs already triggered expiry this session to avoid loops. */
const expiredForMismatch = new Set<string>();

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
 * On fingerprint mismatch: expire formal evidence once and drop session marks.
 * Keep the stale connectionFingerprint so isConnectionVerificationStale stays
 * true until markModelConnectionVerified writes the new fingerprint — otherwise
 * unbound liveProbe.ok would resurrect "success" for the old endpoint.
 */
function invalidateStaleAdmission(modelId: string, reason: string) {
  if (!expiredForMismatch.has(modelId)) {
    expireFormalCapabilityEvidence(modelId, reason);
    expiredForMismatch.add(modelId);
  }
  sessionVerified.delete(modelId);
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

  const previous = getModelAdmission(normalized);
  if (
    fingerprint &&
    previous.connectionFingerprint &&
    previous.connectionFingerprint !== fingerprint
  ) {
    invalidateStaleAdmission(normalized, "配置指纹已变更，需重新验证");
  }

  if (fingerprint && !isMinimalFingerprint(fingerprint, normalized)) {
    sessionVerified.set(normalized, fingerprint);
    expiredForMismatch.delete(normalized);
    upsertModelAdmission(normalized, {
      connectionFingerprint: fingerprint,
      connectionVerifiedAt: Date.now(),
    });
    return;
  }

  // modelId-only mark: session success without claiming a durable endpoint fingerprint.
  // Only valid while endpoint identity remains unknown (minimal fingerprint).
  sessionVerified.set(normalized, "*");
  upsertModelAdmission(normalized, {
    connectionVerifiedAt: Date.now(),
  });
}

export function __resetModelConnectionSessionForTest() {
  sessionVerified.clear();
  expiredForMismatch.clear();
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
 * Connection success is a live probe or a catalog verification bound to the
 * current config fingerprint when one is known.
 *
 * When a persisted fingerprint no longer matches, old probe/session marks and
 * formal capability evidence are invalidated — liveProbe.ok / healthBasis alone
 * cannot keep the previous config's success alive.
 */
export function hasSuccessfulModelConnection(asset: ConnectionAsset): boolean {
  const currentFp = currentFingerprint(asset);
  const admission = getModelAdmission(asset.modelId);

  // Persisted fingerprint mismatch → expire evidence and refuse success.
  if (admission.connectionFingerprint && admission.connectionFingerprint !== currentFp) {
    invalidateStaleAdmission(asset.modelId, "配置指纹已变更，需重新验证");
    return false;
  }

  const sessionFp = sessionVerified.get(asset.modelId);
  if (sessionFp) {
    if (sessionFp === "*") {
      // modelId-only marks do not survive once endpoint identity is known.
      if (isMinimalFingerprint(currentFp, asset.modelId)) {
        return true;
      }
      sessionVerified.delete(asset.modelId);
    } else if (sessionFp === currentFp) {
      return true;
    } else {
      // Stale session mark after endpoint/protocol/model identity change.
      sessionVerified.delete(asset.modelId);
    }
  }

  if (admission.connectionFingerprint && admission.connectionVerifiedAt) {
    if (admission.connectionFingerprint === currentFp) {
      return true;
    }
  }

  // Unbound live probe / health basis: only accept when there is no conflicting
  // fingerprint claim (already handled above) AND we are not carrying a stale
  // session mark for a different endpoint. These indicate current gateway health
  // for the loaded config, not a prior verification of a different endpoint.
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
