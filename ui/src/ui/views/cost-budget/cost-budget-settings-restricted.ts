import { html, type TemplateResult } from "lit";
import { t } from "../../../i18n/index.ts";

export function renderCostBudgetSettingsRestricted(): TemplateResult {
  return html`
    <div class="enterprise-empty" data-testid="cost-budget-settings-restricted">
      ${t("costBudget.settingsRestricted")}
    </div>
  `;
}
