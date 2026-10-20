/**
 * Empty State — 「能力使用管理」模块的空状态占位组件。
 *
 * 所有子页在无数据时统一使用本组件渲染业务语言空状态文案。
 * CSS class: `enterprise-usage-empty-state`
 *
 * 落实需求：Requirements 4.10, 5.7, 6.10, 7.10
 */

import { html, type TemplateResult } from "lit-html";
import { USAGE_EMPTY_STATE } from "./styles.css.ts";

/**
 * 渲染空状态占位。
 *
 * @param message 业务语言文案（如"当前筛选条件下没有匹配的机器人"）
 */
export function renderEmptyState(message: string): TemplateResult {
  return html`
    <div class="${USAGE_EMPTY_STATE}">
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
          d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
      </svg>
      <p class="enterprise-usage-empty-state__message">${message}</p>
    </div>
  `;
}
