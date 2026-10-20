import { html, nothing, type TemplateResult } from "lit";

/** 操作区统一副标题 */
export const ORG_WS_WORKSPACE_SUB = "在右侧完成配置并保存，左侧组织树保持可见。";

export type OrgWsTrailSegment = {
  label: string;
  onClick?: () => void;
};

/** Lightweight path trail: 组织与数字人 / 组织目录 / 当前面板 */
export function orgWsTrail(segments: OrgWsTrailSegment[]) {
  if (!segments.length) {
    return nothing;
  }
  return html`
    <nav class="enterprise-org-trail" aria-label="组织导航">
      ${segments.map(
        (segment, index) => html`
          ${
            index > 0
              ? html`
                  <span class="enterprise-org-trail__sep" aria-hidden="true">/</span>
                `
              : nothing
          }
          ${
            segment.onClick
              ? html`
                  <button
                    type="button"
                    class="enterprise-org-trail__link"
                    @click=${segment.onClick}
                  >
                    ${segment.label}
                  </button>
                `
              : html`<span class="enterprise-org-trail__current">${segment.label}</span>`
          }
        `,
      )}
    </nav>
  `;
}

export function orgWsHeader(params: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  closeLabel?: string;
}) {
  return html`
    <header class="enterprise-org-ws__header">
      <div class="enterprise-org-ws__headline">
        <div class="enterprise-org-ws__title">${params.title}</div>
        ${params.subtitle ? html`<div class="enterprise-org-ws__sub">${params.subtitle}</div>` : nothing}
      </div>
      <button class="btn btn--sm btn--ghost" type="button" @click=${params.onClose}>
        ${params.closeLabel ?? "关闭"}
      </button>
    </header>
  `;
}

export function orgWsBody(content: TemplateResult) {
  return html`<div class="enterprise-org-ws__body">${content}</div>`;
}

export function orgWsFooter(params: {
  onCancel?: () => void;
  cancelLabel?: string;
  primaryLabel?: string;
  onPrimary?: (event?: Event) => void;
  primaryDisabled?: boolean;
  busy?: boolean;
  extraStart?: TemplateResult;
}) {
  return html`
    <footer class="enterprise-org-ws__footer">
      <div class="enterprise-org-ws__footer-start">${params.extraStart ?? nothing}</div>
      <div class="enterprise-org-ws__footer-actions">
        ${
          params.onCancel
            ? html`
                <button
                  class="btn btn--sm"
                  type="button"
                  ?disabled=${params.busy}
                  @click=${params.onCancel}
                >
                  ${params.cancelLabel ?? "取消"}
                </button>
              `
            : nothing
        }
        ${
          params.primaryLabel && params.onPrimary
            ? html`
                <button
                  class="btn btn--sm btn--primary"
                  type="button"
                  ?disabled=${params.primaryDisabled || params.busy}
                  @click=${(event: Event) => params.onPrimary!(event)}
                >
                  ${params.busy ? "处理中..." : params.primaryLabel}
                </button>
              `
            : nothing
        }
      </div>
    </footer>
  `;
}

export type OrgWsKvItem = { label: string; value: string; mono?: boolean };

export function orgWsKvGrid(items: OrgWsKvItem[]) {
  return html`
    <div class="enterprise-org-ws__kv-grid">
      ${items.map(
        (item) => html`
          <div class="enterprise-org-ws__kv">
            <span class="enterprise-org-ws__kv-label">${item.label}</span>
            <span class="enterprise-org-ws__kv-value ${item.mono ? "mono" : ""}">${item.value}</span>
          </div>
        `,
      )}
    </div>
  `;
}

export function orgWsField(params: { label: string; alignTop?: boolean; content: TemplateResult }) {
  return html`
    <div
      class="enterprise-org-ws__field ${params.alignTop ? "enterprise-org-ws__field--stack" : ""}"
    >
      <span class="enterprise-org-ws__field-label">${params.label}</span>
      <div class="enterprise-org-ws__field-control">${params.content}</div>
    </div>
  `;
}

export function orgWsRadioRow(params: {
  legend?: string;
  name: string;
  value: string;
  disabled?: boolean;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return html`
    <div class="enterprise-org-ws__radio-row" role="radiogroup" aria-label=${params.legend ?? ""}>
      ${params.legend ? html`<span class="enterprise-org-ws__radio-row-label">${params.legend}</span>` : nothing}
      ${params.options.map(
        (opt) => html`
          <label class="enterprise-org-ws__radio-option">
            <input
              type="radio"
              name=${params.name}
              .checked=${params.value === opt.value}
              ?disabled=${params.disabled}
              @change=${() => params.onChange(opt.value)}
            />
            <span>${opt.label}</span>
          </label>
        `,
      )}
    </div>
  `;
}

export function orgWsNotice(params: { kind: "danger" | "ok"; content: TemplateResult | string }) {
  return html`
    <div class="enterprise-org-ws__notice enterprise-org-ws__notice--${params.kind}">
      ${params.content}
    </div>
  `;
}

export function orgWsDetailStack(content: TemplateResult) {
  return html`<div class="enterprise-org-ws__detail-stack">${content}</div>`;
}

export function orgWsMetaList(items: Array<{ title: string; detail: string; badge?: string }>) {
  if (!items.length) {
    return nothing;
  }
  return html`
    <ul class="enterprise-org-ws__meta-list">
      ${items.map(
        (item) => html`
          <li class="enterprise-org-ws__meta-item">
            <div class="enterprise-org-ws__meta-copy">
              <strong>${item.title}</strong>
              <span>${item.detail}</span>
            </div>
            ${item.badge ? html`<span class="enterprise-org-ws__meta-badge">${item.badge}</span>` : nothing}
          </li>
        `,
      )}
    </ul>
  `;
}

export function orgWsSection(params: { title?: string; content: TemplateResult }) {
  return html`
    <section class="enterprise-org-ws__section">
      ${params.title ? html`<div class="enterprise-org-ws__section-title">${params.title}</div>` : nothing}
      ${params.content}
    </section>
  `;
}

export function orgWsCheckboxGrid(params: {
  items: Array<{
    id: string;
    label: string;
    checked: boolean;
    disabled?: boolean;
    onToggle: () => void;
  }>;
  emptyLabel?: string;
}) {
  if (!params.items.length) {
    return html`<div class="enterprise-org-ws__empty">${params.emptyLabel ?? "暂无可选项。"}</div>`;
  }
  return html`
    <div class="enterprise-org-ws__checkbox-grid">
      ${params.items.map(
        (item) => html`
          <label class="enterprise-org-ws__checkbox-option">
            <input
              type="checkbox"
              .checked=${item.checked}
              ?disabled=${item.disabled}
              @change=${() => item.onToggle()}
            />
            <span>${item.label}</span>
          </label>
        `,
      )}
    </div>
  `;
}
