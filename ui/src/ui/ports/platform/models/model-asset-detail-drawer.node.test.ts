import { describe, expect, it } from "vitest";
import { renderModelAssetDetailDrawer } from "./model-asset-detail-drawer.ts";
import type { ModelAsset } from "./view-model.ts";

function sampleAsset(): ModelAsset {
  return {
    modelId: "openrouter/gpt-4o",
    displayName: "GPT-4o",
    displaySubtitle: "OpenRouter · gpt-4o",
    providerId: "openrouter",
    providerName: "OpenRouter",
    source: "discovered",
    inputModalities: ["text"],
    outputModalities: ["text"],
    capabilities: ["tool_use"],
    costTier: "medium",
    health: "healthy",
    healthBasis: "config_inferred",
    taskTags: [],
    inRecommendationPool: false,
    tenantSelectable: false,
    contextWindow: 128000,
  };
}

describe("renderModelAssetDetailDrawer", () => {
  it("renders enabled import action for pending assets", () => {
    const rendered = renderModelAssetDetailDrawer({
      selectedModel: sampleAsset(),
      actions: {
        onImportCatalogModel: () => {},
        onUpsertAllowlistEntry: () => {},
        onSaveConfig: async () => {},
        onProbeHealth: () => {},
      } as never,
      compatCanManage: true,
      saving: false,
      onSavingChange: () => {},
      onClose: () => {},
      onNavigateTab: () => {},
    });
    const html = JSON.stringify(rendered);

    expect(html).toContain("btn--primary");
    expect(html).toContain("验证连接");
    expect(html).toContain("先验证连接，成功后再入池");
    expect(html).not.toContain("加入推荐池");
    expect(html).toContain("生命周期");
    expect(html).toContain("GPT-4o");
  });

  it("offers 入池 once the connection has succeeded", () => {
    const rendered = renderModelAssetDetailDrawer({
      selectedModel: { ...sampleAsset(), healthBasis: "live_probe_ok" },
      actions: {
        onImportCatalogModel: () => {},
        onUpsertAllowlistEntry: () => {},
        onSaveConfig: async () => {},
        onProbeHealth: () => {},
      } as never,
      compatCanManage: true,
      saving: false,
      onSavingChange: () => {},
      onClose: () => {},
      onNavigateTab: () => {},
    });
    const html = JSON.stringify(rendered);
    expect(html).toContain("入池");
    expect(html).not.toContain("验证连接");
  });
});
