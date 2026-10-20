import { html, type TemplateResult } from "lit";
import { renderIcon } from "../../icons.ts";
import type { PricingSpecItem } from "./pricing-card-spec.ts";

export function renderPricingSpecList(items: readonly PricingSpecItem[]): TemplateResult {
  return html`
    <ul class="pricing-v3__spec-list" data-testid="pricing-v3-spec-list">
      ${items.map(
        (item) => html`
          <li class="pricing-v3__spec-item">
            <span class="pricing-v3__spec-icon" aria-hidden="true">${renderIcon(item.icon)}</span>
            <span class="pricing-v3__spec-copy">
              <span class="pricing-v3__spec-label">${item.label}</span>
              ${item.value ? html`<span class="pricing-v3__spec-value">${item.value}</span>` : null}
            </span>
          </li>
        `,
      )}
    </ul>
  `;
}
