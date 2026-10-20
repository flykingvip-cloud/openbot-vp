/**
 * Filter Bar — 「能力使用管理」模块的筛选栏容器组件。
 * 使用 inline style 确保在 lit-html 模板中正确渲染。
 */

import { html, type TemplateResult } from "lit-html";

export function renderFilterBar(children: TemplateResult): TemplateResult {
  return html`
    <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 16px;">
      ${children}
    </div>
  `;
}

export function renderSearchInput(props: {
  placeholder: string;
  value: string;
  onInput: (value: string) => void;
}): TemplateResult {
  return html`
    <input
      type="text"
      style="padding: 6px 12px; font-size: 13px; border: 1px solid #d1d5db; border-radius: 6px; outline: none; width: 180px;"
      placeholder=${props.placeholder}
      .value=${props.value}
      @input=${(e: Event) => props.onInput((e.target as HTMLInputElement).value)}
    />
  `;
}

export function renderSelect<T extends string>(props: {
  options: readonly { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
}): TemplateResult {
  return html`
    <select
      style="padding: 6px 12px; font-size: 13px; border: 1px solid #d1d5db; border-radius: 6px; outline: none; background: white; cursor: pointer;"
      @change=${(e: Event) => props.onChange((e.target as HTMLSelectElement).value as T)}
    >
      ${props.options.map(
        (opt) =>
          html`<option value=${opt.value} ?selected=${opt.value === props.value}>${opt.label}</option>`,
      )}
    </select>
  `;
}
