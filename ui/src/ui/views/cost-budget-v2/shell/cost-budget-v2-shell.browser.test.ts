// @vitest-environment jsdom

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { zh_CN } from "../../../../i18n/locales/zh-CN.ts";
import type { EnterprisePortReadModel } from "../../../ports/enterprise/semantic/enterprise-read-model.ts";
import {
  renderCostBudgetV2Shell,
  __resetChangePlanDrawerForTest,
  __resetOperationsStoreForTest,
  __resetSettingsStoreForTest,
  __resetSeatsStoreForTest,
  __resetSubscriptionStoreForTest,
  __seedOperationsStoreForTest,
  __seedSettingsStoreForTest,
} from "../index.ts";

beforeEach(async () => {
  i18n.registerTranslation("zh-CN", zh_CN);
  await i18n.setLocale("zh-CN");
});

afterEach(() => {
  document.body.innerHTML = "";
  __resetSubscriptionStoreForTest();
  __resetOperationsStoreForTest();
  __resetSettingsStoreForTest();
  __resetSeatsStoreForTest();
  __resetChangePlanDrawerForTest();
  window.history.replaceState({}, "", "/");
});

function readModel(): EnterprisePortReadModel {
  return {
    currentTenantId: "acme",
    membershipRole: "enterprise-admin",
  } as EnterprisePortReadModel;
}

describe("cost-budget-v2 shell", () => {
  it("renders four primary tabs and overview body", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(
      renderCostBudgetV2Shell({
        client: null,
        basePath: "",
        tenantId: "acme",
        readModel: readModel(),
        navigation: {
          route: "overview",
          planOrdersPanel: "catalog",
          settingsPanel: "budget",
        },
        onNavigate: () => {},
      }),
      container,
    );
    expect(container.querySelector('[data-testid="cost-budget-v2-page"]')).toBeTruthy();
    expect(container.querySelector(".enterprise-segmented-nav")).toBeTruthy();
    expect(container.textContent).toContain("Gateway 未连接");
    expect(container.textContent).toContain("套餐与订单");
    expect(container.textContent).toContain("设置");
  });

  it("renders overview page when route is overview", () => {
    __seedOperationsStoreForTest({ dashboard: null, loadAttempted: true });
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(
      renderCostBudgetV2Shell({
        client: { connected: true } as never,
        basePath: "",
        tenantId: "acme",
        readModel: readModel(),
        navigation: {
          route: "overview",
          planOrdersPanel: "catalog",
          settingsPanel: "budget",
        },
        onNavigate: () => {},
      }),
      container,
    );
    expect(container.querySelector('[data-testid="cost-budget-v2-overview-page"]')).toBeTruthy();
  });

  it("renders plan-orders page scaffold when route is plan-orders", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(
      renderCostBudgetV2Shell({
        client: { connected: true } as never,
        basePath: "",
        tenantId: "acme",
        readModel: readModel(),
        navigation: {
          route: "plan-orders",
          planOrdersPanel: "catalog",
          settingsPanel: "budget",
        },
        onNavigate: () => {},
      }),
      container,
    );
    expect(container.querySelector('[data-testid="cost-budget-v2-plan-orders-page"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="cost-budget-v2-plan-orders-nav"]')).toBeTruthy();
  });

  it("navigates primary plan-orders tab to the stable my-plan target", () => {
    const onNavigate = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(
      renderCostBudgetV2Shell({
        client: null,
        basePath: "",
        tenantId: "acme",
        readModel: readModel(),
        navigation: {
          route: "overview",
          planOrdersPanel: "catalog",
          settingsPanel: "budget",
        },
        onNavigate,
      }),
      container,
    );

    const tab = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".enterprise-segmented-nav__tab"),
    ).find((entry) => entry.textContent?.includes("套餐与订单"));
    expect(tab).toBeTruthy();
    tab?.click();

    expect(onNavigate).toHaveBeenCalledWith({
      route: "plan-orders",
      planOrdersPanel: "plan",
    });
  });

  it("renders seats page wrapper when route is seats", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(
      renderCostBudgetV2Shell({
        client: null,
        basePath: "",
        tenantId: "acme",
        readModel: readModel(),
        navigation: {
          route: "seats",
          planOrdersPanel: "catalog",
          settingsPanel: "budget",
        },
        onNavigate: () => {},
      }),
      container,
    );
    expect(container.querySelector('[data-testid="cost-budget-v2-seats-page"]')).toBeTruthy();
  });

  it("renders settings page wrapper when route is settings", () => {
    const client = { connected: true } as never;
    __seedSettingsStoreForTest(
      {
        budget: null,
        resources: null,
        analytics: null,
        forecast: null,
        loadPartialFailure: false,
      },
      client,
      "acme",
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(
      renderCostBudgetV2Shell({
        client,
        basePath: "",
        tenantId: "acme",
        readModel: readModel(),
        navigation: {
          route: "settings",
          planOrdersPanel: "catalog",
          settingsPanel: "budget",
        },
        onNavigate: () => {},
      }),
      container,
    );
    expect(container.querySelector('[data-testid="cost-budget-v2-settings-page"]')).toBeTruthy();
    expect(
      container.querySelector('[data-testid="cost-budget-v2-settings-panel-nav"]'),
    ).toBeTruthy();
    expect(container.querySelector('[data-testid="cost-budget-v2-preview-banner"]')).toBeFalsy();
  });
});
