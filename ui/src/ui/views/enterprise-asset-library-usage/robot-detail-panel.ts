/**
 * Robot Detail Panel — 「机器人能力配置」子页的机器人详情弹窗（Modal Dialog）。
 *
 * 三分区：基础信息 / 已安装能力 / 能力运行统计（30 天迷你折线图）
 *
 * 严禁展示：runtime version、CPU、内存、节点 ID、Agent ID、template ID、
 * provider、model routing（Requirement 4.8）
 *
 * 弹窗结构（modal）：
 *   - 全屏遮罩（点击关闭）
 *   - 居中对话框（点击不冒泡到遮罩；ESC 关闭）
 *   - 顶部 sticky header（标题 + 关闭按钮）
 *
 * 样式说明：本模块无 Tailwind 构建链路，所有视觉样式以 `enterprise-robot-detail-*`
 * 具名 class 落在 `ui/src/styles/enterprise-usage-management.css` 中实现。
 *
 * 落实需求：Requirements 4.7, 4.8
 */

import { html, nothing, type TemplateResult } from "lit-html";
import type { RobotDetail } from "../../capability/runtime-projection/types.ts";
import {
  formatExecutions,
  formatHealthStatus,
  formatLastActiveAt,
  formatSuccessRate,
} from "./shared/format.ts";
import { USAGE_DETAIL_BACKDROP, USAGE_DETAIL_DIALOG } from "./shared/styles.css.ts";

export type RobotDetailPanelProps = {
  data: RobotDetail | null;
  loading: boolean;
  onClose: () => void;
};

function renderBasicInfo(data: RobotDetail): TemplateResult {
  return html`
    <div class="enterprise-robot-detail-section enterprise-robot-detail-basic">
      <h3 class="enterprise-robot-detail-hero">${data.robotName}</h3>
      <div class="enterprise-robot-detail-meta-grid">
        <div class="enterprise-robot-detail-meta">
          <span class="enterprise-robot-detail-meta__label">健康状态</span>
          <span class="enterprise-robot-detail-meta__value">${formatHealthStatus(data.healthStatus)}</span>
        </div>
        <div class="enterprise-robot-detail-meta">
          <span class="enterprise-robot-detail-meta__label">最近活跃</span>
          <span class="enterprise-robot-detail-meta__value">${formatLastActiveAt(data.lastActiveAt)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderCapabilityList(data: RobotDetail): TemplateResult {
  if (data.capabilities.length === 0) {
    return html`
      <div class="enterprise-robot-detail-section enterprise-robot-detail-capabilities">
        <h4 class="enterprise-robot-detail-section__title">已安装能力</h4>
        <p class="enterprise-robot-detail-empty">暂无已安装能力</p>
      </div>
    `;
  }

  return html`
    <div class="enterprise-robot-detail-section enterprise-robot-detail-capabilities">
      <h4 class="enterprise-robot-detail-section__title">已安装能力（${data.capabilities.length} 项）</h4>
      <div class="enterprise-robot-detail-cap-list">
        ${data.capabilities.map(
          (cap) => html`
            <div class="enterprise-robot-detail-cap-row">
              <span class="enterprise-robot-detail-cap-row__name">${cap.capabilityName}</span>
              <span class="enterprise-robot-detail-cap-row__metric">${formatExecutions(cap.monthlyExecutions)} 次</span>
              <span class="enterprise-robot-detail-cap-row__metric">${formatSuccessRate(cap.successRate)}</span>
            </div>
          `,
        )}
      </div>
    </div>
  `;
}

function renderUsageStats(data: RobotDetail): TemplateResult {
  return html`
    <div class="enterprise-robot-detail-section enterprise-robot-detail-stats">
      <h4 class="enterprise-robot-detail-section__title">能力运行统计</h4>
      <div class="enterprise-robot-detail-stats-grid">
        <div class="enterprise-robot-detail-substat">
          <p class="enterprise-robot-detail-substat__label">近 30 天调用趋势</p>
          <div class="enterprise-robot-detail-trend">
            ${renderMiniTrend(data.trend30d.dailyExecutions)}
          </div>
        </div>
        <div class="enterprise-robot-detail-coverage">
          <span class="enterprise-robot-detail-coverage__label">覆盖员工数</span>
          <span class="enterprise-robot-detail-coverage__value">${data.employeeCoverage}</span>
        </div>
        ${
          data.topCapabilities.length > 0
            ? html`
            <div class="enterprise-robot-detail-substat">
              <p class="enterprise-robot-detail-substat__label">Top 能力</p>
              <div class="enterprise-robot-detail-chips">
                ${data.topCapabilities.map(
                  (name) => html`<span class="enterprise-robot-detail-chip">${name}</span>`,
                )}
              </div>
            </div>
          `
            : nothing
        }
      </div>
    </div>
  `;
}

function renderMiniTrend(values: number[]): TemplateResult {
  if (values.length === 0) {
    return html`
      <span class="enterprise-robot-detail-trend__empty">暂无数据</span>
    `;
  }
  const max = Math.max(...values, 1);
  return html`
    ${values.map(
      (v) =>
        html`<div
          class="enterprise-robot-detail-trend__bar"
          style="height: ${Math.max((v / max) * 100, 2)}%"
        ></div>`,
    )}
  `;
}

function renderLoading(): TemplateResult {
  // `animate-pulse` 类名保留用于既有测试断言；视觉骨架由 enterprise-robot-detail-skeleton-* 提供。
  return html`
    <div class="enterprise-robot-detail-skeleton animate-pulse">
      <div
        class="enterprise-robot-detail-skeleton__bar enterprise-robot-detail-skeleton__bar--lg"
        style="width: 66%"
      ></div>
      <div class="enterprise-robot-detail-skeleton__bar" style="width: 50%"></div>
      <div class="enterprise-robot-detail-skeleton__bar" style="width: 75%"></div>
      <div
        class="enterprise-robot-detail-skeleton__bar enterprise-robot-detail-skeleton__bar--block"
      ></div>
    </div>
  `;
}

function handleBackdropKeydown(event: KeyboardEvent, onClose: () => void): void {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
  }
}

/**
 * 渲染机器人详情弹窗（Modal Dialog）。
 *
 * 行为：
 *   - 点击遮罩关闭
 *   - 点击对话框内部不关闭（事件不冒泡）
 *   - ESC 键关闭
 */
export function renderRobotDetailPanel(props: RobotDetailPanelProps): TemplateResult {
  const { data, loading, onClose } = props;

  return html`
    <div
      class="${USAGE_DETAIL_BACKDROP}"
      role="dialog"
      aria-modal="true"
      aria-label="机器人详情"
      tabindex="-1"
      @click=${onClose}
      @keydown=${(event: KeyboardEvent) => handleBackdropKeydown(event, onClose)}
    >
      <div
        class="${USAGE_DETAIL_DIALOG}"
        @click=${(event: Event) => event.stopPropagation()}
      >
        <div class="enterprise-robot-detail-header">
          <h2 class="enterprise-robot-detail-header__title">机器人能力详情</h2>
          <button
            class="enterprise-robot-detail-close"
            aria-label="关闭"
            @click=${onClose}
          >
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        ${loading ? renderLoading() : nothing}
        ${
          !loading && data
            ? html`
          ${renderBasicInfo(data)}
          ${renderCapabilityList(data)}
          ${renderUsageStats(data)}
        `
            : nothing
        }
        ${
          !loading && !data
            ? html`
                <div class="enterprise-robot-detail-error">加载失败，请重试</div>
              `
            : nothing
        }
      </div>
    </div>
  `;
}
