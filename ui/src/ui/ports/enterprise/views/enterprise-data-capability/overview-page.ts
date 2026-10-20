/**
 * 总览页 — KPI / 待办队列 / 产品排行的页面编排入口。
 */

import { html, type TemplateResult } from "lit";
import {
  buildOverviewActionQueue,
  type OverviewActionItem,
  type OverviewActionKind,
} from "./overview-action-queue.ts";

export { buildOverviewActionQueue, type OverviewActionItem, type OverviewActionKind };

/** 「需要处理」队列面板。 */
export function renderOverviewActionQueuePanel(
  items: OverviewActionItem[],
  onOpen: (item: OverviewActionItem) => void,
): TemplateResult {
  if (items.length === 0) {
    return html`
      <section
        class="enterprise-data-capability__panel enterprise-data-capability__panel--flat"
        aria-label="需要处理"
      >
        <div class="edc-section-label">需要处理</div>
        <div class="enterprise-data-capability__hint">当前没有待处理异常。</div>
      </section>
    `;
  }
  return html`
    <section
      class="enterprise-data-capability__panel enterprise-data-capability__panel--flat"
      aria-label="需要处理"
    >
      <div class="edc-section-label">需要处理</div>
      <ul class="enterprise-settings-row-list edc-policy-list">
        ${items.map(
          (item) => html`
            <li class="enterprise-settings-row">
              <div>
                <strong>${item.title}</strong>
                <span class="muted">${item.detail}</span>
              </div>
              <button
                type="button"
                class="btn btn--sm"
                aria-label=${`处理 ${item.title}`}
                title=${`处理 ${item.title}`}
                @click=${() => onOpen(item)}
              >
                去处理
              </button>
            </li>
          `,
        )}
      </ul>
    </section>
  `;
}

/** 总览页外壳（多段注入）。 */
export function renderOverviewPage(sections: TemplateResult[]): TemplateResult {
  return html`<div class="edc-page edc-page--overview">${sections}</div>`;
}
