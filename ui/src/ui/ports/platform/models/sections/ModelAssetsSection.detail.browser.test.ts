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

const SANDBOX_PROBE_ERROR =
  "Managed multitenant sandbox requires a server-derived account (tenantId and userId).";

function asset(overrides: Partial<ModelAsset> = {}): ModelAsset {
  return {
    modelId: "api-proxy-deepseek/deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    providerId: "api-proxy-deepseek",
    providerName: "api-proxy-deepseek",
    source: "configured",
    inputModalities: ["text"],
    outputModalities: ["text"],
    capabilities: ["tool_use"],
    costTier: "medium",
    health: "degraded",
    healthBasis: "live_probe_failed",
    healthNote: SANDBOX_PROBE_ERROR,
    taskTags: ["coding"],
    inRecommendationPool: true,
    tenantSelectable: false,
    contextWindow: 128000,
    liveProbe: {
      status: "unknown",
      source: "models.json",
      label: "models.json",
      latencyMs: 75,
      error: SANDBOX_PROBE_ERROR,
    },
    ...overrides,
  };
}

function vm(model: ModelAsset = asset()): ModelAssetsVM {
  return {
    summary: {
      totalModels: 1,
      activeModels7d: 0,
      healthyModels: 0,
      degradedModels: 1,
      unavailableModels: 0,
      recommendationPoolSize: 1,
      tenantSelectableModels: 0,
    },
    models: [model],
    filters: {
      providers: ["api-proxy-deepseek"],
      modalities: [],
      capabilities: [],
      costTiers: [],
      healthStates: [],
      taskTags: [],
    },
    defaultSort: { field: "displayName", direction: "asc" },
  };
}

function paint(actions: PlatformModelsActions, model?: ModelAsset) {
  const host = document.createElement("div");
  document.body.append(host);
  const view = vm(model);
  render(
    renderModelAssetsSection({
      vm: view,
      actions,
      compat: null,
      onNavigateTab: () => {},
      onToggleRecommendationPool: () => {},
    }),
    host,
  );
  return { host, view, actions };
}

function openDetail(host: HTMLElement, view: ModelAssetsVM, actions: PlatformModelsActions) {
  const row = Array.from(host.querySelectorAll("tr")).find((entry) =>
    entry.textContent?.includes("DeepSeek V4 Flash"),
  );
  const detail = Array.from(row?.querySelectorAll("button") ?? []).find(
    (button) => button.textContent?.trim() === "详情",
  );
  detail?.click();
  render(
    renderModelAssetsSection({
      vm: view,
      actions,
      compat: null,
      onNavigateTab: () => {},
      onToggleRecommendationPool: () => {},
    }),
    host,
  );
  const drawer = host.querySelector<HTMLElement>("[data-testid='model-detail-drawer']");
  expect(drawer).not.toBeNull();
  return drawer as HTMLElement;
}

describe("model detail drawer layout", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    __resetModelConnectionSessionForTest();
    __resetModelAssetsSectionStateForTest();
  });

  it("hides the raw model key and drops facts already shown as tags", () => {
    const { host, view, actions } = paint({} as PlatformModelsActions);
    const drawer = openDetail(host, view, actions);

    expect(drawer.querySelector(".model-assets-drawer__sub")).toBeNull();
    expect(drawer.textContent).toContain("DeepSeek V4 Flash");
    expect(drawer.textContent).not.toContain("api-proxy-deepseek/deepseek-v4-flash");
    expect(drawer.textContent).toContain("显式配置");
    expect(drawer.textContent).toContain("已配置");
    expect(drawer.textContent).toContain("真实探测失败");

    const basics = drawer.querySelector("[data-testid='model-detail-basics']");
    expect(basics).not.toBeNull();
    expect(basics?.hasAttribute("open")).toBe(false);
    expect(basics?.textContent).toContain("推荐池");
    expect(basics?.textContent).toContain("已加入");
    expect(basics?.textContent).toContain("租户可选");
    expect(basics?.textContent).not.toContain("Provider");
    expect(basics?.textContent).not.toContain("资产来源");
    expect(basics?.textContent).not.toContain("配置状态");
    expect(basics?.textContent).not.toContain("健康判定");
    expect(basics?.textContent).not.toContain("健康说明");
    expect(drawer.textContent).not.toContain(SANDBOX_PROBE_ERROR);
    expect(drawer.textContent).toContain("调用没有到达模型");
    expect(drawer.textContent).toContain("延迟 75ms");
  });

  it("keeps verify, pool, and governance actions wired to the probe", async () => {
    const onProbeHealth = vi.fn(async () => ({
      results: [
        {
          provider: "api-proxy-deepseek",
          model: "api-proxy-deepseek/deepseek-v4-flash",
          status: "ok",
          latencyMs: 40,
        },
      ],
    }));
    const onNavigateTab = vi.fn();
    const { host, view } = paint({ onProbeHealth } as unknown as PlatformModelsActions);
    render(
      renderModelAssetsSection({
        vm: view,
        actions: { onProbeHealth } as unknown as PlatformModelsActions,
        compat: null,
        onNavigateTab,
        onToggleRecommendationPool: () => {},
      }),
      host,
    );
    const drawer = openDetail(host, view, { onProbeHealth } as unknown as PlatformModelsActions);

    expect(drawer.querySelector("[data-testid='model-drawer-verify']")).not.toBeNull();
    expect(drawer.textContent).toContain("重新测试调用");
    expect(drawer.textContent).toContain("移出推荐池");
    expect(drawer.textContent).toContain("允许租户选择");
    expect(drawer.textContent).toContain("使用分析");
    expect(drawer.textContent).toContain("任务方案");
    expect(drawer.textContent).toContain("治理告警");

    const retest = Array.from(drawer.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "重新测试调用",
    );
    retest?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onProbeHealth).toHaveBeenCalledWith({
      provider: "api-proxy-deepseek",
      modelRef: "api-proxy-deepseek/deepseek-v4-flash",
    });
  });
});
