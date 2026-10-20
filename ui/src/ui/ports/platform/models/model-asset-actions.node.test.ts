import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  importAssetIntoPool,
  primaryLifecycleAction,
  publishAssetToAllowlist,
  resolveModelAssetCanManage,
  saveEndpointThenAllowlistVerified,
} from "./model-asset-actions.ts";
import { resolveModelAssetLifecycleStage } from "./model-asset-presentation.ts";
import { __resetModelConnectionSessionForTest } from "./model-connection-gate.ts";
import type { ModelAsset } from "./view-model.ts";

function sampleAsset(overrides: Partial<ModelAsset> = {}): ModelAsset {
  return {
    modelId: "openrouter/gpt-4o",
    displayName: "GPT-4o",
    providerId: "openrouter",
    source: "discovered",
    inputModalities: ["text"],
    outputModalities: ["text"],
    capabilities: [],
    costTier: "medium",
    health: "healthy",
    healthBasis: "config_inferred",
    taskTags: [],
    inRecommendationPool: false,
    tenantSelectable: false,
    ...overrides,
  } as ModelAsset;
}

describe("model-asset-actions", () => {
  beforeEach(() => {
    __resetModelConnectionSessionForTest();
  });

  it("allows manage when compat is undefined and save hooks exist", () => {
    expect(
      resolveModelAssetCanManage({
        actions: {
          onImportCatalogModel: vi.fn(),
          onSaveConfig: vi.fn(),
        } as never,
      }),
    ).toBe(true);
  });

  it("blocks manage when compat explicitly denies write access", () => {
    expect(
      resolveModelAssetCanManage({
        compatCanManage: false,
        actions: {
          onImportCatalogModel: vi.fn(),
          onSaveConfig: vi.fn(),
        } as never,
      }),
    ).toBe(false);
  });

  it("refuses pool import until the connection succeeds", async () => {
    const onImportCatalogModel = vi.fn();
    const onUpsertAllowlistEntry = vi.fn();
    const onSaveConfig = vi.fn(async () => {});
    const asset = sampleAsset({ source: "discovered", healthBasis: "config_inferred" });

    const imported = await importAssetIntoPool({
      asset,
      actions: {
        onImportCatalogModel,
        onUpsertAllowlistEntry,
        onSaveConfig,
      } as never,
    });

    expect(imported).toBe(false);
    expect(onImportCatalogModel).not.toHaveBeenCalled();
    expect(onUpsertAllowlistEntry).not.toHaveBeenCalled();
    expect(onSaveConfig).not.toHaveBeenCalled();
  });

  it("imports into provider and allowlist after a successful connection", async () => {
    const onImportCatalogModel = vi.fn();
    const onUpsertAllowlistEntry = vi.fn();
    const onSaveConfig = vi.fn(async () => {});
    const asset = sampleAsset({ source: "discovered", healthBasis: "live_probe_ok" });

    const imported = await importAssetIntoPool({
      asset,
      actions: {
        onImportCatalogModel,
        onUpsertAllowlistEntry,
        onSaveConfig,
      } as never,
    });

    expect(imported).toBe(true);
    expect(onImportCatalogModel).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "openrouter",
        modelId: "gpt-4o",
      }),
    );
    expect(onUpsertAllowlistEntry).toHaveBeenCalledWith("openrouter/gpt-4o", "GPT-4o");
    expect(onSaveConfig).toHaveBeenCalledTimes(1);
  });

  it("maps configured assets to publish action", () => {
    const asset = sampleAsset({ source: "configured", inRecommendationPool: false });
    expect(primaryLifecycleAction(resolveModelAssetLifecycleStage(asset))).toBe("publish");
  });

  it("publishes allowlist entry then saves", async () => {
    const onUpsertAllowlistEntry = vi.fn();
    const onSaveConfig = vi.fn(async () => {});
    const asset = sampleAsset({ source: "configured" });

    await publishAssetToAllowlist({
      asset,
      actions: { onUpsertAllowlistEntry, onSaveConfig } as never,
    });

    expect(onUpsertAllowlistEntry).toHaveBeenCalledWith("openrouter/gpt-4o", "GPT-4o");
    expect(onSaveConfig).toHaveBeenCalledTimes(1);
  });

  it("allowlists only models whose connection probe succeeded", async () => {
    const add = vi.fn();
    const save = vi.fn(async () => {});
    const allowlist = vi.fn();
    const verify = vi.fn(async (modelRef: string) => modelRef.endsWith("/ok-model"));

    const result = await saveEndpointThenAllowlistVerified({
      inputs: [
        { providerId: "private", modelId: "ok-model", name: "OK" },
        { providerId: "private", modelId: "bad-model", name: "Bad" },
      ],
      add,
      save,
      allowlist,
      verify,
    });

    expect(add).toHaveBeenCalledTimes(2);
    expect(verify).toHaveBeenCalledTimes(2);
    expect(allowlist).toHaveBeenCalledTimes(1);
    expect(allowlist).toHaveBeenCalledWith("private/ok-model", "OK");
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.allowlisted).toEqual(["private/ok-model"]);
    expect(add.mock.invocationCallOrder[1]).toBeLessThan(verify.mock.invocationCallOrder[0]);
    expect(verify.mock.invocationCallOrder[0]).toBeLessThan(allowlist.mock.invocationCallOrder[0]);
  });

  it("does not allowlist when every probe fails", async () => {
    const allowlist = vi.fn();
    const save = vi.fn(async () => {});
    const result = await saveEndpointThenAllowlistVerified({
      inputs: [{ providerId: "private", modelId: "bad-model", name: "Bad" }],
      add: vi.fn(),
      save,
      allowlist,
      verify: async () => false,
    });
    expect(allowlist).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.allowlisted).toEqual([]);
  });
});
