import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../../i18n/index.ts";
import { createCostBudgetGateway } from "../../../../capability/cost-budget-billing/gateway-client.ts";
import type { Budget } from "../../../../capability/cost-budget-billing/index.ts";
import type { GatewayBrowserClient } from "../../../../gateway.ts";
import { renderEnterpriseKpiGrid } from "../../../enterprise-kpi-card.ts";
import { getSettingsStoreState, reloadSettingsStore } from "../../stores/settings-store.ts";
import { renderBudgetForecastAlerts } from "./budget-forecast-alerts.ts";
import { renderCreditsReconciliationAlert } from "./credits-reconciliation-alert.ts";

type BudgetDraft = {
  monthlyLimitYuan: string;
  alertThresholdPercent: string;
  limitAiCalls: boolean;
  limitBotCreation: boolean;
  autoDowngrade: boolean;
};

const draft: BudgetDraft = {
  monthlyLimitYuan: "",
  alertThresholdPercent: "80",
  limitAiCalls: false,
  limitBotCreation: false,
  autoDowngrade: false,
};

let draftSyncedKey = "";
let saving = false;
let saveError: string | null = null;
let saveNotice: string | null = null;

function fmtMoney(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

function syncDraftFromBudget(budget: Budget | null): void {
  const key = budget?.updatedAt ?? "empty";
  if (draftSyncedKey === key) {
    return;
  }
  draftSyncedKey = key;
  if (!budget) {
    draft.monthlyLimitYuan = "";
    draft.alertThresholdPercent = "80";
    draft.limitAiCalls = false;
    draft.limitBotCreation = false;
    draft.autoDowngrade = false;
    return;
  }
  draft.monthlyLimitYuan =
    budget.monthlyLimitCents > 0 ? (budget.monthlyLimitCents / 100).toFixed(2) : "";
  draft.alertThresholdPercent = String(Math.round(budget.alertThreshold * 100));
  draft.limitAiCalls = budget.controls.limitAiCalls;
  draft.limitBotCreation = budget.controls.limitBotCreation;
  draft.autoDowngrade = budget.controls.autoDowngrade;
}

function parseMonthlyLimitCents(): number | null {
  const trimmed = draft.monthlyLimitYuan.trim();
  if (!trimmed) {
    return 0;
  }
  const yuan = Number(trimmed);
  if (!Number.isFinite(yuan) || yuan < 0) {
    return null;
  }
  return Math.round(yuan * 100);
}

function parseAlertThreshold(): number | null {
  const trimmed = draft.alertThresholdPercent.trim();
  if (!trimmed) {
    return 0.8;
  }
  const percent = Number(trimmed);
  if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
    return null;
  }
  return percent / 100;
}

async function submitBudget(client: GatewayBrowserClient, rerender: () => void): Promise<void> {
  const monthlyLimitCents = parseMonthlyLimitCents();
  const alertThreshold = parseAlertThreshold();
  if (monthlyLimitCents == null) {
    saveError = t("costBudget.v2.settings.budget.invalidMonthlyLimit");
    saveNotice = null;
    rerender();
    return;
  }
  if (alertThreshold == null) {
    saveError = t("costBudget.v2.settings.budget.invalidAlertThreshold");
    saveNotice = null;
    rerender();
    return;
  }
  saving = true;
  saveError = null;
  saveNotice = null;
  rerender();
  try {
    const gw = createCostBudgetGateway(client);
    const result = await gw.setBudget({
      monthlyLimitCents,
      alertThreshold,
      controls: {
        limitAiCalls: draft.limitAiCalls,
        limitBotCreation: draft.limitBotCreation,
        autoDowngrade: draft.autoDowngrade,
      },
    });
    draftSyncedKey = "";
    syncDraftFromBudget(result.budget);
    saveNotice = t("costBudget.v2.settings.budget.saveSuccess");
    await reloadSettingsStore(client);
  } catch (err) {
    saveError = err instanceof Error ? err.message : t("costBudget.v2.settings.budget.saveFailed");
  } finally {
    saving = false;
    rerender();
  }
}

export function __resetBudgetSettingsPanelForTest(): void {
  draftSyncedKey = "";
  draft.monthlyLimitYuan = "";
  draft.alertThresholdPercent = "80";
  draft.limitAiCalls = false;
  draft.limitBotCreation = false;
  draft.autoDowngrade = false;
  saving = false;
  saveError = null;
  saveNotice = null;
}

export type BudgetSettingsPanelOptions = {
  client: GatewayBrowserClient;
  rerender: () => void;
};

export function renderBudgetSettingsPanel(options: BudgetSettingsPanelOptions): TemplateResult {
  const view = getSettingsStoreState();
  const budget = view.budget?.budget ?? null;
  syncDraftFromBudget(budget);

  return html`
    <section class="cost-budget-v2-budget-panel" data-testid="cost-budget-v2-budget-panel">
      ${renderBudgetForecastAlerts({ budget: view.budget, forecast: view.forecast })}
      ${
        view.dashboard?.creditsReconciliation
          ? renderCreditsReconciliationAlert({
              reconciliation: view.dashboard.creditsReconciliation,
              testId: "cost-budget-settings-reconciliation-drift",
            })
          : nothing
      }
      ${
        budget
          ? html`
              <div class="cost-budget-v2-budget-panel__summary">
                ${renderEnterpriseKpiGrid([
                  {
                    label: t("costBudget.v2.settings.budget.kpiMonthlyLimit"),
                    value: fmtMoney(budget.monthlyLimitCents),
                  },
                  {
                    label: t("costBudget.v2.settings.budget.kpiAlertThreshold"),
                    value: `${Math.round(budget.alertThreshold * 100)}%`,
                  },
                ])}
              </div>
            `
          : html`
              <div class="enterprise-hint" data-testid="cost-budget-v2-budget-empty-hint">
                ${t("costBudget.v2.settings.budget.emptyHint")}
              </div>
            `
      }
      <form
        class="cost-budget-v2-budget-form enterprise-card"
        data-testid="cost-budget-v2-budget-form"
        @submit=${(event: Event) => {
          event.preventDefault();
          void submitBudget(options.client, options.rerender);
        }}
      >
        <h3 class="enterprise-section-title">${t("costBudget.v2.settings.budget.formTitle")}</h3>
        <div class="form-field">
          <label for="budget-monthly-limit">${t("costBudget.v2.settings.budget.monthlyLimitLabel")}</label>
          <input
            id="budget-monthly-limit"
            type="number"
            min="0"
            step="0.01"
            .value=${draft.monthlyLimitYuan}
            ?disabled=${saving}
            data-testid="budget-monthly-limit-input"
            @input=${(event: Event) => {
              draft.monthlyLimitYuan = (event.target as HTMLInputElement).value;
              options.rerender();
            }}
          />
          <p class="muted">${t("costBudget.v2.settings.budget.monthlyLimitHint")}</p>
        </div>
        <div class="form-field">
          <label for="budget-alert-threshold">${t("costBudget.v2.settings.budget.alertThresholdLabel")}</label>
          <input
            id="budget-alert-threshold"
            type="number"
            min="1"
            max="100"
            step="1"
            .value=${draft.alertThresholdPercent}
            ?disabled=${saving}
            data-testid="budget-alert-threshold-input"
            @input=${(event: Event) => {
              draft.alertThresholdPercent = (event.target as HTMLInputElement).value;
              options.rerender();
            }}
          />
          <p class="muted">${t("costBudget.v2.settings.budget.alertThresholdHint")}</p>
        </div>
        <fieldset class="cost-budget-v2-budget-form__controls">
          <legend>${t("costBudget.v2.settings.budget.controlsTitle")}</legend>
          <label class="cost-budget-v2-budget-form__check">
            <input
              type="checkbox"
              .checked=${draft.limitAiCalls}
              ?disabled=${saving}
              data-testid="budget-limit-ai-calls"
              @change=${(event: Event) => {
                draft.limitAiCalls = (event.target as HTMLInputElement).checked;
                options.rerender();
              }}
            />
            ${t("costBudget.v2.settings.budget.limitAiCalls")}
          </label>
          <label class="cost-budget-v2-budget-form__check">
            <input
              type="checkbox"
              .checked=${draft.limitBotCreation}
              ?disabled=${saving}
              data-testid="budget-limit-bot-creation"
              @change=${(event: Event) => {
                draft.limitBotCreation = (event.target as HTMLInputElement).checked;
                options.rerender();
              }}
            />
            ${t("costBudget.v2.settings.budget.limitBotCreation")}
          </label>
          <label class="cost-budget-v2-budget-form__check">
            <input
              type="checkbox"
              .checked=${draft.autoDowngrade}
              ?disabled=${saving}
              data-testid="budget-auto-downgrade"
              @change=${(event: Event) => {
                draft.autoDowngrade = (event.target as HTMLInputElement).checked;
                options.rerender();
              }}
            />
            ${t("costBudget.v2.settings.budget.autoDowngrade")}
          </label>
        </fieldset>
        ${
          saveError
            ? html`<div class="callout warning" data-testid="budget-save-error">${saveError}</div>`
            : nothing
        }
        ${
          saveNotice
            ? html`<div class="callout success" data-testid="budget-save-notice">${saveNotice}</div>`
            : nothing
        }
        <div class="cost-budget-v2-budget-form__actions">
          <button
            type="submit"
            class="btn btn--primary"
            ?disabled=${saving}
            data-testid="budget-save-btn"
          >
            ${saving ? t("costBudget.v2.settings.budget.saving") : t("costBudget.v2.settings.budget.save")}
          </button>
        </div>
      </form>
    </section>
  `;
}
