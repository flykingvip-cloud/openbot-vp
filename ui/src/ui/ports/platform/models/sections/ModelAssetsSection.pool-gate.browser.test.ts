// @vitest-environment jsdom
import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformModelsActions } from "../actions.ts";
import { __resetModelConnectionSessionForTest } from "../model-connection-gate.ts";
import type { ModelAsset, ModelAssetsVM } from "../view-model.ts";
import {
  __resetModelAssetsSectionStateForTest,
  renderModelAssetsSection,
} from "./ModelAssetsSection.ts";

function asset(overrides: Partial<ModelAsset>): ModelAsset {
  return {
    modelId: "private/qwen",
    displayName: "Qwen",
    providerId: "private",
    source: "configured",
    inputModalities: ["text"],
    outputModalities: ["text"],
    capabilities: ["coding"],
    costTier: "unknown",
    health: "healthy",
    healthBasis: "config_inferred",
    taskTags: [],
    inRecommendationPool: false,
    tenantSelectable: false,
    ...overrides,
  };
}

function vm(): ModelAssetsVM {
  return {
    summary: {
      totalModels: 3,
      activeModels7d: 0,
      healthyModels: 3,
      degradedModels: 0,
      unavailableModels: 0,
      recommendationPoolSize: 0,
      tenantSelectableModels: 0,
    },
    models: [
      asset({
        modelId: "deepseek/deepseek-v4",
        displayName: "DeepSeek V4",
        providerId: "deepseek",
        healthBasis: "live_probe_ok",
        source: "configured",
      }),
      asset({
        modelId: "private/unconnected",
        displayName: "Unconnected Flash",
        providerId: "private",
        healthBasis: "config_inferred",
        source: "configured",
      }),
      asset({
        modelId: "private/ready",
        displayName: "Ready Flash",
        providerId: "private",
        healthBasis: "catalog_verified",
        source: "discovered",
      }),
    ],
    filters: {
      providers: ["deepseek", "private"],
      modalities: [],
      capabilities: [],
      costTiers: [],
      healthStates: [],
      taskTags: [],
    },
    defaultSort: { field: "displayName", direction: "asc" },
  };
}

function paint(actions: PlatformModelsActions) {
  const host = document.createElement("div");
  document.body.append(host);
  render(
    renderModelAssetsSection({
      vm: vm(),
      actions,
      compat: null,
      onNavigateTab: () => {},
    }),
    host,
  );
  return host;
}

describe("model pool connection gate", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    __resetModelConnectionSessionForTest();
    __resetModelAssetsSectionStateForTest();
  });

  it("lists only connected models in the pool and keeps the rest pending", () => {
    const host = paint({} as PlatformModelsActions);
    const pool = host.querySelector("[data-testid='model-pool-table']");
    const pending = host.querySelector("[data-testid='model-pending-connect']");
    expect(pool?.textContent).toContain("DeepSeek V4");
    expect(pool?.textContent).not.toContain("Unconnected Flash");
    expect(pool?.textContent).not.toContain("Ready Flash");
    expect(pool?.querySelector("[data-testid='model-pool-import']")).toBeNull();
    expect(pool?.querySelector("[data-testid='model-connect-verify']")).toBeNull();
    expect(pending?.textContent).toContain("Unconnected Flash");
    expect(pending?.textContent).toContain("未连通");
    expect(pending?.querySelector("[data-testid='model-connect-verify']")).not.toBeNull();
    expect(
      pending?.querySelector("[data-testid='model-pool-import'][data-model-id='private/ready']"),
    ).not.toBeNull();
    expect(host.querySelector("[data-testid='model-pool-total']")?.textContent?.trim()).toBe("1");
    expect(host.textContent).toContain("显示 1 / 1 个模型");
    const healthCell = pool?.querySelector("tbody .platform-model-assets-table__col-health");
    expect(healthCell?.textContent?.replace(/\s+/g, "")).toBe("健康");
    expect(healthCell?.textContent).not.toContain("真实探测成功");
    expect(host.querySelector(".platform-model-assets-summary__helper")).toBeNull();
    expect(host.textContent).not.toContain("已连通并纳入模型池");
    expect(host.textContent).not.toContain("按调用频次排序");
    expect(host.textContent).not.toContain("使用分析数据尚未接入");
    expect(host.textContent).not.toContain("不代表模型已进入模型池");
    expect(host.querySelector(".platform-model-assets-topbar")).not.toBeNull();
    expect(host.querySelector(".platform-model-assets-search input")).not.toBeNull();
    expect(host.querySelector(".platform-model-assets-add-btn")?.textContent).toContain("添加模型");
  });

  it("admits a configured model after verify and imports a verified discovery only on 入池", async () => {
    const onImportCatalogModel = vi.fn();
    const onUpsertAllowlistEntry = vi.fn();
    const onSaveConfig = vi.fn(async () => {});
    const actions = {
      onProbeHealth: async () => ({
        results: [{ provider: "private", model: "private/unconnected", status: "ok" }],
      }),
      onImportCatalogModel,
      onUpsertAllowlistEntry,
      onSaveConfig,
    } as unknown as PlatformModelsActions;
    const host = paint(actions);
    const verify = host.querySelector(
      "[data-testid='model-connect-verify'][data-model-id='private/unconnected']",
    ) as HTMLButtonElement;
    verify.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    render(
      renderModelAssetsSection({
        vm: vm(),
        actions,
        compat: null,
        onNavigateTab: () => {},
      }),
      host,
    );
    expect(onImportCatalogModel).not.toHaveBeenCalled();
    expect(host.querySelector("[data-testid='model-pool-table']")?.textContent).toContain(
      "Unconnected Flash",
    );
    const importButton = host.querySelector(
      "[data-testid='model-pool-import'][data-model-id='private/ready']",
    ) as HTMLButtonElement;
    importButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onImportCatalogModel).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "private", modelId: "ready" }),
    );
    expect(onUpsertAllowlistEntry).toHaveBeenCalledWith("private/ready", "Ready Flash");
  });
});
