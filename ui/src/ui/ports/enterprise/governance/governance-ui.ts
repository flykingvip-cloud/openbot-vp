/**
 * Governance UI Components
 *
 * 治理配置面板和动作对话框的 UI 组件（lit-html templates）。
 */

import { html, nothing, type TemplateResult } from "lit";
import { availableActionsForLevel, actionLabel } from "./governance-actions.ts";
import type {
  GovernanceActionType,
  GovernanceConfig,
  GovernanceItem,
  GovernanceLevel,
} from "./types.ts";

// ─── 配置面板 ──────────────────────────────────────────────────────────────────

export type GovernanceConfigField = {
  key: keyof GovernanceConfig;
  label: string;
  description: string;
  unit: string;
  min: number;
  max: number;
  step: number;
};

export const GOVERNANCE_CONFIG_FIELDS: GovernanceConfigField[] = [
  {
    key: "consecutiveErrorThreshold",
    label: "连续错误次数阈值",
    description: "机器人连续错误达到此次数时触发 Critical 告警",
    unit: "次",
    min: 1,
    max: 100,
    step: 1,
  },
  {
    key: "offlineAlertHours",
    label: "离线告警时间阈值",
    description: "机器人离线超过此时长且有活跃会话时触发 Critical 告警",
    unit: "小时",
    min: 1,
    max: 168,
    step: 1,
  },
  {
    key: "zombieDays",
    label: "僵尸机器人判定天数",
    description: "机器人无活跃会话超过此天数时标记为僵尸",
    unit: "天",
    min: 7,
    max: 365,
    step: 1,
  },
  {
    key: "errorRateThreshold",
    label: "错误率告警阈值",
    description: "机器人错误率超过此值时触发 Warning 告警",
    unit: "%",
    min: 0.05,
    max: 1,
    step: 0.05,
  },
  {
    key: "costSpikeMultiplier",
    label: "成本突增倍数",
    description: "单日成本超出 7 日均值此倍数时触发 Critical 告警",
    unit: "倍",
    min: 1.5,
    max: 10,
    step: 0.5,
  },
  {
    key: "qualityDropPoints",
    label: "质量下降百分点",
    description: "成功率环比下降超过此百分点时触发 Warning 告警",
    unit: "百分点",
    min: 5,
    max: 50,
    step: 5,
  },
  {
    key: "groupZombieDays",
    label: "协作小组僵尸判定天数",
    description: "协作小组无活跃会话超过此天数时标记为僵尸",
    unit: "天",
    min: 7,
    max: 365,
    step: 1,
  },
];

export type GovernanceConfigPanelParams = {
  config: GovernanceConfig;
  onUpdate: (partial: Partial<GovernanceConfig>) => void;
  onClose?: () => void;
};

export function renderGovernanceConfigPanel(params: GovernanceConfigPanelParams): TemplateResult {
  return html`
    <section class="enterprise-mesh-governance-config" data-mesh-panel="governance-config">
      <div class="enterprise-mesh-governance-config__header">
        <h3>治理阈值配置</h3>
        ${
          params.onClose
            ? html`<button type="button" class="enterprise-mesh-governance-config__close" @click=${() => params.onClose?.()}>×</button>`
            : nothing
        }
      </div>
      <div class="enterprise-mesh-governance-config__fields">
        ${GOVERNANCE_CONFIG_FIELDS.map(
          (field) => html`
            <div class="enterprise-mesh-governance-config__field">
              <label class="enterprise-mesh-governance-config__label">
                ${field.label}
                <span class="enterprise-mesh-governance-config__unit">(${field.unit})</span>
              </label>
              <div class="enterprise-mesh-governance-config__description">
                ${field.description}
              </div>
              <input
                type="number"
                class="enterprise-mesh-governance-config__input"
                value=${formatConfigValue(params.config[field.key], field)}
                min=${field.min}
                max=${field.max}
                step=${field.step}
                @change=${(event: Event) => {
                  const input = event.target as HTMLInputElement;
                  const raw = Number(input.value);
                  const value = parseConfigValue(raw, field);
                  params.onUpdate({ [field.key]: value } as Partial<GovernanceConfig>);
                }}
              />
            </div>
          `,
        )}
      </div>
    </section>
  `;
}

function formatConfigValue(value: number, field: GovernanceConfigField): string {
  if (field.unit === "%") {
    return String(Math.round(value * 100));
  }
  return String(value);
}

function parseConfigValue(raw: number, field: GovernanceConfigField): number {
  if (field.unit === "%") {
    return raw / 100;
  }
  return raw;
}

// ─── 动作对话框 ────────────────────────────────────────────────────────────────

export type GovernanceActionDialogParams = {
  issue: GovernanceItem;
  onExecute: (actionType: GovernanceActionType, reason?: string) => void;
  onCancel: () => void;
  pending?: boolean;
  error?: string | null;
};

export function renderGovernanceActionDialog(params: GovernanceActionDialogParams): TemplateResult {
  const actions = availableActionsForLevel(params.issue.level);
  return html`
    <div class="enterprise-mesh-governance-dialog" data-mesh-panel="governance-action-dialog" role="dialog" aria-modal="true">
      <div class="enterprise-mesh-governance-dialog__backdrop" @click=${() => params.onCancel()}></div>
      <div class="enterprise-mesh-governance-dialog__content">
        <header class="enterprise-mesh-governance-dialog__header">
          <h3>处置治理项</h3>
          <button type="button" class="enterprise-mesh-governance-dialog__close" @click=${() => params.onCancel()}>×</button>
        </header>
        <div class="enterprise-mesh-governance-dialog__body">
          <div class="enterprise-mesh-governance-dialog__issue">
            <div class="enterprise-mesh-governance-dialog__title">${params.issue.title}</div>
            <div class="enterprise-mesh-governance-dialog__meta">
              <span class="enterprise-mesh-governance-dialog__level enterprise-mesh-governance-dialog__level--${params.issue.level}">
                ${levelLabel(params.issue.level)}
              </span>
              <span>${params.issue.target.name}</span>
              <span>归属: ${params.issue.target.ownership.positionLabel} / ${params.issue.target.ownership.currentManagerLabel}</span>
            </div>
            <div class="enterprise-mesh-governance-dialog__suggestion">
              建议: ${params.issue.suggestedAction}
            </div>
          </div>
          ${
            params.error
              ? html`<div class="enterprise-mesh-governance-dialog__error">${params.error}</div>`
              : nothing
          }
          <div class="enterprise-mesh-governance-dialog__actions">
            ${actions.map(
              (actionType) => html`
                <button
                  type="button"
                  class="enterprise-mesh-governance-dialog__action enterprise-mesh-governance-dialog__action--${params.issue.level}"
                  ?disabled=${params.pending}
                  @click=${() => params.onExecute(actionType)}
                >
                  ${actionLabel(actionType)}
                </button>
              `,
            )}
          </div>
        </div>
      </div>
    </div>
  `;
}

function levelLabel(level: GovernanceLevel): string {
  switch (level) {
    case "critical":
      return "待处置";
    case "warning":
      return "待复核";
    case "info":
      return "待优化";
  }
}
