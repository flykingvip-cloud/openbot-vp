/**
 * 版本激活确认面板：权益 / 定价 / 模型三栏 diff + 影响说明（Phase 3 扁平化）。
 */

import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import type { PricingDiff } from "../../../capability/cost-budget-billing/index.ts";
import type { EntitlementDiffRow } from "./commercial-display.ts";

export type ModelBindingDiff = {
  addedModelIds: string[];
  removedModelIds: string[];
  quotaChangedModelIds: string[];
  aorChanged: boolean;
};

export type ActivateConfirmImpact = {
  lockedCount: number;
  marginDeltaLabel: string | null;
};

export type ActivateConfirmPanelParams = {
  versionNumber: number;
  entitlementDiff: EntitlementDiffRow[];
  pricingDiff: PricingDiff | null;
  pricingDiffLoading: boolean;
  bindingDiff: ModelBindingDiff | null;
  impact: ActivateConfirmImpact;
  busy: boolean;
  fmtMoney: (cents: number | null) => string;
  onConfirm: () => void;
  onCancel: () => void;
};

function countPricingChanges(diff: PricingDiff | null): number {
  return (diff?.entries ?? []).filter((entry) => entry.change !== "unchanged").length;
}

function countBindingChanges(diff: ModelBindingDiff | null): number {
  if (!diff) {
    return 0;
  }
  let count =
    diff.addedModelIds.length + diff.removedModelIds.length + diff.quotaChangedModelIds.length;
  if (diff.aorChanged) {
    count += 1;
  }
  return count;
}

export function summarizeActivateDiffChanges(params: {
  entitlementDiff: EntitlementDiffRow[];
  pricingDiff: PricingDiff | null;
  bindingDiff: ModelBindingDiff | null;
}): { entitlement: number; pricing: number; models: number; total: number } {
  const entitlement = params.entitlementDiff.length;
  const pricing = countPricingChanges(params.pricingDiff);
  const models = countBindingChanges(params.bindingDiff);
  return { entitlement, pricing, models, total: entitlement + pricing + models };
}

function renderEntitlementDiff(rows: EntitlementDiffRow[]): TemplateResult {
  if (rows.length === 0) {
    return html`
      <div class="muted platform-pricing__activate-diff-empty" data-testid="entitlement-diff">
        ${t("platformPricing.commercialNoEntitlementDiff")}
      </div>
    `;
  }
  return html`
    <div class="platform-pricing__entitlement-diff" data-testid="entitlement-diff">
      ${rows.map(
        (row) => html`
          <div class="platform-pricing__entitlement-diff-row">
            <span class="platform-pricing__entitlement-diff-label">${row.label}</span>
            <span class="platform-pricing__entitlement-diff-from">${row.from}</span>
            <span class="platform-pricing__entitlement-diff-arrow">→</span>
            <span class="platform-pricing__entitlement-diff-to">${row.to}</span>
          </div>
        `,
      )}
    </div>
  `;
}

function renderPricingDiff(
  diff: PricingDiff | null,
  diffLoading: boolean,
  fmtMoney: (cents: number | null) => string,
): TemplateResult {
  if (diffLoading) {
    return html`
      <div class="muted">…</div>
    `;
  }
  const changed = (diff?.entries ?? []).filter((entry) => entry.change !== "unchanged");
  if (changed.length === 0) {
    return html`<div class="muted">${t("platformPricing.diffNone")}</div>`;
  }
  const changeLabel = (change: string) =>
    change === "added"
      ? t("platformPricing.diffAdded")
      : change === "removed"
        ? t("platformPricing.diffRemoved")
        : t("platformPricing.diffChanged");
  return html`
    <div class="platform-pricing__activate-pricing-diff" data-testid="version-diff">
      ${changed.map(
        (entry) => html`
          <div class="platform-pricing__activate-pricing-row">
            <span class="chip">${changeLabel(entry.change)}</span>
            <span class="mono">${entry.type}/${entry.key}</span>
            <span class="platform-pricing__activate-pricing-values">
              ${fmtMoney(entry.oldPriceCents)} → ${fmtMoney(entry.newPriceCents)}
            </span>
          </div>
        `,
      )}
    </div>
  `;
}

function renderBindingDiffSection(diff: ModelBindingDiff | null): TemplateResult {
  if (!diff) {
    return html``;
  }
  const hasChanges =
    diff.addedModelIds.length > 0 ||
    diff.removedModelIds.length > 0 ||
    diff.quotaChangedModelIds.length > 0 ||
    diff.aorChanged;
  if (!hasChanges) {
    return html`
      <div class="muted platform-pricing__activate-diff-empty" data-testid="binding-diff">
        ${t("platformPricing.bindingDiffNone")}
      </div>
    `;
  }
  return html`
    <div class="platform-pricing__activate-binding-diff" data-testid="binding-diff">
      ${
        diff.addedModelIds.length > 0
          ? html`
              <div class="platform-pricing__activate-binding-row">
                <span class="chip">${t("platformPricing.bindingDiffAdded")}</span>
                <span>${diff.addedModelIds.join(" · ")}</span>
              </div>
            `
          : nothing
      }
      ${
        diff.removedModelIds.length > 0
          ? html`
              <div class="platform-pricing__activate-binding-row">
                <span class="chip">${t("platformPricing.bindingDiffRemoved")}</span>
                <span>${diff.removedModelIds.join(" · ")}</span>
              </div>
            `
          : nothing
      }
      ${
        diff.quotaChangedModelIds.length > 0
          ? html`
              <div class="platform-pricing__activate-binding-row">
                <span class="chip">${t("platformPricing.bindingDiffQuota")}</span>
                <span>${diff.quotaChangedModelIds.join(" · ")}</span>
              </div>
            `
          : nothing
      }
      ${
        diff.aorChanged
          ? html`
              <div class="platform-pricing__activate-binding-row">
                <span class="chip">${t("platformPricing.bindingDiffAor")}</span>
                <span class="muted">${t("platformPricing.bindingDiffAorHint")}</span>
              </div>
            `
          : nothing
      }
    </div>
  `;
}

export function renderPlanActivateConfirmPanel(params: ActivateConfirmPanelParams): TemplateResult {
  const summary = summarizeActivateDiffChanges({
    entitlementDiff: params.entitlementDiff,
    pricingDiff: params.pricingDiff,
    bindingDiff: params.bindingDiff,
  });

  return html`
    <section
      class="platform-pricing__activate-confirm platform-pricing__activate-confirm--flat"
      data-testid="activate-confirm"
    >
      <header class="platform-pricing__activate-confirm-head">
        <h3 class="platform-pricing__activate-confirm-title">
          ${t("platformPricing.confirmActivate")} ·
          ${t("platformPricing.versionLabel", { n: String(params.versionNumber) })}
        </h3>
        <p class="muted platform-pricing__activate-confirm-summary" data-testid="activate-diff-summary">
          ${t("platformPricing.activateDiffSummary", {
            total: String(summary.total),
            entitlement: String(summary.entitlement),
            pricing: String(summary.pricing),
            models: String(summary.models),
          })}
        </p>
      </header>

      <div class="platform-pricing__activate-diff-grid" data-testid="activate-diff-grid">
        <section class="platform-pricing__activate-diff-block" data-testid="activate-diff-entitlement">
          <h4 class="platform-pricing__activate-diff-title">${t("platformPricing.commercialEntitlementDiff")}</h4>
          ${renderEntitlementDiff(params.entitlementDiff)}
        </section>
        <section class="platform-pricing__activate-diff-block" data-testid="activate-diff-pricing">
          <h4 class="platform-pricing__activate-diff-title">${t("platformPricing.diffTitle")}</h4>
          ${renderPricingDiff(params.pricingDiff, params.pricingDiffLoading, params.fmtMoney)}
        </section>
        <section class="platform-pricing__activate-diff-block" data-testid="activate-diff-models">
          <h4 class="platform-pricing__activate-diff-title">${t("platformPricing.sectionModels")}</h4>
          ${renderBindingDiffSection(params.bindingDiff)}
        </section>
      </div>

      <div class="platform-pricing__impact-panel" data-testid="impact-warning">
        <div class="platform-pricing__impact-title">${t("platformPricing.commercialImpactTitle")}</div>
        <ul class="platform-pricing__impact-list">
          <li>
            ${t("platformPricing.commercialImpactExisting", {
              count: String(params.impact.lockedCount),
            })}
          </li>
          <li>${t("platformPricing.commercialImpactNewDefault")}</li>
          ${
            params.impact.marginDeltaLabel
              ? html`
                  <li data-testid="activate-margin-delta">
                    ${t("platformPricing.unitEconomicsActivateDelta", {
                      delta: params.impact.marginDeltaLabel,
                    })}
                  </li>
                `
              : nothing
          }
        </ul>
      </div>

      <div class="platform-pricing__activate-confirm-actions">
        <button
          type="button"
          class="btn btn--primary"
          data-testid="confirm-activate-btn"
          ?disabled=${params.busy}
          @click=${params.onConfirm}
        >
          ${params.busy ? t("platformPricing.activating") : t("platformPricing.confirmActivate")}
        </button>
        <button type="button" class="btn" ?disabled=${params.busy} @click=${params.onCancel}>
          ${t("platformPricing.cancel")}
        </button>
      </div>
    </section>
  `;
}
