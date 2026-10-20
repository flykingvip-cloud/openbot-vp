// @vitest-environment jsdom
// Regression: platformPricing 必须被 platform shell 识别为表面并透传 client。
// 历史 bug：platform-shell 的 isPlatformSurface 漏掉 platformPricing，导致
// surfaceProps 为 null，整个「套餐与定价」页面（含表头）渲染为空白。

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { zh_CN } from "../../../../i18n/locales/zh-CN.ts";
import { __resetPlatformPricingForTest } from "../pricing/page.ts";
import { renderPlatformPortShell } from "./platform-shell.ts";

function noop() {
  return undefined;
}

beforeEach(async () => {
  i18n.registerTranslation("zh-CN", zh_CN);
  await i18n.setLocale("zh-CN");
  __resetPlatformPricingForTest();
});

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  __resetPlatformPricingForTest();
});

/** 仅暴露定价表面所需 RPC 的 mock client。 */
function mockClient() {
  return {
    request: vi.fn(async (method: string) => {
      if (method === "platform-plan-bundle.overview") {
        return {
          catalog: [],
          plans: [],
          pricingCatalog: {
            billingHint: "",
            faq: [],
            compareRows: [],
            plans: [],
          },
        };
      }
      if (method === "platform-resource-catalog.overview") {
        return {
          tiers: [
            {
              id: "tier_a",
              code: "A",
              name: "Tier A",
              description: "",
              sortOrder: 0,
              status: "active",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          models: [],
          creditWeights: [],
          failoverRules: [],
          configModelCount: 0,
          missingFromCatalog: [],
          tierUsageWindow: {
            startTime: "2026-01-01T00:00:00.000Z",
            endTime: "2026-01-31T00:00:00.000Z",
          },
          tierUsageStats: [],
        };
      }
      if (method === "platform-policy.list") {
        return { policies: [] };
      }
      if (method === "platform-plan-bundle.consistency") {
        return { issues: [] };
      }
      if (method === "platform-pricing-catalog.catalog") {
        return {
          billingHint: "",
          faq: [],
          compareRows: [],
          plans: [],
        };
      }
      if (method === "platform-subscriptions.summary") {
        return {
          totals: {
            activeSubscriptions: 0,
            mrrCents: 0,
            previousActiveSubscriptions: 0,
            previousMrrCents: 0,
            subsTrendDelta: 0,
            mrrTrendDelta: 0,
          },
          plans: [],
          recentActivity: [],
        };
      }
      throw new Error(`unexpected method ${method}`);
    }),
    connected: true,
  } as never;
}

function pricingModel(client: unknown) {
  return {
    state: { tab: "platformPricing", basePath: "", client },
    subnavProps: {
      tabs: ["platformDashboard", "platformPricing"],
      activeTab: "platformPricing",
      basePath: "",
      onOpenConsoleTab: noop,
    },
    channelsProps: {} as never,
    readModel: { enterpriseDirectory: [] } as never,
    pageViewModels: {} as never,
    surfaceActions: {
      dashboard: { onRefresh: noop },
      tenants: { onRefresh: noop, onRefreshDirectory: noop, onRefreshCoverage: noop },
      capabilities: { onRefresh: noop },
      models: { onRefresh: noop },
      platformAgents: { onRefresh: noop },
      advanced: { onRefresh: noop },
      systemSettings: { onRefresh: noop },
    },
    authPanelProps: { session: { provider: "trusted-proxy", user: "admin" } },
  } as never;
}

describe("platform pricing shell regression", () => {
  it("renders the pricing surface (header + body) instead of a blank page", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    window.history.replaceState({}, "", "/platform/pricing");

    const client = mockClient();
    const doRender = () => render(renderPlatformPortShell(pricingModel(client)), container);
    const onPop = () => doRender();
    window.addEventListener("popstate", onPop);
    try {
      doRender();
      // 表头由 surface 直接渲染，存在即说明 surfaceProps 非空（修复点）。
      expect(container.querySelector(".platform-surface")).toBeTruthy();
      expect(container.textContent).toContain("套餐与定价");
      // client 透传后定价页拉取套餐，最终落到空态而非「未连接 Gateway」。
      await vi.waitFor(() => {
        expect(container.textContent).toContain("暂无可用套餐");
      });
      expect(container.textContent).not.toContain("尚未连接到 Gateway");
    } finally {
      window.removeEventListener("popstate", onPop);
    }
  });
});
