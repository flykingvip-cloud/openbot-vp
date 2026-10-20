/**
 * 平台「档位对比」视图（对外、决策者视角）。
 *
 * 现代简约风格：响应式五列卡片 + 月度/季度/年度周期切换器（年度挂「省 15%」徽标）。
 * 单档卡片去释义化，只呈现价值信息（价格 + 数据驱动的价值清单）。推荐档（Professional /
 * marketingTags=recommended）做视觉锚点。所有视觉走 `platform-ui-spec.md` 设计 token。
 *
 * 纯渲染：数据 + 选中周期 + 回调入参，无内部状态，便于单测。复用 `summarizePlansForDisplay`
 * 去重，故新增 Trial 槽位后自动多一列。
 */

import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import type { Plan, SeatRole } from "../../../capability/cost-budget-billing/index.ts";
import { renderIcon } from "../../../icons.ts";
import {
  resolvePlanSlot,
  summarizePlansForDisplay,
  type CanonicalPlanKey,
} from "./plan-display.ts";
import { BILLING_CYCLES, type BillingCycle, computeCyclePrice } from "./pricing-cycle.ts";

export type PricingComparisonOptions = {
  plans: readonly Plan[];
  selectedCycle: BillingCycle;
  onSelectCycle: (cycle: BillingCycle) => void;
  /** 点击某档主行动按钮（开始试用 / 升级）。 */
  onSelectPlan?: (plan: Plan) => void;
  /** 点击「联系销售」（卓越版/企业档）。 */
  onContactSales?: (plan: Plan) => void;
  /** 当前已订阅的套餐 id（企业端订阅页）；该档展示「当前套餐」而非行动按钮。 */
  currentPlanId?: string;
  /** 只读预览（平台管理端）：隐藏所有行动按钮，仅展示价格与权益。 */
  readOnly?: boolean;
  /** 平台管理端：点击卡片右上角「编辑」按钮进入套餐编辑页。 */
  onEditPlan?: (plan: Plan) => void;
};

function fmtMoney(cents: number): string {
  return `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function cycleLabel(cycle: BillingCycle): string {
  return t(`platformPricing.cycle.${cycle}`);
}

function totalSeats(seatQuota: Partial<Record<SeatRole, number>>): number {
  return (seatQuota.viewer ?? 0) + (seatQuota.creator ?? 0) + (seatQuota.admin ?? 0);
}

/** 每档的精选权益 i18n key（除席位/Bot 数据行外的营销权益），用于拉长权益清单。 */
const SLOT_BENEFITS: Record<CanonicalPlanKey, readonly string[]> = {
  trial: ["benefitTrial1", "benefitTrial2", "benefitTrial3", "benefitTrial4"],
  starter: ["benefitStarter1", "benefitStarter2", "benefitStarter3", "benefitStarter4"],
  professional: ["benefitPro1", "benefitPro2", "benefitPro3", "benefitPro4"],
  business: ["benefitBusiness1", "benefitBusiness2", "benefitBusiness3", "benefitBusiness4"],
  enterprise: [
    "benefitEnterprise1",
    "benefitEnterprise2",
    "benefitEnterprise3",
    "benefitEnterprise4",
  ],
};

/** 权益清单 = 数据行（席位 / Bot）+ 该档精选权益。卡片底部统一拉伸对齐。 */
function planValueRows(plan: Plan): TemplateResult[] {
  const rows: TemplateResult[] = [];
  const seats = totalSeats(plan.seatQuota);
  if (seats > 0) {
    rows.push(valueRow(t("platformPricing.compareSeats", { count: String(seats) })));
  }
  if (plan.botQuota > 0) {
    rows.push(valueRow(t("platformPricing.compareBots", { count: String(plan.botQuota) })));
  }
  const slot = resolvePlanSlot(plan.name);
  if (slot) {
    for (const key of SLOT_BENEFITS[slot]) {
      rows.push(valueRow(t(`platformPricing.${key}`)));
    }
  }
  return rows;
}

function valueRow(label: string): TemplateResult {
  return html`
    <li class="platform-pricing__compare-feature">
      <span class="platform-pricing__compare-feature-icon" aria-hidden="true"
        >${renderIcon("check")}</span
      >
      <span>${label}</span>
    </li>
  `;
}

function isRecommended(plan: Plan): boolean {
  return (
    (plan.marketingTags ?? []).includes("recommended") ||
    resolvePlanSlot(plan.name) === "professional"
  );
}

function renderCycleSwitcher(options: PricingComparisonOptions): TemplateResult {
  return html`
    <div
      class="platform-pricing__compare-cycles"
      role="tablist"
      aria-label=${t("platformPricing.cycleSwitcherLabel")}
      data-testid="pricing-cycle-switcher"
    >
      ${BILLING_CYCLES.map((cycle) => {
        const active = cycle === options.selectedCycle;
        const annualSave = cycle === "annual";
        return html`
          <button
            type="button"
            role="tab"
            aria-selected=${active ? "true" : "false"}
            class="platform-pricing__compare-cycle ${active ? "is-active" : ""}"
            data-cycle=${cycle}
            @click=${() => options.onSelectCycle(cycle)}
          >
            ${cycleLabel(cycle)}
            ${
              annualSave
                ? html`<span class="platform-pricing__compare-cycle-badge"
                  >${t("platformPricing.cycleAnnualSave")}</span
                >`
                : nothing
            }
          </button>
        `;
      })}
    </div>
  `;
}

function renderPlanCard(plan: Plan, options: PricingComparisonOptions): TemplateResult {
  const quote = computeCyclePrice(plan.basePriceCents, options.selectedCycle);
  const recommended = isRecommended(plan);
  // 卓越版/企业档：basePriceCents=0 表示「面议」，须区别于免费试用（同为 ¥0）。
  const contactSales = resolvePlanSlot(plan.name) === "enterprise";
  const free = !contactSales && plan.basePriceCents === 0;
  const discounted = !contactSales && quote.discountRate > 0 && quote.listTotalCents > 0;
  const priceLabel = contactSales
    ? t("platformPricing.compareContactSales")
    : free
      ? t("platformPricing.compareFree")
      : fmtMoney(quote.effectiveMonthlyCents);
  return html`
    <article
      class="platform-pricing__compare-card ${recommended ? "is-recommended" : ""}"
      data-testid="compare-card"
      data-plan-id=${plan.id}
    >
      <div class="platform-pricing__compare-card-topbar">
        ${
          recommended
            ? html`<span class="platform-pricing__compare-badge platform-pricing__compare-badge--inline">
                ${renderIcon("sparkles")} ${t("platformPricing.recommendedTag")}
              </span>`
            : html`
                <span></span>
              `
        }
        ${
          options.onEditPlan
            ? html`
                <button
                  type="button"
                  class="btn btn--sm platform-pricing__compare-card-edit"
                  data-testid="compare-card-edit"
                  @click=${(e: MouseEvent) => {
                    e.stopPropagation();
                    options.onEditPlan!(plan);
                  }}
                >
                  ${t("platformPricing.planConfigModeEdit")}
                </button>
              `
            : nothing
        }
      </div>
      <h3 class="platform-pricing__compare-name">${plan.name}</h3>
      <div class="platform-pricing__compare-pricing">
        <div class="platform-pricing__compare-price">
          <span
            class="platform-pricing__compare-price-value ${
              contactSales ? "platform-pricing__compare-price-value--quote" : ""
            }"
            >${priceLabel}</span
          >
          ${
            free || contactSales
              ? nothing
              : html`<span class="platform-pricing__compare-price-unit"
                >${t("platformPricing.perMonth")}</span
              >`
          }
        </div>
        ${
          discounted
            ? html`<div class="platform-pricing__compare-savings">
              <span class="platform-pricing__compare-list-price">${fmtMoney(quote.listTotalCents)}</span>
              <span class="platform-pricing__compare-save"
                >${t("platformPricing.compareSaved", { amount: fmtMoney(quote.savingsCents) })}</span
              >
            </div>`
            : nothing
        }
      </div>
      <button
        type="button"
        class="platform-pricing__compare-cta ${recommended || contactSales ? "is-primary" : ""} ${
          plan.id === options.currentPlanId ? "is-current" : ""
        }"
        data-testid="compare-cta"
        ?hidden=${options.readOnly === true}
        ?disabled=${plan.id === options.currentPlanId}
        @click=${() => {
          if (options.readOnly || plan.id === options.currentPlanId) {
            return;
          }
          if (contactSales) {
            (options.onContactSales ?? options.onSelectPlan)?.(plan);
            return;
          }
          options.onSelectPlan?.(plan);
        }}
      >
        ${
          plan.id === options.currentPlanId
            ? t("platformPricing.compareCurrentPlan")
            : contactSales
              ? t("platformPricing.compareContactSales")
              : free
                ? t("platformPricing.compareStartTrial")
                : t("platformPricing.compareChoose")
        }
      </button>
      <ul class="platform-pricing__compare-features">
        ${planValueRows(plan)}
      </ul>
    </article>
  `;
}

export function renderPricingComparison(options: PricingComparisonOptions): TemplateResult {
  const { visible } = summarizePlansForDisplay(options.plans);
  if (visible.length === 0) {
    return html`
      <div class="platform-pricing__compare-empty muted" data-testid="compare-empty">
        ${t("platformPricing.compareEmpty")}
      </div>
    `;
  }
  return html`
    <section class="platform-pricing__compare" data-testid="pricing-comparison">
      ${renderCycleSwitcher(options)}
      <div class="platform-pricing__compare-grid">
        ${visible.map((plan) => renderPlanCard(plan, options))}
      </div>
    </section>
  `;
}
