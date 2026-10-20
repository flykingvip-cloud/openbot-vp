import { html, nothing, type TemplateResult } from "lit";
import type { CapabilityUpdateRecap } from "../capability/employee-capability/types.ts";

export type CapabilityUpdateRecapTimelineProps = {
  recaps: CapabilityUpdateRecap[];
  loading: boolean;
};

function formatDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }
  return new Date(timestamp).toLocaleDateString("zh-CN");
}

export function renderCapabilityUpdateRecapTimeline(
  props: CapabilityUpdateRecapTimelineProps,
): TemplateResult | typeof nothing {
  if (props.loading) {
    return html`
      <section class="capability-update-recap-timeline" aria-label="最近更新">
        <p>加载中…</p>
      </section>
    `;
  }

  if (props.recaps.length === 0) {
    return nothing;
  }

  return html`
    <section class="capability-update-recap-timeline" aria-label="最近更新">
      <h3>最近更新</h3>
      <ol>
        ${props.recaps.map(
          (recap) => html`
            <li>
              <span>${recap.headline}</span>
              ${formatDate(recap.at) ? html`<time>${formatDate(recap.at)}</time>` : nothing}
            </li>
          `,
        )}
      </ol>
    </section>
  `;
}
