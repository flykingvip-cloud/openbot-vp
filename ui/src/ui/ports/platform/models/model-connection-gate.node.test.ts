import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetModelAdmissionStoreForTest,
  getModelAdmission,
  upsertModelAdmission,
} from "./model-admission-store.ts";
import {
  __resetModelConnectionSessionForTest,
  buildConnectionFingerprint,
  hasSuccessfulModelConnection,
  isConnectionVerificationStale,
  isManagedPoolModel,
  markModelConnectionVerified,
} from "./model-connection-gate.ts";
import type { ModelAsset } from "./view-model.ts";

function asset(overrides: Partial<ModelAsset> = {}): ModelAsset {
  return {
    modelId: "private/qwen",
    displayName: "Qwen",
    providerId: "private",
    source: "configured",
    inputModalities: ["text"],
    outputModalities: ["text"],
    capabilities: [],
    costTier: "unknown",
    health: "healthy",
    healthBasis: "config_inferred",
    taskTags: [],
    inRecommendationPool: false,
    tenantSelectable: false,
    ...overrides,
  };
}

describe("model connection gate", () => {
  beforeEach(() => {
    __resetModelConnectionSessionForTest();
    __resetModelAdmissionStoreForTest();
  });

  it("keeps config-inferred models out of the managed pool", () => {
    const row = asset();
    expect(hasSuccessfulModelConnection(row)).toBe(false);
    expect(isManagedPoolModel(row)).toBe(false);
  });

  it("admits a configured model after a live probe or catalog verification", () => {
    expect(isManagedPoolModel(asset({ healthBasis: "live_probe_ok" }))).toBe(true);
    expect(isManagedPoolModel(asset({ healthBasis: "catalog_verified" }))).toBe(true);
    expect(
      isManagedPoolModel(
        asset({
          healthBasis: "config_inferred",
          liveProbe: { status: "ok", source: "profile", label: "default" },
        }),
      ),
    ).toBe(true);
  });

  it("keeps a verified discovery pending until it is placed in the pool", () => {
    const row = asset({ source: "discovered", healthBasis: "catalog_verified" });
    expect(hasSuccessfulModelConnection(row)).toBe(true);
    expect(isManagedPoolModel(row)).toBe(false);
  });

  it("treats a model probed in this session as connected", () => {
    const row = asset({
      source: "configured",
      healthBasis: "config_inferred",
      baseUrl: "https://api.example",
      api: "openai-completions",
      connectionFingerprint: buildConnectionFingerprint({
        modelId: "private/qwen",
        providerId: "private",
        baseUrl: "https://api.example",
        api: "openai-completions",
      }),
    });
    expect(isManagedPoolModel(row)).toBe(false);
    markModelConnectionVerified(row.modelId, {
      modelId: row.modelId,
      providerId: row.providerId,
      baseUrl: row.baseUrl,
      api: row.api,
    });
    expect(isManagedPoolModel(row)).toBe(true);
  });

  it("does not treat failed probes or missing auth as success", () => {
    expect(hasSuccessfulModelConnection(asset({ healthBasis: "live_probe_failed" }))).toBe(false);
    expect(hasSuccessfulModelConnection(asset({ healthBasis: "auth_missing" }))).toBe(false);
    expect(hasSuccessfulModelConnection(asset({ healthBasis: "catalog_missing" }))).toBe(false);
  });

  it("keeps old liveProbe from unlocking success after endpoint fingerprint changes", () => {
    const modelId = "private/qwen";
    markModelConnectionVerified(modelId, {
      modelId,
      providerId: "private",
      baseUrl: "https://old.example",
      api: "openai-completions",
    });
    upsertModelAdmission(modelId, {
      capabilityEvidence: [
        {
          id: "text_chat",
          label: "text_chat",
          source: "protocol_probe",
          status: "passed",
          verifiedAt: Date.now(),
        },
      ],
    });

    const changed = asset({
      modelId,
      providerId: "private",
      baseUrl: "https://new.example",
      api: "openai-completions",
      connectionFingerprint: buildConnectionFingerprint({
        modelId,
        providerId: "private",
        baseUrl: "https://new.example",
        api: "openai-completions",
      }),
      liveProbe: { status: "ok", source: "profile", label: "retained-old-ok" },
      healthBasis: "live_probe_ok",
    });

    expect(hasSuccessfulModelConnection(changed)).toBe(false);
    expect(isConnectionVerificationStale(changed)).toBe(true);
    expect(getModelAdmission(modelId).capabilityEvidence[0]?.status).toBe("expired");
  });
});
