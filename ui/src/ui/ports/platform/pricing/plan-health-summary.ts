/**
 * 套餐目录行健康摘要：模型绑定 + Tier 档位。
 */

import { html, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import type { PlatformPlanBundleVersionRow } from "../../../capability/platform-plan-bundle/index.ts";

export type PlanVersionHealth = {
  tierCount: number;
  modelsBound: boolean;
  modelCount: number;
  needsModels: boolean;
};

export function resolvePlanVersionHealth(
  meta: PlatformPlanBundleVersionRow | null | undefined,
): PlanVersionHealth {
  if (!meta) {
    return { tierCount: 0, modelsBound: false, modelCount: 0, needsModels: true };
  }
  const tierIds = meta.binding?.allowedTiers ?? meta.entitlementSnapshot?.allowedTiers ?? [];
  const tierCount = new Set(tierIds.filter((entry) => entry.trim().length > 0)).size;
  const modelCount = meta.binding?.allowedModelIds?.length ?? 0;
  const modelsBound =
    !meta.activationBlockers.includes("missing_binding") &&
    meta.bindingState !== "missing" &&
    modelCount > 0;
  return {
    tierCount,
    modelsBound,
    modelCount,
    needsModels: !modelsBound,
  };
}

export type PlanHealthSummaryInput = {
  tierCount: number;
  modelsBound: boolean;
  modelCount: number;
  /** 经营分析等只读场景：不展示「去绑定」入口。 */
  readOnly?: boolean;
  onFixModels?: () => void;
};

export function renderPlanHealthSummary(input: PlanHealthSummaryInput): TemplateResult {
  const canFix = !input.readOnly && typeof input.onFixModels === "function";
  return html`
    <div class="platform-pricing__plan-health-summary" data-testid="plan-health-summary">
      ${
        input.modelsBound
          ? html`
              <span class="platform-pricing__plan-health-ok" data-testid="plan-health-models-ok">
                ✓ ${t("platformPricing.planHealthModelsOk")}
                ${
                  input.modelCount > 0
                    ? html` (${t("platformPricing.planHealthModelCount", { count: String(input.modelCount) })})`
                    : ""
                }
              </span>
            `
          : canFix
            ? html`
                <button
                  type="button"
                  class="platform-pricing__plan-health-warn-link"
                  data-testid="plan-health-fix-models"
                  @click=${() => input.onFixModels?.()}
                >
                  ⚠ ${t("platformPricing.planHealthMissingModels")}
                </button>
              `
            : html`
                <span class="platform-pricing__plan-health-warn" data-testid="plan-health-models-missing">
                  ⚠ ${t("platformPricing.planHealthMissingModels")}
                </span>
              `
      }
      <span class="platform-pricing__plan-health-sep" aria-hidden="true">·</span>
      <span class="platform-pricing__plan-health-tiers" data-testid="plan-health-tiers">
        ${t("platformPricing.planHealthTiers", { count: String(input.tierCount) })}
      </span>
    </div>
  `;
}
