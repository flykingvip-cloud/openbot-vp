// @vitest-environment jsdom

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../../../i18n/index.ts";
import { zh_CN } from "../../../../../i18n/locales/zh-CN.ts";
import { renderCatalogPanel } from "./catalog-panel.ts";

beforeEach(async () => {
  i18n.registerTranslation("zh-CN", zh_CN);
  await i18n.setLocale("zh-CN");
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("catalog-panel", () => {
  it("renders pricing-v3 page with the current plan highlighted", () => {
    const onSelectCycle = vi.fn();
    const onSelectPlan = vi.fn();
    const onContactSales = vi.fn();
    const container = document.createElement("div");

    render(
      renderCatalogPanel({
        client: {} as never,
        loading: false,
        error: null,
        selectedCycle: "monthly",
        actionNotice: null,
        actionError: null,
        actionBusy: false,
        onSelectCycle,
        onSelectPlan,
        onContactSales,
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
            billingHint: "按团队席位、AI 员工与企业治理能力计费。",
          },
        } as never,
      }),
      container,
    );

    expect(container.querySelector('[data-testid="pricing-v3-page"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="pricing-v3-card"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="pricing-v3-cta"]')).toBeTruthy();
    expect(container.textContent).toContain("专业版");
    expect(container.textContent).not.toContain("年付折后");
  });
});
