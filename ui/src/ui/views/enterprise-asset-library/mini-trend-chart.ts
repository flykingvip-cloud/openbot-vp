import { html, type TemplateResult } from "lit";

/**
 * 迷你趋势图组件属性。
 *
 * 在企业能力中心的能力资产列表"企业复用数据"列内嵌渲染：
 * 上半部分为近 30 天使用量折线，下半部分为环比增长百分比文本。
 *
 * 验证需求：
 * - 7.3：以业务语言（趋势 + 增长百分比）展示复用价值，禁止裸数字
 * - 7.4：在列表中可视化呈现 EnterpriseReuseData 的 trend30Days 与 growthPercentage 两个维度
 */
export type MiniTrendChartProps = {
  /** 近 30 天每日使用量；典型长度为 30，长度可变。 */
  trend: number[];
  /** 环比增长百分比，允许负值；0 表示"持平"。 */
  growthPercentage: number;
  /** 折线图宽度（像素），默认 80。 */
  width?: number;
  /** 折线图高度（像素），默认 24。 */
  height?: number;
};

/** 默认折线图尺寸（保持紧凑，可在表格行内不破坏行高）。 */
const DEFAULT_WIDTH = 80;
const DEFAULT_HEIGHT = 24;

/** 描边颜色与文本颜色 token —— 与企业管理后台白底蓝色主题保持一致。 */
const COLOR_POSITIVE = "#10B981"; // 绿
const COLOR_NEGATIVE = "#EF4444"; // 红
const COLOR_NEUTRAL = "#9CA3AF"; // 灰

/** 描边粗细：在 24px 高度下保持线条清晰但不抢占视觉。 */
const STROKE_WIDTH = 1.5;

/** 折线 SVG 上下方向的留白，防止线条贴边裁切。 */
const VERTICAL_PADDING = 2;

/**
 * 根据增长百分比选择颜色：正数→绿，负数→红，零→灰。
 * 同一颜色同时用于折线描边与下方百分比文本，保持视觉对应。
 */
function resolveColor(growthPercentage: number): string {
  if (growthPercentage > 0) {
    return COLOR_POSITIVE;
  }
  if (growthPercentage < 0) {
    return COLOR_NEGATIVE;
  }
  return COLOR_NEUTRAL;
}

/**
 * 将 `trend` 序列映射为 SVG `<polyline>` 的 points 字符串。
 * - 当所有点相同（min === max）时，将折线居中于绘图区域，避免除零并保留视觉提示
 * - 当只有一个点时，折线退化为水平线段
 */
function buildPolylinePoints(trend: number[], width: number, height: number): string {
  const drawableHeight = Math.max(0, height - VERTICAL_PADDING * 2);

  if (trend.length === 0) {
    return "";
  }

  if (trend.length === 1) {
    const y = VERTICAL_PADDING + drawableHeight / 2;
    return `0,${y} ${width},${y}`;
  }

  const min = Math.min(...trend);
  const max = Math.max(...trend);
  const range = max - min;
  const stepX = width / (trend.length - 1);

  return trend
    .map((value, index) => {
      const x = index * stepX;
      // 当数据无波动时居中绘制；否则按比例从底向上映射（值越大 y 越小）
      const normalized = range === 0 ? 0.5 : (value - min) / range;
      const y = VERTICAL_PADDING + drawableHeight * (1 - normalized);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

/**
 * 格式化增长百分比为业务语言文本：
 * - 正数：`+12%` 配合 ↑
 * - 负数：`-5%`  配合 ↓
 * - 零：  `持平` 不带箭头
 *
 * 数值保留至整数百分点，与 `EnterpriseReuseData.growthPercentage` 的数据精度一致。
 */
function renderGrowthLabel(growthPercentage: number): TemplateResult {
  if (growthPercentage === 0) {
    return html`
      <span class="mini-trend-chart__growth mini-trend-chart__growth--neutral">持平</span>
    `;
  }

  const rounded = Math.round(growthPercentage);
  const sign = rounded > 0 ? "+" : "";
  const arrow = rounded > 0 ? "↑" : "↓";
  const direction = rounded > 0 ? "positive" : "negative";

  return html`
    <span class="mini-trend-chart__growth mini-trend-chart__growth--${direction}">
      <span class="mini-trend-chart__arrow" aria-hidden="true">${arrow}</span>
      <span class="mini-trend-chart__growth-value">${sign}${rounded}%</span>
    </span>
  `;
}

/**
 * 渲染 MiniTrendChart —— 企业能力中心列表行内的紧凑趋势图组件。
 *
 * 行为：
 * - 从 `trend` 中计算 min/max，按比例映射到 SVG viewBox
 * - 描边颜色与下方百分比颜色按 `growthPercentage` 正负零分别取绿/红/灰
 * - `trend` 为空数组或全零时，回退为"暂无使用数据"占位文本（对应 EnterpriseReuseData 无运行记录场景）
 * - SVG 标注 `role="img"` 与 `aria-label="近30天使用趋势"`，保证读屏可读
 *
 * 验证需求：7.3 / 7.4
 */
export function renderMiniTrendChart(props: MiniTrendChartProps): TemplateResult {
  const width = props.width ?? DEFAULT_WIDTH;
  const height = props.height ?? DEFAULT_HEIGHT;

  // 空数组或全零序列：视为无运行数据，展示业务语言占位
  const hasData = props.trend.length > 0 && props.trend.some((value) => value !== 0);
  if (!hasData) {
    return html`
      <span class="mini-trend-chart mini-trend-chart--empty">
        <span class="mini-trend-chart__placeholder">暂无使用数据</span>
      </span>
    `;
  }

  const color = resolveColor(props.growthPercentage);
  const points = buildPolylinePoints(props.trend, width, height);

  return html`
    <span class="mini-trend-chart">
      <svg
        class="mini-trend-chart__svg"
        role="img"
        aria-label="近30天使用趋势"
        viewBox="0 0 ${width} ${height}"
        width="${width}"
        height="${height}"
        preserveAspectRatio="none"
      >
        <polyline
          class="mini-trend-chart__line"
          fill="none"
          stroke="${color}"
          stroke-width="${STROKE_WIDTH}"
          stroke-linecap="round"
          stroke-linejoin="round"
          points="${points}"
        ></polyline>
      </svg>
      ${renderGrowthLabel(props.growthPercentage)}
    </span>
  `;
}
