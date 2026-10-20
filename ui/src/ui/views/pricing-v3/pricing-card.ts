import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../i18n/index.ts";
import type { PricingPlanViewModel } from "../../capability/platform-pricing-catalog/index.ts";
import { renderIcon, type IconName } from "../../icons.ts";
import {
  computeCyclePrice,
  type BillingCycle,
} from "../../ports/platform/pricing/pricing-cycle.ts";
import { buildPricingSpecItems, resolveSlotSubtitleBadge } from "./pricing-card-spec.ts";
import { renderPricingSpecList } from "./pricing-spec-list.ts";

export type PricingCardOptions = {
  plan: PricingPlanViewModel;
  selectedCycle: BillingCycle;
  /**
   * When true, hide purchase CTAs (summary / snapshot surfaces).
   * Independent from admin edit affordances.
   */
  hideCta?: boolean;
  /**
   * @deprecated Prefer hideCta. Kept for call-site compatibility: when true hides CTA
   * unless showCta is explicitly true.
   */
  readOnly?: boolean;
  /** Explicit purchase CTA visibility (public catalog). Overrides hideCta/readOnly when true. */
  showCta?: boolean;
  currentPlanId?: string;
  onSelectPlan?: (plan: PricingPlanViewModel) => void;
  onContactSales?: (plan: PricingPlanViewModel) => void;
  /** Platform admin edit entry (independent of purchase CTA). */
  onEditPlan?: (plan: PricingPlanViewModel) => void;
};

function fmtMoney(cents: number): string {
  return `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function slotIcon(slot: string): IconName {
  switch (slot) {
    case "trial":
      return "rocket";
    case "starter":
      return "users";
    case "professional":
      return "trendingUp";
    case "business":
      return "building";
    case "enterprise":
      return "sparkles";
    default:
      return "sparkles";
  }
}

type ResolvedPrice = {
  main: string;
  showUnit: boolean;
  unitLabel?: string;
  listMonthly?: number;
  savingsCents?: number;
  savingsLabel?: string;
  cycleTotalLabel?: string;
  discounted: boolean;
};

function resolvePrice(plan: PricingPlanViewModel, cycle: BillingCycle): ResolvedPrice {
  if (plan.contactSales) {
    return {
      main: "定制报价",
      discounted: false,
      showUnit: false,
    };
  }
  if (plan.freeTrial) {
    return {
      main: "免费",
      discounted: false,
      showUnit: false,
    };
  }
  const monthlyList = plan.pricing.monthly;
  const strikeMonthlyList = plan.originalPricing?.monthly ?? monthlyList;

  if (cycle === "monthly") {
    return {
      main: fmtMoney(monthlyList),
      discounted: false,
      showUnit: true,
      unitLabel: t("platformPricing.perMonth"),
    };
  }

  /**
   * Prefer catalog cycle fields when present; derive total from the *same*
   * effective monthly so 折合月价 × months === 展示总额.
   * Fallback to computeCyclePrice for both monthly+total when catalog omits custom cycle prices.
   */
  const quote = computeCyclePrice(monthlyList, cycle);
  const months = cycle === "quarterly" ? 3 : 12;
  const catalogEffectiveMonthly =
    cycle === "quarterly" ? plan.pricing.quarterly : plan.pricing.annual;
  const effectiveMonthly =
    typeof catalogEffectiveMonthly === "number" && catalogEffectiveMonthly > 0
      ? catalogEffectiveMonthly
      : quote.effectiveMonthlyCents;
  // Total must share the effective monthly source (not quote.totalCents alone when custom).
  const cycleTotal = effectiveMonthly * months;
  const listTotal = monthlyList * months;
  const savingsCents =
    typeof (cycle === "quarterly" ? plan.cycleSavings?.quarterly : plan.cycleSavings?.annual) ===
    "number"
      ? cycle === "quarterly"
        ? plan.cycleSavings!.quarterly!
        : plan.cycleSavings!.annual!
      : Math.max(0, listTotal - cycleTotal);
  const savingsLabel =
    savingsCents > 0
      ? cycle === "quarterly"
        ? `每季节省 ${fmtMoney(savingsCents)}`
        : `每年节省 ${fmtMoney(savingsCents)}`
      : undefined;
  const cycleTotalLabel =
    cycle === "quarterly" ? `季付 ${fmtMoney(cycleTotal)}` : `年付 ${fmtMoney(cycleTotal)}`;

  return {
    main: fmtMoney(effectiveMonthly),
    listMonthly: strikeMonthlyList,
    savingsCents,
    savingsLabel,
    cycleTotalLabel,
    discounted: savingsCents > 0,
    showUnit: true,
    unitLabel: "折合每月",
  };
}

/** Exported for unit tests: cycle total must equal effective monthly × months. */
export function resolveCycleDisplayTotals(
  plan: PricingPlanViewModel,
  cycle: Exclude<BillingCycle, "monthly">,
): { effectiveMonthlyCents: number; cycleTotalCents: number; months: number } {
  const monthlyList = plan.pricing.monthly;
  const quote = computeCyclePrice(monthlyList, cycle);
  const months = cycle === "quarterly" ? 3 : 12;
  const catalogEffectiveMonthly =
    cycle === "quarterly" ? plan.pricing.quarterly : plan.pricing.annual;
  const effectiveMonthlyCents =
    typeof catalogEffectiveMonthly === "number" && catalogEffectiveMonthly > 0
      ? catalogEffectiveMonthly
      : quote.effectiveMonthlyCents;
  return {
    effectiveMonthlyCents,
    cycleTotalCents: effectiveMonthlyCents * months,
    months,
  };
}

function resolveCtaLabel(plan: PricingPlanViewModel, isCurrent: boolean): string {
  if (isCurrent) {
    return "当前套餐";
  }
  if (plan.freeTrial) {
    return plan.cta.label || "免费试用";
  }
  if (plan.contactSales || plan.slot === "enterprise") {
    return plan.cta.label || "联系销售";
  }
  return plan.cta.label || "立即升级";
}

function resolveCtaClasses(
  plan: PricingPlanViewModel,
  recommended: boolean,
  enterprise: boolean,
): string {
  const classes = ["pricing-v3__cta"];
  if (plan.freeTrial) {
    classes.push("is-outline");
  } else if (enterprise) {
    classes.push("is-enterprise-cta");
  } else {
    classes.push("is-primary");
  }
  if (recommended && !plan.freeTrial) {
    classes.push("is-recommended-cta");
  }
  return classes.join(" ");
}

function shouldShowPurchaseCta(options: PricingCardOptions): boolean {
  if (options.showCta === true) {
    return true;
  }
  if (options.showCta === false) {
    return false;
  }
  if (options.hideCta === true) {
    return false;
  }
  // Legacy: readOnly hid CTAs
  if (options.readOnly === true) {
    return false;
  }
  return true;
}

export function renderPricingCard(options: PricingCardOptions): TemplateResult {
  const { plan } = options;
  const price = resolvePrice(plan, options.selectedCycle);
  const isCurrent = plan.id === options.currentPlanId;
  const enterprise = plan.contactSales || plan.slot === "enterprise";
  const recommended = Boolean(plan.recommended);
  const subtitleBadge = resolveSlotSubtitleBadge(plan);
  const specItems = buildPricingSpecItems(plan);
  const slotClass = plan.slot !== "custom" ? `is-slot-${plan.slot}` : "";
  const showCta = shouldShowPurchaseCta(options);
  const interactive = showCta || Boolean(options.onEditPlan);

  return html`
    <article
      class="pricing-v3__card ${recommended ? "is-recommended" : ""} ${enterprise ? "is-enterprise" : ""} ${slotClass} ${interactive ? "is-interactive" : "is-static"}"
      data-testid="pricing-v3-card"
      data-plan-id=${plan.id}
    >
      ${
        options.onEditPlan
          ? html`
              <button
                type="button"
                class="btn btn--sm platform-pricing__compare-card-edit pricing-v3__card-edit"
                data-testid="compare-card-edit"
                data-plan-id=${plan.id}
                @click=${(e: MouseEvent) => {
                  e.stopPropagation();
                  options.onEditPlan?.(plan);
                }}
              >
                ${t("platformPricing.planConfigModeEdit")}
              </button>
            `
          : nothing
      }

      <div class="pricing-v3__card-zone pricing-v3__card-zone--head">
        <div class="pricing-v3__card-header">
          <div class="pricing-v3__card-icon" aria-hidden="true">${renderIcon(slotIcon(plan.slot))}</div>
          <div class="pricing-v3__card-title-block">
            <h3 class="pricing-v3__card-name">${plan.displayName}</h3>
            ${
              subtitleBadge
                ? html`<span
                    class="pricing-v3__slot-badge ${recommended ? "is-recommended-badge" : ""}"
                    >${subtitleBadge}</span
                  >`
                : nothing
            }
          </div>
        </div>
      </div>

      <div class="pricing-v3__card-zone pricing-v3__card-zone--price">
        <div class="pricing-v3__card-price">
          <span class="pricing-v3__price-main ${enterprise ? "pricing-v3__price-main--quote" : ""}"
            >${price.main}</span
          >
          ${
            price.showUnit
              ? html`<span class="pricing-v3__price-unit">${price.unitLabel ?? t("platformPricing.perMonth")}</span>`
              : nothing
          }
        </div>
        ${
          price.cycleTotalLabel
            ? html`<div class="pricing-v3__price-cycle-total" data-testid="pricing-v3-cycle-total">
                ${price.cycleTotalLabel}
              </div>`
            : nothing
        }
      </div>

      <div class="pricing-v3__card-zone pricing-v3__card-zone--savings">
        ${
          price.discounted && price.listMonthly != null
            ? html`
                <div class="pricing-v3__price-savings">
                  <span class="pricing-v3__list-price">${fmtMoney(price.listMonthly)}${t("platformPricing.perMonth")}</span>
                  ${
                    price.savingsLabel
                      ? html`<span class="pricing-v3__save">${price.savingsLabel}</span>`
                      : nothing
                  }
                </div>
              `
            : html`
                <span class="pricing-v3__savings-placeholder" aria-hidden="true"></span>
              `
        }
      </div>

      ${renderPricingSpecList(specItems)}

      <div class="pricing-v3__card-spacer" aria-hidden="true"></div>

      <div class="pricing-v3__card-actions">
        ${
          showCta
            ? html`
                <button
                  type="button"
                  class="${resolveCtaClasses(plan, recommended, enterprise)} ${isCurrent ? "is-current" : ""}"
                  data-testid="pricing-v3-cta"
                  ?disabled=${isCurrent}
                  @click=${() => {
                    if (isCurrent) {
                      return;
                    }
                    if (plan.cta.type === "contact" || enterprise) {
                      options.onContactSales?.(plan);
                    } else {
                      options.onSelectPlan?.(plan);
                    }
                  }}
                >
                  ${resolveCtaLabel(plan, isCurrent)}
                </button>
              `
            : nothing
        }
      </div>
    </article>
  `;
}
