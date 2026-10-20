/**
 * 候选能力卡片（CandidateCard）— 含雷达图
 *
 * 展示候选池中单个能力的核心信息：
 * - 能力名称（可点击跳转至能力详情页）
 * - 当前成熟度、近 30 天调用次数、覆盖机器人数、成功率
 * - 四维度雷达图（复用广度、效果稳定性、业务覆盖度、员工满意度）
 * - 综合分数值
 *
 * 雷达图使用内联 SVG 实现，polygon 绘制评分形状。
 *
 * 验证需求：1.3, 2.1, 2.4, 14.2
 *
 * @module candidate-card
 */

import { html, type TemplateResult } from "lit";
import type { CandidateCapability } from "../../controllers/enterprise-incubation/candidate-pool.ts";
import type { IncubationScore } from "../../controllers/enterprise-incubation/incubation-score.ts";
import {
  INCUBATION_CARD,
  INCUBATION_BTN_PRIMARY,
  INCUBATION_FLEX_BETWEEN,
  INCUBATION_TEXT_LINK,
  INCUBATION_TEXT_MUTED,
  INCUBATION_TEXT_STRONG,
} from "./shared/styles.css.ts";

export type CandidateCardProps = {
  candidate: CandidateCapability;
  onNavigateToDetail: (capabilityId: string) => void;
  promotionState?: "idle" | "submitting" | "submitted" | "error";
  promotionMessage?: string | null;
  onRecommendUpload?: (capabilityId: string) => void;
};

// ─── 雷达图常量 ─────────────────────────────────────────────────────────────

/** 雷达图 SVG 视口尺寸 */
const RADAR_SIZE = 160;
/** 雷达图中心坐标 */
const RADAR_CENTER = RADAR_SIZE / 2;
/** 雷达图最大半径 */
const RADAR_RADIUS = 60;
/** 雷达图维度标签 */
const RADAR_LABELS = ["复用广度", "效果稳定性", "业务覆盖度", "员工满意度"] as const;
/** 雷达图维度数量 */
const RADAR_AXES = RADAR_LABELS.length;
/** 每个轴的角度偏移（从顶部开始，顺时针） */
const ANGLE_OFFSET = -Math.PI / 2;

/**
 * 计算雷达图上某个轴、某个比例值对应的坐标点。
 * @param axisIndex 轴索引 (0-3)
 * @param ratio 比例值 (0-1)
 */
function radarPoint(axisIndex: number, ratio: number): { x: number; y: number } {
  const angle = ANGLE_OFFSET + (2 * Math.PI * axisIndex) / RADAR_AXES;
  return {
    x: RADAR_CENTER + RADAR_RADIUS * ratio * Math.cos(angle),
    y: RADAR_CENTER + RADAR_RADIUS * ratio * Math.sin(angle),
  };
}

/**
 * 生成雷达图多边形的 points 属性字符串。
 */
function radarPolygonPoints(values: number[]): string {
  return values
    .map((v, i) => {
      const ratio = Math.max(0, Math.min(1, v / 100));
      const { x, y } = radarPoint(i, ratio);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/**
 * 生成雷达图背景网格（同心多边形）的 points 属性字符串。
 */
function radarGridPoints(level: number, levels: number): string {
  const ratio = (level + 1) / levels;
  return Array.from({ length: RADAR_AXES }, (_, i) => {
    const { x, y } = radarPoint(i, ratio);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

/**
 * 渲染四维度雷达图（SVG）。
 * 当 score 为 null 时展示空白占位。
 */
function renderRadarChart(score: IncubationScore | null): TemplateResult {
  if (!score) {
    return html`
      <div class="enterprise-incubation-radar enterprise-incubation-radar--empty">
        <svg
          width="${RADAR_SIZE}"
          height="${RADAR_SIZE}"
          viewBox="0 0 ${RADAR_SIZE} ${RADAR_SIZE}"
          role="img"
          aria-label="孵化评分雷达图：暂无数据"
        >
          ${renderRadarGrid()}
          ${renderRadarAxes()}
        </svg>
        <p class="${INCUBATION_TEXT_MUTED}" style="text-align:center;margin-top:4px">暂无评分数据</p>
      </div>
    `;
  }

  const values = [
    score.reuseBreath.value,
    score.effectStability.value,
    score.businessCoverage.value,
    score.employeeSatisfaction.available ? score.employeeSatisfaction.value : 0,
  ];

  const ariaDescription = RADAR_LABELS.map((label, i) => {
    if (i === 3 && !score.employeeSatisfaction.available) {
      return `${label}：数据不足`;
    }
    return `${label}：${values[i]}分`;
  }).join("，");

  return html`
    <div class="enterprise-incubation-radar">
      <svg
        width="${RADAR_SIZE}"
        height="${RADAR_SIZE}"
        viewBox="0 0 ${RADAR_SIZE} ${RADAR_SIZE}"
        role="img"
        aria-label="孵化评分雷达图"
        aria-description="${ariaDescription}"
      >
        ${renderRadarGrid()}
        ${renderRadarAxes()}
        ${renderRadarLabels(score)}
        <polygon
          points="${radarPolygonPoints(values)}"
          fill="rgba(37, 99, 235, 0.2)"
          stroke="#2563eb"
          stroke-width="1.5"
        />
        ${renderRadarDots(values)}
      </svg>
    </div>
  `;
}

/**
 * 渲染雷达图背景网格（3 层同心多边形）。
 */
function renderRadarGrid(): TemplateResult {
  const levels = 3;
  return html`
    ${Array.from(
      { length: levels },
      (_, i) => html`
      <polygon
        points="${radarGridPoints(i, levels)}"
        fill="none"
        stroke="#e5e7eb"
        stroke-width="0.5"
      />
    `,
    )}
  `;
}

/**
 * 渲染雷达图轴线（从中心到各顶点）。
 */
function renderRadarAxes(): TemplateResult {
  return html`
    ${Array.from({ length: RADAR_AXES }, (_, i) => {
      const { x, y } = radarPoint(i, 1);
      return html`
        <line
          x1="${RADAR_CENTER}"
          y1="${RADAR_CENTER}"
          x2="${x.toFixed(1)}"
          y2="${y.toFixed(1)}"
          stroke="#e5e7eb"
          stroke-width="0.5"
        />
      `;
    })}
  `;
}

/**
 * 渲染雷达图维度标签。
 */
function renderRadarLabels(score: IncubationScore): TemplateResult {
  const labelOffset = 14;
  return html`
    ${RADAR_LABELS.map((label, i) => {
      const { x, y } = radarPoint(i, 1);
      // 根据位置调整文本锚点
      let textAnchor = "middle";
      let dx = 0;
      let dy = 0;
      if (i === 0) {
        dy = -labelOffset;
      } else if (i === 1) {
        dx = labelOffset;
        textAnchor = "start";
      } else if (i === 2) {
        dy = labelOffset + 4;
      } else if (i === 3) {
        dx = -labelOffset;
        textAnchor = "end";
      }

      const isUnavailable = i === 3 && !score.employeeSatisfaction.available;
      const fillColor = isUnavailable ? "#9ca3af" : "#6b7280";

      return html`
        <text
          x="${(x + dx).toFixed(1)}"
          y="${(y + dy).toFixed(1)}"
          text-anchor="${textAnchor}"
          font-size="10"
          fill="${fillColor}"
          dominant-baseline="middle"
        >${label}${isUnavailable ? "(不足)" : ""}</text>
      `;
    })}
  `;
}

/**
 * 渲染雷达图数据点（圆点）。
 */
function renderRadarDots(values: number[]): TemplateResult {
  return html`
    ${values.map((v, i) => {
      const ratio = Math.max(0, Math.min(1, v / 100));
      const { x, y } = radarPoint(i, ratio);
      return html`
        <circle
          cx="${x.toFixed(1)}"
          cy="${y.toFixed(1)}"
          r="3"
          fill="#2563eb"
          stroke="#fff"
          stroke-width="1"
        />
      `;
    })}
  `;
}

/**
 * 格式化成功率为百分比字符串。
 */
function formatSuccessRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * 渲染候选能力卡片。
 *
 * 包含：
 * - 能力名称（可点击跳转至详情页，满足 Requirement 14.2）
 * - 成熟度、调用次数、覆盖机器人数、成功率
 * - 四维度雷达图（满足 Requirement 2.4）
 * - 综合分数值
 *
 * 验证需求：1.3, 2.1, 2.4, 14.2
 */
export function renderCandidateCard(props: CandidateCardProps): TemplateResult {
  const { candidate, onNavigateToDetail } = props;
  const promotionState = props.promotionState ?? "idle";
  const canRecommend =
    Boolean(props.onRecommendUpload) &&
    promotionState !== "submitted" &&
    promotionState !== "submitting";

  return html`
    <article class="${INCUBATION_CARD}" aria-label="候选能力：${candidate.name}">
      <!-- 卡片头部：能力名称（可点击跳转） -->
      <header class="${INCUBATION_FLEX_BETWEEN}" style="margin-bottom:12px">
        <a
          class="${INCUBATION_TEXT_LINK}"
          style="font-size:15px;font-weight:600"
          href="#"
          @click=${(e: Event) => {
            e.preventDefault();
            onNavigateToDetail(candidate.capabilityId);
          }}
        >${candidate.name}</a>
        <span
          class="enterprise-status-badge enterprise-status-badge--info"
        >${candidate.maturity}</span>
      </header>

      <!-- 指标摘要 -->
      <div class="enterprise-incubation-card__metrics">
        <div>
          <p class="${INCUBATION_TEXT_MUTED}">30天调用</p>
          <p class="${INCUBATION_TEXT_STRONG}">${candidate.calls30d}</p>
        </div>
        <div>
          <p class="${INCUBATION_TEXT_MUTED}">覆盖机器人</p>
          <p class="${INCUBATION_TEXT_STRONG}">${candidate.departmentCount}</p>
        </div>
        <div>
          <p class="${INCUBATION_TEXT_MUTED}">成功率</p>
          <p class="${INCUBATION_TEXT_STRONG}">${formatSuccessRate(candidate.successRate)}</p>
        </div>
      </div>

      <!-- 雷达图 -->
      <div style="display:flex;justify-content:center;margin-bottom:8px">
        ${renderRadarChart(candidate.score)}
      </div>

      <!-- 综合分 -->
      <div class="enterprise-incubation-card__score">
        <span class="${INCUBATION_TEXT_MUTED}">综合分</span>
        <span
          class="enterprise-incubation-card__score-value"
        >${candidate.score?.compositeScore ?? "—"}</span>
      </div>

      <footer class="enterprise-incubation-card__footer">
        <button
          type="button"
          class="${INCUBATION_BTN_PRIMARY}"
          ?disabled=${!canRecommend}
          @click=${() => props.onRecommendUpload?.(candidate.capabilityId)}
          aria-label="推荐 ${candidate.name} 上报平台"
        >
          ${
            promotionState === "submitting"
              ? "上报中…"
              : promotionState === "submitted"
                ? "已推荐上报"
                : "推荐上报平台"
          }
        </button>
        ${
          props.promotionMessage
            ? html`
              <p
                class="${
                  promotionState === "error"
                    ? "enterprise-incubation-feedback enterprise-incubation-feedback--error"
                    : "enterprise-incubation-feedback enterprise-incubation-feedback--success"
                }"
                role="${promotionState === "error" ? "alert" : "status"}"
              >
                ${props.promotionMessage}
              </p>
            `
            : ""
        }
      </footer>
    </article>
  `;
}
