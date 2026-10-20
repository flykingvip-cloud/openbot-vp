// @vitest-environment jsdom

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../../../i18n/index.ts";
import { zh_CN } from "../../../../../i18n/locales/zh-CN.ts";
import { renderMyPlanPanel } from "./my-plan-panel.ts";

vi.mock("../../stores/operations-store.ts", () => ({
  getOperationsStoreState: () => ({
    resources: null,
    forecast: null,
    allocation: null,
    seats: null,
  }),
}));

vi.mock("../../stores/subscription-store.ts", () => ({
  getSubscriptionStoreState: () => ({
    commercialOrders: [],
  }),
}));

vi.mock("./plan-growth-path-panel.ts", () => ({
  renderPlanGrowthPathPanel: () => "",
}));

beforeEach(async () => {
  i18n.registerTranslation("zh-CN", zh_CN);
  await i18n.setLocale("zh-CN");
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("my-plan-panel", () => {
  it("renders the current package card with new package language", () => {
    const container = document.createElement("div");
    render(
      renderMyPlanPanel({
        selectedCycle: "monthly",
        onOpenCatalog: vi.fn(),
        subscriptionLoading: false,
        subscription: {
          subscription: {
            id: "sub-1",
            enterpriseId: "acme",
            planId: "plan-pro",
            planVersionId: "pv-pro",
            startTime: "2026-01-01T00:00:00.000Z",
            endTime: null,
            status: "active",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          pricingCatalog: {
            plans: [
              {
                id: "plan-pro",
                planVersionId: "pv-pro",
                slot: "professional",
                displayName: "专业版",
                recommended: true,
                pricing: { monthly: 99_900, annual: 84_900 },
                originalPricing: { monthly: 99_900 },
                cycleSavings: { annual: 179_880 },
                annualDiscountedMonthlyLabel: "¥849 / 月",
                badge: "推荐",
                targetAudience: "企业 AI 核心生产力",
                description: "面向 15-50 人团队",
                capabilities: ["多 Agent 协同"],
                metrics: {
                  seats: 30,
                  aiEmployees: 120,
                  concurrentRuns: 20,
                  workflows: 50,
                  knowledgeBases: 50,
                },
                cardFields: {
                  annualDiscountedMonthly: "¥849 / 月",
                  teamRange: "15-50 人",
                  overagePolicy: "超额阻断",
                },
                compare: {
                  aiEmployees: 120,
                  concurrentRuns: 20,
                  creditsMonthly: 30_000,
                  overagePolicy: "超额阻断",
                },
                cta: { label: "立即升级", type: "upgrade" },
                contactSales: false,
                freeTrial: false,
              },
            ],
            compareRows: [],
            faq: [],
            billingHint: "",
          },
          planVersion: {
            id: "pv-pro",
            planId: "plan-pro",
            version: 2,
            status: "active",
            snapshot: {
              basePriceCents: 99_900,
              seatQuota: {},
              botQuota: 120,
              pricing: [],
            },
            createdAt: "2026-01-01T00:00:00.000Z",
            createdByUserId: "platform-admin",
          },
          currentPlanVersion: {
            id: "pv-pro",
            planId: "plan-pro",
            version: 2,
            status: "active",
            snapshot: {
              basePriceCents: 99_900,
              seatQuota: {},
              botQuota: 120,
              pricing: [],
            },
            createdAt: "2026-01-01T00:00:00.000Z",
            createdByUserId: "platform-admin",
          },
        } as never,
      }),
      container,
    );

    expect(container.querySelector('[data-testid="cost-budget-v2-my-plan-panel"]')).toBeTruthy();
    expect(container.textContent).toContain("专业版");
    expect(container.textContent).toContain("超额策略");
    expect(container.textContent).not.toContain("年付折后");
    expect(container.textContent).toContain("当前锁定版本 v2");
    expect(container.textContent).toContain("当前企业已跟上平台最新套餐版本");
  });

  it("shows latest version hint when the enterprise is behind the active platform version", () => {
    const container = document.createElement("div");
    render(
      renderMyPlanPanel({
        selectedCycle: "monthly",
        onOpenCatalog: vi.fn(),
        subscriptionLoading: false,
        subscription: {
          subscription: {
            id: "sub-1",
            enterpriseId: "acme",
            planId: "plan-pro",
            planVersionId: "pv-pro-v1",
            startTime: "2026-01-01T00:00:00.000Z",
            endTime: null,
            status: "active",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          planView: {
            id: "plan-pro",
            name: "专业版",
            billingCycle: "monthly",
            basePriceCents: 99_900,
            currentVersionId: "pv-pro-v2",
            seatQuota: {},
            botQuota: 120,
            status: "active",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
          availablePlans: [],
          pricingCatalog: { plans: [], compareRows: [], faq: [], billingHint: "" },
          planVersion: {
            id: "pv-pro-v1",
            planId: "plan-pro",
            version: 1,
            status: "active",
            snapshot: {
              basePriceCents: 99_900,
              seatQuota: {},
              botQuota: 120,
              pricing: [],
            },
            createdAt: "2026-01-01T00:00:00.000Z",
            createdByUserId: "platform-admin",
          },
          currentPlanVersion: {
            id: "pv-pro-v2",
            planId: "plan-pro",
            version: 2,
            status: "active",
            snapshot: {
              basePriceCents: 99_900,
              seatQuota: {},
              botQuota: 120,
              pricing: [],
            },
            createdAt: "2026-01-02T00:00:00.000Z",
            createdByUserId: "platform-admin",
          },
        } as never,
      }),
      container,
    );

    expect(container.textContent).toContain("当前锁定版本 v1");
    expect(container.textContent).toContain("最新版本 v2");
    expect(container.textContent).toContain("平台已发布更新版本");
  });
});
