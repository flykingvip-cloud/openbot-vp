import { html, type TemplateResult } from "lit";

export type CapabilityAttributionPanelProps = {
  attribution: {
    sourceRobot: { id: string; name: string };
    sourceTaskSummary: string;
    firstFormedScenario: string;
    highFrequencyScenarios: string[];
  };
  loading: boolean;
  onOpenRobot?: (robotId: string) => void;
};

export function renderCapabilityAttributionPanel(
  props: CapabilityAttributionPanelProps,
): TemplateResult {
  if (props.loading) {
    return html`
      <section class="capability-attribution-panel" aria-label="能力归因">
        <h3>能力归因</h3>
        <p>加载中…</p>
      </section>
    `;
  }

  const { attribution } = props;
  return html`
    <section class="capability-attribution-panel" aria-label="能力归因">
      <h3>能力归因</h3>
      <div class="capability-attribution-panel__rows">
        <div class="capability-attribution-panel__row">
          <span class="capability-attribution-panel__label">来源机器人</span>
          <button
            type="button"
            class="capability-attribution-panel__robot-link"
            @click=${() => props.onOpenRobot?.(attribution.sourceRobot.id)}
          >
            ${attribution.sourceRobot.name || "未知来源"}
          </button>
        </div>
        <div class="capability-attribution-panel__row">
          <span class="capability-attribution-panel__label">来源任务</span>
          <span>${attribution.sourceTaskSummary || "暂无"}</span>
        </div>
        <div class="capability-attribution-panel__row">
          <span class="capability-attribution-panel__label">首次形成场景</span>
          <span>${attribution.firstFormedScenario || "暂无"}</span>
        </div>
        <div class="capability-attribution-panel__row capability-attribution-panel__row--stack">
          <span class="capability-attribution-panel__label">高频场景</span>
          ${
            attribution.highFrequencyScenarios.length > 0
              ? html`
                  <div class="capability-attribution-panel__chips">
                    ${attribution.highFrequencyScenarios.map(
                      (scenario) =>
                        html`<span class="capability-attribution-panel__chip">${scenario}</span>`,
                    )}
                  </div>
                `
              : html`
                  <span>暂无</span>
                `
          }
        </div>
      </div>
    </section>
  `;
}
