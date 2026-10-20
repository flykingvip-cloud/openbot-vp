// @vitest-environment jsdom

import { render } from "lit";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { zh_CN } from "../../../../i18n/locales/zh-CN.ts";
import {
  baseProps,
  handleCatalogPolicyRpc,
  handlePlanBundleAuxRpc,
  mockClient,
  mockClientWithVersions,
  overviewFor,
  PLAN_FIXTURE,
  PLANS_CATALOG_PATH,
  versionFixture,
} from "./browser-test-helpers.ts";
import { __resetPlatformPricingForTest, renderPlatformPricingSurface } from "./page.ts";

beforeAll(async () => {
  i18n.registerTranslation("zh-CN", zh_CN);
  await i18n.setLocale("zh-CN");
});

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  __resetPlatformPricingForTest();
});

function mount(client: PlatformSurfaceProps["client"], pathname: string) {
  const container = document.createElement("div");
  window.history.replaceState({}, "", pathname);
  const doRender = () => render(renderPlatformPricingSurface(baseProps(client)), container);
  const onPop = () => doRender();
  window.addEventListener("popstate", onPop);
  doRender();
  return { container, onPop };
}

async function openEconomics(container: HTMLElement) {
  await vi.waitFor(() =>
    expect(container.querySelector('[data-testid="pricing-tab-economics"]')).toBeTruthy(),
  );
  container.querySelector<HTMLButtonElement>('[data-testid="pricing-tab-economics"]')?.click();
  await vi.waitFor(() =>
    expect(container.querySelector('[data-testid="economics-summary"]')).toBeTruthy(),
  );
}

type PlatformSurfaceProps = import("../shared/surface.ts").PlatformSurfaceProps;

describe("PlatformPricingSurface top-level pages", () => {
  it("renders create page form", async () => {
    const { container, onPop } = mount(mockClient([]), "/platform/pricing/new");
    try {
      await vi.waitFor(() =>
        expect(container.querySelector('[data-testid="create-plan-page"]')).toBeTruthy(),
      );
      expect(container.querySelector('[data-testid="back-to-plans"]')).toBeTruthy();
      expect(container.textContent).toContain("Viewer 席位价（元）");
    } finally {
      window.removeEventListener("popstate", onPop);
    }
  });

  it("submits create plan through platform-plan-bundle.create", async () => {
    const MODEL_ID = "ollama/llama3.2";
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      const catalogPolicy = handleCatalogPolicyRpc(method, [{ id: PLAN_FIXTURE.id }], params);
      if (catalogPolicy !== undefined) {
        return catalogPolicy;
      }
      const bundleAux = handlePlanBundleAuxRpc(method);
      if (bundleAux !== undefined) {
        return bundleAux;
      }
      if (method === "platform-plan-bundle.overview") {
        return {
          catalog: [MODEL_ID],
          plans: [],
          pricingCatalog: { plans: [], compareRows: [], faq: [], billingHint: "" },
        };
      }
      if (method === "platform-plan-bundle.create") {
        return {
          plan: PLAN_FIXTURE,
          version: versionFixture({ id: "pv-active", version: 1, status: "active" }),
          binding: {
            planVersionId: "pv-active",
            allowedModelIds: [MODEL_ID],
            updatedAt: "2026-03-01T00:00:00.000Z",
          },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const { container, onPop } = mount(
      { request, connected: true } as never,
      "/platform/pricing/new",
    );
    try {
      await vi.waitFor(() =>
        expect(container.querySelector('[data-testid="create-plan-page"]')).toBeTruthy(),
      );
      const nameInput = container.querySelector<HTMLInputElement>(
        '[data-testid="create-plan-name"]',
      );
      nameInput!.value = "Starter";
      nameInput!.dispatchEvent(new Event("input", { bubbles: true }));
      await vi.waitFor(() =>
        expect(
          container.querySelector('[data-testid="create-tier-checkbox"][data-tier-id="tier_a"]'),
        ).toBeTruthy(),
      );
      // Phase 1: Tier is the primary config; the model pool is auto-resolved (no manual model checkboxes).
      const tierButton = container.querySelector<HTMLButtonElement>(
        '[data-testid="create-tier-checkbox"][data-tier-id="tier_a"]',
      );
      tierButton!.click();
      await vi.waitFor(() => expect(container.textContent).toContain("当前已自动解析"));
      container.querySelector<HTMLButtonElement>('[data-testid="create-plan-btn"]')?.click();
      await vi.waitFor(() =>
        expect(request).toHaveBeenCalledWith(
          "platform-plan-bundle.create",
          expect.objectContaining({
            name: "Starter",
            allowedTiers: ["tier_a"],
            allowedModelIds: ["openai/gpt-4o"],
          }),
        ),
      );
    } finally {
      window.removeEventListener("popstate", onPop);
    }
  });

  it("renders package, economics, commerce, and governance tabs", async () => {
    const { container, onPop } = mount(mockClient([]), PLANS_CATALOG_PATH);
    try {
      await vi.waitFor(() =>
        expect(container.querySelector('[data-testid="pricing-sub-tabs"]')).toBeTruthy(),
      );
      expect(container.textContent).toContain("套餐管理");
      expect(container.textContent).toContain("经营分析");
      expect(container.textContent).toContain("商业核销");
      expect(container.textContent).toContain("AI 能力治理");
    } finally {
      window.removeEventListener("popstate", onPop);
    }
  });

  it("renders resource catalog governance workspace", async () => {
    const { container, onPop } = mount(
      mockClientWithVersions([versionFixture()]),
      PLANS_CATALOG_PATH,
    );
    try {
      await vi.waitFor(() =>
        expect(container.querySelector('[data-testid="pricing-tab-resourceCatalog"]')).toBeTruthy(),
      );
      container
        .querySelector<HTMLButtonElement>('[data-testid="pricing-tab-resourceCatalog"]')
        ?.click();
      await vi.waitFor(() =>
        expect(container.querySelector('[data-testid="resource-catalog-panel"]')).toBeTruthy(),
      );
      expect(container.querySelector('[data-testid="resource-governance-workspace"]')).toBeTruthy();
    } finally {
      window.removeEventListener("popstate", onPop);
    }
  });

  it("saves tier credit weight from tier detail", async () => {
    const upsertCalls: Array<{ tier: string; creditCost: number }> = [];
    const client = {
      request: async (method: string, params?: Record<string, unknown>) => {
        const catalogPolicy = handleCatalogPolicyRpc(method, [{ id: PLAN_FIXTURE.id }], params);
        if (catalogPolicy !== undefined) {
          if (method === "platform-resource-catalog.tiers.upsert") {
            return catalogPolicy;
          }
          return catalogPolicy;
        }
        if (method === "platform-plan-bundle.overview") {
          return overviewFor(PLAN_FIXTURE, [
            versionFixture({ id: "pv-active", version: 1, status: "active" }),
          ]);
        }
        if (method === "platform-resource-catalog.credit-weights.upsert") {
          upsertCalls.push({
            tier: typeof params?.tier === "string" ? params.tier : "",
            creditCost: Number(params?.creditCost ?? 0),
          });
          return {
            creditWeight: {
              tier: params?.tier,
              creditCost: params?.creditCost,
              updatedAt: "2026-06-23T00:00:00.000Z",
            },
          };
        }
        throw new Error(`unexpected method ${method}`);
      },
      connected: true,
    } as never;
    const { container, onPop } = mount(client, PLANS_CATALOG_PATH);
    try {
      await vi.waitFor(() =>
        expect(container.querySelector('[data-testid="pricing-tab-resourceCatalog"]')).toBeTruthy(),
      );
      container
        .querySelector<HTMLButtonElement>('[data-testid="pricing-tab-resourceCatalog"]')
        ?.click();
      await vi.waitFor(() =>
        expect(container.querySelector('[data-testid="resource-catalog-panel"]')).toBeTruthy(),
      );
      container.querySelector<HTMLButtonElement>('[data-testid="tier-edit-tier_a"]')?.click();
      await vi.waitFor(() =>
        expect(container.querySelector('[data-testid="tier-detail-page"]')).toBeTruthy(),
      );
      const input = container.querySelector<HTMLInputElement>(
        '[data-testid="tier-detail-credit-input"]',
      );
      input!.value = "3";
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      container
        .querySelector<HTMLButtonElement>('[data-testid="tier-detail-save-credit"]')
        ?.click();
      await vi.waitFor(() => expect(upsertCalls).toEqual([{ tier: "tier_a", creditCost: 3 }]));
    } finally {
      window.removeEventListener("popstate", onPop);
    }
  });

  it("renders economics workspace", async () => {
    const { container, onPop } = mount(
      mockClientWithVersions([versionFixture()]),
      PLANS_CATALOG_PATH,
    );
    try {
      await openEconomics(container);
      expect(container.querySelector('[data-testid="economics-workspace"]')).toBeTruthy();
      expect(container.querySelector('[data-testid="plan-operating-table"]')).toBeTruthy();
    } finally {
      window.removeEventListener("popstate", onPop);
    }
  });
});
