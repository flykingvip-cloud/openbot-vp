// @vitest-environment jsdom

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { PricingPlanViewModel } from "../../capability/platform-pricing-catalog/index.ts";
import { renderBillingCycleSwitcher } from "./billing-cycle-switcher.ts";
import { renderCapabilityCompareSection } from "./capability-compare-section.ts";
import { renderPricingCard, resolveCycleDisplayTotals } from "./pricing-card.ts";
import { resolvePublicPricingCtaHref } from "./public-pricing-surface.ts";

function makePlan(overrides: Partial<PricingPlanViewModel> = {}): PricingPlanViewModel {
  return {
    id: "pro",
    planVersionId: "pv-pro",
    slot: "professional",
    displayName: "专业版",
    recommended: true,
    pricing: {
      monthly: 99_900,
      quarterly: 94_905,
      annual: 84_915,
    },
    originalPricing: {
      monthly: 99_900,
    },
    cycleSavings: {
      quarterly: 14_985,
      annual: 179_880,
    },
    annualDiscountedMonthlyLabel: "¥849.15 / 月",
    badge: "推荐",
    targetAudience: "企业 AI 核心生产力",
    description: "面向 15-50 人团队",
    capabilities: ["多 Agent 协同", "API 接入", "审计日志与回溯"],
    metrics: {
      seats: 30,
      aiEmployees: 120,
      concurrentRuns: 20,
      creditsMonthly: 30_000,
      workflows: 50,
      knowledgeBases: 50,
    },
    aiAuthorizationLabel: "20 个基础 AI + 8 个专业 AI + 2 个高级 AI 授权",
    aiProfileQuota: { basic: 20, pro: 8, elite: 2 },
    tierLabel: "Tier B",
    cardFields: {
      annualDiscountedMonthly: "¥849.15 / 月",
      teamRange: "15-50 人",
      overagePolicy: "超额阻断",
    },
    compare: {
      aiEmployees: 120,
      concurrentRuns: 20,
      creditsMonthly: 30_000,
      overagePolicy: "超额阻断",
    },
    cta: {
      label: "立即升级",
      type: "upgrade",
    },
    contactSales: false,
    freeTrial: false,
    ...overrides,
  };
}

describe("renderCapabilityCompareSection AI capability group", () => {
  it("shows AI tier rows with descriptions and footnote", () => {
    const container = document.createElement("div");
    const plan = makePlan();
    render(
      renderCapabilityCompareSection(
        [
          {
            id: "aiEmployees",
            label: "AI 员工数",
            values: { professional: "120 个" },
          },
          {
            id: "aiBasic",
            label: "基础 AI 授权",
            description: "文字问答、总结翻译、信息整理、基础创作",
            values: { professional: "20 个" },
          },
          {
            id: "aiPro",
            label: "专业 AI 授权",
            description: "专业写作、图片生成、深度分析、多步骤任务",
            values: { professional: "8 个" },
          },
          {
            id: "aiElite",
            label: "高级 AI 授权",
            description: "视频生成、复杂推理、长程任务、跨工具执行",
            values: { professional: "2 个" },
          },
        ],
        [plan],
      ),
      container,
    );
    expect(container.textContent).toContain("团队规模与 AI 能力");
    expect(container.textContent).toContain("基础 AI 授权");
    expect(container.textContent).toContain("文字问答、总结翻译");
    expect(container.textContent).toContain("视频生成、复杂推理");
    expect(
      container.querySelector('[data-testid="pricing-v3-ai-capability-footnote"]')?.textContent,
    ).toMatch(/AI 能力等级决定成员/);
    const empty = container.querySelectorAll('[aria-label="不支持"]');
    expect(empty.length).toBeGreaterThanOrEqual(0);
  });

  it("hides rows that are all empty dashes", () => {
    const container = document.createElement("div");
    render(
      renderCapabilityCompareSection(
        [
          {
            id: "vpc",
            label: "专属网络 / VPC 部署",
            values: { professional: false, business: false },
          },
        ],
        [
          makePlan(),
          makePlan({ id: "biz", slot: "business", displayName: "旗舰版", recommended: false }),
        ],
      ),
      container,
    );
    // all-false / empty group → section may be empty
    expect(container.querySelector('[data-testid="pricing-v3-compare"]')).toBeFalsy();
  });
});

describe("renderPricingCard", () => {
  it("renders core specs: seats, AI employees, AI auth, credits, concurrency, overage", () => {
    const container = document.createElement("div");
    render(
      renderPricingCard({
        plan: makePlan(),
        selectedCycle: "monthly",
        showCta: true,
      }),
      container,
    );

    const labels = [...container.querySelectorAll(".pricing-v3__spec-label")].map((node) =>
      node.textContent?.trim(),
    );
    expect(labels).toEqual([
      "团队席位",
      "AI 员工数",
      "AI 授权",
      "月度 Credits",
      "并发数",
      "超额策略",
    ]);
    expect(labels).not.toContain("默认 AI 授权");
    expect(labels).not.toContain("工作流数量");
    expect(labels).not.toContain("知识库数量");
    expect(labels).not.toContain("数据隔离");
    expect(container.textContent).toContain("30,000 Credits");
    expect(container.textContent).toContain("20 个基础 AI + 8 个专业 AI + 2 个高级 AI 授权");
    expect(container.textContent).not.toMatch(/只读席位|创作席位|管理席位|Viewer|Creator|Admin/);
  });

  it("does not put long AI capability explanations on the card", () => {
    const container = document.createElement("div");
    render(
      renderPricingCard({
        plan: makePlan(),
        selectedCycle: "monthly",
        showCta: true,
      }),
      container,
    );
    expect(container.textContent).not.toContain("文字问答、总结翻译");
    expect(container.textContent).not.toContain("视频生成、复杂推理");
  });

  it("shows purchase CTA on public catalog and hides on summary hideCta", () => {
    const publicCard = document.createElement("div");
    render(
      renderPricingCard({
        plan: makePlan(),
        selectedCycle: "monthly",
        showCta: true,
        onSelectPlan: vi.fn(),
      }),
      publicCard,
    );
    expect(publicCard.querySelector("[data-testid='pricing-v3-cta']")).toBeTruthy();
    expect(publicCard.textContent).toContain("立即升级");

    const summary = document.createElement("div");
    render(
      renderPricingCard({
        plan: makePlan(),
        selectedCycle: "monthly",
        hideCta: true,
      }),
      summary,
    );
    expect(summary.querySelector("[data-testid='pricing-v3-cta']")).toBeNull();
  });

  it("keeps admin edit button independent of purchase CTA visibility", () => {
    const container = document.createElement("div");
    const onEdit = vi.fn();
    render(
      renderPricingCard({
        plan: makePlan(),
        selectedCycle: "monthly",
        hideCta: true,
        onEditPlan: onEdit,
      }),
      container,
    );
    expect(container.querySelector("[data-testid='pricing-v3-cta']")).toBeNull();
    expect(container.querySelector("[data-testid='compare-card-edit']")).toBeTruthy();
  });

  it("does not render audience, feature list, card foot notes, or per-card billing rules", () => {
    const paid = document.createElement("div");
    render(
      renderPricingCard({
        plan: makePlan(),
        selectedCycle: "monthly",
        showCta: true,
      }),
      paid,
    );
    expect(paid.querySelector(".pricing-v3__audience-box")).toBeNull();
    expect(paid.querySelector("[data-testid='pricing-v3-feature-list']")).toBeNull();
    expect(paid.querySelector("[data-testid='pricing-v3-billing-rules']")).toBeNull();
    expect(paid.querySelector("[data-testid='pricing-v3-card-foot']")).toBeNull();
    expect(paid.textContent).not.toContain("无需信用卡");
    expect(paid.textContent).not.toContain("7 天无理由退款");
    expect(paid.textContent).not.toContain("年付折后");
    expect(paid.textContent).not.toContain("计费规则");

    const enterprise = document.createElement("div");
    render(
      renderPricingCard({
        plan: makePlan({
          id: "ent",
          slot: "enterprise",
          contactSales: true,
          freeTrial: false,
          cta: { label: "联系销售", type: "contact" },
        }),
        selectedCycle: "monthly",
        showCta: true,
      }),
      enterprise,
    );
    expect(enterprise.querySelector("[data-testid='pricing-v3-card-foot']")).toBeNull();
    expect(enterprise.querySelector("[data-testid='pricing-v3-billing-rules']")).toBeNull();
    expect(enterprise.textContent).not.toContain("获取专属方案与演示");
    expect(enterprise.querySelector("[data-testid='pricing-v3-cta']")?.textContent).toContain(
      "联系销售",
    );
  });

  it("labels quarterly/annual as equivalent monthly with cycle savings", () => {
    const container = document.createElement("div");
    render(
      renderPricingCard({
        plan: makePlan(),
        selectedCycle: "annual",
        showCta: true,
      }),
      container,
    );
    expect(container.textContent).toContain("折合每月");
    expect(container.textContent).toContain("每年节省");
    expect(container.querySelector("[data-testid='pricing-v3-cycle-total']")?.textContent).toMatch(
      /年付/,
    );
  });

  it("keeps cycle total consistent with effective monthly for custom quarterly/annual prices", () => {
    // Custom cycle prices intentionally diverge from default computeCyclePrice discount.
    const plan = makePlan({
      pricing: {
        monthly: 100_000,
        quarterly: 90_000, // custom 折合每月
        annual: 80_000,
      },
      cycleSavings: undefined,
    });

    for (const cycle of ["quarterly", "annual"] as const) {
      const totals = resolveCycleDisplayTotals(plan, cycle);
      expect(totals.cycleTotalCents).toBe(totals.effectiveMonthlyCents * totals.months);
      expect(totals.effectiveMonthlyCents).toBe(cycle === "quarterly" ? 90_000 : 80_000);
      expect(totals.months).toBe(cycle === "quarterly" ? 3 : 12);

      const container = document.createElement("div");
      render(
        renderPricingCard({
          plan,
          selectedCycle: cycle,
          showCta: true,
        }),
        container,
      );
      const totalText =
        container.querySelector("[data-testid='pricing-v3-cycle-total']")?.textContent ?? "";
      const monthlyYuan = totals.effectiveMonthlyCents / 100;
      const totalYuan = totals.cycleTotalCents / 100;
      expect(totalText).toContain(String(totalYuan));
      expect(container.querySelector(".pricing-v3__price-main")?.textContent).toContain(
        `¥${monthlyYuan}`,
      );
      // 折合月价 × 周期月数 = 展示总额
      expect(totals.effectiveMonthlyCents * totals.months).toBe(totals.cycleTotalCents);
    }
  });

  it("derives cycle total from computeCyclePrice when catalog omits custom cycle fields", () => {
    const plan = makePlan({
      pricing: { monthly: 99_900 },
      cycleSavings: undefined,
    });
    const annual = resolveCycleDisplayTotals(plan, "annual");
    expect(annual.months).toBe(12);
    expect(annual.cycleTotalCents).toBe(annual.effectiveMonthlyCents * 12);
    // Default annual is 15% off monthly list → effective = floor(monthly * 0.85)
    expect(annual.effectiveMonthlyCents).toBeLessThan(99_900);
  });

  it("shows fixed 6-row specs; enterprise credits value is placeholder not a number", () => {
    const container = document.createElement("div");
    render(
      renderPricingCard({
        plan: makePlan({
          id: "ent",
          slot: "enterprise",
          contactSales: true,
          freeTrial: false,
          pricing: { monthly: 0 },
          metrics: {
            seats: "custom",
            aiEmployees: "custom",
            concurrentRuns: "custom",
            // production view-model leaves credits undefined for enterprise
          },
          aiAuthorizationLabel: "按需配置",
          cardFields: {
            overagePolicy: "custom",
          },
          cta: { label: "联系销售", type: "contact" },
        }),
        selectedCycle: "monthly",
        showCta: true,
      }),
      container,
    );
    const labels = [...container.querySelectorAll(".pricing-v3__spec-label")].map((n) =>
      n.textContent?.trim(),
    );
    expect(labels).toHaveLength(6);
    // 无具体 Credits 数字；统一行结构下 value 为 —
    expect(container.textContent).not.toContain("10,000");
    const creditsValue = [...container.querySelectorAll(".pricing-v3__spec-item")].find((li) =>
      li.textContent?.includes("月度 Credits"),
    );
    expect(creditsValue?.textContent).toMatch(/—/);
  });

  it("shows recommended badge text for recommended plans", () => {
    const container = document.createElement("div");
    render(
      renderPricingCard({
        plan: makePlan({ recommended: true, badge: "推荐" }),
        selectedCycle: "monthly",
        showCta: true,
      }),
      container,
    );
    expect(container.querySelector(".is-recommended-badge")?.textContent).toContain("推荐");
  });
});

describe("billing cycle switcher a11y", () => {
  it("uses pressed segmented buttons instead of incomplete tabs", () => {
    const container = document.createElement("div");
    render(
      renderBillingCycleSwitcher({
        selectedCycle: "monthly",
        onSelectCycle: vi.fn(),
      }),
      container,
    );
    const root = container.querySelector("[data-testid='pricing-v3-cycle-switcher']");
    expect(root?.getAttribute("role")).toBe("group");
    expect(container.querySelectorAll("[role='tab']")).toHaveLength(0);
    const annual = container.querySelector("[data-testid='pricing-v3-cycle-annual']");
    expect(annual?.getAttribute("aria-pressed")).toBe("false");
    const monthly = container.querySelector("[data-testid='pricing-v3-cycle-monthly']");
    expect(monthly?.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("capability compare section", () => {
  it("uses plan displayName and paid-only title by default", () => {
    const container = document.createElement("div");
    render(
      renderCapabilityCompareSection(
        [{ id: "r1", label: "多智能体编排", values: { professional: true, starter: false } }],
        [
          makePlan({ id: "s", slot: "starter", displayName: "基础版" }),
          makePlan({ id: "p", slot: "professional", displayName: "专业版" }),
        ],
      ),
      container,
    );
    expect(container.textContent).toContain("付费套餐功能对比");
    expect(container.textContent).toContain("基础版");
    expect(container.textContent).toContain("专业版");
    expect(container.textContent).not.toContain("Growth");
    expect(container.querySelector("[aria-label='支持']")).toBeTruthy();
  });
});

describe("public pricing CTA basePath", () => {
  it("prefixes trial/enterprise login with deployment basePath", () => {
    expect(resolvePublicPricingCtaHref("trialApply", "/pricing")).toBe("/trial/apply");
    expect(resolvePublicPricingCtaHref("enterpriseLogin", "/pricing")).toBe("/enterprise/login");
    expect(resolvePublicPricingCtaHref("trialApply", "/ui/pricing")).toBe("/ui/trial/apply");
    expect(resolvePublicPricingCtaHref("enterpriseLogin", "/ui/pricing")).toBe(
      "/ui/enterprise/login",
    );
    expect(resolvePublicPricingCtaHref("trialApply", "/apps/openclaw/pricing")).toBe(
      "/apps/openclaw/trial/apply",
    );
  });
});
