import { html, nothing, type TemplateResult } from "lit";
import type { CapabilityUsageBrief } from "../capability/employee-capability/types.ts";

export type CapabilityUsageBriefPanelProps = {
  usage: CapabilityUsageBrief | null;
  loading: boolean;
  actionLabel: string;
  onOpenRobot?: (robotId: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

export function renderCapabilityUsageBriefPanel(
  props: CapabilityUsageBriefPanelProps,
): TemplateResult | typeof nothing {
  if (!props.loading && (!props.usage || props.usage.robots.length === 0)) {
    return nothing;
  }

  if (props.loading) {
    return html`
      <section class="capability-usage-brief-panel" aria-label="能力使用简述">
        <p class="capability-usage-brief-panel__loading">加载中…</p>
      </section>
    `;
  }

  const usage = props.usage!;

  return html`
    <section class="capability-usage-brief-panel" aria-label="能力使用简述">
      <header class="capability-usage-brief-panel__header">
        <h3>正在被这些机器人使用</h3>
        <p>${props.actionLabel}前，请先确认这些机器人会受到影响。</p>
      </header>
      <ul class="capability-usage-brief-panel__robot-list">
        ${usage.robots.map(
          (robot) => html`
            <li class="capability-usage-brief-panel__robot-item">
              <button
                type="button"
                class="capability-usage-brief-panel__robot-link"
                @click=${() => props.onOpenRobot?.(robot.id)}
              >
                ${robot.name}
              </button>
            </li>
          `,
        )}
      </ul>
      <footer class="capability-usage-brief-panel__actions">
        <button type="button" @click=${props.onCancel}>取消</button>
        <button type="button" @click=${props.onConfirm}>确认继续</button>
      </footer>
    </section>
  `;
}
