import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../i18n/index.ts";
import type { BillingCycle } from "../../ports/platform/pricing/pricing-cycle.ts";
import { BILLING_CYCLES } from "../../ports/platform/pricing/pricing-cycle.ts";

export type BillingCycleSwitcherOptions = {
  selectedCycle: BillingCycle;
  onSelectCycle: (cycle: BillingCycle) => void;
};

/** Segmented control (not incomplete tablist/tab without panels). */
export function renderBillingCycleSwitcher(options: BillingCycleSwitcherOptions): TemplateResult {
  return html`
    <div
      class="pricing-v3__cycle-switcher"
      role="group"
      aria-label=${t("platformPricing.cycleSwitcherLabel")}
      data-testid="pricing-v3-cycle-switcher"
    >
      ${BILLING_CYCLES.map((cycle) => {
        const active = cycle === options.selectedCycle;
        return html`
          <button
            type="button"
            aria-pressed=${active ? "true" : "false"}
            class="pricing-v3__cycle-tab ${active ? "is-active" : ""}"
            data-cycle=${cycle}
            data-testid=${`pricing-v3-cycle-${cycle}`}
            @click=${() => options.onSelectCycle(cycle)}
          >
            ${t(`platformPricing.cycle.${cycle}`)}
            ${
              cycle === "annual"
                ? html`<span class="pricing-v3__cycle-badge">${t("platformPricing.cycleAnnualSave")}</span>`
                : nothing
            }
          </button>
        `;
      })}
    </div>
  `;
}
