// @vitest-environment jsdom
// Feature: platform-pricing-tiers — 联系销售页

import { render } from "lit";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { zh_CN } from "../../../../i18n/locales/zh-CN.ts";
import type { Plan } from "../../../capability/cost-budget-billing/index.ts";
import { renderPricingContactSales } from "./pricing-contact-sales.ts";

beforeAll(async () => {
  i18n.registerTranslation("zh-CN", zh_CN);
  await i18n.setLocale("zh-CN");
});

afterEach(() => {
  document.body.innerHTML = "";
});

const ENTERPRISE: Plan = {
  id: "ent",
  name: "卓越版",
  billingCycle: "monthly",
  basePriceCents: 0,
  seatQuota: {},
  botQuota: 0,
  status: "active",
  currentVersionId: "pv-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function mount(opts = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const onBack = vi.fn();
  const onSubmit = vi.fn();
  render(renderPricingContactSales({ plan: ENTERPRISE, onBack, onSubmit, ...opts }), host);
  return { host, onBack, onSubmit };
}

describe("renderPricingContactSales", () => {
  it("左侧渲染销售卡片（含联系方式），右侧渲染需求表单", () => {
    const { host } = mount();
    expect(host.querySelector('[data-testid="sales-card"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="sales-form"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="sales-card"]')?.textContent).toContain("400-000-0000");
    expect(host.textContent).toContain("卓越版");
  });

  it("点击返回触发 onBack", () => {
    const { host, onBack } = mount();
    host.querySelector<HTMLButtonElement>('[data-testid="sales-back"]')?.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("提交表单读取字段并触发 onSubmit", () => {
    const { host, onSubmit } = mount();
    const set = (name: string, value: string) => {
      const el = host.querySelector<HTMLInputElement>(`[name="${name}"]`);
      if (el) {
        el.value = value;
      }
    };
    set("company", "Acme 公司");
    set("contact", "张三");
    set("phone", "13800000000");
    set("scale", "120");
    const form = host.querySelector<HTMLFormElement>('[data-testid="sales-form-body"]');
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      company: "Acme 公司",
      contact: "张三",
      phone: "13800000000",
      scale: "120",
    });
  });

  it("submitted 态展示回执，不再渲染表单输入", () => {
    const { host } = mount({ submitted: true });
    expect(host.querySelector('[data-testid="sales-submitted"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="sales-form-body"]')).toBeNull();
  });
});
