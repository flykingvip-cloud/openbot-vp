/**
 * Employee settings layout helpers for robots / collaboration-groups master-detail.
 */

import { html, nothing, type TemplateResult } from "lit";

export function wbSettingsSubhead(title: string, hint?: string) {
  return html`
    <div class="wb-groups__subhead">
      <span class="wb-groups__subhead-title">${title}</span>
      ${hint ? html`<span class="wb-groups__subhead-hint">${hint}</span>` : nothing}
    </div>
  `;
}

export function wbSettingsSection(params: {
  title: string;
  subtitle?: string;
  wide?: boolean;
  content: TemplateResult;
}) {
  return html`
    <section
      class="wb-groups__section ${params.wide ? "wb-groups__section--wide" : ""}"
      data-wb-settings-section=${params.title}
    >
      <div class="wb-groups__section-head">
        <div class="wb-groups__section-title">${params.title}</div>
        ${
          params.subtitle
            ? html`<div class="wb-groups__section-subtitle">${params.subtitle}</div>`
            : nothing
        }
      </div>
      <div class="wb-groups__section-body">${params.content}</div>
    </section>
  `;
}

export function wbSettingsDetailToolbar(params: {
  title: string;
  mission?: TemplateResult | typeof nothing;
  /** Retained for callers; dirty is signaled by primary Save styling, not a pill. */
  dirty?: boolean;
  actions: TemplateResult;
}) {
  void params.dirty;
  return html`
    <div class="wb-groups__toolbar" data-wb-settings-toolbar>
      <div class="wb-groups__toolbar-heading">
        <div class="wb-groups__stage-title">${params.title}</div>
        ${params.mission ?? nothing}
      </div>
      <div class="wb-groups__toolbar-actions">${params.actions}</div>
    </div>
  `;
}
