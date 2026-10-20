import { html, type TemplateResult } from "lit";
import type { CapabilityHealthLabel } from "../capability/employee-capability/types.ts";

export type CapabilityHealthBadgeVariant = "inline" | "detail";

export type CapabilityHealthBadgeProps = {
  label: CapabilityHealthLabel;
  variant: CapabilityHealthBadgeVariant;
};

export function healthRepairSuggestion(label: CapabilityHealthLabel): string | null {
  if (label === "偶尔异常") {
    return "偶尔没法稳定完成任务，建议稍后整理使用场景。";
  }
  if (label === "需要重新整理") {
    return "此能力暂时没法稳定完成任务，建议稍后重新整理。";
  }
  return null;
}

export function renderCapabilityHealthBadge(props: CapabilityHealthBadgeProps): TemplateResult {
  const suggestion = healthRepairSuggestion(props.label);
  return html`
    <span class=${`capability-health-badge capability-health-badge--${props.variant}`}>
      <span class="capability-health-badge__label">${props.label}</span>
      ${
        props.variant === "detail" && suggestion
          ? html`<span class="capability-health-badge__suggestion">${suggestion}</span>`
          : ""
      }
    </span>
  `;
}
