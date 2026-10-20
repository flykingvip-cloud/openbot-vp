import { html, nothing, type TemplateResult } from "lit";
import type { PricingFaqItem } from "../../capability/platform-pricing-catalog/index.ts";

function renderFaqBody(item: PricingFaqItem): TemplateResult {
  const points = item.points?.filter((p) => p.trim()) ?? [];
  const examples = item.examples?.filter((p) => p.trim()) ?? [];
  return html`
    <div class="pricing-v3__faq-body">
      <p class="pricing-v3__faq-lead">${item.answer}</p>
      ${
        points.length > 0
          ? html`
              <ol class="pricing-v3__faq-points">
                ${points.map((p) => html`<li>${p}</li>`)}
              </ol>
            `
          : nothing
      }
      ${
        examples.length > 0
          ? html`
              <div class="pricing-v3__faq-examples">
                <div class="pricing-v3__faq-examples-title">举例说明</div>
                <ul class="pricing-v3__faq-examples-list">
                  ${examples.map((ex) => html`<li>${ex}</li>`)}
                </ul>
              </div>
            `
          : nothing
      }
    </div>
  `;
}

export function renderFaqSection(items: readonly PricingFaqItem[]): TemplateResult {
  if (items.length === 0) {
    return html``;
  }
  return html`
    <section class="pricing-v3__faq" data-testid="pricing-v3-faq">
      <h2 class="pricing-v3__section-title">常见问题</h2>
      <p class="pricing-v3__faq-intro">
        以下用企业采购视角说明计费、配额与名词含义。展开条目可查看要点与算账例子。
      </p>
      <div class="pricing-v3__faq-list">
        ${items.map(
          (item, index) => html`
            <details
              class="pricing-v3__faq-item"
              data-testid="pricing-v3-faq-item"
              ?open=${index === 0}
            >
              <summary>
                <span class="pricing-v3__faq-q-index">${index + 1}</span>
                <span class="pricing-v3__faq-q-text">${item.question}</span>
              </summary>
              ${renderFaqBody(item)}
            </details>
          `,
        )}
      </div>
    </section>
  `;
}
