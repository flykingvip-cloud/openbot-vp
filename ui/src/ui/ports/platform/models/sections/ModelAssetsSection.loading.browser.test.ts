// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import type { PlatformModelsActions } from "../actions.ts";
import type { ModelAssetsVM } from "../view-model.ts";
import { renderModelAssetsSection } from "./ModelAssetsSection.ts";

/**
 * Regression: on refresh the model-assets tab briefly rendered the empty-state
 * bootstrap page ("暂无已纳管模型资产" + 手动添加模型) before the snapshot loaded,
 * because `emptyState` is derived purely from `models.length === 0`. When
 * `loading` is set and there are no models yet, the section must render a
 * loading placeholder instead of the empty-state page.
 */
function emptyVm(): ModelAssetsVM {
  return {
    summary: {
      totalModels: 0,
      activeModels7d: 0,
      healthyModels: 0,
      degradedModels: 0,
      unavailableModels: 0,
      recommendationPoolSize: 0,
      tenantSelectableModels: 0,
    },
    models: [],
    filters: {
      providers: [],
      modalities: [],
      capabilities: [],
      costTiers: [],
      healthStates: [],
      taskTags: [],
    },
    defaultSort: { field: "displayName", direction: "asc" },
    emptyState: {
      title: "暂无已纳管模型资产",
      description: "仅展示配置目录、allowlist 与默认路由中已引用的模型。",
      primaryActionLabel: "打开模型管理",
    },
  };
}

const noopActions = {} as unknown as PlatformModelsActions;

function renderToText(vm: ModelAssetsVM, loading: boolean): string {
  const host = document.createElement("div");
  document.body.appendChild(host);
  try {
    render(
      renderModelAssetsSection({
        vm,
        actions: noopActions,
        compat: null,
        onNavigateTab: () => {},
        loading,
      }),
      host,
    );
    return host.textContent ?? "";
  } finally {
    host.remove();
  }
}

describe("renderModelAssetsSection loading state", () => {
  it("shows the loading placeholder (not the empty-state page) while loading with no models", () => {
    const text = renderToText(emptyVm(), true);
    expect(text).toContain("正在加载模型资产");
    expect(text).not.toContain("暂无已纳管模型资产");
    expect(text).not.toContain("手动添加模型");
  });

  it("shows the empty-state bootstrap page once loading resolves with no models", () => {
    const text = renderToText(emptyVm(), false);
    expect(text).toContain("暂无已纳管模型资产");
    expect(text).not.toContain("正在加载模型资产…");
  });
});
