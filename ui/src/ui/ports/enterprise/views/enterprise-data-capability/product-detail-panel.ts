/**
 * 数据产品详情 — 六个业务区段（概览 / 输入 / 输出 / 开放 / 运行 / 血缘）。
 */

import { html, type TemplateResult } from "lit";
import type { ManagedCapabilityGovernanceView } from "../../../../capability/enterprise-data-capability/types.ts";
import { renderOrgTargetPicker } from "../../../../views/enterprise-data-capability/org-target-picker.ts";
import type { EnterprisePortReadModel } from "../../semantic/enterprise-read-model.ts";

const LIFECYCLE_LABEL: Record<string, string> = {
  draft: "草稿",
  active: "使用中",
  deprecated: "已弃用",
  frozen: "已冻结",
};

export type ProductDetailPanelProps = {
  detail: ManagedCapabilityGovernanceView;
  readModel: EnterprisePortReadModel;
  seatQuery: string;
  selectedSeatIds: ReadonlySet<string>;
  selectedDepartmentPaths: ReadonlySet<string>;
  grantBusy: boolean;
  grantNotice: string | null;
  /** 列表侧物化失败计数（可选）。 */
  materializationFailureCount?: number | null;
  onGrantSeat: () => void | Promise<void>;
  onToggleSeat: (seatId: string) => void;
  onSelectDepartment: (departmentPath: string) => void;
  onRemoveSeat: (seatId: string) => void;
  onClearDepartment: (departmentPath: string) => void;
  onClearAll: () => void;
  onQueryChange: (value: string) => void;
  onOpenAudit?: () => void;
  onOpenOutputs?: () => void;
};

export function renderProductDetailPanel(props: ProductDetailPanelProps): TemplateResult {
  const { detail } = props;
  const capability = detail.capability;
  const targetCount = props.selectedSeatIds.size + props.selectedDepartmentPaths.size;
  const health = detail.supplyHealth;
  const activeGrants = detail.accessScope.activeGrants.filter((grant) => !grant.revokedAt);
  const recentRuns = detail.projectionSpecs.slice(0, 5);

  return html`
    <section class="enterprise-card enterprise-data-capability__panel">
      <div class="enterprise-data-capability__panel-title">产品详情</div>
      <div class="enterprise-data-capability__hint">
        ${capability.displayName} · ${capability.capabilityKey}
      </div>

      <div class="edc-form-section">
        <div class="edc-form-section__title">概览</div>
        <div class="enterprise-data-capability__hint">
          状态：${capability.enabled ? "启用" : "停用"} · 投影 ${health.projectionCount} · 绑定
          ${health.bindingCount} · 有效授权 ${health.activeGrantCount} · 策略
          ${health.enabledPolicyCount}
        </div>
        ${
          capability.description
            ? html`<div class="enterprise-data-capability__hint">${capability.description}</div>`
            : html``
        }
      </div>

      <div class="edc-form-section">
        <div class="edc-form-section__title">数据输入</div>
        <div class="enterprise-data-capability__hint">
          数据源：${detail.sourceMappings.map((item) => item.source.displayName).join(" / ") || "—"}
        </div>
        <div class="enterprise-data-capability__hint">
          动作：${
            detail.actionMappings
              .map((item) => `${item.ref.connectorId}:${item.ref.actionKey}:${item.ref.version}`)
              .join(" / ") || "—"
          }
        </div>
      </div>

      <div class="edc-form-section">
        <div class="edc-form-section__title">输出与物化</div>
        ${
          detail.projectionSpecs.length === 0
            ? html`
                <div class="enterprise-data-capability__hint">
                  尚未绑定投影物化。知识宇宙目前没有该产品的供给记录。
                  ${
                    props.onOpenOutputs
                      ? html`<button class="btn btn--sm" type="button" @click=${props.onOpenOutputs}>
                          前往输出与物化
                        </button>`
                      : html``
                  }
                </div>
              `
            : html`
                <ul class="enterprise-settings-row-list">
                  ${detail.projectionSpecs.map(
                    (spec) => html`
                      <li class="enterprise-settings-row">
                        <div>
                          <strong>${spec.displayName}</strong>
                          <span>${LIFECYCLE_LABEL[spec.lifecycle] ?? spec.lifecycle}</span>
                        </div>
                      </li>
                    `,
                  )}
                </ul>
              `
        }
      </div>

      <div class="edc-form-section">
        <div class="edc-form-section__title">开放范围</div>
        <div class="edc-cell-sub">当前有效授权 ${activeGrants.length} 条</div>
        ${renderOrgTargetPicker({
          readModel: props.readModel,
          query: props.seatQuery,
          selectedSeatIds: props.selectedSeatIds,
          selectedDepartmentPaths: props.selectedDepartmentPaths,
          disabled: props.grantBusy,
          hint: "勾选岗位可多选；勾选部门将授权给该部门（含子部门）全部岗位。",
          onQueryChange: props.onQueryChange,
          onToggleSeat: props.onToggleSeat,
          onToggleDepartment: props.onSelectDepartment,
          onRemoveSeat: props.onRemoveSeat,
          onRemoveDepartment: props.onClearDepartment,
          onClearAll: props.onClearAll,
        })}
        <div class="enterprise-data-capability__actions">
          <button
            class="btn btn--sm btn--primary"
            type="button"
            ?disabled=${props.grantBusy || targetCount === 0}
            @click=${() => void props.onGrantSeat()}
          >
            ${
              props.grantBusy
                ? "授权中…"
                : targetCount > 0
                  ? `开放给 ${targetCount} 个目标`
                  : "开放给岗位"
            }
          </button>
        </div>
        ${
          props.grantNotice
            ? html`<div class="enterprise-org-modal__notice enterprise-org-modal__notice--ok">
                ${props.grantNotice}
              </div>`
            : html``
        }
      </div>

      <div class="edc-form-section">
        <div class="edc-form-section__title">运行记录</div>
        <div class="enterprise-data-capability__hint">
          供给健康：投影 ${health.projectionCount} · 绑定 ${health.bindingCount} · 有效授权
          ${health.activeGrantCount}
          ${
            typeof props.materializationFailureCount === "number"
              ? html` · 近期物化失败 ${props.materializationFailureCount}`
              : html``
          }
        </div>
        ${
          recentRuns.length === 0
            ? html`
                <div class="enterprise-data-capability__hint">
                  暂无关联投影规格；可在「输出与物化」配置后于此处查看运行态摘要。
                  ${
                    props.onOpenOutputs
                      ? html`<button class="btn btn--sm" type="button" @click=${props.onOpenOutputs}>
                          前往输出与物化
                        </button>`
                      : html``
                  }
                </div>
              `
            : html`
                <ul class="enterprise-settings-row-list">
                  ${recentRuns.map(
                    (spec) => html`
                      <li class="enterprise-settings-row">
                        <div>
                          <strong>${spec.displayName}</strong>
                          <span>运行态 ${LIFECYCLE_LABEL[spec.lifecycle] ?? spec.lifecycle}</span>
                        </div>
                      </li>
                    `,
                  )}
                </ul>
              `
        }
        ${
          typeof props.materializationFailureCount === "number" &&
          props.materializationFailureCount > 0
            ? html`<div class="enterprise-data-capability__hint edc-stat-danger">
                近期物化失败 ${props.materializationFailureCount} 次 — 详见「血缘与审计」
              </div>`
            : html``
        }
      </div>

      <div class="edc-form-section">
        <div class="edc-form-section__title">血缘与审计</div>
        <div class="enterprise-data-capability__hint">
          策略 ${detail.accessScope.policies.length} · 有效授权 ${activeGrants.length} · 投影规格
          ${detail.projectionSpecs.length}
        </div>
        ${
          detail.accessScope.policies.length > 0
            ? html`
                <ul class="enterprise-settings-row-list">
                  ${detail.accessScope.policies.slice(0, 5).map(
                    (policy) => html`
                      <li class="enterprise-settings-row">
                        <div>
                          <strong>${policy.displayName}</strong>
                          <span>${policy.targetKind}：${policy.targetId}</span>
                        </div>
                      </li>
                    `,
                  )}
                </ul>
              `
            : html`
                <div class="enterprise-data-capability__hint">暂无关联访问策略。</div>
              `
        }
        ${
          props.onOpenAudit
            ? html`<button class="btn btn--sm" type="button" @click=${props.onOpenAudit}>
                打开审计血缘
              </button>`
            : html``
        }
      </div>
    </section>
  `;
}
