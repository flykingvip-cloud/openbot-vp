/**
 * 数据产品新建/编辑向导模态框（从 surface 迁出）。
 */

import { html, type TemplateResult } from "lit";
import type {
  ManagedConnectorActionRecord,
  ManagedDataSourceRecord,
} from "../../../../capability/enterprise-data-capability/types.ts";
import { renderIcon } from "../../../../icons.ts";
import { renderOrgTargetPicker } from "../../../../views/enterprise-data-capability/org-target-picker.ts";
import type { EnterprisePortReadModel } from "../../semantic/enterprise-read-model.ts";
import {
  clampProductWizardStep,
  PRODUCT_WIZARD_STEPS,
  validateProductWizardStep,
  type ProductWizardStep,
} from "./product-wizard.ts";

export type CapabilityEditorState = {
  open: boolean;
  wizardStep: ProductWizardStep;
  outputMode: "direct" | "projection";
  projectionTemplateKey: string;
  capabilityId: string | null;
  capabilityKey: string;
  displayName: string;
  description: string;
  sourceIds: Set<string>;
  actionRefTokens: Set<string>;
  enabled: boolean;
  busy: boolean;
  error: string | null;
};

function formatDataSourceCategory(category: string): string {
  const labels: Record<string, string> = {
    crm: "CRM",
    erp: "ERP",
    finance: "财务",
    oa: "OA",
    mes: "MES",
    external: "外部",
    marketing: "营销",
    support: "客服",
    analytics: "分析",
    other: "其他",
  };
  return labels[category] ?? category;
}

export function renderCapabilityEditorModal(
  state: CapabilityEditorState,
  sourceOptions: ManagedDataSourceRecord[],
  actionsCatalog: ManagedConnectorActionRecord[],
  ctx: {
    seatCount: number;
    readModel: EnterprisePortReadModel;
    seatIds: ReadonlySet<string>;
    departmentPaths: ReadonlySet<string>;
    seatQuery: string;
    onToggleSeat: (seatId: string) => void;
    onToggleDepartment: (path: string) => void;
    onRemoveSeat: (seatId: string) => void;
    onRemoveDepartment: (path: string) => void;
    onClearAll: () => void;
    onSeatQueryChange: (value: string) => void;
  },
  onClose: () => void,
  onSubmit: () => void,
  onUpdate: (patch: Partial<CapabilityEditorState>) => void,
  onJumpAssets: () => void,
  onJumpOrg: () => void,
): TemplateResult {
  if (!state.open) {
    return html``;
  }
  const isCreate = !state.capabilityId;
  const step = isCreate ? state.wizardStep : 1;
  const draft = {
    capabilityKey: state.capabilityKey,
    displayName: state.displayName,
    description: state.description,
    sourceIds: state.sourceIds,
    actionRefTokens: state.actionRefTokens,
    outputMode: state.outputMode,
    projectionTemplateKey: state.projectionTemplateKey,
    openScopeReady: ctx.seatIds.size + ctx.departmentPaths.size > 0,
  };
  const stepValidation = isCreate
    ? validateProductWizardStep(step, draft, {
        sourceCount: sourceOptions.length,
        actionCount: actionsCatalog.length,
        seatCount: ctx.seatCount,
      })
    : { ok: true, message: null, missing: [] as Array<"sources" | "actions" | "seats"> };

  const showStep = (n: ProductWizardStep) => !isCreate || step === n;

  const goNext = () => {
    if (!isCreate) {
      return;
    }
    const current = validateProductWizardStep(state.wizardStep, draft, {
      sourceCount: sourceOptions.length,
      actionCount: actionsCatalog.length,
      seatCount: ctx.seatCount,
    });
    if (!current.ok) {
      onUpdate({ error: current.message });
      return;
    }
    onUpdate({ wizardStep: clampProductWizardStep(state.wizardStep + 1), error: null });
  };
  const goPrev = () => {
    if (!isCreate) {
      return;
    }
    onUpdate({ wizardStep: clampProductWizardStep(state.wizardStep - 1), error: null });
  };

  return html`
    <div class="enterprise-org-modal-overlay" @click=${(event: MouseEvent) => {
      if (event.target === event.currentTarget && !state.busy) {
        onClose();
      }
    }}>
      <section class="enterprise-org-modal" role="dialog" aria-modal="true" aria-label="数据产品编辑">
        <div class="enterprise-org-modal__header">
          <div>
            <div class="enterprise-org-modal__title">${isCreate ? "新建数据产品" : "编辑数据产品"}</div>
            <div class="enterprise-org-modal__sub">
              ${
                isCreate
                  ? "四步完成：业务定义 → 数据输入 → 输出定义 → 开放范围。"
                  : "调整产品标识、来源数据源与动作绑定。"
              }
            </div>
          </div>
          <button class="btn btn--sm" type="button" ?disabled=${state.busy} @click=${onClose}>关闭</button>
        </div>
        <div class="enterprise-org-modal__body">
          ${
            isCreate
              ? html`
                  <div class="edc-wizard-steps" role="list" style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;">
                    ${PRODUCT_WIZARD_STEPS.map(
                      (item) => html`
                        <span
                          role="listitem"
                          class="enterprise-mesh-badge ${item.step === step ? "enterprise-mesh-badge--ok" : "enterprise-mesh-badge--neutral"}"
                        >
                          ${item.step}. ${item.title}
                        </span>
                      `,
                    )}
                  </div>
                `
              : html``
          }

          ${
            showStep(1)
              ? html`
          <div class="edc-form-section">
            <div class="edc-form-section__title">业务定义</div>
            <div class="form-grid">
              <label class="field">
                <span>产品标识 (Unique Key)</span>
                <input
                  .value=${state.capabilityKey}
                  placeholder="crm_customer_sync"
                  ?disabled=${state.busy}
                  @input=${(event: Event) =>
                    onUpdate({ capabilityKey: (event.target as HTMLInputElement).value })}
                />
              </label>
              <label class="field">
                <span>显示名称</span>
                <input
                  .value=${state.displayName}
                  placeholder="客户数据自动同步产品"
                  ?disabled=${state.busy}
                  @input=${(event: Event) =>
                    onUpdate({ displayName: (event.target as HTMLInputElement).value })}
                />
              </label>
              <label class="field full">
                <span>描述</span>
                <textarea
                  class="enterprise-org-modal__textarea"
                  .value=${state.description}
                  placeholder="请输入该数据产品的业务边界及作用…"
                  ?disabled=${state.busy}
                  @input=${(event: Event) =>
                    onUpdate({ description: (event.target as HTMLTextAreaElement).value })}
                ></textarea>
              </label>
            </div>
          </div>
          `
              : html``
          }

          ${
            showStep(2)
              ? html`
          <div class="edc-form-section">
            <div class="edc-form-section__title">数据输入</div>
            <div class="edc-form-section__sub">勾选已连接的数据源与可调用动作。</div>
            ${
              sourceOptions.length === 0
                ? html`
                    <div class="edc-pick-empty">
                      暂无已连接的数据源。
                      <button class="btn btn--sm" type="button" @click=${onJumpAssets}>前往数据资产</button>
                    </div>
                  `
                : html`<div class="edc-pick-list" role="group" aria-label="来源数据源">
                    ${sourceOptions.map((source) => {
                      const checked = state.sourceIds.has(source.sourceId);
                      return html`
                        <label class="edc-pick-row ${checked ? "is-checked" : ""}">
                          <input
                            type="checkbox"
                            class="edc-pick-row__checkbox"
                            .checked=${checked}
                            ?disabled=${state.busy}
                            @change=${() => {
                              const next = new Set(state.sourceIds);
                              if (next.has(source.sourceId)) {
                                next.delete(source.sourceId);
                              } else {
                                next.add(source.sourceId);
                              }
                              onUpdate({ sourceIds: next });
                            }}
                          />
                          ${renderIcon("link", "edc-pick-row__icon")}
                          <span class="edc-pick-row__body">
                            <span class="edc-pick-row__label">${source.displayName}</span>
                            <span class="edc-pick-row__meta">
                              ${formatDataSourceCategory(source.category)} · ${source.connectorId}
                            </span>
                          </span>
                        </label>
                      `;
                    })}
                  </div>`
            }
            ${
              actionsCatalog.length === 0
                ? html`
                    <div class="edc-pick-empty" style="margin-top:0.75rem;">
                      暂无可用动作。请先在数据资产中完成连接器接入。
                      <button class="btn btn--sm" type="button" @click=${onJumpAssets}>前往数据资产</button>
                    </div>
                  `
                : html`<div class="edc-pick-list" role="group" aria-label="动作能力绑定" style="margin-top:0.75rem;">
                    ${actionsCatalog.map((action) => {
                      const token = `${action.connectorId}:${action.actionKey}:${action.version}`;
                      const checked = state.actionRefTokens.has(token);
                      return html`
                        <label class="edc-pick-row ${checked ? "is-checked" : ""}">
                          <input
                            type="checkbox"
                            class="edc-pick-row__checkbox"
                            .checked=${checked}
                            ?disabled=${state.busy}
                            @change=${() => {
                              const next = new Set(state.actionRefTokens);
                              if (next.has(token)) {
                                next.delete(token);
                              } else {
                                next.add(token);
                              }
                              onUpdate({ actionRefTokens: next });
                            }}
                          />
                          ${renderIcon("zap", "edc-pick-row__icon")}
                          <span class="edc-pick-row__body">
                            <span class="edc-pick-row__label">${action.displayName}</span>
                            <span class="edc-pick-row__meta">
                              ${action.actionKey}:${action.version}
                            </span>
                          </span>
                        </label>
                      `;
                    })}
                  </div>`
            }
          </div>
          `
              : html``
          }

          ${
            showStep(3)
              ? html`
          <div class="edc-form-section">
            <div class="edc-form-section__title">输出定义</div>
            <div class="edc-form-section__sub">选择是否写成知识供给。不作物化时，知识宇宙没有可消费内容；员工执行仍走受治理的企业数据调用。</div>
            <div class="form-grid">
              <label class="field">
                <span>输出方式</span>
                <select
                  .value=${state.outputMode}
                  ?disabled=${state.busy}
                  @change=${(event: Event) =>
                    onUpdate({
                      outputMode: (event.target as HTMLSelectElement)
                        .value as CapabilityEditorState["outputMode"],
                    })}
                >
                  <option value="direct">仅登记能力</option>
                  <option value="projection">投影物化并供给知识宇宙</option>
                </select>
                ${
                  state.outputMode === "direct"
                    ? html`
                        <small>不会创建投影和供给记录。知识宇宙里该能力会显示为未供给。</small>
                      `
                    : html``
                }
              </label>
              ${
                state.outputMode === "projection"
                  ? html`
                      <label class="field">
                        <span>投影模板</span>
                        <select
                          .value=${state.projectionTemplateKey}
                          ?disabled=${state.busy}
                          @change=${(event: Event) =>
                            onUpdate({
                              projectionTemplateKey: (event.target as HTMLSelectElement).value,
                            })}
                        >
                          <option value="">请选择模板</option>
                          <option value="NormalizeTemplate">规范化 Normalize</option>
                          <option value="AggregateTemplate">聚合 Aggregate</option>
                          <option value="TrendTemplate">趋势 Trend</option>
                          <option value="RiskDetectionTemplate">风险检测 RiskDetection</option>
                          <option value="ForecastTemplate">预测 Forecast</option>
                        </select>
                        <small>创建后绑定为手动物化。需要在「输出与物化」点击「立即物化」，知识宇宙才会出现供给记录。</small>
                      </label>
                    `
                  : html``
              }
            </div>
          </div>
          `
              : html``
          }

          ${
            showStep(4) || !isCreate
              ? html`
          <div class="edc-form-section">
            <div class="edc-form-section__title">${isCreate ? "开放范围" : "启用状态"}</div>
            ${
              isCreate
                ? html`
                    <div class="enterprise-page__subtitle">
                      勾选岗位/部门；运行时以 seat 为执行粒度。创建时将立即授权所选目标。
                    </div>
                    ${
                      ctx.seatCount === 0
                        ? html`
                            <div class="edc-pick-empty">
                              当前租户暂无岗位。
                              <button class="btn btn--sm" type="button" @click=${onJumpOrg}>前往组织管理</button>
                            </div>
                          `
                        : renderOrgTargetPicker({
                            readModel: ctx.readModel,
                            query: ctx.seatQuery,
                            selectedSeatIds: ctx.seatIds,
                            selectedDepartmentPaths: ctx.departmentPaths,
                            disabled: state.busy,
                            hint: "勾选岗位可多选；勾选部门将授权给该部门（含子部门）全部岗位。",
                            onQueryChange: ctx.onSeatQueryChange,
                            onToggleSeat: ctx.onToggleSeat,
                            onToggleDepartment: ctx.onToggleDepartment,
                            onRemoveSeat: ctx.onRemoveSeat,
                            onRemoveDepartment: ctx.onRemoveDepartment,
                            onClearAll: ctx.onClearAll,
                          })
                    }
                  `
                : html``
            }
            <label class="field checkbox full">
              <input
                type="checkbox"
                .checked=${state.enabled}
                ?disabled=${state.busy}
                @change=${(event: Event) =>
                  onUpdate({ enabled: (event.target as HTMLInputElement).checked })}
              />
              <span>启用该数据产品</span>
            </label>
          </div>
          `
              : html``
          }

          ${
            state.error
              ? html`<div class="enterprise-org-modal__notice enterprise-org-modal__notice--danger">${state.error}</div>`
              : stepValidation.message && isCreate
                ? html`<div class="enterprise-org-modal__notice enterprise-org-modal__notice--danger">${stepValidation.message}</div>`
                : html``
          }
        </div>
        <div class="enterprise-org-modal__footer">
          <button class="btn" type="button" ?disabled=${state.busy} @click=${onClose}>取消</button>
          ${
            isCreate && step > 1
              ? html`<button class="btn" type="button" ?disabled=${state.busy} @click=${goPrev}>上一步</button>`
              : html``
          }
          ${
            isCreate && step < 4
              ? html`<button class="btn btn--primary" type="button" ?disabled=${state.busy} @click=${goNext}>下一步</button>`
              : html`
                  <button class="btn btn--primary" type="button" ?disabled=${state.busy} @click=${onSubmit}>
                    ${state.busy ? "保存中..." : isCreate ? "创建产品" : "保存产品"}
                  </button>
                `
          }
        </div>
      </section>
    </div>
  `;
}
