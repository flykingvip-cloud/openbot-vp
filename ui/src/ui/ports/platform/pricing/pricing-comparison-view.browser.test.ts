// @vitest-environment jsdom
// Feature: platform-pricing-tiers
// 平台「档位对比」视图浏览器测试

import { render } from "lit";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { zh_CN } from "../../../../i18n/locales/zh-CN.ts";
import type { Plan } from "../../../capability/cost-budget-billing/index.ts";
import { renderPricingComparison } from "./pricing-comparison-view.ts";
import type { BillingCycle } from "./pricing-cycle.ts";

beforeAll(async () => {
  i18n.registerTranslation("zh-CN", zh_CN);
  await i18n.setLocale("zh-CN");
});

afterEach(() => {
  document.body.innerHTML = "";
});

function plan(partial: Partial<Plan> & Pick<Plan, "id" | "name">): Plan {
  return {
    billingCycle: "monthly",
    basePriceCents: 0,
    seatQuota: {},
    botQuota: 1,
    status: "active",
    currentVersionId: "pv-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const FIVE_PLANS: Plan[] = [
  plan({ id: "trial", name: "Trial", basePriceCents: 0, seatQuota: { viewer: 3 }, botQuota: 1 }),
  plan({
    id: "starter",
    name: "Starter",
    basePriceCents: 9_900,
    seatQuota: { viewer: 10, creator: 3 },
    botQuota: 3,
  }),
  plan({
    id: "pro",
    name: "Professional",
    basePriceCents: 49_900,
    seatQuota: { viewer: 30, creator: 10, admin: 2 },
    botQuota: 10,
  }),
  plan({ id: "biz", name: "Business", basePriceCents: 199_900, botQuota: 30 }),
  plan({ id: "ent", name: "Enterprise", basePriceCents: 699_900, botQuota: 100 }),
];

function mount(
  cycle: BillingCycle,
  onSelectCycle = vi.fn(),
  onSelectPlan = vi.fn(),
  onContactSales = vi.fn(),
) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  render(
    renderPricingComparison({
      plans: FIVE_PLANS,
      selectedCycle: cycle,
      onSelectCycle,
      onSelectPlan,
      onContactSales,
    }),
    host,
  );
  return { host, onSelectCycle, onSelectPlan, onContactSales };
}

describe("renderPricingComparison", () => {
  it("渲染五档卡片，Trial 在最前", () => {
    const { host } = mount("monthly");
    const cards = host.querySelectorAll('[data-testid="compare-card"]');
    expect(cards.length).toBe(5);
    expect(cards[0]?.getAttribute("data-plan-id")).toBe("trial");
  });

  it("提供月度/季度/年度三周期切换器", () => {
    const { host } = mount("monthly");
    const cycles = host.querySelectorAll('[data-testid="pricing-cycle-switcher"] button');
    expect(cycles.length).toBe(3);
    expect(Array.from(cycles).map((b) => b.getAttribute("data-cycle"))).toEqual([
      "monthly",
      "quarterly",
      "annual",
    ]);
  });

  it("点击周期触发回调", () => {
    const { host, onSelectCycle } = mount("monthly");
    const annual = host.querySelector<HTMLButtonElement>('button[data-cycle="annual"]');
    annual?.click();
    expect(onSelectCycle).toHaveBeenCalledWith("annual");
  });

  it("专业版标记为推荐档", () => {
    const { host } = mount("monthly");
    const pro = host.querySelector('[data-plan-id="pro"]');
    expect(pro?.classList.contains("is-recommended")).toBe(true);
  });

  it("年度周期下展示等效月价（低于月度）与节省", () => {
    const monthly = mount("monthly").host;
    const monthlyPrice =
      monthly.querySelector('[data-plan-id="pro"] .platform-pricing__compare-price-value')
        ?.textContent ?? "";
    document.body.innerHTML = "";
    const annual = mount("annual").host;
    const annualCard = annual.querySelector('[data-plan-id="pro"]');
    const annualPrice =
      annualCard?.querySelector(".platform-pricing__compare-price-value")?.textContent ?? "";
    // 年度等效月价 = 49900*0.85 = 42415 分 → ¥424.15 < ¥499
    expect(annualPrice).not.toBe(monthlyPrice);
    expect(annualCard?.querySelector(".platform-pricing__compare-save")).toBeTruthy();
  });

  it("免费档展示免费且无周期节省", () => {
    const { host } = mount("annual");
    const trial = host.querySelector('[data-plan-id="trial"]');
    expect(trial?.querySelector(".platform-pricing__compare-price-value")?.textContent).toContain(
      "免费",
    );
    expect(trial?.querySelector(".platform-pricing__compare-save")).toBeNull();
  });

  it("点击套餐行动按钮触发回调", () => {
    const { host, onSelectPlan } = mount("monthly");
    const cta = host.querySelector<HTMLButtonElement>(
      '[data-plan-id="starter"] [data-testid="compare-cta"]',
    );
    cta?.click();
    expect(onSelectPlan).toHaveBeenCalledTimes(1);
    expect(onSelectPlan.mock.calls[0]?.[0]?.id).toBe("starter");
  });

  it("卓越版（enterprise 槽位）展示联系销售而非价格", () => {
    const { host } = mount("monthly");
    const ent = host.querySelector('[data-plan-id="ent"]');
    const priceVal =
      ent?.querySelector(".platform-pricing__compare-price-value")?.textContent ?? "";
    expect(priceVal).toContain("联系销售");
    // 不显示 /月 单位与周期节省
    expect(ent?.querySelector(".platform-pricing__compare-price-unit")).toBeNull();
    const cta = ent?.querySelector('[data-testid="compare-cta"]')?.textContent ?? "";
    expect(cta).toContain("联系销售");
  });

  it("点击卓越版 CTA 触发 onContactSales 而非 onSelectPlan", () => {
    const { host, onContactSales, onSelectPlan } = mount("monthly");
    host
      .querySelector<HTMLButtonElement>('[data-plan-id="ent"] [data-testid="compare-cta"]')
      ?.click();
    expect(onContactSales).toHaveBeenCalledTimes(1);
    expect(onContactSales.mock.calls[0]?.[0]?.id).toBe("ent");
    expect(onSelectPlan).not.toHaveBeenCalled();
  });

  it("每档展示丰富权益清单（席位/Bot + 精选权益，>=4 行）", () => {
    const { host } = mount("monthly");
    for (const id of ["trial", "starter", "pro", "biz", "ent"]) {
      const rows = host.querySelectorAll(
        `[data-plan-id="${id}"] .platform-pricing__compare-feature`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("currentPlanId 对应档展示当前套餐且禁用", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(
      renderPricingComparison({
        plans: FIVE_PLANS,
        selectedCycle: "monthly",
        onSelectCycle: vi.fn(),
        onSelectPlan: vi.fn(),
        currentPlanId: "pro",
      }),
      host,
    );
    const cta = host.querySelector<HTMLButtonElement>(
      '[data-plan-id="pro"] [data-testid="compare-cta"]',
    );
    expect(cta?.textContent).toContain("当前套餐");
    expect(cta?.disabled).toBe(true);
  });

  it("readOnly 预览隐藏所有行动按钮", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(
      renderPricingComparison({
        plans: FIVE_PLANS,
        selectedCycle: "monthly",
        onSelectCycle: vi.fn(),
        readOnly: true,
      }),
      host,
    );
    const ctas = host.querySelectorAll<HTMLButtonElement>('[data-testid="compare-cta"]');
    expect(ctas.length).toBe(5);
    expect(Array.from(ctas).every((b) => b.hidden)).toBe(true);
  });

  it("空套餐列表展示空态", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(
      renderPricingComparison({ plans: [], selectedCycle: "monthly", onSelectCycle: vi.fn() }),
      host,
    );
    expect(host.querySelector('[data-testid="compare-empty"]')).toBeTruthy();
  });
});
