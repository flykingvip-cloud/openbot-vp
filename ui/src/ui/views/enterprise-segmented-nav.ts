/**
 * 企业端共享二级导航（segmented nav，药丸视图切换）
 *
 * ## 规范（见 docs/design/enterprise-ui-baseline.md §3.3）
 * - **顶部药丸 = 同一数据的视图切换**（如「概览 / 明细」「按部门 / 按数字人」）。
 * - 各模块一律复用本组件，禁止逐模块重写自造 `*-surface-nav` / `*-subnav` / `*-tabs`。
 * - 无障碍：容器 `role="tablist"`，各项 `role="tab"` + `aria-selected`，`title=hint`；
 *   选中态 `:focus-visible` 走 `--focus-ring`（样式见 enterprise-foundation.css）。
 *
 * 抽取自组织模块 `.enterprise-org-surface-nav` 的药丸 segmented control。
 */

import { html, nothing, type TemplateResult } from "lit";

export type EnterpriseSegmentedNavItem = {
  id: string;
  label: string;
  /** 悬停提示（无则不渲染 title 属性）。 */
  hint?: string;
  active: boolean;
  /** 提供 href 时渲染为 `<a>`，由上层 `@click` 委托处理 SPA 导航。 */
  href?: string;
};

/**
 * 渲染药丸 segmented control。
 *
 * @param items 视图项；`active` 为当前选中项（同一数据的不同视图）。
 * @param onSelect 点击某项时回调其 `id`（仅 button 模式；href 模式走委托导航）。
 */
export function renderEnterpriseSegmentedNav(
  items: EnterpriseSegmentedNavItem[],
  onSelect: (id: string) => unknown,
): TemplateResult {
  return html`
    <nav class="enterprise-segmented-nav" role="tablist">
      ${items.map((item) => {
        const className = `enterprise-segmented-nav__tab ${item.active ? "is-active" : ""}`;
        if (item.href) {
          return html`
            <a
              class=${className}
              href=${item.href}
              role="tab"
              aria-selected=${String(item.active)}
              title=${item.hint ?? nothing}
            >
              ${item.label}
            </a>
          `;
        }
        return html`
          <button
            class=${className}
            type="button"
            role="tab"
            aria-selected=${String(item.active)}
            title=${item.hint ?? nothing}
            @click=${() => onSelect(item.id)}
          >
            ${item.label}
          </button>
        `;
      })}
    </nav>
  `;
}
