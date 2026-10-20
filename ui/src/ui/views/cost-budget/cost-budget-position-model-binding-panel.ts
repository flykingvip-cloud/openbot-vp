import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../i18n/index.ts";
import type { SeatRole } from "../../capability/cost-budget-billing/index.ts";
import type { SelectedOrgPosition } from "./cost-budget-position-model-binding.ts";

export function renderCostBudgetPositionModelBindingPanel(params: {
  position: SelectedOrgPosition;
  entitledModelIds: readonly string[];
  draftModelIds: ReadonlySet<string>;
  savedModelIds: readonly string[];
  dirty: boolean;
  disabled: boolean;
  defaultRole: SeatRole | null;
  roleLabel: (role: SeatRole) => string;
  onToggleModel: (modelId: string, selected: boolean) => void;
  onDefaultRoleChange: (role: SeatRole | null) => void;
  onSave: () => void;
  onCancel: () => void;
  onClearPosition: () => void;
}): TemplateResult {
  const hasModels = params.entitledModelIds.length > 0;

  return html`
    <div class="cost-budget-position-model-binding" data-testid="position-model-binding">
      <div class="cost-budget-position-model-binding__header">
        <div>
          <h5 class="cost-budget-position-model-binding__title">${params.position.title}</h5>
          <p class="enterprise-hint">${params.position.teamLabel}</p>
        </div>
        <button
          type="button"
          class="btn btn--sm"
          ?disabled=${params.disabled}
          @click=${() => params.onClearPosition()}
        >
          ${t("costBudget.allocation.positionModelClear")}
        </button>
      </div>

      <p class="enterprise-hint cost-budget-position-model-binding__hint">
        ${t("costBudget.allocation.positionModelHint")}
      </p>

      <label class="cost-budget-position-model-binding__role">
        ${t("costBudget.allocation.positionModelDefaultRole")}
        <select
          .value=${params.defaultRole ?? ""}
          ?disabled=${params.disabled}
          @change=${(event: Event) => {
            const value = (event.currentTarget as HTMLSelectElement).value;
            params.onDefaultRoleChange(value ? (value as SeatRole) : null);
          }}
        >
          <option value="">${t("costBudget.allocation.roleTemplatesAuto")}</option>
          <option value="viewer">${params.roleLabel("viewer")}</option>
          <option value="creator">${params.roleLabel("creator")}</option>
          <option value="admin">${params.roleLabel("admin")}</option>
        </select>
      </label>

      ${
        !hasModels
          ? html`
              <div class="callout warning" data-testid="position-model-binding-empty">
                ${t("costBudget.allocation.positionModelNoEntitlement")}
              </div>
            `
          : html`
              <div
                class="cost-budget-position-model-binding__models"
                data-testid="position-model-binding-list"
              >
                ${params.entitledModelIds.map((modelId) => {
                  const checked = params.draftModelIds.has(modelId);
                  return html`
                    <label class="cost-budget-position-model-binding__row">
                      <input
                        type="checkbox"
                        .checked=${checked}
                        ?disabled=${params.disabled}
                        data-testid=${`position-model-${modelId.replace(/[^\w-]+/g, "_")}`}
                        @change=${(event: Event) =>
                          params.onToggleModel(
                            modelId,
                            (event.currentTarget as HTMLInputElement).checked,
                          )}
                      />
                      <span class="cost-budget-position-model-binding__model-id">${modelId}</span>
                    </label>
                  `;
                })}
              </div>
            `
      }

      ${
        params.dirty
          ? html`
              <p class="enterprise-hint cost-budget-position-model-binding__unsaved">
                ${t("costBudget.allocation.positionModelUnsaved")}
              </p>
            `
          : nothing
      }

      <div class="cost-budget-position-model-binding__actions">
        <button
          type="button"
          class="btn"
          ?disabled=${params.disabled || !params.dirty}
          @click=${() => params.onCancel()}
        >
          ${t("costBudget.allocation.positionModelCancel")}
        </button>
        <button
          type="button"
          class="btn primary"
          data-testid="position-model-binding-save"
          ?disabled=${params.disabled || !params.dirty || !hasModels}
          @click=${() => params.onSave()}
        >
          ${t("costBudget.allocation.positionModelSave")}
        </button>
      </div>
    </div>
  `;
}
