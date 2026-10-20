/**
 * 未订阅总览 Hero — 双入口（智能推荐 / 查看全部套餐）。
 */

import { html, type TemplateResult } from "lit";
import { t } from "../../../i18n/index.ts";
import { renderIcon } from "../../icons.ts";

export type SubscribeHeroActions = {
  onStartRecommend: () => void;
  onBrowsePlans: () => void;
};

export function renderCostBudgetOverviewSubscribeHero(
  actions: SubscribeHeroActions,
): TemplateResult {
  return html`
    <section class="cost-budget-subscribe-hero" data-testid="overview-subscribe-hero">
      <div class="cost-budget-subscribe-hero__copy">
        <h2 class="cost-budget-subscribe-hero__title">
          ${t("costBudget.subscribeHero.title")}
        </h2>
        <p class="cost-budget-subscribe-hero__subtitle">
          ${t("costBudget.subscribeHero.subtitle")}
        </p>
      </div>
      <div class="cost-budget-subscribe-hero__cards">
        <article class="cost-budget-subscribe-hero__card cost-budget-subscribe-hero__card--primary">
          <div class="cost-budget-subscribe-hero__card-icon" aria-hidden="true">
            ${renderIcon("sparkles")}
          </div>
          <h3>${t("costBudget.subscribeHero.recommendTitle")}</h3>
          <p class="enterprise-hint">${t("costBudget.subscribeHero.recommendHint")}</p>
          <button
            type="button"
            class="btn btn--primary"
            data-testid="hero-start-recommend"
            @click=${actions.onStartRecommend}
          >
            ${t("costBudget.subscribeHero.recommendCta")}
          </button>
        </article>
        <article class="cost-budget-subscribe-hero__card">
          <div class="cost-budget-subscribe-hero__card-icon" aria-hidden="true">
            ${renderIcon("barChart")}
          </div>
          <h3>${t("costBudget.subscribeHero.compareTitle")}</h3>
          <p class="enterprise-hint">${t("costBudget.subscribeHero.compareHint")}</p>
          <button
            type="button"
            class="btn"
            data-testid="hero-browse-plans"
            @click=${actions.onBrowsePlans}
          >
            ${t("costBudget.subscribeHero.compareCta")}
          </button>
        </article>
      </div>
      <ol class="cost-budget-subscribe-hero__steps" aria-label=${t("costBudget.subscribeHero.pathLabel")}>
        <li>${t("costBudget.subscribeHero.stepPlan")}</li>
        <li aria-hidden="true">→</li>
        <li>${t("costBudget.subscribeHero.stepSeats")}</li>
        <li aria-hidden="true">→</li>
        <li>${t("costBudget.subscribeHero.stepUsage")}</li>
      </ol>
    </section>
  `;
}
