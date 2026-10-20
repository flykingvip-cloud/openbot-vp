// @vitest-environment jsdom

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { i18n } from "../../../../../i18n/index.ts";
import { zh_CN } from "../../../../../i18n/locales/zh-CN.ts";
import {
  __resetChangePlanDrawerForTest,
  __resetSubscriptionStoreForTest,
  __seedSubscriptionStoreForTest,
  openChangePlanDrawerConfirm,
  renderChangePlanDrawer,
} from "../../index.ts";

beforeEach(async () => {
  i18n.registerTranslation("zh-CN", zh_CN);
  await i18n.setLocale("zh-CN");
  __resetChangePlanDrawerForTest();
  __resetSubscriptionStoreForTest();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("change-plan-drawer", () => {
  it("renders confirm-only drawer for subscribed tenant", () => {
    __seedSubscriptionStoreForTest({
      data: {
        subscription: {
          id: "sub-1",
          enterpriseId: "acme",
          planId: "plan-a",
          planVersionId: "pv-a",
          startTime: "2026-01-01T00:00:00.000Z",
          endTime: null,
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        planView: {
          id: "plan-a",
          name: "Team",
          billingCycle: "monthly",
          basePriceCents: 29900,
          currentVersionId: "pv-a",
          seatQuota: {},
          botQuota: 5,
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        pricingView: [],
        availablePlans: [
          {
            id: "plan-b",
            name: "Business",
            billingCycle: "monthly",
            basePriceCents: 59900,
            currentVersionId: "pv-b",
            seatQuota: {},
            botQuota: 10,
            status: "active",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    });

    openChangePlanDrawerConfirm("plan-b");
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(
      renderChangePlanDrawer({
        client: { connected: true } as never,
        onNavigate: () => {},
        onRefresh: () => {},
      }),
      container,
    );
    expect(container.querySelector('[data-testid="change-plan-drawer"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="change-plan-drawer-confirm"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="change-plan-wizard"]')).toBeFalsy();
  });
});
