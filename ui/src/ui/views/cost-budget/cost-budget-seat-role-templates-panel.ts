import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../i18n/index.ts";
import type { SeatRole } from "../../capability/cost-budget-billing/index.ts";
import type { EnterprisePortReadModel } from "../../ports/enterprise/semantic/enterprise-read-model.ts";
import {
  BUILTIN_SEAT_ROLE_PREFIX_RULES,
  listDistinctRoleCodePrefixes,
  type SeatRoleTemplateStore,
  seatRoleShortLabel,
} from "./cost-budget-seat-role-templates.ts";

export function renderSeatRoleTemplatePanel(params: {
  readModel: EnterprisePortReadModel | null | undefined;
  templates: SeatRoleTemplateStore;
  roleLabel: (role: SeatRole) => string;
  disabled: boolean;
  onPrefixRuleChange: (prefix: string, role: SeatRole) => void;
  onPositionOverrideChange: (orgSeatId: string, role: SeatRole | null) => void;
}): TemplateResult {
  const prefixes = listDistinctRoleCodePrefixes(params.readModel);
  const vacantPositions =
    params.readModel?.seatSummaries.filter((seat) => !seat.currentEmployeeUser?.trim()) ?? [];

  return html`
    <details class="cost-budget-seat-role-templates" data-testid="seat-role-templates">
      <summary>${t("costBudget.allocation.roleTemplatesTitle")}</summary>
      <p class="enterprise-hint cost-budget-seat-role-templates__hint">
        ${t("costBudget.allocation.roleTemplatesHint")}
      </p>
      ${
        prefixes.length > 0
          ? html`
              <div class="cost-budget-seat-role-templates__section">
                <h5>${t("costBudget.allocation.roleTemplatesPrefixSection")}</h5>
                <div class="cost-budget-seat-role-templates__table-wrap">
                  <table class="cost-budget-seat-role-templates__table">
                    <thead>
                      <tr>
                        <th>${t("costBudget.allocation.roleTemplatesPrefixCol")}</th>
                        <th>${t("costBudget.allocation.roleTemplatesDefaultCol")}</th>
                        <th>${t("costBudget.allocation.roleTemplatesBuiltinCol")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${prefixes.map((prefix) => {
                        const current =
                          params.templates.prefixRules[prefix] ??
                          BUILTIN_SEAT_ROLE_PREFIX_RULES[prefix] ??
                          "viewer";
                        const builtin = BUILTIN_SEAT_ROLE_PREFIX_RULES[prefix];
                        return html`
                          <tr data-testid=${`role-template-prefix-${prefix}`}>
                            <td><code>${prefix}</code></td>
                            <td>
                              <select
                                .value=${params.templates.prefixRules[prefix] ?? current}
                                ?disabled=${params.disabled}
                                @change=${(e: Event) =>
                                  params.onPrefixRuleChange(
                                    prefix,
                                    (e.target as HTMLSelectElement).value as SeatRole,
                                  )}
                              >
                                <option value="viewer">${params.roleLabel("viewer")}</option>
                                <option value="creator">${params.roleLabel("creator")}</option>
                                <option value="admin">${params.roleLabel("admin")}</option>
                              </select>
                            </td>
                            <td class="enterprise-hint">
                              ${builtin ? seatRoleShortLabel(builtin) : "—"}
                            </td>
                          </tr>
                        `;
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            `
          : nothing
      }
      ${
        vacantPositions.length > 0
          ? html`
              <div class="cost-budget-seat-role-templates__section">
                <h5>${t("costBudget.allocation.roleTemplatesVacantSection")}</h5>
                <div class="cost-budget-seat-role-templates__table-wrap">
                  <table class="cost-budget-seat-role-templates__table">
                    <thead>
                      <tr>
                        <th>${t("costBudget.allocation.listColPosition")}</th>
                        <th>${t("costBudget.allocation.roleTemplatesDefaultCol")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${vacantPositions.map(
                        (seat) => html`
                        <tr data-testid=${`role-template-position-${seat.seatId}`}>
                          <td>
                            <strong>${seat.title}</strong>
                            <div class="enterprise-hint">${seat.teamLabel ?? "未分组"}</div>
                          </td>
                          <td>
                            <select
                              .value=${params.templates.positionOverrides[seat.seatId] ?? ""}
                              ?disabled=${params.disabled}
                              @change=${(e: Event) => {
                                const value = (e.target as HTMLSelectElement).value;
                                params.onPositionOverrideChange(
                                  seat.seatId,
                                  value ? (value as SeatRole) : null,
                                );
                              }}
                            >
                              <option value="">
                                ${t("costBudget.allocation.roleTemplatesAuto")}
                              </option>
                              <option value="viewer">${params.roleLabel("viewer")}</option>
                              <option value="creator">${params.roleLabel("creator")}</option>
                              <option value="admin">${params.roleLabel("admin")}</option>
                            </select>
                          </td>
                        </tr>
                      `,
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            `
          : nothing
      }
    </details>
  `;
}
