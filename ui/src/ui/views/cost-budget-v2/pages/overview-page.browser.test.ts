// @vitest-environment jsdom

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { zh_CN } from "../../../../i18n/locales/zh-CN.ts";
import type { DashboardResponse } from "../../../capability/cost-budget-billing/index.ts";
import {
  __resetOperationsStoreForTest,
  __seedOperationsStoreForTest,
} from "../stores/operations-store.ts";
import {
  __resetSubscriptionStoreForTest,
  __seedSubscriptionStoreForTest,
} from "../stores/subscription-store.ts";
import { renderOverviewPage } from "./overview-page.ts";

beforeEach(async () => {
  i18n.registerTranslation("zh-CN", zh_CN);
  await i18n.setLocale("zh-CN");
  __resetOperationsStoreForTest();
  __resetSubscriptionStoreForTest();
});

afterEach(() => {
  document.body.innerHTML = "";
});

function dashboardUnsubscribed(): DashboardResponse {
  return {
    subscribed: false,
    accruedCents: 0,
    seatCostCents: 0,
    usageCostCents: 0,
    extraCostCents: 0,
    predictedCents: null,
    budgetStatus: {
      level: "ok",
      monthlyLimitCents: 0,
      accruedCents: 0,
      predictedCents: null,
    },
  } as DashboardResponse;
}

describe("overview-page", () => {
  it("renders subscribe hero when dashboard is unsubscribed", () => {
    __seedOperationsStoreForTest({ dashboard: dashboardUnsubscribed() });
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(
      renderOverviewPage({
        client: { connected: true } as never,
        basePath: "",
        tenantId: "acme",
        onNavigate: () => {},
        onRefresh: () => {},
      }),
      container,
    );
    expect(container.querySelector('[data-testid="cost-budget-v2-overview-page"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="overview-subscribe-hero"]')).toBeTruthy();
  });

  it("renders card-based subscribed overview with hero KPIs on top", () => {
    __seedOperationsStoreForTest({
      dashboard: {
        subscribed: true,
        accruedCents: 1000,
        seatCostCents: 100,
        usageCostCents: 200,
        extraCostCents: 50,
        predictedCents: 1500,
        budgetStatus: {
          level: "ok",
          monthlyLimitCents: 10000,
          accruedCents: 1000,
          predictedCents: 1500,
        },
        creditsStatus: {
          monthlyCredits: 1000,
          creditsRemaining: 400,
        },
      } as DashboardResponse,
      forecast: {
        enterpriseId: "acme",
        cycleStart: "2026-06-01",
        cycleEnd: "2026-06-30",
        computedAt: "2026-06-23T00:00:00.000Z",
        forecastCostCents: 9500,
        forecastCostInsufficientData: false,
        creditsRemaining: 400,
        monthlyCredits: 1000,
        creditsEtaDays: 5,
        creditsEtaInsufficientData: false,
        concurrencyUsed: 2,
        concurrencyLimit: 5,
        concurrencyPeakInCycle: 3,
        concurrencyRisk: "medium",
        concurrencyRiskMessage: "并发峰值接近上限",
        marginCents: 100,
        tenantRevenueCents: 200,
        providerCostCents: 100,
        marginRatio: 0.5,
        marginWarning: "none",
        forecastCostMode: "wma",
        activeBots: 4,
        maxBots: 10,
        botQuotaRisk: "none",
      },
      budget: {
        budget: { monthlyLimitCents: 10000, alertThresholdPercent: 80 },
      } as never,
    });
    __seedSubscriptionStoreForTest({
      data: {
        subscription: { planId: "scale", status: "active" },
        planView: { id: "scale", name: "旗舰版", botQuota: 100 },
        pricingView: [],
        availablePlans: [],
      } as never,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(
      renderOverviewPage({
        client: { connected: true } as never,
        basePath: "",
        tenantId: "acme",
        onNavigate: () => {},
        onRefresh: () => {},
      }),
      container,
    );

    const hero = container.querySelector('[data-testid="cost-budget-v2-overview-hero"]');
    const costCard = container.querySelector('[data-testid="cost-budget-v2-overview-cost"]');
    const planCard = container.querySelector('[data-testid="cost-budget-v2-overview-plan-card"]');
    const forecastPanel = container.querySelector('[data-testid="cost-budget-forecast-panel"]');
    const usageEmbedded = container.querySelector('[data-testid="cost-budget-v2-overview-usage"]');

    expect(hero).toBeTruthy();
    expect(costCard).toBeTruthy();
    expect(planCard).toBeTruthy();
    expect(forecastPanel).toBeTruthy();
    expect(usageEmbedded).toBeTruthy();
    expect(container.textContent).toContain("成本构成");
    expect(container.textContent).toContain("容量用量");
    expect(container.querySelector('[data-testid="plan-capacity-usage-compact"]')).toBeTruthy();
    expect(
      container.querySelector('[data-testid="cost-budget-v2-overview-usage-card"]'),
    ).toBeFalsy();
    expect(container.querySelector('[data-testid="subscribed-plan-hub"]')).toBeFalsy();
    expect(container.textContent).toContain("消耗预测");
    expect(container.querySelector('[data-testid="cost-budget-forecast-month-risk"]')).toBeTruthy();

    expect(
      hero!.compareDocumentPosition(costCard!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
