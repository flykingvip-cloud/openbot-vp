import { html, nothing, type TemplateResult } from "lit";

export type EnterpriseMemoryGovernanceScopeRow = {
  scopeId: string;
  transferClass: "inheritable" | "review_required";
};

export type EnterpriseMemoryGovernanceSeatRow = {
  seatId: string;
  title: string;
  scopes: EnterpriseMemoryGovernanceScopeRow[];
};

export type EnterpriseMemoryGovernancePanelState = {
  loading?: boolean;
  error?: string | null;
  privacyNote?: string | null;
  seats?: EnterpriseMemoryGovernanceSeatRow[];
};

function transferClassLabel(value: EnterpriseMemoryGovernanceScopeRow["transferClass"]): string {
  if (value === "inheritable") {
    return "可继承";
  }
  return "需复核";
}

/**
 * CW2-P6-02 enterprise memory governance panel — org-owned scope metadata only.
 * Never renders employee private memory content.
 */
export function renderEnterpriseMemoryGovernancePanel(
  state: EnterpriseMemoryGovernancePanelState,
): TemplateResult {
  return html`
    <section class="enterprise-card enterprise-data-capability__panel">
      <div class="edc-section-label">记忆范围治理</div>
      <div class="employee-workbench__settings-section-subtitle">
        ${
          state.privacyNote?.trim() || "仅展示岗位/组织记忆范围元数据；员工私人记忆对管理员不可见。"
        }
      </div>
      ${
        state.loading
          ? html`
              <div class="employee-workbench__settings-status-copy">正在加载记忆范围…</div>
            `
          : nothing
      }
      ${state.error ? html`<div class="callout callout--danger">${state.error}</div>` : nothing}
      ${
        !state.loading && !state.error && (state.seats?.length ?? 0) === 0
          ? html`
              <div class="employee-workbench__settings-status-copy">当前租户暂无岗位记忆范围配置。</div>
            `
          : nothing
      }
      ${(state.seats ?? []).map(
        (seat) => html`
            <div class="employee-workbench__settings-list employee-workbench__settings-list--meta" style="margin-top: 0.75rem;">
              <div class="employee-workbench__settings-row">
                <div class="employee-workbench__settings-label">岗位</div>
                <div class="employee-workbench__settings-value">${seat.title}</div>
              </div>
              ${
                seat.scopes.length === 0
                  ? html`
                      <div class="employee-workbench__settings-row">
                        <div class="employee-workbench__settings-label">范围</div>
                        <div class="employee-workbench__settings-value">无组织可见范围</div>
                      </div>
                    `
                  : seat.scopes.map(
                      (scope) => html`
                        <div class="employee-workbench__settings-row">
                          <div class="employee-workbench__settings-label">
                            ${transferClassLabel(scope.transferClass)}
                          </div>
                          <div class="employee-workbench__settings-value">${scope.scopeId}</div>
                        </div>
                      `,
                    )
              }
            </div>
          `,
      )}
    </section>
  `;
}
