import { html, type TemplateResult } from "lit";
import type { SkillHealthSummary } from "../controllers/skill-health.ts";
import { formatRelativeTimestamp } from "../format.ts";

export type SkillHealthBadgeProps = {
  summary: SkillHealthSummary;
  variant: "inline" | "detail";
};

function statusColor(summary: SkillHealthSummary): string {
  switch (summary.status) {
    case "warning":
      return "amber";
    case "broken":
      return "red";
    default:
      return "green";
  }
}

function renderInline(props: SkillHealthBadgeProps): TemplateResult {
  const color = statusColor(props.summary);
  return html`
    <span class=${`skill-health-badge skill-health-badge--inline skill-health-badge--${color}`}>
      <span class="skill-health-badge__dot"></span>
      <span class="skill-health-badge__label">${props.summary.friendlyStatusLabel}</span>
    </span>
  `;
}

function renderDetail(props: SkillHealthBadgeProps): TemplateResult {
  const { summary } = props;
  const color = statusColor(summary);
  const successRateText =
    summary.successRate !== null ? `${Math.round(summary.successRate * 100)}%` : "暂无数据";
  const latencyText =
    summary.avgLatencyMs !== null ? `${Math.round(summary.avgLatencyMs)}ms` : "暂无数据";
  const lastVerifiedText = formatRelativeTimestamp(summary.lastVerifiedAt);

  return html`
    <div class=${`skill-health-badge skill-health-badge--detail skill-health-badge--${color}`}>
      <div class="skill-health-badge__header">
        <span class="skill-health-badge__dot"></span>
        <span class="skill-health-badge__label">${summary.friendlyStatusLabel}</span>
      </div>
      <div class="skill-health-badge__metrics">
        <span>成功率：${successRateText}</span>
        <span>平均耗时：${latencyText}</span>
        <span>最近验证：${lastVerifiedText}</span>
      </div>
    </div>
  `;
}

export function renderSkillHealthBadge(props: SkillHealthBadgeProps): TemplateResult {
  if (props.variant === "detail") {
    return renderDetail(props);
  }
  return renderInline(props);
}
