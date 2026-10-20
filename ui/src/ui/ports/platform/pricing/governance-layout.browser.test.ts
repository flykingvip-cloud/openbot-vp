// @vitest-environment jsdom

import { render } from "lit";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { zh_CN } from "../../../../i18n/locales/zh-CN.ts";
import { renderPlatformPricingSurface } from "./page.ts";

beforeAll(async () => {
  i18n.registerTranslation("zh-CN", zh_CN);
  await i18n.setLocale("zh-CN");
});

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

function client() {
  return {
    request: vi.fn(async (method: string) => {
      if (method === "platform-plan-bundle.overview") {
        return {
          catalog: ["ollama/llama3.2"],
          plans: [],
          pricingCatalog: {
            plans: [],
            compareRows: [],
            faq: [],
            billingHint: "",
          },
        };
      }
      if (method === "platform-policy.overview") {
        return {
          policies: [
            {
              id: "balanced",
              name: "Balanced",
              description: "",
              selectorStrategy: "balanced",
              status: "active",
              builtin: true,
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (method === "platform-resource-catalog.overview") {
        return {
          tiers: [{ id: "tier_a", name: "Tier A" }],
          models: [],
        };
      }
      if (method === "platform-subscriptions.summary") {
        return { plans: [] };
      }
      if (method === "platform-economics.overview") {
        return { summary: null, projectionContext: null };
      }
      throw new Error(`Unhandled method ${method}`);
    }),
  } as never;
}

describe("platform pricing governance editor layout", () => {
  it("renders governance options as compact horizontal chips", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    window.history.replaceState({}, "", "/platform/pricing/new");

    render(
      renderPlatformPricingSurface({
        tab: "platformPricing",
        basePath: "",
        client: client(),
        readModel: {} as never,
        channelsProps: {} as never,
        actions: {} as never,
      }),
      container,
    );

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="create-plan-page"]')).toBeTruthy();
      expect(container.querySelector('[data-testid="create-governance-editor"]')).toBeTruthy();
    });

    const chips = container.querySelectorAll(".platform-pricing__segmented-chip");
    expect(chips.length).toBeGreaterThanOrEqual(6);
    expect(container.textContent).toContain("审计日志");
    expect(container.textContent).toContain("MFA");
    expect(container.textContent).toContain("VPC 隔离");
  });
});
