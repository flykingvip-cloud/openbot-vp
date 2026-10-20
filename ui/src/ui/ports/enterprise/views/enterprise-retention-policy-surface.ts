import { html, nothing, type TemplateResult } from "lit";

export type EnterpriseRetentionComplianceProfile = "standard" | "financial" | "custom";

export type EnterpriseRetentionPolicyPanelState = {
  loading?: boolean;
  error?: string | null;
  deleteAfterDays?: number | null;
  archiveDays?: number | null;
  activeDays?: number | null;
  complianceProfile?: EnterpriseRetentionComplianceProfile | null;
  saving?: boolean;
  message?: string | null;
  onSave?: () => void;
  onActiveDaysChange?: (value: number) => void;
  onArchiveDaysChange?: (value: number) => void;
  onDeleteAfterDaysChange?: (value: number) => void;
  onComplianceProfileChange?: (value: EnterpriseRetentionComplianceProfile) => void;
};

function complianceProfileLabel(value: EnterpriseRetentionComplianceProfile): string {
  switch (value) {
    case "financial":
      return "金融合规";
    case "custom":
      return "自定义";
    default:
      return "标准";
  }
}

function numberFieldValue(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function parseDaysInput(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * CW2-P6-02 enterprise conversation retention policy panel — presentation only.
 */
export function renderEnterpriseRetentionPolicyPanel(
  state: EnterpriseRetentionPolicyPanelState,
): TemplateResult {
  const profile = state.complianceProfile ?? "standard";
  const formDisabled = Boolean(state.loading || state.saving);

  return html`
    <section class="enterprise-card enterprise-data-capability__panel">
      <div class="edc-section-label">会话保留策略</div>
      <div class="employee-workbench__settings-section-subtitle">
        配置租户级会话活跃、归档与删除周期；保存后由网关统一执行保留任务。
      </div>
      ${
        state.loading
          ? html`
              <div class="employee-workbench__settings-status-copy">正在加载保留策略…</div>
            `
          : nothing
      }
      ${state.error ? html`<div class="callout callout--danger">${state.error}</div>` : nothing}
      ${
        state.message?.trim()
          ? html`<div class="callout callout--info">${state.message}</div>`
          : nothing
      }
      ${
        !state.loading
          ? html`
              <div class="employee-workbench__settings-list" style="margin-top: 0.75rem;">
                <div class="employee-workbench__settings-row">
                  <div class="employee-workbench__settings-label">合规档位</div>
                  <div class="employee-workbench__settings-value">
                    <select
                      class="input"
                      ?disabled=${formDisabled}
                      .value=${profile}
                      @change=${(event: Event) => {
                        const value = (event.currentTarget as HTMLSelectElement)
                          .value as EnterpriseRetentionComplianceProfile;
                        state.onComplianceProfileChange?.(value);
                      }}
                    >
                      <option value="standard">${complianceProfileLabel("standard")}</option>
                      <option value="financial">${complianceProfileLabel("financial")}</option>
                      <option value="custom">${complianceProfileLabel("custom")}</option>
                    </select>
                  </div>
                </div>
                <div class="employee-workbench__settings-row">
                  <div class="employee-workbench__settings-label">活跃期（天）</div>
                  <div class="employee-workbench__settings-value">
                    <input
                      class="input"
                      type="number"
                      min="0"
                      inputmode="numeric"
                      ?disabled=${formDisabled}
                      .value=${numberFieldValue(state.activeDays)}
                      @input=${(event: Event) =>
                        state.onActiveDaysChange?.(
                          parseDaysInput((event.currentTarget as HTMLInputElement).value),
                        )}
                    />
                  </div>
                </div>
                <div class="employee-workbench__settings-row">
                  <div class="employee-workbench__settings-label">归档期（天）</div>
                  <div class="employee-workbench__settings-value">
                    <input
                      class="input"
                      type="number"
                      min="0"
                      inputmode="numeric"
                      ?disabled=${formDisabled}
                      .value=${numberFieldValue(state.archiveDays)}
                      @input=${(event: Event) =>
                        state.onArchiveDaysChange?.(
                          parseDaysInput((event.currentTarget as HTMLInputElement).value),
                        )}
                    />
                  </div>
                </div>
                <div class="employee-workbench__settings-row">
                  <div class="employee-workbench__settings-label">删除周期（天）</div>
                  <div class="employee-workbench__settings-value">
                    <input
                      class="input"
                      type="number"
                      min="0"
                      inputmode="numeric"
                      ?disabled=${formDisabled}
                      .value=${numberFieldValue(state.deleteAfterDays)}
                      @input=${(event: Event) =>
                        state.onDeleteAfterDaysChange?.(
                          parseDaysInput((event.currentTarget as HTMLInputElement).value),
                        )}
                    />
                  </div>
                </div>
              </div>
              <div class="enterprise-data-capability__actions" style="margin-top: 0.75rem;">
                <button
                  class="btn btn--primary"
                  type="button"
                  ?disabled=${formDisabled}
                  @click=${() => state.onSave?.()}
                >
                  ${state.saving ? "保存中…" : "保存策略"}
                </button>
              </div>
            `
          : nothing
      }
    </section>
  `;
}
