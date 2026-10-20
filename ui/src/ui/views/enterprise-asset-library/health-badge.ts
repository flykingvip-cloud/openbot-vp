/**
 * 能力健康状态徽章（HealthBadge）
 *
 * 以"颜色编码 + 业务语言文字标签"双通道呈现 {@link EnterpriseHealthStatus}，
 * 满足无障碍合规：状态信息不仅依赖颜色（需求 18.7）。当能力尚无运行时
 * 健康遥测数据（新上架或从未被调用，需求 6.7）时，附加"暂无运行数据"
 * 小注释，避免误导管理员把缺失数据当成"效果稳定"。
 *
 * 颜色映射（需求 4.7 / 6.1）：
 *   - 效果稳定           → 绿色 (#10B981)
 *   - 偶尔结果不理想     → 黄色 (#F59E0B)
 *   - 建议重新整理       → 橙色 (#EA580C)
 *   - 已不适合继续推广   → 灰色 (#6B7280)
 *
 * 视觉变体：
 *   - "inline"：紧凑型，用于列表表格单元格（小字号、低内边距）
 *   - "detail"：常规尺寸，用于详情页区段（中字号、舒适内边距）
 *
 * 样式：使用 enterprise-components.css 的 .enterprise-health-badge 类体系。
 * 颜色通过 [data-status="..."] 属性选择器应用。
 *
 * 验证需求：4.6, 6.1, 6.7, 18.7, 20.1
 */

import { html, nothing, type TemplateResult } from "lit";
import type { EnterpriseHealthStatus } from "../../capability/enterprise-capability/types.ts";

/** 健康状态徽章视觉变体 */
export type HealthBadgeVariant = "inline" | "detail";

export type HealthBadgeProps = {
  /** 能力健康状态（业务效果语言） */
  status: EnterpriseHealthStatus;
  /** 为 true 时表示尚无运行时健康遥测数据（新上架或从未被调用） */
  noTelemetry?: boolean;
  /** 视觉变体；缺省为 "inline"（适配表格场景） */
  variant?: HealthBadgeVariant;
};

/**
 * 渲染 HealthBadge —— 能力健康状态徽章。
 *
 * - 始终同时输出颜色（背景）与业务语言文字标签（需求 18.7）。
 * - `noTelemetry === true` 时在主徽章右侧附加"暂无运行数据"小注释（需求 6.7）。
 * - 容器 `<span role="status">` + `aria-label="能力健康状态：…"` 使屏幕阅读器
 *   读出完整业务语义，而不是仅读"绿色"或"灰色"。
 *
 * @param props 组件属性
 * @returns Lit 模板片段
 */
export function renderEnterpriseHealthBadge(props: HealthBadgeProps): TemplateResult {
  const { status } = props;
  const variant: HealthBadgeVariant = props.variant ?? "inline";
  const noTelemetry = props.noTelemetry === true;

  return html`
    <span
      class="enterprise-health-badge enterprise-health-badge--${variant}"
      role="status"
      aria-label="能力健康状态：${status}"
    >
      <span
        class="enterprise-health-badge__main enterprise-health-badge__main--${variant}"
        data-status=${status}
      >
        <span class="enterprise-health-badge__label">${status}</span>
      </span>
      ${
        noTelemetry
          ? html`<span
            class="enterprise-health-badge__annotation enterprise-health-badge__annotation--${variant}"
            >暂无运行数据</span
          >`
          : nothing
      }
    </span>
  `;
}
