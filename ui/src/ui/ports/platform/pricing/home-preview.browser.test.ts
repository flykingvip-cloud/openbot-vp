// @vitest-environment jsdom

import { render } from "lit";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { zh_CN } from "../../../../i18n/locales/zh-CN.ts";
import {
  baseProps,
  mockClient,
  mockClientWithVersions,
  PLANS_CATALOG_PATH,
  versionFixture,
} from "./browser-test-helpers.ts";
import {
  __resetPlatformPricingForTest,
  refreshPlatformPricingAfterGatewayConnect,
  renderPlatformPricingSurface,
} from "./page.ts";

beforeAll(async () => {
  i18n.registerTranslation("zh-CN", zh_CN);
  await i18n.setLocale("zh-CN");
});

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  __resetPlatformPricingForTest();
});

describe("PlatformPricingSurface home preview", () => {
  it("shows connection hint when client is missing", () => {
    const container = document.createElement("div");
    render(renderPlatformPricingSurface(baseProps(null)), container);
    expect(container.textContent).toContain("尚未连接到 Gateway");
  });

  it("retries loading the homepage preview after gateway reconnect", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let overviewAttempts = 0;
    const innerRequest = (
      mockClientWithVersions([versionFixture()]) as {
        request: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
      }
    ).request;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "platform-plan-bundle.overview") {
        overviewAttempts += 1;
        if (overviewAttempts === 1) {
          throw new Error("gateway not connected");
        }
      }
      return innerRequest(method, params);
    });
    const client = { request, connected: true } as never;
    const container = document.createElement("div");
    window.history.replaceState({}, "", PLANS_CATALOG_PATH);
    const doRender = () => render(renderPlatformPricingSurface(baseProps(client)), container);
    const onPop = () => doRender();
    window.addEventListener("popstate", onPop);
    try {
      doRender();
      await vi.waitFor(() => expect(overviewAttempts).toBe(1));
      await vi.waitFor(() => {
        expect(
          container.querySelector('[data-testid="pricing-gateway-reconnect-hint"]'),
        ).toBeTruthy();
      });

      await vi.advanceTimersByTimeAsync(450);
      await vi.waitFor(() => expect(overviewAttempts).toBeGreaterThan(1));
      await vi.waitFor(() => {
        expect(container.querySelector('[data-testid="pricing-comparison-shell"]')).toBeTruthy();
      });

      const prevAttempts = overviewAttempts;
      refreshPlatformPricingAfterGatewayConnect(client);
      await vi.advanceTimersByTimeAsync(450);
      expect(overviewAttempts).toBe(prevAttempts);
    } finally {
      window.removeEventListener("popstate", onPop);
      vi.useRealTimers();
    }
  });

  it("does not dispatch extra popstate storms during internal rerenders", async () => {
    let overviewAttempts = 0;
    const innerRequest = (
      mockClientWithVersions([versionFixture()]) as {
        request: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
      }
    ).request;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "platform-plan-bundle.overview") {
        overviewAttempts += 1;
      }
      return innerRequest(method, params);
    });
    const client = { request, connected: true } as never;
    const container = document.createElement("div");
    let popCount = 0;
    const onPop = () => {
      popCount += 1;
      render(renderPlatformPricingSurface(baseProps(client)), container);
    };
    window.history.replaceState({}, "", PLANS_CATALOG_PATH);
    window.addEventListener("popstate", onPop);
    try {
      render(renderPlatformPricingSurface(baseProps(client)), container);
      await vi.waitFor(() => expect(overviewAttempts).toBeGreaterThan(0));
      await vi.waitFor(() => {
        expect(container.querySelector('[data-testid="pricing-comparison-shell"]')).toBeTruthy();
      });
      expect(popCount).toBeLessThanOrEqual(4);
    } finally {
      window.removeEventListener("popstate", onPop);
    }
  });

  it("renders preview cards and a bottom create-plan entry without the removed homepage blocks", async () => {
    const container = document.createElement("div");
    const client = mockClient([
      {
        id: "plan-1",
        name: "Growth",
        billingCycle: "monthly",
        basePriceCents: 0,
        currentVersionId: "pv-123456789012",
        seatQuota: {},
        botQuota: 100,
        status: "active",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    ]);
    window.history.replaceState({}, "", PLANS_CATALOG_PATH);
    render(renderPlatformPricingSurface(baseProps(client)), container);
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="pricing-comparison-shell"]')).toBeTruthy();
      expect(container.querySelector('[data-testid="create-plan-link"]')).toBeTruthy();
    });
    expect(container.querySelector('[data-testid="overview-health-banner"]')).toBeFalsy();
    expect(container.querySelector(".pricing-v3__hero")).toBeFalsy();
    expect(container.querySelector('[data-testid="packages-home-mode-tabs"]')).toBeFalsy();
  });

  it("shows empty preview state and create action when no plans exist", async () => {
    const container = document.createElement("div");
    window.history.replaceState({}, "", PLANS_CATALOG_PATH);
    render(renderPlatformPricingSurface(baseProps(mockClient([]))), container);
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="create-plan-link"]')).toBeTruthy();
    });
    expect(container.querySelector('[data-testid="pricing-v3-card"]')).toBeFalsy();
  });
});
