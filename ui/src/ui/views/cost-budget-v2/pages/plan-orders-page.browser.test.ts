// @vitest-environment jsdom

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { zh_CN } from "../../../../i18n/locales/zh-CN.ts";
import type { SubscriptionGetResponse } from "../../../capability/cost-budget-billing/index.ts";
import {
  __resetOperationsStoreForTest,
  __seedOperationsStoreForTest,
} from "../stores/operations-store.ts";
import {
  __resetSubscriptionStoreForTest,
  __seedSubscriptionStoreForTest,
} from "../stores/subscription-store.ts";
import { renderPlanOrdersPage } from "./plan-orders-page.ts";

beforeEach(async () => {
  i18n.registerTranslation("zh-CN", zh_CN);
  await i18n.setLocale("zh-CN");
  __resetSubscriptionStoreForTest();
});

afterEach(() => {
  document.body.innerHTML = "";
});

function subscribedResponse(): SubscriptionGetResponse {
  return {
    subscription: { planId: "scale", status: "active" },
    planView: {
      id: "scale",
      name: "Scale",
      botQuota: 100,
    },
    pricingView: [],
    availablePlans: [],
    pricingCatalog: {
      billingHint: "",
      faq: [],
      compareRows: [],
      plans: [],
    },
  } as unknown as SubscriptionGetResponse;
}

describe("plan-orders-page", () => {
  it("shows catalog panel for subscribed tenant when activePanel is catalog", () => {
    __seedSubscriptionStoreForTest({ data: subscribedResponse() });
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(
      renderPlanOrdersPage({
        client: { connected: true } as never,
        tenantId: "acme",
        activePanel: "catalog",
        onNavigate: () => {},
        onRefresh: () => {},
      }),
      container,
    );
    expect(container.querySelector('[data-testid="cost-budget-v2-catalog-panel"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="cost-budget-v2-my-plan-panel"]')).toBeFalsy();
  });

  it("renders growth path panel on my plan tab", () => {
    __seedSubscriptionStoreForTest({
      data: subscribedResponse(),
      commercialOrders: [],
    });
    __seedOperationsStoreForTest({
      resources: {
        usedBots: 5,
        quota: 100,
        ratio: 0.05,
        perUser: {},
        concurrencyUsed: 2,
        concurrencyLimit: 32,
      },
      forecast: { concurrencyPeakInCycle: 10 } as never,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(
      renderPlanOrdersPage({
        client: { connected: true } as never,
        tenantId: "acme",
        activePanel: "plan",
        onNavigate: () => {},
        onRefresh: () => {},
      }),
      container,
    );
    expect(container.querySelector('[data-testid="cost-budget-v2-growth-path"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="plan-growth-summary"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="plan-growth-tabs"]')).toBeTruthy();
    expect(container.querySelector(".cost-budget-v2-my-plan-layout")).toBeTruthy();
  });

  it("navigates to catalog when change-plan button is clicked", () => {
    __seedSubscriptionStoreForTest({ data: subscribedResponse() });
    let navigated: string | null = null;
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(
      renderPlanOrdersPage({
        client: { connected: true } as never,
        tenantId: "acme",
        activePanel: "plan",
        onNavigate: (target) => {
          navigated = target.planOrdersPanel ?? null;
        },
        onRefresh: () => {},
      }),
      container,
    );
    const changePlan = container.querySelector(
      '[data-testid="cost-budget-v2-open-catalog"]',
    ) as HTMLButtonElement;
    expect(changePlan).toBeTruthy();
    changePlan.click();
    expect(navigated).toBe("catalog");
  });
});
