// @vitest-environment jsdom

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderPricingPage } from "./pricing-page.ts";

const basePlan = {
  id: "plan-pro",
  planVersionId: "pv-pro",
  slot: "professional" as const,
  displayName: "专业版",
  pricing: { monthly: 99_900, annual: 84_900 },
  capabilities: [],
  metrics: {
    seats: 30,
    aiEmployees: 120,
    concurrentRuns: 20,
    creditsMonthly: 30_000,
    workflows: 50,
    knowledgeBases: 50,
  },
  aiAuthorizationLabel: "专业 AI",
  cardFields: {
    overagePolicy: "超额阻断",
  },
  compare: {
    aiEmployees: 120,
    concurrentRuns: 20,
    creditsMonthly: 30_000,
    overagePolicy: "超额阻断",
  },
  cta: { label: "立即升级", type: "upgrade" as const },
  contactSales: false,
  freeTrial: false,
};

describe("renderPricingPage", () => {
  it("does not render the removed hero area", () => {
    const container = document.createElement("div");
    render(
      renderPricingPage({
        catalog: {
          plans: [basePlan],
          compareRows: [],
          faq: [],
          billingHint: "按团队席位、AI 员工与企业治理能力计费。",
        },
        selectedCycle: "monthly",
        onSelectCycle: vi.fn(),
        hideCta: true,
      }),
      container,
    );

    expect(container.querySelector(".pricing-v3__hero")).toBeFalsy();
    expect(container.querySelector(".pricing-v3__subtitle")).toBeFalsy();
    expect(container.querySelector(".pricing-v3__billing-hint")).toBeFalsy();
  });

  it("hides compare and FAQ blocks on the public pricing surface but shows CTAs", () => {
    const container = document.createElement("div");
    render(
      renderPricingPage({
        catalog: {
          plans: [basePlan],
          compareRows: [{ id: "row-1", label: "多智能体编排", values: { professional: true } }],
          faq: [{ question: "如何升级？", answer: "联系销售。" }],
          billingHint: "按团队席位、AI 员工与企业治理能力计费。",
        },
        selectedCycle: "monthly",
        onSelectCycle: vi.fn(),
        showCta: true,
        publicSurface: true,
        onSelectPlan: vi.fn(),
      }),
      container,
    );

    expect(container.querySelector('[data-testid="pricing-v3-compare"]')).toBeFalsy();
    expect(container.textContent).not.toContain("功能对比");
    expect(container.querySelector(".pricing-v3__value-strip")).toBeFalsy();
    expect(container.querySelector("[data-testid='pricing-v3-cta']")).toBeTruthy();
  });

  it("admin preview can hide purchase CTA while keeping edit path via onEditPlan on grid cards", () => {
    const container = document.createElement("div");
    const onEdit = vi.fn();
    render(
      renderPricingPage({
        catalog: {
          plans: [basePlan],
          compareRows: [],
          faq: [],
          billingHint: "",
        },
        selectedCycle: "monthly",
        onSelectCycle: vi.fn(),
        hideCta: true,
        onEditPlan: onEdit,
      }),
      container,
    );
    expect(container.querySelector("[data-testid='pricing-v3-cta']")).toBeNull();
    expect(container.querySelector("[data-testid='compare-card-edit']")).toBeTruthy();
  });

  it("enterprise-style catalog (non-public) shows compare and FAQ like platform preview", () => {
    const container = document.createElement("div");
    render(
      renderPricingPage({
        catalog: {
          plans: [basePlan],
          compareRows: [{ id: "row-1", label: "多智能体编排", values: { professional: true } }],
          faq: [{ question: "费用如何计算？", answer: "固定月费 + 超额。" }],
          billingHint: "",
        },
        selectedCycle: "monthly",
        onSelectCycle: vi.fn(),
        showCta: true,
        // enterprise catalog does not set publicSurface
      }),
      container,
    );
    expect(container.querySelector('[data-testid="pricing-v3-compare"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="pricing-v3-faq"]')).toBeTruthy();
    expect(container.textContent).toContain("费用如何计算");
  });
});
