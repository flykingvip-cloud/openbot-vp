import { html, type TemplateResult } from "lit";

export function renderPricingHero(billingHint: string): TemplateResult {
  return html`
    <header class="pricing-v3__hero">
      <h1 class="pricing-v3__title">套餐与定价</h1>
      <p class="pricing-v3__subtitle">为企业部署 AI 员工团队，按组织能力订阅</p>
      <p class="pricing-v3__billing-hint">${billingHint}</p>
    </header>
  `;
}
