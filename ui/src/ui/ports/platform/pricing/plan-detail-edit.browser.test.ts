// @vitest-environment jsdom

import { render } from "lit";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { zh_CN } from "../../../../i18n/locales/zh-CN.ts";
import {
  baseProps,
  handleCatalogPolicyRpc,
  handlePlanBundleAuxRpc,
  overviewFor,
  PLAN_FIXTURE,
  PLANS_CATALOG_PATH,
  planDetailPath,
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

type PlatformSurfaceProps = import("../shared/surface.ts").PlatformSurfaceProps;

describe("PlatformPricingSurface detail editing", () => {
  it("opens detail page from the homepage card edit button", async () => {
    const client = {
      request: async (method: string, params?: Record<string, unknown>) => {
        const catalogPolicy = handleCatalogPolicyRpc(method, [{ id: PLAN_FIXTURE.id }], params);
        if (catalogPolicy !== undefined) {
          return catalogPolicy;
        }
        if (method === "platform-plan-bundle.overview") {
          return overviewFor(PLAN_FIXTURE, [versionFixture()]);
        }
        const aux = handlePlanBundleAuxRpc(method);
        if (aux !== undefined) {
          return aux;
        }
        throw new Error(`unexpected method ${method}`);
      },
      connected: true,
    } as never;
    const { container, onPop } = mount(client, PLANS_CATALOG_PATH);
    try {
      await vi.waitFor(() =>
        expect(container.querySelector('[data-testid="compare-card-edit"]')).toBeTruthy(),
      );
      container.querySelector<HTMLButtonElement>('[data-testid="compare-card-edit"]')?.click();
      window.dispatchEvent(new PopStateEvent("popstate"));
      await vi.waitFor(() =>
        expect(container.querySelector('[data-testid="edit-plan-page"]')).toBeTruthy(),
      );
    } finally {
      window.removeEventListener("popstate", onPop);
    }
  });

  it("renders version timeline in detail page versions tab", async () => {
    const client = {
      request: async (method: string, params?: Record<string, unknown>) => {
        const catalogPolicy = handleCatalogPolicyRpc(method, [{ id: PLAN_FIXTURE.id }], params);
        if (catalogPolicy !== undefined) {
          return catalogPolicy;
        }
        if (method === "platform-plan-bundle.overview") {
          return overviewFor(PLAN_FIXTURE, [
            versionFixture({ id: "pv-active", version: 1, status: "active" }),
            versionFixture({ id: "pv-draft", version: 2, status: "draft" }),
          ]);
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
        const aux = handlePlanBundleAuxRpc(method);
        if (aux !== undefined) {
          return aux;
        }
        throw new Error(`unexpected method ${method}`);
      },
      connected: true,
    } as never;
    const { container, onPop } = mount(client, planDetailPath("plan-1", "versions"));
    try {
      await vi.waitFor(() => {
        expect(container.querySelector('[data-testid="versions-panel"]')).toBeTruthy();
        expect(container.querySelectorAll('[data-testid="version-row"]').length).toBe(2);
      });
      expect(container.textContent).toContain("v1");
      expect(container.textContent).toContain("v2");
    } finally {
      window.removeEventListener("popstate", onPop);
    }
  });

  it("shows binding blocker in detail page versions tab", async () => {
    const client = {
      request: async (method: string, params?: Record<string, unknown>) => {
        const catalogPolicy = handleCatalogPolicyRpc(method, [{ id: PLAN_FIXTURE.id }], params);
        if (catalogPolicy !== undefined) {
          return catalogPolicy;
        }
        if (method === "platform-plan-bundle.overview") {
          return overviewFor(PLAN_FIXTURE, [
            versionFixture({
              id: "pv-active",
              version: 1,
              status: "active",
              bindingState: "valid",
            }),
            versionFixture({
              id: "pv-draft",
              version: 2,
              status: "draft",
              bindingState: "missing",
              activationReady: false,
              activationBlockers: ["missing_binding"],
            }),
          ]);
        }
        const aux = handlePlanBundleAuxRpc(method);
        if (aux !== undefined) {
          return aux;
        }
        throw new Error(`unexpected method ${method}`);
      },
      connected: true,
    } as never;
    const { container, onPop } = mount(client, planDetailPath("plan-1", "versions"));
    try {
      await vi.waitFor(() => {
        expect(container.textContent).toContain("未绑定可用模型");
        expect(container.querySelector('[data-testid="version-fix-models-btn"]')).toBeTruthy();
      });
    } finally {
      window.removeEventListener("popstate", onPop);
    }
  });

  it("renders the models tab as a read-only Tier-resolved pool linking to the plan editor", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      const catalogPolicy = handleCatalogPolicyRpc(method, [{ id: PLAN_FIXTURE.id }], params);
      if (catalogPolicy !== undefined) {
        return catalogPolicy;
      }
      if (method === "platform-plan-bundle.overview") {
        return overviewFor(PLAN_FIXTURE, [
          versionFixture({
            id: "pv-active",
            version: 1,
            status: "active",
            bindingState: "valid",
            activationBlockers: [],
            binding: {
              planVersionId: "pv-active",
              allowedModelIds: [],
              allowedTiers: ["tier_a"],
              allowedPolicies: ["balanced"],
              policyId: "balanced",
            },
            entitlementSnapshot: {
              planVersionId: "pv-active",
              monthlyPriceCents: 0,
              monthlyCredits: 100,
              maxSeats: {},
              maxBots: 10,
              allowedPolicies: ["balanced"],
              allowedTiers: ["tier_a"],
              updatedAt: "2026-03-01T00:00:00.000Z",
            },
          }),
        ]);
      }
      const aux = handlePlanBundleAuxRpc(method);
      if (aux !== undefined) {
        return aux;
      }
      throw new Error(`unexpected method ${method}`);
    });
    const { container, onPop } = mount(
      { request, connected: true } as never,
      planDetailPath("plan-1", "models"),
    );
    try {
      await vi.waitFor(() =>
        expect(container.querySelector('[data-testid="plan-config-models"]')).toBeTruthy(),
      );
      // Tier-resolved pool is shown read-only (tier_a -> openai/gpt-4o from the shared catalog fixture).
      await vi.waitFor(() =>
        expect(
          container.querySelector(
            '[data-testid="plan-config-resolved-model-row"][data-model-id="openai/gpt-4o"]',
          ),
        ).toBeTruthy(),
      );
      // No manual model maintenance: no checkboxes, no save-binding button.
      expect(container.querySelector('[data-testid="drawer-model-checkbox"]')).toBeNull();
      expect(container.querySelector('[data-testid="model-binding-save-btn"]')).toBeNull();
      // The CTA routes to the plan editor where tiers (the single source of truth) are configured.
      container
        .querySelector<HTMLButtonElement>('[data-testid="plan-config-edit-tiers-btn"]')
        ?.click();
      window.dispatchEvent(new PopStateEvent("popstate"));
      await vi.waitFor(() =>
        expect(container.querySelector('[data-testid="edit-plan-page"]')).toBeTruthy(),
      );
      // The models tab never writes a manual binding to the backend.
      expect(request).not.toHaveBeenCalledWith("platform-plan-bundle.update", expect.anything());
    } finally {
      window.removeEventListener("popstate", onPop);
    }
  });

  it("prefers the latest draft binding when reopening bundle edit form", async () => {
    const MODEL_ID = "ollama/llama3.2";
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      const catalogPolicy = handleCatalogPolicyRpc(method, [{ id: PLAN_FIXTURE.id }], params);
      if (catalogPolicy !== undefined) {
        return catalogPolicy;
      }
      if (method === "platform-plan-bundle.overview") {
        return overviewFor(PLAN_FIXTURE, [
          versionFixture({
            id: "pv-active",
            version: 1,
            status: "active",
            bindingState: "valid",
            activationBlockers: [],
            binding: {
              planVersionId: "pv-active",
              allowedModelIds: [],
              allowedTiers: ["tier_a"],
              allowedPolicies: ["balanced"],
              policyId: "balanced",
            },
            entitlementSnapshot: {
              planVersionId: "pv-active",
              monthlyPriceCents: 0,
              monthlyCredits: 100,
              maxSeats: {},
              maxBots: 10,
              allowedPolicies: ["balanced"],
              allowedTiers: ["tier_a"],
              updatedAt: "2026-03-01T00:00:00.000Z",
            },
          }),
          versionFixture({
            id: "pv-draft",
            version: 2,
            status: "draft",
            bindingState: "valid",
            activationReady: true,
            activationBlockers: [],
            binding: {
              planVersionId: "pv-draft",
              allowedModelIds: [MODEL_ID],
              allowedTiers: ["tier_b"],
              allowedPolicies: ["balanced"],
              policyId: "balanced",
            },
            entitlementSnapshot: {
              planVersionId: "pv-draft",
              monthlyPriceCents: 0,
              monthlyCredits: 100,
              maxSeats: {},
              maxBots: 10,
              allowedPolicies: ["balanced"],
              allowedTiers: ["tier_b"],
              updatedAt: "2026-03-01T00:00:00.000Z",
            },
          }),
        ]);
      }
      const aux = handlePlanBundleAuxRpc(method);
      if (aux !== undefined) {
        return aux;
      }
      throw new Error(`unexpected method ${method}`);
    });
    const { container, onPop } = mount(
      { request, connected: true } as never,
      planDetailPath("plan-1", "bundle"),
    );
    try {
      await vi.waitFor(() =>
        expect(container.querySelector('[data-testid="edit-plan-page"]')).toBeTruthy(),
      );
      await vi.waitFor(() => {
        expect(container.querySelector('[data-testid="edit-plan-page"]')).toBeTruthy();
        const draftTier = container.querySelector<HTMLButtonElement>(
          '[data-testid="edit-tier-checkbox"][data-tier-id="tier_b"]',
        );
        expect(draftTier?.getAttribute("aria-pressed")).toBe("true");
      });
    } finally {
      window.removeEventListener("popstate", onPop);
    }
  });

  it("uses draft-oriented save copy in bundle edit mode", async () => {
    const client = {
      request: async (method: string, params?: Record<string, unknown>) => {
        const catalogPolicy = handleCatalogPolicyRpc(method, [{ id: PLAN_FIXTURE.id }], params);
        if (catalogPolicy !== undefined) {
          return catalogPolicy;
        }
        if (method === "platform-plan-bundle.overview") {
          return overviewFor(PLAN_FIXTURE, [versionFixture()]);
        }
        const aux = handlePlanBundleAuxRpc(method);
        if (aux !== undefined) {
          return aux;
        }
        throw new Error(`unexpected method ${method}`);
      },
      connected: true,
    } as never;
    const { container, onPop } = mount(client, planDetailPath("plan-1", "bundle"));
    try {
      await vi.waitFor(() =>
        expect(container.querySelector('[data-testid="edit-plan-page"]')).toBeTruthy(),
      );
      expect(container.textContent).toContain("保存草稿");
    } finally {
      window.removeEventListener("popstate", onPop);
    }
  });

  it("shows a top draft activation banner when a draft version exists", async () => {
    const client = {
      request: async (method: string, params?: Record<string, unknown>) => {
        const catalogPolicy = handleCatalogPolicyRpc(method, [{ id: PLAN_FIXTURE.id }], params);
        if (catalogPolicy !== undefined) {
          return catalogPolicy;
        }
        if (method === "platform-plan-bundle.overview") {
          return overviewFor(PLAN_FIXTURE, [
            versionFixture({ id: "pv-active", version: 1, status: "active" }),
            versionFixture({ id: "pv-draft", version: 2, status: "draft" }),
          ]);
        }
        const aux = handlePlanBundleAuxRpc(method);
        if (aux !== undefined) {
          return aux;
        }
        throw new Error(`unexpected method ${method}`);
      },
      connected: true,
    } as never;
    const { container, onPop } = mount(client, planDetailPath("plan-1", "bundle"));
    try {
      await vi.waitFor(() =>
        expect(container.querySelector('[data-testid="edit-plan-draft-banner"]')).toBeTruthy(),
      );
      expect(container.querySelector('[data-testid="edit-plan-activate-draft-btn"]')).toBeTruthy();
      expect(container.textContent).toContain("当前正在编辑草稿");
      expect(container.textContent).toContain("立即激活草稿");
    } finally {
      window.removeEventListener("popstate", onPop);
    }
  });

  it("resolves allowed models from selected tiers when saving bundle draft", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      const catalogPolicy = handleCatalogPolicyRpc(method, [{ id: PLAN_FIXTURE.id }], params);
      if (catalogPolicy !== undefined) {
        return catalogPolicy;
      }
      if (method === "platform-plan-bundle.overview") {
        return overviewFor(PLAN_FIXTURE, [
          versionFixture({
            id: "pv-active",
            version: 1,
            status: "active",
            bindingState: "valid",
            activationBlockers: [],
            binding: {
              planVersionId: "pv-active",
              allowedModelIds: [],
              allowedTiers: [],
              allowedPolicies: ["balanced"],
              policyId: "balanced",
            },
            entitlementSnapshot: {
              planVersionId: "pv-active",
              monthlyPriceCents: 0,
              monthlyCredits: 100,
              maxSeats: {},
              maxBots: 10,
              allowedPolicies: ["balanced"],
              allowedTiers: [],
              updatedAt: "2026-03-01T00:00:00.000Z",
            },
          }),
        ]);
      }
      if (method === "platform-plan-bundle.update") {
        return {
          plan: PLAN_FIXTURE,
          version: versionFixture({ id: "pv-draft", version: 2, status: "draft" }),
          binding: {
            planVersionId: "pv-draft",
            allowedModelIds: ["openai/gpt-4o"],
            allowedTiers: ["tier_a"],
            updatedAt: "2026-03-01T00:00:00.000Z",
          },
        };
      }
      const aux = handlePlanBundleAuxRpc(method);
      if (aux !== undefined) {
        return aux;
      }
      throw new Error(`unexpected method ${method}`);
    });
    const { container, onPop } = mount(
      { request, connected: true } as never,
      planDetailPath("plan-1", "bundle"),
    );
    try {
      await vi.waitFor(() =>
        expect(container.querySelector('[data-testid="edit-plan-page"]')).toBeTruthy(),
      );
      const tierButton = await vi.waitFor(() => {
        const el = container.querySelector<HTMLButtonElement>(
          '[data-testid="edit-tier-checkbox"][data-tier-id="tier_a"]',
        );
        expect(el).toBeTruthy();
        return el!;
      });
      tierButton.click();

      await vi.waitFor(() => expect(container.textContent).toContain("当前已自动解析 1 个模型"));
      container.querySelector<HTMLButtonElement>('[data-testid="save-plan-btn"]')?.click();
      await vi.waitFor(() =>
        expect(request).toHaveBeenCalledWith(
          "platform-plan-bundle.update",
          expect.objectContaining({
            planId: "plan-1",
            allowedTiers: ["tier_a"],
            allowedModelIds: ["openai/gpt-4o"],
          }),
        ),
      );
    } finally {
      window.removeEventListener("popstate", onPop);
    }
  });

  it("saves per-model request cap, token cap, and budgets in the advanced control", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      const catalogPolicy = handleCatalogPolicyRpc(method, [{ id: PLAN_FIXTURE.id }], params);
      if (catalogPolicy !== undefined) {
        return catalogPolicy;
      }
      if (method === "platform-plan-bundle.overview") {
        return overviewFor(PLAN_FIXTURE, [
          versionFixture({
            id: "pv-active",
            version: 1,
            status: "active",
            bindingState: "valid",
            activationBlockers: [],
            binding: {
              planVersionId: "pv-active",
              allowedModelIds: [],
              allowedTiers: [],
              allowedPolicies: ["balanced"],
              policyId: "balanced",
            },
            entitlementSnapshot: {
              planVersionId: "pv-active",
              monthlyPriceCents: 0,
              monthlyCredits: 100,
              maxSeats: {},
              maxBots: 10,
              allowedPolicies: ["balanced"],
              allowedTiers: [],
              updatedAt: "2026-03-01T00:00:00.000Z",
            },
          }),
        ]);
      }
      if (method === "platform-plan-bundle.update") {
        return {
          plan: PLAN_FIXTURE,
          version: versionFixture({ id: "pv-draft", version: 2, status: "draft" }),
          binding: {
            planVersionId: "pv-draft",
            allowedModelIds: ["openai/gpt-4o"],
            allowedTiers: ["tier_a"],
            updatedAt: "2026-03-01T00:00:00.000Z",
          },
        };
      }
      const aux = handlePlanBundleAuxRpc(method);
      if (aux !== undefined) {
        return aux;
      }
      throw new Error(`unexpected method ${method}`);
    });
    const { container, onPop } = mount(
      { request, connected: true } as never,
      planDetailPath("plan-1", "bundle"),
    );
    try {
      await vi.waitFor(() =>
        expect(container.querySelector('[data-testid="edit-plan-page"]')).toBeTruthy(),
      );
      const tierButton = await vi.waitFor(() => {
        const el = container.querySelector<HTMLButtonElement>(
          '[data-testid="edit-tier-checkbox"][data-tier-id="tier_a"]',
        );
        expect(el).toBeTruthy();
        return el!;
      });
      tierButton.click();
      // Fill both per-model guardrails for the auto-resolved model.
      const requestCap = await vi.waitFor(() => {
        const el = container.querySelector<HTMLInputElement>(
          '[data-testid="edit-model-quota"][data-model-id="openai/gpt-4o"]',
        );
        expect(el).toBeTruthy();
        return el!;
      });
      requestCap.value = "100";
      requestCap.dispatchEvent(new Event("input", { bubbles: true }));
      const tokenCap = container.querySelector<HTMLInputElement>(
        '[data-testid="edit-model-token-cap"][data-model-id="openai/gpt-4o"]',
      );
      tokenCap!.value = "2000000";
      tokenCap!.dispatchEvent(new Event("input", { bubbles: true }));
      // Fill per-model budgets (Phase 4) — independent of the guardrail caps above.
      const creditsCap = container.querySelector<HTMLInputElement>(
        '[data-testid="edit-model-budget-credits"][data-model-id="openai/gpt-4o"]',
      );
      creditsCap!.value = "5000";
      creditsCap!.dispatchEvent(new Event("input", { bubbles: true }));
      const spendCap = container.querySelector<HTMLInputElement>(
        '[data-testid="edit-model-budget-spend"][data-model-id="openai/gpt-4o"]',
      );
      spendCap!.value = "20000";
      spendCap!.dispatchEvent(new Event("input", { bubbles: true }));

      container.querySelector<HTMLButtonElement>('[data-testid="save-plan-btn"]')?.click();
      await vi.waitFor(() =>
        expect(request).toHaveBeenCalledWith(
          "platform-plan-bundle.update",
          expect.objectContaining({
            allowedModelIds: ["openai/gpt-4o"],
            modelQuota: { "openai/gpt-4o": { maxRequests: 100, maxTokens: 2_000_000 } },
            modelBudgets: { "openai/gpt-4o": { monthlyCreditsCap: 5000, spendCapCents: 20000 } },
          }),
        ),
      );
    } finally {
      window.removeEventListener("popstate", onPop);
    }
  });

  it("shows an empty model pool and blocks create when no tier is selected", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      const catalogPolicy = handleCatalogPolicyRpc(method, [{ id: PLAN_FIXTURE.id }], params);
      if (catalogPolicy !== undefined) {
        return catalogPolicy;
      }
      const aux = handlePlanBundleAuxRpc(method);
      if (aux !== undefined) {
        return aux;
      }
      if (method === "platform-plan-bundle.overview") {
        return {
          catalog: [],
          plans: [],
          pricingCatalog: { plans: [], compareRows: [], faq: [], billingHint: "" },
        };
      }
      if (method === "platform-plan-bundle.create") {
        return {
          plan: PLAN_FIXTURE,
          version: versionFixture(),
          binding: {
            planVersionId: "pv-active",
            allowedModelIds: [],
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
      // No tier selected -> model pool is empty (read-only empty state).
      await vi.waitFor(() =>
        expect(container.querySelector('[data-testid="create-model-preview-empty"]')).toBeTruthy(),
      );
      container.querySelector<HTMLButtonElement>('[data-testid="create-plan-btn"]')?.click();
      await vi.waitFor(() => expect(container.textContent).toContain("请至少选择 1 个 Tier"));
      expect(request).not.toHaveBeenCalledWith("platform-plan-bundle.create", expect.anything());
    } finally {
      window.removeEventListener("popstate", onPop);
    }
  });

  it("still displays a legacy version that only has allowedModelIds and no tiers", async () => {
    const client = {
      request: async (method: string, params?: Record<string, unknown>) => {
        const catalogPolicy = handleCatalogPolicyRpc(method, [{ id: PLAN_FIXTURE.id }], params);
        if (catalogPolicy !== undefined) {
          return catalogPolicy;
        }
        if (method === "platform-plan-bundle.overview") {
          return overviewFor(PLAN_FIXTURE, [
            versionFixture({
              id: "pv-active",
              version: 1,
              status: "active",
              bindingState: "valid",
              activationBlockers: [],
              binding: {
                planVersionId: "pv-active",
                allowedModelIds: ["openai/gpt-4o"],
                allowedTiers: [],
                allowedPolicies: ["balanced"],
                policyId: "balanced",
              },
              entitlementSnapshot: {
                planVersionId: "pv-active",
                monthlyPriceCents: 0,
                monthlyCredits: 100,
                maxSeats: {},
                maxBots: 10,
                allowedPolicies: ["balanced"],
                allowedTiers: [],
                updatedAt: "2026-03-01T00:00:00.000Z",
              },
            }),
          ]);
        }
        const aux = handlePlanBundleAuxRpc(method);
        if (aux !== undefined) {
          return aux;
        }
        throw new Error(`unexpected method ${method}`);
      },
      connected: true,
    } as never;
    const { container, onPop } = mount(client, planDetailPath("plan-1", "bundle"));
    try {
      await vi.waitFor(() =>
        expect(container.querySelector('[data-testid="edit-plan-page"]')).toBeTruthy(),
      );
      // Legacy binding (allowedModelIds, no tiers) still renders its model pool read-only.
      await vi.waitFor(() =>
        expect(
          container.querySelector(
            '[data-testid="resolved-model-row"][data-model-id="openai/gpt-4o"]',
          ),
        ).toBeTruthy(),
      );
    } finally {
      window.removeEventListener("popstate", onPop);
    }
  });

  it("limits advanced modelQuota controls to the auto-resolved pool", async () => {
    const client = {
      request: async (method: string, params?: Record<string, unknown>) => {
        const catalogPolicy = handleCatalogPolicyRpc(method, [{ id: PLAN_FIXTURE.id }], params);
        if (catalogPolicy !== undefined) {
          return catalogPolicy;
        }
        if (method === "platform-plan-bundle.overview") {
          return overviewFor(PLAN_FIXTURE, [
            versionFixture({
              id: "pv-active",
              version: 1,
              status: "active",
              bindingState: "valid",
              activationBlockers: [],
              binding: {
                planVersionId: "pv-active",
                allowedModelIds: [],
                allowedTiers: [],
                allowedPolicies: ["balanced"],
                policyId: "balanced",
              },
              entitlementSnapshot: {
                planVersionId: "pv-active",
                monthlyPriceCents: 0,
                monthlyCredits: 100,
                maxSeats: {},
                maxBots: 10,
                allowedPolicies: ["balanced"],
                allowedTiers: [],
                updatedAt: "2026-03-01T00:00:00.000Z",
              },
            }),
          ]);
        }
        const aux = handlePlanBundleAuxRpc(method);
        if (aux !== undefined) {
          return aux;
        }
        throw new Error(`unexpected method ${method}`);
      },
      connected: true,
    } as never;
    const { container, onPop } = mount(client, planDetailPath("plan-1", "bundle"));
    try {
      await vi.waitFor(() =>
        expect(container.querySelector('[data-testid="edit-plan-page"]')).toBeTruthy(),
      );
      const tierButton = await vi.waitFor(() => {
        const el = container.querySelector<HTMLButtonElement>(
          '[data-testid="edit-tier-checkbox"][data-tier-id="tier_a"]',
        );
        expect(el).toBeTruthy();
        return el!;
      });
      tierButton.click();
      // Advanced control exposes per-model guardrail inputs only for the auto-resolved pool (tier_a -> gpt-4o).
      await vi.waitFor(() => {
        expect(container.querySelector('[data-testid="edit-advanced-model-control"]')).toBeTruthy();
        expect(
          container.querySelector(
            '[data-testid="advanced-model-quota-row"][data-model-id="openai/gpt-4o"]',
          ),
        ).toBeTruthy();
      });
      // Both the request cap and the token cap inputs are present for the resolved model.
      expect(
        container.querySelector('[data-testid="edit-model-quota"][data-model-id="openai/gpt-4o"]'),
      ).toBeTruthy();
      expect(
        container.querySelector(
          '[data-testid="edit-model-token-cap"][data-model-id="openai/gpt-4o"]',
        ),
      ).toBeTruthy();
      // Phase 4: per-model budget inputs (credits + spend) are present for the resolved model too.
      expect(
        container.querySelector(
          '[data-testid="edit-model-budget-credits"][data-model-id="openai/gpt-4o"]',
        ),
      ).toBeTruthy();
      expect(
        container.querySelector(
          '[data-testid="edit-model-budget-spend"][data-model-id="openai/gpt-4o"]',
        ),
      ).toBeTruthy();
      // tier_b's model is not in the resolved pool, so it has neither guardrail control.
      expect(
        container.querySelector(
          '[data-testid="advanced-model-quota-row"][data-model-id="openai/gpt-4o-mini"]',
        ),
      ).toBeNull();
      expect(
        container.querySelector(
          '[data-testid="edit-model-token-cap"][data-model-id="openai/gpt-4o-mini"]',
        ),
      ).toBeNull();
    } finally {
      window.removeEventListener("popstate", onPop);
    }
  });

  it("demotes per-model guardrails into a collapsed advanced control, out of the main flow", async () => {
    const client = {
      request: async (method: string, params?: Record<string, unknown>) => {
        const catalogPolicy = handleCatalogPolicyRpc(method, [{ id: PLAN_FIXTURE.id }], params);
        if (catalogPolicy !== undefined) {
          return catalogPolicy;
        }
        if (method === "platform-plan-bundle.overview") {
          return overviewFor(PLAN_FIXTURE, [
            versionFixture({
              id: "pv-active",
              version: 1,
              status: "active",
              bindingState: "valid",
              activationBlockers: [],
              binding: {
                planVersionId: "pv-active",
                allowedModelIds: [],
                allowedTiers: [],
                allowedPolicies: ["balanced"],
                policyId: "balanced",
              },
              entitlementSnapshot: {
                planVersionId: "pv-active",
                monthlyPriceCents: 0,
                monthlyCredits: 100,
                maxSeats: {},
                maxBots: 10,
                allowedPolicies: ["balanced"],
                allowedTiers: [],
                updatedAt: "2026-03-01T00:00:00.000Z",
              },
            }),
          ]);
        }
        const aux = handlePlanBundleAuxRpc(method);
        if (aux !== undefined) {
          return aux;
        }
        throw new Error(`unexpected method ${method}`);
      },
      connected: true,
    } as never;
    const { container, onPop } = mount(client, planDetailPath("plan-1", "bundle"));
    try {
      await vi.waitFor(() =>
        expect(container.querySelector('[data-testid="edit-plan-page"]')).toBeTruthy(),
      );
      const tierButton = await vi.waitFor(() => {
        const el = container.querySelector<HTMLButtonElement>(
          '[data-testid="edit-tier-checkbox"][data-tier-id="tier_a"]',
        );
        expect(el).toBeTruthy();
        return el!;
      });
      tierButton.click();
      // Phase 2: the per-model guardrail is demoted into a collapsed <details> advanced control.
      const advanced = await vi.waitFor(() => {
        const el = container.querySelector<HTMLDetailsElement>(
          '[data-testid="edit-advanced-model-control"]',
        );
        expect(el).toBeTruthy();
        return el!;
      });
      // It is a real <details> element and collapsed by default (not surfaced in the main flow).
      expect(advanced.tagName).toBe("DETAILS");
      expect(advanced.open).toBe(false);
      // Every per-model guardrail input (request cap + token cap) lives inside the advanced control.
      const quotaInputs = container.querySelectorAll(
        '[data-testid="edit-model-quota"], [data-testid="edit-model-token-cap"]',
      );
      expect(quotaInputs.length).toBeGreaterThan(0);
      for (const input of quotaInputs) {
        expect(advanced.contains(input)).toBe(true);
      }
    } finally {
      window.removeEventListener("popstate", onPop);
    }
  });
});
