/**
 * TelemetryMiniChart — Runtime Health 标签页使用的迷你趋势图组件。
 *
 * 任务 20 实现：渲染延迟（avg/p95）、吞吐量、错误率、Token 消耗等运行时指标
 * 的轻量 SVG sparkline。本组件**不**展示原始错误堆栈或 PII。
 *
 * 设计准则：
 * - 纯函数渲染：lit `html` template，输入 = telemetry 时间序列
 * - 无第三方依赖：使用原生 SVG，避免引入图表库
 * - 数值边界保护：N=0 时显示 "暂无数据"，避免空数组导致 NaN
 * - 颜色 token 与 platform-capabilities 主题对齐（is-ok / is-warn / is-danger）
 */

import { html, nothing, svg, type TemplateResult } from "lit";
import type { RuntimeTelemetry } from "../../../../capability/runtime-canonical/index.ts";

/** 支持的指标种类。每种指标都对应 telemetry 中的一个数值字段。 */
export type TelemetryMetricKind =
  | "avg-latency"
  | "p95-latency"
  | "calls"
  | "error-rate"
  | "token-consumption";

/** 指标元信息（标题 / 单位 / Tone 推导规则）。 */
const METRIC_META: Record<
  TelemetryMetricKind,
  {
    label: string;
    unit: string;
    /** 给定数值返回 tone（"ok" 越好；用于 sparkline 颜色）。 */
    toneOf: (value: number) => "ok" | "warn" | "danger" | "neutral";
  }
> = {
  "avg-latency": {
    label: "平均延迟",
    unit: "ms",
    toneOf: (v) => (v <= 1_000 ? "ok" : v <= 5_000 ? "warn" : "danger"),
  },
  "p95-latency": {
    label: "P95 延迟",
    unit: "ms",
    toneOf: (v) => (v <= 2_000 ? "ok" : v <= 10_000 ? "warn" : "danger"),
  },
  calls: {
    label: "调用数",
    unit: "",
    toneOf: () => "neutral",
  },
  "error-rate": {
    label: "错误率",
    unit: "%",
    toneOf: (v) => (v <= 5 ? "ok" : v <= 30 ? "warn" : "danger"),
  },
  "token-consumption": {
    label: "Token 消耗",
    unit: "",
    toneOf: () => "neutral",
  },
};

function extractValues(samples: RuntimeTelemetry[], kind: TelemetryMetricKind): number[] {
  return samples.map((s) => {
    switch (kind) {
      case "avg-latency":
        return s.avgLatencyMs;
      case "p95-latency":
        return s.p95LatencyMs;
      case "calls":
        return s.calls7d;
      case "error-rate":
        // 用 1 - successRate7d，归一化到百分比；保护无样本时的 NaN
        return s.calls7d === 0 ? 0 : (1 - s.successRate7d) * 100;
      case "token-consumption":
        return s.tokenConsumption7d;
    }
  });
}

/** 简单的折线 sparkline path 字符串。 */
function buildPath(
  values: number[],
  width: number,
  height: number,
  pad: number,
): { path: string; min: number; max: number } {
  const n = values.length;
  if (n === 0) {
    return { path: "", min: 0, max: 0 };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = n === 1 ? 0 : (width - pad * 2) / (n - 1);
  const points = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - (v - min) / range) * (height - pad * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return {
    path: `M ${points[0]} L ${points.slice(1).join(" ")}`,
    min,
    max,
  };
}

export type TelemetryMiniChartProps = {
  samples: RuntimeTelemetry[];
  metric: TelemetryMetricKind;
  width?: number;
  height?: number;
};

/**
 * 渲染单个指标的迷你趋势图。空样本时展示"暂无数据"占位。
 *
 * 调用示例：
 *   ${renderTelemetryMiniChart({ samples, metric: "avg-latency" })}
 */
export function renderTelemetryMiniChart(props: TelemetryMiniChartProps): TemplateResult {
  const { samples, metric, width = 160, height = 48 } = props;
  const meta = METRIC_META[metric];

  if (samples.length === 0) {
    return html`
      <div class="agent-runtime__mini-chart agent-runtime__mini-chart--empty">
        <span class="agent-runtime__mini-chart-label">${meta.label}</span>
        <span class="agent-runtime__mini-chart-empty">暂无数据</span>
      </div>
    `;
  }

  const values = extractValues(samples, metric);
  const last = values[values.length - 1] ?? 0;
  const tone = meta.toneOf(last);
  const { path, min, max } = buildPath(values, width, height, 4);

  return html`
    <div class="agent-runtime__mini-chart agent-runtime__mini-chart--is-${tone}">
      <header class="agent-runtime__mini-chart-header">
        <span class="agent-runtime__mini-chart-label">${meta.label}</span>
        <span class="agent-runtime__mini-chart-value">
          ${formatNumber(last)}${meta.unit ? html` <span class="agent-runtime__mini-chart-unit">${meta.unit}</span>` : nothing}
        </span>
      </header>
      <svg
        class="agent-runtime__mini-chart-svg"
        viewBox="0 0 ${width} ${height}"
        preserveAspectRatio="none"
        role="img"
        aria-label="${meta.label} 趋势图"
      >
        ${
          path
            ? svg`<path d=${path} fill="none" stroke="currentColor" stroke-width="1.5" />`
            : nothing
        }
      </svg>
      <footer class="agent-runtime__mini-chart-footer">
        <span class="agent-runtime__mini-chart-range">
          最小 ${formatNumber(min)}${meta.unit ? ` ${meta.unit}` : ""} ·
          最大 ${formatNumber(max)}${meta.unit ? ` ${meta.unit}` : ""}
        </span>
      </footer>
    </div>
  `;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString();
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(1);
}
