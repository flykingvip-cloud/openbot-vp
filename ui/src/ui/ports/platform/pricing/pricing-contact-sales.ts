/**
 * 卓越版「联系销售」页。左侧销售卡片（联系方式），右侧定制需求填写卡。
 *
 * 纯渲染：入参 + 回调，无内部状态。提交时从表单读取字段交给 `onSubmit`，由调用方
 * （page.ts）维护「已提交」态并展示回执。联系方式为占位示例值（非真实 PII）。
 */

import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import type { Plan } from "../../../capability/cost-budget-billing/index.ts";
import { renderIcon, type IconName } from "../../../icons.ts";

export type ContactSalesForm = {
  company: string;
  contact: string;
  phone: string;
  scale: string;
  requirements: string;
};

export type PricingContactSalesOptions = {
  /** 触发联系销售的套餐（卓越版）。 */
  plan?: Plan | null;
  onBack: () => void;
  onSubmit?: (form: ContactSalesForm) => void;
  /** 已提交回执态，由调用方维护。 */
  submitted?: boolean;
};

function contactRow(icon: IconName, label: string, value: string): TemplateResult {
  return html`
    <li class="platform-pricing__sales-contact-row">
      <span class="platform-pricing__sales-contact-icon" aria-hidden="true">${renderIcon(icon)}</span>
      <span class="platform-pricing__sales-contact-label">${label}</span>
      <span class="platform-pricing__sales-contact-value">${value}</span>
    </li>
  `;
}

function readForm(root: HTMLElement): ContactSalesForm {
  const val = (name: string) =>
    (
      root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)?.value ?? ""
    ).trim();
  return {
    company: val("company"),
    contact: val("contact"),
    phone: val("phone"),
    scale: val("scale"),
    requirements: val("requirements"),
  };
}

function renderSalesCard(): TemplateResult {
  return html`
    <aside class="card platform-pricing__sales-card" data-testid="sales-card">
      <div class="platform-pricing__sales-card-head">
        <span class="platform-pricing__sales-card-icon" aria-hidden="true">${renderIcon("building")}</span>
        <div>
          <div class="platform-pricing__sales-card-title">${t("platformPricing.salesCardTitle")}</div>
          <div class="muted platform-pricing__sales-card-sub">${t("platformPricing.salesCardSub")}</div>
        </div>
      </div>
      <ul class="platform-pricing__sales-contacts">
        ${contactRow("smartphone", t("platformPricing.salesPhone"), "400-000-0000")}
        ${contactRow("messageSquare", t("platformPricing.salesWechat"), "OpenBot-Sales")}
        ${contactRow("globe", t("platformPricing.salesEmail"), "sales@openbot.example")}
        ${contactRow("clock", t("platformPricing.salesHours"), t("platformPricing.salesHoursValue"))}
      </ul>
    </aside>
  `;
}

function renderRequirementForm(options: PricingContactSalesOptions): TemplateResult {
  if (options.submitted) {
    return html`
      <section class="card platform-pricing__sales-form" data-testid="sales-form">
        <div class="platform-pricing__sales-submitted" data-testid="sales-submitted">
          <span class="platform-pricing__sales-submitted-icon" aria-hidden="true"
            >${renderIcon("checkCircle")}</span
          >
          <div class="platform-pricing__sales-submitted-title">${t("platformPricing.salesSubmittedTitle")}</div>
          <div class="muted">${t("platformPricing.salesSubmittedSub")}</div>
        </div>
      </section>
    `;
  }
  return html`
    <section class="card platform-pricing__sales-form" data-testid="sales-form">
      <div class="card-title">${t("platformPricing.salesFormTitle")}</div>
      <form
        class="platform-pricing__sales-form-body"
        data-testid="sales-form-body"
        @submit=${(event: SubmitEvent) => {
          event.preventDefault();
          const root = (event.currentTarget as HTMLElement).closest("section") as HTMLElement;
          options.onSubmit?.(readForm(root));
        }}
      >
        <label class="platform-pricing__sales-field">
          <span>${t("platformPricing.salesFieldCompany")}</span>
          <input name="company" type="text" required autocomplete="organization" />
        </label>
        <label class="platform-pricing__sales-field">
          <span>${t("platformPricing.salesFieldContact")}</span>
          <input name="contact" type="text" required autocomplete="name" />
        </label>
        <label class="platform-pricing__sales-field">
          <span>${t("platformPricing.salesFieldPhone")}</span>
          <input name="phone" type="text" required autocomplete="tel" />
        </label>
        <label class="platform-pricing__sales-field">
          <span>${t("platformPricing.salesFieldScale")}</span>
          <input name="scale" type="text" inputmode="numeric" />
        </label>
        <label class="platform-pricing__sales-field platform-pricing__sales-field--full">
          <span>${t("platformPricing.salesFieldRequirements")}</span>
          <textarea name="requirements" rows="4"></textarea>
        </label>
        <div class="platform-pricing__sales-form-actions">
          <button type="submit" class="btn btn--primary" data-testid="sales-submit">
            ${t("platformPricing.salesSubmit")}
          </button>
        </div>
      </form>
    </section>
  `;
}

export function renderPricingContactSales(options: PricingContactSalesOptions): TemplateResult {
  return html`
    <section class="platform-pricing__sales" data-testid="pricing-contact-sales">
      <div class="platform-pricing__sales-header">
        <button
          type="button"
          class="platform-pricing__sales-back"
          data-testid="sales-back"
          @click=${() => options.onBack()}
        >
          <span class="platform-pricing__sales-back-icon" aria-hidden="true"
            >${renderIcon("chevronRight")}</span
          >
          ${t("platformPricing.salesBack")}
        </button>
        <h2 class="platform-pricing__sales-title">
          ${t("platformPricing.salesTitle")}
          ${
            options.plan
              ? html`<span class="platform-pricing__sales-plan">${options.plan.name}</span>`
              : nothing
          }
        </h2>
      </div>
      <div class="platform-pricing__sales-grid">
        ${renderSalesCard()}
        ${renderRequirementForm(options)}
      </div>
    </section>
  `;
}
